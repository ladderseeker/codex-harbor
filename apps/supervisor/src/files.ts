import {
  deploymentAdmission,
  deploymentState,
} from "../../../packages/storage/src/deployment.ts";
import type { Pool, PoolClient } from "pg";
import type { Config } from "../../api/src/config.ts";
import { transaction } from "../../../packages/storage/src/index.ts";
import {
  requireAuthority,
  lockOwnerIdentity,
  type Scope,
} from "../../../packages/policy/src/authority.ts";
import { selectedWorkspace } from "../../../packages/workspaces/src/service.ts";
import { workspaceFileCommand } from "../../../packages/files/src/workspace.ts";
import {
  executeFile,
  inspectFileEffect,
} from "../../../infra/files/service.ts";
import { retireFileHelper } from "../../../infra/files/launcher.ts";
const activeFileHelpers = new Set<string>();
export async function retireActiveFiles() {
  await Promise.all(
    [...activeFileHelpers].map(async (id) => {
      await retireFileHelper(id);
      activeFileHelpers.delete(id);
    }),
  );
}
const inspectionRepairs = new Set<string>();
const repairs = new Map<
  string,
  { state: string; result?: any; code?: string }
>();
function need(kind: string): Scope {
  return kind === "save" ? "files:write" : "git:write";
}
async function failDependentFiles(db: Pool | PoolClient, row: any) {
  await db.query(
    "UPDATE file_operations SET state='failed',failure_code='PREDECESSOR_UNCERTAIN',payload=NULL,payload_bytes=0,updated_at=now() WHERE state='queued' AND (workspace_id=$1 OR ($2<>'save' AND project_id=$3 AND kind<>'save'))",
    [row.workspace_id, row.kind, row.project_id],
  );
}
async function settle(
  db: PoolClient,
  row: any,
  state: string,
  result?: any,
  code?: string,
) {
  const w = await selectedWorkspace(db, row.workspace_id, true);
  if (
    w.writer_kind === "file" &&
    w.writer_owner_id === row.id &&
    row.epoch != null &&
    Number(w.writer_epoch) !== Number(row.epoch)
  )
    return;
  const changed = await db.query(
    "UPDATE file_operations SET state=$2,result=$3,failure_code=$4,payload=CASE WHEN $2 IN ('succeeded','failed') THEN NULL ELSE payload END,payload_bytes=CASE WHEN $2 IN ('succeeded','failed') THEN 0 ELSE payload_bytes END,updated_at=now() WHERE id=$1 AND state IN ('queued','dispatching')",
    [row.id, state, result ? JSON.stringify(result) : null, code ?? null],
  );
  if (!changed.rowCount) return;
  if (state === "uncertain") await failDependentFiles(db, row);
  if (
    state !== "uncertain" &&
    w.writer_kind === "file" &&
    w.writer_owner_id === row.id &&
    (row.epoch == null || Number(w.writer_epoch) === Number(row.epoch))
  )
    await db.query(
      "UPDATE workspaces SET writer_kind=NULL,writer_owner_id=NULL,writer_generation=NULL WHERE id=$1 AND writer_kind='file' AND writer_owner_id=$2",
      [w.id, row.id],
    );
  const seq = (
    await db.query(
      "UPDATE workspaces SET files_revision=files_revision+1 WHERE id=$1 RETURNING files_revision",
      [w.id],
    )
  ).rows[0].files_revision;
  await db.query(
    "INSERT INTO file_events(workspace_id,sequence,data) VALUES($1,$2,$3)",
    [
      w.id,
      seq,
      JSON.stringify({ type: "operation.settled", operationId: row.id, state }),
    ],
  );
  await db.query(
    "DELETE FROM file_events WHERE workspace_id=$1 AND (sequence<=$2-1000 OR created_at<clock_timestamp()-interval '1 hour')",
    [w.id, seq],
  );
}
export async function recoverFileStartup(pool: Pool) {
  await transaction(pool, async (db) => {
    const changed = await db.query(
      "UPDATE file_operations SET state='uncertain',failure_code='SUPERVISOR_RESTART',updated_at=now() WHERE state='dispatching' RETURNING workspace_id,project_id,kind",
    );
    for (const row of changed.rows) await failDependentFiles(db, row);
  });
  await pool.query(
    "UPDATE file_inspections SET state='failed',report='{\"status\":\"interrupted\"}',updated_at=now() WHERE state='inspecting'",
  );
}
export async function processFiles(
  pool: Pool,
  c: Config,
  current: () => boolean,
  identity: { generation: number; ownerPin: string },
) {
  const lockFence = async (db: PoolClient, allowEmergency = false) => {
    await lockOwnerIdentity(db);
    const meta = (
      await db.query(
        "SELECT generation,identity_pin,emergency FROM harbor_meta FOR SHARE",
      )
    ).rows[0];
    if (
      !current() ||
      Number(meta.generation) !== identity.generation ||
      meta.identity_pin !== identity.ownerPin ||
      (!allowEmergency && meta.emergency)
    )
      throw Error("File dispatcher fenced");
  };
  for (const id of inspectionRepairs) {
    await pool.query(
      "UPDATE file_inspections SET state='failed',report='{\"status\":\"unavailable\"}',updated_at=now() WHERE id=$1 AND state IN ('queued','inspecting')",
      [id],
    );
    inspectionRepairs.delete(id);
  }
  for (const [id, value] of repairs) {
    const row = (
      await pool.query("SELECT * FROM file_operations WHERE id=$1", [id])
    ).rows[0];
    await transaction(pool, (db) =>
      settle(db, row, value.state, value.result, value.code),
    );
    repairs.delete(id);
  }
  const inspection = (
    await pool.query(
      "SELECT i.*,o.workspace_id,o.project_id,o.kind,o.payload,o.restored_from,o.id AS effect_id FROM file_inspections i JOIN file_operations o ON o.id=i.operation_id WHERE i.state='queued' ORDER BY i.created_at LIMIT 1",
    )
  ).rows[0];
  if (inspection) {
    try {
      await transaction(pool, async (db) => {
        await lockFence(db, true);
        await requireAuthority(db, inspection.actor_hash, c, {
          scope: need(inspection.kind),
          projectId: inspection.project_id,
          permissionProfile: "workspace-write",
        });
        const w = await selectedWorkspace(db, inspection.workspace_id, true);
        await requireAuthority(db, inspection.actor_hash, c, {
          scope: need(inspection.kind),
          projectId: inspection.project_id,
          permissionProfile: "workspace-write",
        });
        if (
          !current() ||
          w.writer_kind !== "file" ||
          w.writer_owner_id !== inspection.effect_id ||
          Number(w.writer_epoch) !== Number(inspection.expected_epoch)
        )
          throw Error("File inspection ownership changed");
        await db.query(
          "UPDATE file_inspections SET state='inspecting',updated_at=now() WHERE id=$1 AND state='queued'",
          [inspection.id],
        );
        if (!inspection.restored_from)
          await retireFileHelper(inspection.effect_id);
        const report = await inspectFileEffect(
          {
            ...workspaceFileCommand(w, inspection.kind, inspection.payload),
            operationId: inspection.effect_id,
            epoch: Number(w.writer_epoch),
          },
          !!c.HARBOR_FIXTURE_MODE && !process.env.HARBOR_STORAGE_SOCKET,
          !!inspection.restored_from,
        );
        if (Buffer.byteLength(JSON.stringify(report)) > 16384)
          throw Error("File inspection result limit");
        await requireAuthority(db, inspection.actor_hash, c, {
          scope: need(inspection.kind),
          projectId: inspection.project_id,
          permissionProfile: "workspace-write",
        });
        if (!current()) throw Error("File inspection authority lost");
        const epoch = Number(
          (await db.query("SELECT nextval('runtime_generation_seq') AS n"))
            .rows[0].n,
        );
        await db.query("UPDATE workspaces SET writer_epoch=$2 WHERE id=$1", [
          w.id,
          epoch,
        ]);
        await db.query(
          "UPDATE file_inspections SET state='ready',fence=$2,report=$3,updated_at=now() WHERE id=$1",
          [inspection.id, epoch, JSON.stringify(report)],
        );
        await db.query(
          "INSERT INTO file_operation_audits(operation_id,slot,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [
            inspection.effect_id,
            inspection.attempts - 1,
            JSON.stringify({ type: "inspected", epoch }),
          ],
        );
      });
    } catch {
      inspectionRepairs.add(inspection.id);
      await pool.query(
        "UPDATE file_inspections SET state='failed',report='{\"status\":\"unavailable\"}',updated_at=now() WHERE id=$1 AND state IN ('queued','inspecting')",
        [inspection.id],
      );
      inspectionRepairs.delete(inspection.id);
    }
    return;
  }
  if ((await deploymentState(pool)).maintenance) return;
  const candidates = (
    await pool.query(
      "SELECT o.* FROM file_operations o JOIN workspaces w ON w.id=o.workspace_id JOIN projects p ON p.id=o.project_id WHERE o.state='queued' AND w.writer_owner_id IS NULL AND w.state='ready' AND p.archived_at IS NULL ORDER BY o.created_at,o.id LIMIT 20",
    )
  ).rows;
  for (const row of candidates) {
    let w: any,
      epoch = 0,
      claimed = false,
      sent = false;
    try {
      const admitted = await transaction(pool, async (db) => {
        await lockFence(db);
        await requireAuthority(db, row.actor_hash, c, {
          scope: need(row.kind),
          projectId: row.project_id,
          permissionProfile: "workspace-write",
        });
        await deploymentAdmission(db);
        w = await selectedWorkspace(db, row.workspace_id, true);
        if (w.writer_owner_id || w.state !== "ready" || w.project_archived)
          return false;
        if (
          (
            await db.query(
              "SELECT 1 FROM workspace_storage_operations WHERE project_id=$1 AND state IN ('queued','dispatching') LIMIT 1",
              [w.project_id],
            )
          ).rowCount
        )
          return false;
        if (
          (
            await db.query(
              "SELECT 1 FROM file_operations WHERE project_id=$1 AND kind IN ('stage','unstage','commit') AND state IN ('dispatching','uncertain') AND acknowledged_at IS NULL LIMIT 1",
              [w.project_id],
            )
          ).rowCount
        )
          return false;
        if (
          row.kind !== "save" &&
          (
            await db.query(
              "SELECT 1 FROM workspaces WHERE project_id=$1 AND writer_owner_id IS NOT NULL UNION ALL SELECT 1 FROM preview_readers r JOIN workspaces w ON w.id=r.workspace_id WHERE w.project_id=$1 LIMIT 1",
              [w.project_id],
            )
          ).rowCount
        )
          return false;
        const meta = (await db.query("SELECT emergency FROM harbor_meta"))
          .rows[0];
        await requireAuthority(db, row.actor_hash, c, {
          scope: need(row.kind),
          projectId: row.project_id,
          permissionProfile: "workspace-write",
        });
        if (!current() || meta.emergency) return false;
        epoch = Number(
          (await db.query("SELECT nextval('runtime_generation_seq') AS n"))
            .rows[0].n,
        );
        epoch = Number(
          (
            await db.query(
              "UPDATE workspaces SET writer_kind='file',writer_owner_id=$2,writer_generation=NULL WHERE id=$1 RETURNING writer_epoch",
              [w.id, row.id],
            )
          ).rows[0].writer_epoch,
        );
        await db.query(
          "UPDATE file_operations SET state='dispatching',epoch=$2,updated_at=now() WHERE id=$1 AND state='queued'",
          [row.id, epoch],
        );
        claimed = true;
        return true;
      });
      if (!admitted) continue;
      row.epoch = epoch;
      const command = {
        ...workspaceFileCommand(w, row.kind, row.payload),
        operationId: row.id,
        epoch,
      };
      let watching = false;
      const watchdog = setInterval(() => {
        if (watching) return;
        watching = true;
        void pool
          .query("SELECT emergency FROM harbor_meta")
          .then(async (r) => {
            if (!current() || r.rows[0].emergency)
              await retireFileHelper(row.id);
          })
          .catch(async () => {
            await retireFileHelper(row.id).catch(() => {});
          })
          .finally(() => {
            watching = false;
          });
      }, 500);
      let result: any;
      activeFileHelpers.add(row.id);
      try {
        result = await executeFile(
          command,
          !!c.HARBOR_FIXTURE_MODE && !process.env.HARBOR_STORAGE_SOCKET,
          async (send) =>
            transaction(pool, async (db) => {
              await lockFence(db);
              await requireAuthority(db, row.actor_hash, c, {
                scope: need(row.kind),
                projectId: row.project_id,
                permissionProfile: "workspace-write",
              });
              await deploymentAdmission(db);
              const locked = await selectedWorkspace(
                db,
                row.workspace_id,
                true,
              );
              const meta = (await db.query("SELECT emergency FROM harbor_meta"))
                .rows[0];
              if (
                !current() ||
                meta.emergency ||
                locked.writer_kind !== "file" ||
                locked.writer_owner_id !== row.id ||
                Number(locked.writer_epoch) !== epoch
              )
                throw Error("File dispatch fenced");
              await requireAuthority(db, row.actor_hash, c, {
                scope: need(row.kind),
                projectId: row.project_id,
                permissionProfile: "workspace-write",
              });
              sent = true;
              send();
            }),
        );
      } finally {
        clearInterval(watchdog);
      }
      activeFileHelpers.delete(row.id);
      repairs.set(row.id, { state: "succeeded", result });
      await transaction(pool, (db) => settle(db, row, "succeeded", result));
      repairs.delete(row.id);
    } catch (error) {
      if (!claimed && (error as any)?.code === "MAINTENANCE") return;
      if (activeFileHelpers.has(row.id)) {
        try {
          await retireFileHelper(row.id);
          activeFileHelpers.delete(row.id);
        } catch {}
      }
      // A retained successful receipt is never replaced by an ambiguous DB reply.
      if (!repairs.has(row.id))
        repairs.set(row.id, {
          state:
            activeFileHelpers.has(row.id) ||
            (sent &&
              !(error as any)?.confirmedRejected &&
              !["FILE_STALE", "GIT_STALE"].includes((error as any)?.code))
              ? "uncertain"
              : "failed",
          code:
            activeFileHelpers.has(row.id) || sent
              ? (error as any)?.confirmedRejected ||
                ["FILE_STALE", "GIT_STALE"].includes((error as any)?.code)
                ? (error as any).code
                : "FILE_UNCERTAIN"
              : "FILE_DENIED",
        });
      const repair = repairs.get(row.id)!;
      await transaction(pool, (db) =>
        settle(db, row, repair.state, repair.result, repair.code),
      );
      repairs.delete(row.id);
    }
    return;
  }
}
