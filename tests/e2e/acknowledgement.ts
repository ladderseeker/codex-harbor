/** P001 ordinary conversation ACK versus native request persistence. */
import {
  expect,
  type APIResponse,
  type BrowserContext,
} from "@playwright/test";
import type { Pool, PoolClient } from "pg";
import {
  acknowledgementPool,
  releaseAcknowledgementGate,
} from "./acknowledgement-db.ts";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export async function acknowledgementContention(o: {
  db: Pool;
  command(route: string, body: unknown, key?: string): Promise<APIResponse>;
  context: BrowserContext;
  origin: string;
  sessionId: string;
  traceFile: string;
  artifacts: string;
}) {
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const session = { id: o.sessionId };
  expect(session.id).toMatch(/^[a-f0-9-]{36}$/);
  const db = acknowledgementPool(o.db.options.connectionString!);
  let gate: PoolClient | undefined;
  let released = false,
    primary: unknown;
  let operationId: string | undefined,
    ackPid: number | undefined,
    requestPid: number | undefined;
  const cleanupErrors: string[] = [];
  try {
    gate = await db.connect();
    await gate.query("BEGIN");
    await gate.query("SET LOCAL statement_timeout='12s'");
    const gatePid = Number(
      (await gate.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    );
    await gate.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      session.id,
    ]);
    await db.query(
      `CREATE FUNCTION p001_ack_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(hashtextextended(NEW.session_id::text,0)); RETURN NEW; END $$`,
    );
    await db.query(
      `CREATE TRIGGER p001_ack_barrier BEFORE UPDATE ON operations FOR EACH ROW WHEN (OLD.state='dispatching' AND NEW.state='running' AND NEW.session_id='${session.id}'::uuid) EXECUTE FUNCTION p001_ack_barrier()`,
    );
    const accepted = await o.command(`/sessions/${session.id}/turns`, {
      ...settings,
      text: "[approval] [ack-lock]",
    });
    expect(accepted.status()).toBe(202);
    operationId = (await accepted.json()).operation.id;
    await expect
      .poll(
        async () => {
          const rows = (
            await db.query(
              "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND $1::int=ANY(pg_blocking_pids(pid)) AND query LIKE '%UPDATE operations SET state=%'",
              [gatePid],
            )
          ).rows;
          if (rows.length === 1) ackPid = Number(rows[0].pid);
          return rows.length;
        },
        { timeout: 10000 },
      )
      .toBe(1);
    await expect
      .poll(
        async () => {
          // The fixture emits only the approval after ACK for this marker. Its
          // request handler is therefore the session-row contender, not an earlier
          // turn/started notification or a synthetic Harbor transaction.
          const rows = (
            await db.query(
              "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid)) AND query='SELECT id FROM sessions WHERE id=$1 FOR UPDATE'",
              [ackPid],
            )
          ).rows;
          if (rows.length === 1) requestPid = Number(rows[0].pid);
          return rows.length;
        },
        { timeout: 10000 },
      )
      .toBe(1);
    expect(requestPid).not.toBe(ackPid);
    await gate.query("COMMIT");
    released = true;
    const snapshot = async () =>
      (
        await o.context.request.get(
          o.origin + `/api/v1/sessions/${session.id}/snapshot`,
        )
      ).json();
    await expect
      .poll(
        async () =>
          (await snapshot()).approvals.filter(
            (a: any) => a.operationId === operationId && a.state === "pending",
          ).length,
        { timeout: 10000 },
      )
      .toBe(1);
    const approval = (await snapshot()).approvals.find(
      (a: any) => a.operationId === operationId,
    );
    expect(
      (
        await o.command(`/approvals/${approval.id}/answer`, {
          generation: approval.generation,
          decision: "accept",
        })
      ).status(),
    ).toBe(202);
    await expect
      .poll(
        async () =>
          (await snapshot()).operations.find((v: any) => v.id === operationId)
            ?.state,
        { timeout: 10000 },
      )
      .toBe("succeeded");
    const final = await snapshot();
    expect(
      final.approvals.filter((a: any) => a.operationId === operationId),
    ).toHaveLength(1);
    expect(
      final.messages
        .filter(
          (m: any) => m.operationId === operationId && m.role === "assistant",
        )
        .map((m: any) => m.text)
        .join(""),
    ).toContain("Approved input received.");
    const native = (
      await db.query(
        "SELECT native_thread_id,native_turn_id FROM sessions WHERE id=$1",
        [session.id],
      )
    ).rows[0];
    const sends = (await readFile(o.traceFile, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((v) => JSON.parse(v))
      .filter(
        (v) =>
          v.method === "turn/start" && v.threadId === native.native_thread_id,
      );
    expect(sends).toHaveLength(1);
    expect(
      (
        await db.query(
          "SELECT count(*) FROM events WHERE session_id=$1 AND type='operation.uncertain'",
          [session.id],
        )
      ).rows[0].count,
    ).toBe("0");
  } catch (error) {
    primary = error;
  } finally {
    if (gate) await releaseAcknowledgementGate(gate, released, cleanupErrors);
    // Cleanup timeout cannot mask the first assertion or hang the shared lane.
    let cleanup: import("pg").PoolClient | undefined;
    try {
      cleanup = await db.connect();
      await cleanup.query("SET statement_timeout='5s'");
      // Names belong to this one case in the harness's fresh database. Reconcile
      // DDL even when its command committed but its reply was lost.
      await cleanup.query(
        "DROP TRIGGER IF EXISTS p001_ack_barrier ON operations",
      );
      await cleanup.query("DROP FUNCTION IF EXISTS p001_ack_barrier()");
    } catch {
      cleanupErrors.push("BARRIER_REMOVAL_FAILED");
    } finally {
      if (cleanup) {
        await cleanup.query("RESET statement_timeout").catch(() => {});
        cleanup.release(true);
      }
    }
    await db.end().catch(() => cleanupErrors.push("OWNED_POOL_CLOSE_FAILED"));
  }
  try {
    await writeFile(
      path.join(o.artifacts, "acknowledgement-contention.json"),
      JSON.stringify(
        {
          passed: !primary && cleanupErrors.length === 0,
          scope:
            "Actual Harbor API/PostgreSQL/supervisor ordinary conversation with external Codex/OIDC fixtures; no native/live/Linux claim",
          sessionId: session.id,
          operationId,
          ackPid,
          requestPid,
          cleanupErrors,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (!primary) primary = error;
  }
  if (primary) throw primary;
  expect(cleanupErrors).toEqual([]);
}
