import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { transaction } from "../../../packages/storage/src/index.ts";
import {
  deploymentAdmission,
  deploymentState,
} from "../../../packages/storage/src/deployment.ts";
import { lockOwnerIdentity } from "../../../packages/policy/src/authority.ts";
import {
  HarborError,
  authorizePermission,
} from "../../../packages/policy/src/index.ts";
import {
  lockedPreview,
  previewRow,
  requirePreviewAuthority,
  revokePreviewAccess,
} from "../../../packages/previews/src/store.ts";
import {
  selectedWorkspace,
  verifyWorkspace,
} from "../../../packages/workspaces/src/service.ts";
import { createRuntime } from "../../../packages/codex-adapter/src/runtime.ts";
import type { CodexAdapter } from "../../../packages/codex-adapter/src/index.ts";
import {
  launchRelay,
  retireRelay,
  type PreviewRelay,
} from "../../../infra/previews/launcher.ts";
import { startPreviewBroker } from "../../../infra/previews/broker.ts";
import { retireRuntimeIdentity } from "../../../infra/runner/authority.ts";
import type { RelayOutput } from "../../../infra/previews/protocol.ts";
import type { Config } from "../../api/src/config.ts";
type Owned = {
  id: string;
  project: string;
  generation: number;
  actor: string;
  adapter?: CodexAdapter;
  relay?: PreviewRelay;
  reason?: string;
  exit?: number;
  deadline: NodeJS.Timeout;
  queue: { sequence: number; bytes: Buffer }[];
  high: number;
  queuedBytes: number;
  rate: { at: number; bytes: number }[];
  lost: boolean;
  sent: boolean;
};
export class PreviewSupervisor {
  private owned = new Map<string, Owned>();
  private timer?: NodeJS.Timeout;
  private brokerClose?: () => Promise<void>;
  private busy = false;
  private first = true;
  private healthy = Date.now();
  private maintenance = 0;
  constructor(
    private pool: Pool,
    private c: Config,
    private current: () => boolean,
  ) {}
  async start() {
    if (!this.c.HARBOR_PREVIEW_SOCKET || !this.c.HARBOR_PREVIEW_DOMAIN) return;
    this.brokerClose = await startPreviewBroker(this.pool, this.c, (id) => {
      const r = this.owned.get(id);
      return r?.relay && !r.reason
        ? { generation: r.generation, relay: r.relay }
        : undefined;
    });
    this.timer = setInterval(() => {
      if (Date.now() - this.healthy > 30000 || !this.current())
        for (const r of this.owned.values())
          this.fail(r, "STORAGE_UNAVAILABLE");
      if (this.busy || !this.current()) return;
      this.busy = true;
      void this.tick()
        .then(() => {
          this.healthy = Date.now();
        })
        .catch(() => undefined)
        .finally(() => {
          this.busy = false;
        });
    }, 100);
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.brokerClose?.();
    for (const r of this.owned.values()) this.fail(r, "SUPERVISOR_STOPPED");
    await Promise.allSettled(
      [...this.owned.values()].map(async (r) => {
        await r.relay?.close();
        await r.adapter?.closeAndWait();
      }),
    );
  }
  private fail(r: Owned, reason: string) {
    r.reason ??= reason;
    r.adapter?.close();
    void r.relay?.close().catch(() => undefined);
  }
  private async owner(db: PoolClient) {
    await lockOwnerIdentity(db);
    const meta = (await db.query("SELECT emergency FROM harbor_meta FOR SHARE"))
      .rows[0];
    if (!this.current() || meta.emergency)
      throw new HarborError(
        409,
        "PREVIEW_FENCED",
        "Preview execution authority is unavailable",
      );
  }
  private async wire<T>(r: Owned, send: () => T) {
    return transaction(this.pool, async (db) => {
      await this.owner(db);
      const before = await previewRow(db, r.id);
      await requirePreviewAuthority(db, before, r.actor, this.c, "start");
      await deploymentAdmission(db);
      const { p, w } = await lockedPreview(db, r.id);
      if (
        r.reason ||
        !this.current() ||
        p.state !== "starting" ||
        p.retired ||
        Number(p.generation) !== r.generation ||
        w.state !== "ready" ||
        w.project_archived
      )
        throw new HarborError(
          409,
          "PREVIEW_FENCED",
          "Preview launch changed before dispatch",
        );
      await this.lease(db, p, w);
      await requirePreviewAuthority(db, p, r.actor, this.c, "start");
      if (!this.current() || r.reason)
        throw new HarborError(409, "PREVIEW_FENCED", "Preview authority lost");
      r.sent = true;
      return send();
    });
  }
  private async lease(db: PoolClient, p: any, w: any) {
    if (p.permission_profile === "workspace-write") {
      if (
        w.writer_kind !== "preview" ||
        w.writer_owner_id !== p.id ||
        String(w.writer_epoch) !== String(p.lease_epoch)
      )
        throw Error("Preview writer lease changed");
    } else if (
      !(
        await db.query(
          "SELECT 1 FROM preview_readers WHERE owner_id=$1 AND workspace_id=$2 AND generation=$3 AND epoch=$4",
          [p.id, w.id, p.generation, p.lease_epoch],
        )
      ).rowCount
    )
      throw Error("Preview reader lease changed");
  }
  private capture(r: Owned, method: string, value: any) {
    if (method !== "command/exec/outputDelta") return;
    if (
      value.processId !== r.id ||
      !["stdout", "stderr"].includes(value.stream) ||
      typeof value.deltaBase64 !== "string" ||
      value.deltaBase64.length > 1048576 ||
      typeof value.capReached !== "boolean"
    )
      return this.fail(r, "LOG_PROTOCOL");
    const chunk = Buffer.from(value.deltaBase64, "base64"),
      now = Date.now();
    if (chunk.toString("base64") !== value.deltaBase64)
      return this.fail(r, "LOG_PROTOCOL");
    while (r.rate.length && r.rate[0].at <= now - 1000) r.rate.shift();
    if (
      value.capReached ||
      r.rate.length >= 1024 ||
      r.rate.reduce((n, v) => n + v.bytes, 0) + chunk.length > 65536 ||
      r.queuedBytes + chunk.length > 262144
    ) {
      r.lost = true;
      return this.fail(r, "LOG_LIMIT");
    }
    r.rate.push({ at: now, bytes: chunk.length });
    for (let offset = 0; offset < chunk.length; offset += 16384) {
      const bytes = chunk.subarray(offset, offset + 16384);
      r.queue.push({ sequence: ++r.high, bytes });
      r.queuedBytes += bytes.length;
    }
    if (r.queue.length > 256) {
      r.lost = true;
      this.fail(r, "LOG_LIMIT");
    }
  }
  private async flush(r: Owned) {
    if (!r.queue.length && !r.lost) return;
    const chunks = r.queue.slice(),
      lost = r.lost;
    await transaction(this.pool, async (db) => {
      const { p } = await lockedPreview(db, r.id);
      if (Number(p.generation) !== r.generation)
        throw Error("Preview log generation changed");
      for (const chunk of chunks)
        await db.query(
          "INSERT INTO preview_logs(preview_id,sequence,generation,bytes) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [p.id, chunk.sequence, r.generation, chunk.bytes],
        );
      await db.query(
        "UPDATE previews SET output_sequence=greatest(output_sequence,$2),output_lost=output_lost OR $3 WHERE id=$1",
        [p.id, chunks.at(-1)?.sequence ?? 0, lost],
      );
      await this.prune(db, p.id);
    });
    r.queue.splice(0, chunks.length);
    r.queuedBytes -= chunks.reduce((n, v) => n + v.bytes.length, 0);
    if (r.lost === lost) r.lost = false;
  }
  private async prune(db: PoolClient, id: string) {
    const removed = await db.query(
      "DELETE FROM preview_logs WHERE preview_id=$1 AND (created_at<=clock_timestamp()-interval '24 hours' OR sequence IN (SELECT sequence FROM (SELECT sequence,sum(octet_length(bytes)) OVER (ORDER BY sequence DESC) AS total FROM preview_logs WHERE preview_id=$1) r WHERE total>1048576)) RETURNING sequence",
      [id],
    );
    if (removed.rowCount)
      await db.query(
        "UPDATE previews SET output_floor=greatest(output_floor,$2) WHERE id=$1",
        [id, Math.max(...removed.rows.map((r) => Number(r.sequence)))],
      );
  }
  private async probe(relay: PreviewRelay) {
    const id = randomUUID();
    await new Promise<void>((resolve, reject) => {
      let status: number | undefined;
      const clean = () => {
        clearTimeout(timer);
        relay.off("frame", receive);
        relay.off("closed", closed);
        try {
          relay.send({ type: "close", id });
        } catch {}
      };
      const closed = () => {
        clean();
        reject(Error("Preview relay closed"));
      };
      const receive = (frame: RelayOutput) => {
        if (frame.type === "ready" || frame.id !== id) return;
        if (frame.type === "head") {
          status = frame.status;
          if (status >= 200 && status < 400) {
            clean();
            resolve();
          } else {
            clean();
            reject(Error("Preview application not ready"));
          }
        } else if (frame.type === "error" || frame.type === "end") {
          clean();
          reject(Error("Preview application not ready"));
        }
      };
      const timer = setTimeout(() => {
        clean();
        reject(Error("Preview readiness deadline"));
      }, 2000);
      relay.on("frame", receive);
      relay.once("closed", closed);
      relay.send({
        type: "request",
        id,
        method: "GET",
        path: "/",
        headers: [],
      });
      relay.send({ type: "end", id });
    });
  }
  private async launch(p: any) {
    const r: Owned = {
      id: p.id,
      project: p.project_id,
      generation: Number(p.generation),
      actor: p.actor_hash,
      queue: [],
      high: Number(p.output_sequence),
      queuedBytes: 0,
      rate: [],
      lost: false,
      sent: false,
      deadline: setTimeout(() => {
        const r = this.owned.get(p.id);
        if (r) this.fail(r, "LIFETIME_EXPIRED");
      }, 24 * 3600000),
    };
    this.owned.set(r.id, r);
    const fixture =
      !!this.c.HARBOR_FIXTURE_MODE && !process.env.HARBOR_STORAGE_SOCKET;
    try {
      const w = await selectedWorkspace(this.pool, p.workspace_id),
        workspace = await verifyWorkspace(w);
      const adapter = await createRuntime({
        purpose: "preview",
        sessionId: "preview-" + p.id,
        projectId: p.project_id,
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
        permissionProfile: p.permission_profile,
        fixture,
        onTransport: (a) => {
          r.adapter = a;
        },
        withDispatch: (send) => this.wire(r, send),
        onEvent: (method, value) => this.capture(r, method, value),
        onRequest: () => this.fail(r, "UNEXPECTED_APPROVAL"),
        onDisconnect: () => {
          if (r.exit === undefined) this.fail(r, "RUNTIME_UNCERTAIN");
        },
      });
      const commandProcess = await adapter.startPreview({
        processId: r.id,
        script: p.script,
        port: p.port,
        permissionProfile: p.permission_profile,
      });
      void commandProcess.completion
        .then((result) => {
          r.exit = result.exitCode;
          this.fail(r, "PROCESS_EXITED");
        })
        .catch(() => this.fail(r, "RUNTIME_UNCERTAIN"));
      if (r.reason) throw Error("Preview exited during startup");
      r.relay = await launchRelay(
        {
          id: p.id,
          generation: r.generation,
          instanceId: globalThis.process.env.HARBOR_INSTANCE_ID ?? "harbor",
          port: p.port,
        },
        fixture,
      );
      r.relay.once("closed", () => {
        if (!r.reason) this.fail(r, "RELAY_CLOSED");
      });
      const limit = Date.now() + 15000;
      for (;;) {
        if (r.reason || !this.current())
          throw Error("Preview startup interrupted");
        try {
          await this.probe(r.relay);
          break;
        } catch (error) {
          if (Date.now() >= limit) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      await adapter.probePreview();
      await transaction(this.pool, async (db) => {
        await this.owner(db);
        await requirePreviewAuthority(db, p, r.actor, this.c, "start");
        await deploymentAdmission(db);
        const { p: latest, w } = await lockedPreview(db, p.id);
        await this.lease(db, latest, w);
        if (
          r.reason ||
          latest.state !== "starting" ||
          Number(latest.generation) !== r.generation
        )
          throw Error("Preview startup changed");
        await requirePreviewAuthority(db, latest, r.actor, this.c, "start");
        await db.query(
          "UPDATE previews SET state='ready',runner_id=$2,relay_id=$3,updated_at=clock_timestamp() WHERE id=$1",
          [r.id, r.relay!.runnerId, r.relay!.relayId],
        );
      });
    } catch (error) {
      this.fail(
        r,
        error instanceof HarborError
          ? error.code
          : r.sent
            ? "START_UNCERTAIN"
            : "START_DENIED",
      );
    }
  }
  private async retire(p: any, r?: Owned) {
    const identity = {
      id: p.id,
      generation: Number(p.generation),
      instanceId: process.env.HARBOR_INSTANCE_ID ?? "harbor",
      port: p.port,
    };
    try {
      if (r) {
        if (r.relay) await r.relay.close();
        r.adapter?.close();
        await r.adapter?.closeAndWait();
      }
      if (!this.c.HARBOR_FIXTURE_MODE || process.env.HARBOR_STORAGE_SOCKET) {
        await retireRelay(identity);
        await retireRuntimeIdentity({
          instanceId: identity.instanceId,
          projectId: p.project_id,
          sessionId: "preview-" + p.id,
        });
      }
      await transaction(this.pool, async (db) => {
        const { p: fresh, w } = await lockedPreview(db, p.id);
        if (Number(fresh.generation) !== Number(p.generation))
          throw Error("Preview retirement generation changed");
        if (fresh.lease_epoch !== null) {
          await this.lease(db, fresh, w);
          if (fresh.permission_profile === "workspace-write")
            await db.query(
              "UPDATE workspaces SET writer_kind=NULL,writer_owner_id=NULL,writer_generation=NULL WHERE id=$1 AND writer_kind='preview' AND writer_owner_id=$2 AND writer_epoch=$3",
              [w.id, p.id, fresh.lease_epoch],
            );
          else
            await db.query(
              "DELETE FROM preview_readers WHERE owner_id=$1 AND generation=$2 AND epoch=$3",
              [p.id, p.generation, fresh.lease_epoch],
            );
        }
        await revokePreviewAccess(db, p.id);
        await db.query(
          "UPDATE preview_stops SET state='completed' WHERE preview_id=$1 AND generation=$2 AND state IN ('queued','retiring')",
          [p.id, p.generation],
        );
        await db.query(
          "UPDATE previews SET state=CASE WHEN $2::integer IS NOT NULL THEN 'exited' WHEN failure_code IS NULL THEN 'stopped' ELSE 'failed' END,exit_code=$2,retired=true,lease_epoch=NULL,updated_at=clock_timestamp() WHERE id=$1",
          [p.id, r?.exit ?? null],
        );
      });
      if (r) clearTimeout(r.deadline);
      this.owned.delete(p.id);
    } catch {
      await transaction(this.pool, async (db) => {
        const { p: fresh } = await lockedPreview(db, p.id);
        if (Number(fresh.generation) !== Number(p.generation) || fresh.retired)
          return;
        await db.query(
          "UPDATE previews SET state='uncertain',failure_code='RETIREMENT_UNCONFIRMED',retirement_ack=coalesce(retirement_ack,$2) WHERE id=$1",
          [p.id, randomUUID()],
        );
        await db.query(
          "UPDATE preview_stops SET state='failed',failure_code='RETIREMENT_UNCONFIRMED' WHERE preview_id=$1 AND generation=$2 AND state IN ('queued','retiring')",
          [p.id, p.generation],
        );
        await revokePreviewAccess(db, p.id);
      }).catch(() => undefined);
    }
  }
  private async tick() {
    const deployment = await deploymentState(this.pool);
    if (deployment.activation_required) return;
    if (this.first) {
      await this.pool.query(
        "UPDATE previews SET state='stopping',failure_code='SUPERVISOR_RESTARTED',output_lost=true WHERE NOT retired AND state<>'uncertain' AND restored_from IS NULL",
      );
      this.first = false;
    }
    if (Date.now() - this.maintenance > 30000) {
      for (const p of (
        await this.pool.query("SELECT id FROM previews LIMIT 128")
      ).rows)
        await transaction(this.pool, async (db) => {
          await lockedPreview(db, p.id);
          await this.prune(db, p.id);
        });
      await this.pool.query(
        "DELETE FROM preview_grants WHERE revoked OR expires_at<=clock_timestamp()",
      );
      await this.pool.query(
        "DELETE FROM preview_openings WHERE (revoked OR expires_at<=clock_timestamp()) AND NOT EXISTS(SELECT 1 FROM preview_grants g WHERE g.id=preview_openings.id)",
      );
      this.maintenance = Date.now();
    }
    const emergency = (
      await this.pool.query("SELECT emergency FROM harbor_meta")
    ).rows[0].emergency;
    for (const p of (
      await this.pool.query(
        "SELECT * FROM previews WHERE NOT retired OR state='queued' ORDER BY created_at LIMIT 128",
      )
    ).rows) {
      const r = this.owned.get(p.id);
      if (r) await this.flush(r);
      if (p.state === "uncertain") continue;
      // A committed claim whose acknowledgement was lost must retire its exact
      // identity. It never authorizes repeating the command in this process.
      if (!r && !p.retired && ["starting", "ready"].includes(p.state)) {
        await transaction(this.pool, async (db) => {
          const { p: fresh } = await lockedPreview(db, p.id);
          if (
            Number(fresh.generation) !== Number(p.generation) ||
            fresh.retired
          )
            return;
          await revokePreviewAccess(db, p.id);
          await db.query(
            "UPDATE previews SET state='stopping',failure_code='ADMISSION_UNCONFIRMED',output_lost=true WHERE id=$1",
            [p.id],
          );
        });
        p.state = "stopping";
      }
      if (
        emergency ||
        r?.reason ||
        (p.deadline && new Date(p.deadline).getTime() <= Date.now())
      ) {
        if (r)
          this.fail(
            r,
            r.reason ?? (emergency ? "EMERGENCY_STOPPED" : "LIFETIME_EXPIRED"),
          );
        await transaction(this.pool, async (db) => {
          const { p: fresh } = await lockedPreview(db, p.id);
          if (Number(fresh.generation) !== Number(p.generation)) return;
          await revokePreviewAccess(db, p.id);
          await db.query(
            "UPDATE previews SET state=CASE WHEN retired THEN 'stopped' ELSE 'stopping' END,failure_code=$2 WHERE id=$1",
            [
              p.id,
              r?.reason ??
                (emergency ? "EMERGENCY_STOPPED" : "LIFETIME_EXPIRED"),
            ],
          );
        });
        p.state = p.retired ? "stopped" : "stopping";
      }
      if (p.state === "stopping") {
        await this.retire(p, r);
        continue;
      }
      if (p.state !== "queued" || deployment.maintenance || emergency) continue;
      try {
        const accepted = await transaction(this.pool, async (db) => {
          await this.owner(db);
          await requirePreviewAuthority(db, p, p.actor_hash, this.c, "start");
          await deploymentAdmission(db);
          authorizePermission(
            p.permission_profile,
            this.c.HARBOR_PERMISSION_CEILING,
          );
          await db.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('preview-capacity',0))",
          );
          const { p: fresh, w } = await lockedPreview(db, p.id);
          if (fresh.state !== "queued") return false;
          if (w.state !== "ready" || w.project_archived)
            throw new HarborError(
              409,
              "WORKSPACE_UNAVAILABLE",
              "Preview workspace unavailable",
            );
          if (
            (
              await db.query(
                "SELECT 1 FROM previews WHERE workspace_id=$1 AND NOT retired LIMIT 1",
                [w.id],
              )
            ).rowCount
          )
            return false;
          if (p.permission_profile === "workspace-write" && w.writer_owner_id)
            return false;
          if (
            (
              await db.query(
                "SELECT 1 FROM workspace_storage_operations WHERE project_id=$1 AND state IN ('queued','dispatching') UNION ALL SELECT 1 FROM file_operations WHERE project_id=$1 AND kind IN ('stage','unstage','commit') AND state IN ('dispatching','uncertain') AND acknowledged_at IS NULL LIMIT 1",
                [p.project_id],
              )
            ).rowCount
          )
            return false;
          if (
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM previews WHERE NOT retired",
                )
              ).rows[0].count,
            ) >= 4
          )
            return false;
          await verifyWorkspace(w);
          await requirePreviewAuthority(
            db,
            fresh,
            p.actor_hash,
            this.c,
            "start",
          );
          let epoch: string;
          if (p.permission_profile === "workspace-write")
            epoch = (
              await db.query(
                "UPDATE workspaces SET writer_kind='preview',writer_owner_id=$2,writer_generation=NULL WHERE id=$1 AND writer_owner_id IS NULL RETURNING writer_epoch",
                [w.id, p.id],
              )
            ).rows[0].writer_epoch;
          else
            epoch = (
              await db.query(
                "INSERT INTO preview_readers(owner_id,workspace_id,epoch,generation) VALUES($1,$2,nextval('runtime_generation_seq'),$3) RETURNING epoch",
                [p.id, w.id, p.generation],
              )
            ).rows[0].epoch;
          await db.query(
            "UPDATE previews SET state='starting',retired=false,lease_epoch=$2,deadline=clock_timestamp()+interval '24 hours',started_at=clock_timestamp() WHERE id=$1",
            [p.id, epoch],
          );
          return true;
        });
        if (accepted)
          await this.launch(
            await transaction(this.pool, (db) => previewRow(db, p.id)),
          );
      } catch (error) {
        if (error instanceof HarborError && error.code !== "MAINTENANCE")
          await this.pool.query(
            "UPDATE previews SET state='failed',failure_code=$2 WHERE id=$1 AND state='queued'",
            [p.id, error.code],
          );
        else throw error;
      }
    }
  }
}
