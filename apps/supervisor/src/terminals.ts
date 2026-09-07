import type { Pool, PoolClient } from "pg";
import { transaction } from "../../../packages/storage/src/index.ts";
import {
  authorizePermission,
  HarborError,
} from "../../../packages/policy/src/index.ts";
import {
  requireAuthority,
  lockOwnerIdentity,
} from "../../../packages/policy/src/authority.ts";
import {
  selectedWorkspace,
  verifyWorkspace,
} from "../../../packages/workspaces/src/service.ts";
import {
  terminalRow,
  lockedTerminal,
  lockTerminalResource,
  requireController,
  pruneInput,
  pruneOutput,
  maintainTerminalOutput,
} from "../../../packages/terminals/src/store.ts";
import {
  CodexAdapter,
  RuntimeUncertainError,
} from "../../../packages/codex-adapter/src/index.ts";
import { createRuntime } from "../../../packages/codex-adapter/src/runtime.ts";
import { retireRuntimeIdentity } from "../../../infra/runner/authority.ts";
import type { Config } from "../../api/src/config.ts";
type Repair = {
  epoch: number;
  sequence: number;
  state: "delivered" | "denied" | "uncertain";
  failure: string | null;
};
type Owned = {
  id: string;
  generation: number;
  projectId: string;
  adapter?: CodexAdapter;
  queue: { sequence: number; bytes: Buffer }[];
  nextOutput: number;
  frozenOutput: number;
  queuedBytes: number;
  rateStart: number;
  rateBytes: number;
  lost: number;
  reason?: string;
  exitCode?: number;
  deadline?: NodeJS.Timeout;
  repairs: Repair[];
  guard: {
    kind: "launch" | "input" | "resize";
    actor: string;
    frame?: any;
    sent: boolean;
  };
};
/** Dedicated PTYs remain owned by this supervisor across every API/browser lifetime. */
export class TerminalSupervisor {
  private owned = new Map<string, Owned>();
  private starting = true;
  private lastHealthyTick = Date.now();
  private lastMaintenance = 0;
  private ticking = false;
  private timer?: NodeJS.Timeout;
  constructor(
    private pool: Pool,
    private c: Config,
    private current: () => boolean,
  ) {}
  start() {
    this.timer = setInterval(() => {
      if (Date.now() - this.lastHealthyTick > 30000)
        for (const r of this.owned.values())
          this.fail(r, "STORAGE_UNAVAILABLE");
      if (this.ticking || !this.current()) return;
      this.ticking = true;
      void this.tick()
        .then(() => {
          this.lastHealthyTick = Date.now();
        })
        .catch(() => {})
        .finally(() => {
          this.ticking = false;
        });
    }, 100);
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    for (const r of this.owned.values()) {
      r.reason = "SUPERVISOR_STOPPED";
      r.adapter?.close();
      if (r.deadline) clearTimeout(r.deadline);
    }
    await Promise.allSettled(
      [...this.owned.values()].map((r) => r.adapter?.closeAndWait()),
    );
  }
  private async currentGrant(db: PoolClient, lock = false) {
    if (!this.current())
      throw new HarborError(
        409,
        "SUPERVISOR_FENCED",
        "Supervisor authority lost",
      );
    if (
      (
        await db.query(
          "SELECT emergency FROM harbor_meta" + (lock ? " FOR SHARE" : ""),
        )
      ).rows[0].emergency
    )
      throw new HarborError(
        409,
        "EMERGENCY_STOPPED",
        "Emergency stop is enabled",
      );
  }
  private capture(r: Owned, method: string, p: any) {
    if (method !== "command/exec/outputDelta") return;
    if (
      p.processId !== r.id ||
      typeof p.deltaBase64 !== "string" ||
      p.deltaBase64.length > 1398104 ||
      !["stdout", "stderr"].includes(p.stream) ||
      typeof p.capReached !== "boolean"
    )
      return this.fail(r, "OUTPUT_PROTOCOL");
    const bytes = Buffer.from(p.deltaBase64, "base64");
    if (bytes.toString("base64") !== p.deltaBase64)
      return this.fail(r, "OUTPUT_PROTOCOL");
    if (Date.now() - r.rateStart >= 1000) {
      r.rateStart = Date.now();
      r.rateBytes = 0;
    }
    r.rateBytes += bytes.length;
    if (
      p.capReached ||
      r.rateBytes > 1048576 ||
      r.queuedBytes + bytes.length > 1048576
    ) {
      r.lost = ++r.nextOutput;
      return this.fail(r, "OUTPUT_LIMIT");
    }
    for (let offset = 0; offset < bytes.length; ) {
      const last = r.queue.at(-1);
      const append =
        last && last.sequence > r.frozenOutput && last.bytes.length < 16384;
      const room = append ? 16384 - last.bytes.length : 16384;
      const chunk = bytes.subarray(offset, offset + room);
      if (append) last.bytes = Buffer.concat([last.bytes, chunk]);
      else r.queue.push({ sequence: ++r.nextOutput, bytes: chunk });
      offset += chunk.length;
      r.queuedBytes += chunk.length;
    }
    if (r.queue.length > 256) {
      r.lost = ++r.nextOutput;
      this.fail(r, "OUTPUT_LIMIT");
    }
  }
  private fail(r: Owned, reason: string) {
    r.reason ??= reason;
    r.adapter?.close();
  }
  private async flush(r: Owned) {
    const chunks = r.queue.slice(),
      repairs = r.repairs.slice(),
      lost = r.lost,
      exitCode = r.exitCode;
    if (!chunks.length && !repairs.length && !lost && exitCode === undefined)
      return;
    r.frozenOutput = Math.max(r.frozenOutput, chunks.at(-1)?.sequence ?? 0);
    await transaction(this.pool, async (db) => {
      const t = await lockTerminalResource(db, r.id);
      if (Number(t.generation) !== r.generation)
        throw Error("Terminal generation changed");
      for (const chunk of chunks)
        if (chunk.sequence > Number(t.output_sequence))
          await db.query(
            "INSERT INTO terminal_output(terminal_id,sequence,bytes) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [r.id, chunk.sequence, chunk.bytes],
          );
      const high = Math.max(
        Number(t.output_sequence),
        lost,
        chunks.at(-1)?.sequence ?? 0,
      );
      await db.query(
        "UPDATE terminals SET output_sequence=$2,output_floor=greatest(output_floor,$3),output_lost=output_lost OR $4 WHERE id=$1",
        [r.id, high, lost, !!lost],
      );
      if (lost)
        await db.query(
          "DELETE FROM terminal_output WHERE terminal_id=$1 AND sequence<=$2",
          [r.id, lost],
        );
      for (const repair of repairs) {
        await db.query(
          "UPDATE terminal_input SET state=$4,bytes=NULL,settled_at=clock_timestamp(),failure_code=$5 WHERE terminal_id=$1 AND epoch=$2 AND sequence=$3 AND state IN ('accepted','dispatching')",
          [r.id, repair.epoch, repair.sequence, repair.state, repair.failure],
        );
        if (repair.state === "uncertain")
          await db.query(
            "UPDATE terminals SET input_uncertain=true,controller_until=NULL WHERE id=$1",
            [r.id],
          );
      }
      if (exitCode !== undefined)
        await db.query(
          "UPDATE terminals SET state='shell_exited',exit_code=$2,controller_until=NULL WHERE id=$1 AND state IN ('dispatching','running')",
          [r.id, exitCode],
        );
      await pruneInput(db, r.id);
      await pruneOutput(db, r.id);
    });
    r.queue.splice(0, chunks.length);
    r.queuedBytes -= chunks.reduce((n, c) => n + c.bytes.length, 0);
    r.repairs.splice(0, repairs.length);
    if (r.lost === lost) r.lost = 0;
    if (r.exitCode === exitCode) r.exitCode = undefined;
  }
  private async wire<T>(r: Owned, send: () => T): Promise<T> {
    return transaction(this.pool, async (db) => {
      const g = r.guard;
      // Match conversation dispatch: identity gate -> meta -> actor -> resource.
      // Emergency UPDATE cannot commit between this locked read and synchronous send.
      await lockOwnerIdentity(db);
      await this.currentGrant(db, true);
      const t = await lockedTerminal(
        db,
        r.id,
        g.actor,
        this.c,
        "terminal:control",
      );
      await this.currentGrant(db);
      authorizePermission(
        t.permission_profile,
        this.c.HARBOR_PERMISSION_CEILING,
      );
      if (Number(t.generation) !== r.generation || t.retired || r.reason)
        throw new HarborError(
          409,
          "TERMINAL_STATE",
          "Terminal generation is not active",
        );
      const w = await selectedWorkspace(db, t.workspace_id);
      if (
        w.writer_kind !== "terminal" ||
        w.writer_owner_id !== t.id ||
        Number(w.writer_epoch) !== Number(t.writer_epoch)
      )
        throw new HarborError(
          409,
          "RESERVATION_CHANGED",
          "Terminal reservation changed",
        );
      if (g.kind === "launch") {
        if (t.state !== "dispatching")
          throw new HarborError(
            409,
            "TERMINAL_STATE",
            "Terminal launch was retired",
          );
        if (
          !(
            await db.query(
              "SELECT 1 FROM terminals WHERE id=$1 AND deadline>clock_timestamp()",
              [t.id],
            )
          ).rowCount
        )
          throw new HarborError(
            409,
            "TERMINAL_EXPIRED",
            "Terminal lifetime ended",
          );
      } else {
        await requireController(db, t, g.actor, g.frame);
        if (g.kind === "input") {
          const changed = await db.query(
            "UPDATE terminal_input SET state='dispatching' WHERE terminal_id=$1 AND epoch=$2 AND sequence=$3 AND state='accepted' RETURNING sequence",
            [t.id, g.frame.epoch, g.frame.sequence],
          );
          if (!changed.rowCount)
            throw new HarborError(
              409,
              "INPUT_ALREADY_DISPATCHED",
              "Input cannot be replayed",
            );
        }
      }
      // The callback is synchronous: authority and state locks span the actual wire write.
      await requireAuthority(db, g.actor, this.c, {
        scope: "terminal:control",
        projectId: t.project_id,
        permissionProfile: t.permission_profile,
      });
      if (g.kind !== "launch") await requireController(db, t, g.actor, g.frame);
      if (!this.current())
        throw new HarborError(
          409,
          "SUPERVISOR_FENCED",
          "Supervisor authority lost",
        );
      g.sent = true;
      return send();
    });
  }
  private async launch(t: any) {
    const r: Owned = {
      id: t.id,
      generation: Number(t.generation),
      projectId: t.project_id,
      queue: [],
      nextOutput: Number(t.output_sequence),
      frozenOutput: Number(t.output_sequence),
      queuedBytes: 0,
      rateStart: Date.now(),
      rateBytes: 0,
      lost: 0,
      repairs: [],
      guard: { kind: "launch", actor: t.actor_hash, sent: false },
    };
    this.owned.set(t.id, r);
    r.deadline = setTimeout(
      () => this.fail(r, "LIFETIME_EXPIRED"),
      Math.max(1, new Date(t.deadline).getTime() - Date.now()),
    );
    try {
      const w = await transaction(this.pool, (db) =>
        selectedWorkspace(db, t.workspace_id),
      );
      const workspace = await verifyWorkspace(w);
      const adapter = await createRuntime({
        purpose: "terminal",
        sessionId: "terminal-" + t.id,
        projectId: t.project_id,
        workspaceId: w.id,
        workspacePath: workspace,
        workspaceDevice: w.device,
        workspaceInode: w.inode,
        gitCommon: w.common_path
          ? {
              canonical: w.common_path,
              device: w.common_device,
              inode: w.common_inode,
            }
          : undefined,
        generation: r.generation,
        instanceId: process.env.HARBOR_INSTANCE_ID ?? "harbor",
        permissionProfile: t.permission_profile,
        fixture:
          !!this.c.HARBOR_FIXTURE_MODE && !process.env.HARBOR_STORAGE_SOCKET,
        onTransport: (a) => {
          r.adapter = a;
        },
        withDispatch: (send) => this.wire(r, send),
        onEvent: (method, p) => this.capture(r, method, p),
        onDisconnect: () => {
          r.reason ??= "RUNTIME_INTERRUPTED";
        },
      });
      const shell = await adapter.startTerminal({
        processId: t.id,
        permissionProfile: t.permission_profile,
        cols: t.resize_cols,
        rows: t.resize_rows,
      });
      void shell.completion
        .then((result) => {
          r.exitCode = result.exitCode;
        })
        .catch(() => this.fail(r, "RUNTIME_INTERRUPTED"));
      await this.pool.query(
        "UPDATE terminals SET state='running' WHERE id=$1 AND generation=$2 AND state='dispatching'",
        [t.id, r.generation],
      );
    } catch {
      this.fail(r, "LAUNCH_UNCERTAIN");
    }
  }
  private async retire(t: any, r?: Owned) {
    if (r?.deadline) clearTimeout(r.deadline);
    try {
      if (r?.adapter) await r.adapter.closeAndWait();
      if (!this.c.HARBOR_FIXTURE_MODE || process.env.HARBOR_STORAGE_SOCKET)
        await retireRuntimeIdentity({
          instanceId: process.env.HARBOR_INSTANCE_ID ?? "harbor",
          projectId: t.project_id,
          sessionId: "terminal-" + t.id,
        });
      if (r) await this.flush(r);
      await transaction(this.pool, async (db) => {
        const w = await selectedWorkspace(db, t.workspace_id, true);
        await db.query("SELECT id FROM terminals WHERE id=$1 FOR UPDATE", [
          t.id,
        ]);
        const fresh = await terminalRow(db, t.id);
        if (Number(fresh.generation) !== Number(t.generation))
          throw Error("Terminal generation changed");
        if (fresh.writer_epoch !== null) {
          if (
            w.writer_kind !== "terminal" ||
            w.writer_owner_id !== t.id ||
            Number(w.writer_epoch) !== Number(fresh.writer_epoch)
          )
            throw Error("Terminal retirement reservation changed");
          await db.query(
            "UPDATE workspaces SET writer_kind=NULL,writer_owner_id=NULL,writer_generation=NULL WHERE id=$1 AND writer_kind='terminal' AND writer_owner_id=$2 AND writer_epoch=$3",
            [t.workspace_id, t.id, fresh.writer_epoch],
          );
        }
        const orphaned = !r && fresh.failure_code === "SUPERVISOR_RESTARTED";
        const uncertain = (
          await db.query(
            "SELECT 1 FROM terminal_input WHERE terminal_id=$1 AND (state='dispatching' OR ($2 AND state='accepted')) LIMIT 1",
            [t.id, orphaned],
          )
        ).rowCount;
        await db.query(
          "UPDATE terminal_input SET state=CASE WHEN state='dispatching' OR $2 THEN 'uncertain' ELSE 'denied' END,bytes=NULL,settled_at=clock_timestamp(),failure_code='TERMINAL_RETIRED' WHERE terminal_id=$1 AND state IN ('accepted','dispatching')",
          [t.id, orphaned],
        );
        await db.query(
          "UPDATE terminals SET state=CASE WHEN failure_code IS NULL THEN 'terminated' ELSE 'interrupted' END,retired=true,writer_epoch=NULL,controller_until=NULL,input_uncertain=input_uncertain OR $2 WHERE id=$1",
          [t.id, !!uncertain],
        );
        await pruneInput(db, t.id);
      });
      this.owned.delete(t.id);
    } catch {
      // Keep the exact handle and durable ownership. A deliberate retry may reconcile it.
      await this.pool
        .query(
          "UPDATE terminals SET state='uncertain',failure_code='RETIREMENT_UNCONFIRMED',controller_until=NULL WHERE id=$1 AND NOT retired",
          [t.id],
        )
        .catch(() => {});
    }
  }
  private async tick() {
    if (Date.now() - this.lastMaintenance > 30000) {
      await maintainTerminalOutput(this.pool);
      this.lastMaintenance = Date.now();
    }
    if (this.starting) {
      await this.pool.query(
        "UPDATE terminals SET state='retiring',failure_code='SUPERVISOR_RESTARTED',controller_until=NULL,output_lost=true WHERE NOT retired AND state<>'queued'",
      );
      this.starting = false;
    }
    for (const r of this.owned.values()) await this.flush(r);
    const meta = (await this.pool.query("SELECT emergency FROM harbor_meta"))
      .rows[0];
    const rows = (
      await this.pool.query(
        "SELECT * FROM terminals WHERE NOT retired ORDER BY created_at LIMIT 256",
      )
    ).rows;
    for (const t of rows) {
      const r = this.owned.get(t.id);
      if (t.state === "dispatching" && !r) {
        await this.pool.query(
          "UPDATE terminals SET state='retiring',failure_code='ADMISSION_UNCONFIRMED',controller_until=NULL WHERE id=$1 AND state='dispatching'",
          [t.id],
        );
        t.state = "retiring";
        t.failure_code = "ADMISSION_UNCONFIRMED";
      }
      if (
        t.state !== "uncertain" &&
        (meta.emergency ||
          new Date(t.deadline).getTime() <= Date.now() ||
          r?.reason)
      ) {
        const reason =
          r?.reason ??
          (meta.emergency ? "EMERGENCY_STOPPED" : "LIFETIME_EXPIRED");
        r?.adapter?.close();
        await this.pool.query(
          "UPDATE terminals SET state='retiring',failure_code=$2,controller_until=NULL WHERE id=$1 AND NOT retired",
          [t.id, reason],
        );
        t.state = "retiring";
        t.failure_code = reason;
      }
      if (t.state === "retiring") {
        await this.retire(t, r);
        continue;
      }
      if (t.state !== "running" || !r?.adapter) continue;
      for (const input of (
        await this.pool.query(
          "SELECT * FROM terminal_input WHERE terminal_id=$1 AND state='accepted' ORDER BY epoch,sequence LIMIT 8",
          [t.id],
        )
      ).rows) {
        const frame = {
          generation: r.generation,
          epoch: Number(input.epoch),
          sequence: Number(input.sequence),
          controllerId: input.controller_id,
        };
        r.guard = {
          kind: "input",
          actor: input.actor_hash,
          frame,
          sent: false,
        };
        let state: Repair["state"] = "delivered",
          failure: string | null = null;
        try {
          await r.adapter.writeTerminal(input.bytes);
        } catch (error) {
          state = r.guard.sent ? "uncertain" : "denied";
          failure =
            error instanceof HarborError
              ? error.code
              : "INPUT_DELIVERY_UNCERTAIN";
        }
        r.repairs.push({
          epoch: frame.epoch,
          sequence: frame.sequence,
          state,
          failure,
        });
        await this.flush(r);
        if (state === "uncertain") break;
      }
      const fresh = (
        await this.pool.query("SELECT * FROM terminals WHERE id=$1", [t.id])
      ).rows[0];
      if (fresh.resize_pending && fresh.controller_actor) {
        const frame = {
          generation: r.generation,
          epoch: Number(fresh.controller_epoch),
          controllerId: fresh.controller_id,
        };
        r.guard = {
          kind: "resize",
          actor: fresh.controller_actor,
          frame,
          sent: false,
        };
        try {
          await r.adapter.resizeTerminal(fresh.resize_cols, fresh.resize_rows);
        } catch {
          /* Resize is idempotent; stale control is discarded. */
        }
        await this.pool.query(
          "UPDATE terminals SET resize_pending=false WHERE id=$1 AND controller_epoch=$2 AND resize_sequence=$3",
          [t.id, frame.epoch, fresh.resize_sequence],
        );
      }
    }
    if (meta.emergency) return;
    const queued = (
      await this.pool.query(
        "SELECT * FROM terminals WHERE state='queued' ORDER BY created_at LIMIT 8",
      )
    ).rows;
    for (const t of queued) {
      let accepted = false;
      try {
        accepted = await transaction(this.pool, async (db) => {
          await requireAuthority(db, t.actor_hash, this.c, {
            scope: "terminal:control",
            projectId: t.project_id,
            permissionProfile: t.permission_profile,
          });
          authorizePermission(
            t.permission_profile,
            this.c.HARBOR_PERMISSION_CEILING,
          );
          await db.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('terminal-capacity',0))",
          );
          const w = await selectedWorkspace(db, t.workspace_id, true);
          await db.query("SELECT id FROM terminals WHERE id=$1 FOR UPDATE", [
            t.id,
          ]);
          const fresh = await terminalRow(db, t.id);
          if (fresh.state !== "queued") return false;
          await this.currentGrant(db);
          if (w.state !== "ready" || w.project_archived)
            throw new HarborError(
              409,
              "WORKSPACE_UNAVAILABLE",
              "Workspace unavailable",
            );
          if (w.writer_owner_id) return false;
          if (
            (
              await db.query(
                "SELECT 1 FROM file_operations WHERE project_id=$1 AND kind IN ('stage','unstage','commit') AND state IN ('dispatching','uncertain') AND acknowledged_at IS NULL LIMIT 1",
                [t.project_id],
              )
            ).rowCount
          )
            return false;
          if (
            (
              await db.query(
                "SELECT 1 FROM workspace_storage_operations WHERE project_id=$1 AND state IN ('queued','dispatching') LIMIT 1",
                [t.project_id],
              )
            ).rowCount
          )
            return false;
          if (
            Number(
              (
                await db.query(
                  "SELECT count(*) AS n FROM terminals WHERE NOT retired AND state<>'queued'",
                )
              ).rows[0].n,
            ) >= 4
          )
            return false;
          await verifyWorkspace(w);
          await requireAuthority(db, t.actor_hash, this.c, {
            scope: "terminal:control",
            projectId: t.project_id,
            permissionProfile: t.permission_profile,
          });
          const claim = (
            await db.query(
              "UPDATE workspaces SET writer_kind='terminal',writer_owner_id=$2,writer_generation=NULL WHERE id=$1 AND writer_owner_id IS NULL RETURNING writer_epoch",
              [w.id, t.id],
            )
          ).rows[0];
          if (!claim) return false;
          await db.query(
            "UPDATE terminals SET state='dispatching',writer_epoch=$2 WHERE id=$1",
            [t.id, claim.writer_epoch],
          );
          return true;
        });
      } catch (error) {
        if (error instanceof HarborError)
          await this.pool.query(
            "UPDATE terminals SET state='failed',retired=true,failure_code=$2 WHERE id=$1 AND state='queued'",
            [t.id, error.code],
          );
        else throw error;
      }
      if (accepted) await this.launch(t);
    }
  }
}
