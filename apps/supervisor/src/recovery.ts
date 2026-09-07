import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { event, transaction } from "../../../packages/storage/src/index.ts";
import type { CodexAdapter } from "../../../packages/codex-adapter/src/index.ts";
export interface RecoveryHooks {
  pool: Pool;
  /** Authority lock precedes project -> workspace -> session ownership locks. */
  authority(db: PoolClient, actor: string): Promise<void>;
  lockWorkspace?(db: PoolClient, sessionId: string): Promise<void>;
  retireSession(session: any): Promise<void>;
  probe(session: any, generation: number): Promise<CodexAdapter>;
  retireProbe(adapter: CodexAdapter): Promise<boolean>;
  releaseWorkspace?(
    db: PoolClient,
    input: {
      workspaceId: string;
      sessionId: string;
      generation: number | null;
      recoveryId: string;
    },
  ): Promise<void>;
}
const failedReport = {
  status: "unavailable",
  reason:
    "Retirement or persistence could not be confirmed; original uncertainty remains",
};
// At most the configured 200 conversations can own a repair. A failed repair
// blocks this poll before it can admit another recovery or dispatch new work.
const settlementRepairs = new Map<string, number>();
async function repairSettlements(pool: Pool) {
  for (const [id, attempt] of settlementRepairs) {
    await pool.query(
      "UPDATE session_recoveries SET state='failed',report=$3,updated_at=now() WHERE id=$1 AND attempts=$2 AND state IN ('queued','fencing')",
      [id, attempt, JSON.stringify(failedReport)],
    );
    settlementRepairs.delete(id);
  }
}
async function lockedSession(h: RecoveryHooks, db: PoolClient, r: any) {
  await h.authority(db, r.actor_hash);
  await h.lockWorkspace?.(db, r.session_id);
  const s = (
    await db.query(
      "SELECT s.*,p.root_id,w.device,w.inode,w.relative_path,w.canonical_path,w.common_path,w.common_device,w.common_inode,w.writer_session_id,w.writer_generation FROM sessions s JOIN projects p ON p.id=s.project_id JOIN workspaces w ON w.id=s.workspace_id WHERE s.id=$1 FOR UPDATE OF s",
      [r.session_id],
    )
  ).rows[0];
  await h.authority(db, r.actor_hash);
  if (!s || Number(s.generation) !== Number(r.expected_generation))
    throw Error("Recovery generation changed");
  return s;
}
/** Never sends a turn or approval. Exact retirement and reservation CAS are serialized. */
export async function processRecovery(h: RecoveryHooks) {
  await repairSettlements(h.pool);
  if (settlementRepairs.size >= 200)
    throw Error("Recovery settlement capacity reached");
  const next = (
    await h.pool.query(
      "SELECT * FROM session_recoveries WHERE state='queued' ORDER BY created_at,id LIMIT 1",
    )
  ).rows[0];
  if (!next) return;
  let admitted = false;
  try {
    await transaction(h.pool, async (db) => {
      await lockedSession(h, db, next);
      const result = await db.query(
        "UPDATE session_recoveries SET state='fencing',updated_at=now() WHERE id=$1 AND state='queued' AND attempts=$2 RETURNING id",
        [next.id, next.attempts],
      );
      if (!result.rowCount) return;
      await db.query(
        "INSERT INTO recovery_audits(recovery_id,slot,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [
          next.id,
          next.attempts,
          JSON.stringify({ kind: "fence-attempt", attempt: next.attempts }),
        ],
      );
      admitted = true;
    });
  } catch {
    // A lost COMMIT reply may mean fencing was recorded. Register repair first.
    settlementRepairs.set(next.id, next.attempts);
    await h.pool.query(
      "UPDATE session_recoveries SET state='failed',report=$3,updated_at=now() WHERE id=$1 AND attempts=$2 AND state IN ('queued','fencing')",
      [next.id, next.attempts, JSON.stringify(failedReport)],
    );
    settlementRepairs.delete(next.id);
    return;
  }
  if (!admitted) return;
  let probe: CodexAdapter | undefined;
  try {
    await transaction(h.pool, async (db) => {
      const session = await lockedSession(h, db, next);
      const current = (
        await db.query(
          "SELECT * FROM session_recoveries WHERE id=$1 FOR UPDATE",
          [next.id],
        )
      ).rows[0];
      if (current.state !== "fencing" || current.attempts !== next.attempts)
        throw Error("Recovery attempt changed");
      // Keep authority and workspace/session ownership through trusted retirement,
      // the read-only probe, and final release. P003 cannot retire a successor here.
      await h.retireSession(session);
      const epoch = Number(
        (
          await db.query(
            "SELECT nextval('runtime_generation_seq') AS generation",
          )
        ).rows[0].generation,
      );
      let report: any = {
          status: "unavailable",
          reason:
            "No confirmed native thread reference; durable history retained",
        },
        native: any;
      if (session.native_thread_id) {
        try {
          probe = await h.probe(session, epoch);
          const result = await probe.readThread(session.native_thread_id);
          if (Buffer.byteLength(JSON.stringify(result)) > 2097152)
            report = {
              status: "truncated",
              reason: "Native read exceeds 2 MiB; durable history retained",
            };
          else {
            if (
              !result.thread ||
              result.thread.id !== session.native_thread_id ||
              !Array.isArray(result.thread.turns)
            )
              throw Error("Incomplete native thread read");
            native = result.thread;
            report = {
              status: "available",
              repairedItems: 0,
              conflicts: 0,
              truncated: false,
            };
          }
        } catch {
          report = {
            status: "unavailable",
            reason: "Native read failed; durable history retained",
          };
        }
      }
      if (probe && !(await h.retireProbe(probe)))
        throw Error("Probe retirement unconfirmed");
      probe = undefined;
      await h.retireSession(session);
      await h.authority(db, next.actor_hash);
      if (h.releaseWorkspace)
        await h.releaseWorkspace(db, {
          workspaceId: session.workspace_id,
          sessionId: session.id,
          generation:
            session.writer_generation === null
              ? null
              : Number(session.writer_generation),
          recoveryId: next.id,
        });
      if (native) await reconcileNative(db, session.id, native, report);
      await db.query(
        "UPDATE approvals SET state='expired',answer=NULL WHERE session_id=$1 AND state IN ('pending','answering')",
        [session.id],
      );
      await db.query(
        "UPDATE operations SET state='interrupted',updated_at=now() WHERE session_id=$1 AND state='queued'",
        [session.id],
      );
      await db.query("UPDATE sessions SET generation=$2 WHERE id=$1", [
        session.id,
        epoch,
      ]);
      await db.query(
        "UPDATE session_recoveries SET state='ready',fence_generation=$2,report=$3,updated_at=now() WHERE id=$1",
        [next.id, epoch, JSON.stringify(report)],
      );
      await event(db, session.id, "recovery.ready", {
        recoveryId: next.id,
        generation: epoch,
        report,
      });
      await h.authority(db, next.actor_hash);
    });
  } catch {
    settlementRepairs.set(next.id, next.attempts);
    if (probe) await h.retireProbe(probe);
    await repairSettlements(h.pool);
  }
}
async function reconcileNative(
  db: PoolClient,
  id: string,
  native: any,
  report: any,
) {
  const turns = Array.isArray(native.turns) ? native.turns : [];
  let items = 0,
    bytes = Number(
      (
        await db.query(
          "SELECT coalesce(sum(octet_length(text)),0) AS bytes FROM messages WHERE session_id=$1",
          [id],
        )
      ).rows[0].bytes,
    );
  let count = Number(
    (await db.query("SELECT count(*) FROM messages WHERE session_id=$1", [id]))
      .rows[0].count,
  );
  for (const turn of turns)
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      if (++items > 2000) {
        report.truncated = true;
        return;
      }
      if (
        item.type !== "agentMessage" ||
        typeof item.id !== "string" ||
        item.id.length > 256 ||
        typeof item.text !== "string"
      )
        continue;
      const old = (
        await db.query(
          "SELECT * FROM messages WHERE session_id=$1 AND native_item_id=$2",
          [id, item.id],
        )
      ).rows[0];
      if (old?.status === "complete") {
        if (old.text !== item.text) report.conflicts++;
        continue;
      }
      // Only extend a matching prefix. Conflicting/incomplete reads never replace durable text.
      if (old && !item.text.startsWith(old.text)) {
        report.conflicts++;
        continue;
      }
      const extra =
        Buffer.byteLength(item.text) - Buffer.byteLength(old?.text ?? "");
      if (bytes + extra > 2097152 || (!old && count >= 2000)) {
        report.truncated = true;
        continue;
      }
      const operation =
        (
          await db.query(
            "SELECT id FROM operations WHERE session_id=$1 AND native_turn_id=$2",
            [id, turn.id],
          )
        ).rows[0]?.id ?? null;
      if (old)
        await db.query("UPDATE messages SET text=$2,status=$3 WHERE id=$1", [
          old.id,
          item.text,
          turn.status === "completed" ? "complete" : "recovered",
        ]);
      else {
        await db.query(
          "INSERT INTO messages(id,session_id,operation_id,native_item_id,role,text,status) VALUES($1,$2,$3,$4,'assistant',$5,$6)",
          [
            randomUUID(),
            id,
            operation,
            item.id,
            item.text,
            turn.status === "completed" ? "complete" : "recovered",
          ],
        );
        count++;
      }
      bytes += extra;
      report.repairedItems++;
    }
}
