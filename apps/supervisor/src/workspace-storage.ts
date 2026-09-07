import { HarborError } from "../../../packages/policy/src/index.ts";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../../../packages/storage/src/index.ts";
import {
  selectedWorkspace,
  storageWorkspace,
  workspaceRelative,
  verifyWorkspace,
} from "../../../packages/workspaces/src/service.ts";
export async function processWorkspaceStorage(
  pool: Pool,
  fixture: boolean,
  roots: { id: string; path: string }[],
  admission?: (db: PoolClient, row: any) => Promise<void>,
) {
  const rows = (
    await pool.query(
      "SELECT * FROM workspace_storage_operations WHERE state IN ('queued','dispatching') ORDER BY created_at LIMIT 1",
    )
  ).rows;
  for (const row of rows) {
    try {
      await transaction(pool, async (db) => {
        if (row.state === "queued") {
          if (row.actor_hash.startsWith("schedule:") && !admission)
            throw new Error("Schedule preparation admission unavailable");
          await admission?.(db, row);
        }
        await selectedWorkspace(db, row.workspace_id, true);
        if (row.state === "queued") await admission?.(db, row);
        await db.query(
          "UPDATE workspace_storage_operations SET state='dispatching',updated_at=now() WHERE id=$1",
          [row.id],
        );
      });
      // Stable command identity was committed before external effects. Trusted receipts reconcile retries.
      const result = await storageWorkspace(row.command, fixture);
      let available = true;
      if (row.action === "create")
        try {
          await verifyWorkspace({
            id: row.workspace_id,
            root_id: row.command.rootId,
            kind: row.command.kind,
            canonical_path: result.canonical,
            device: result.device,
            inode: result.inode,
            common_path: result.common?.canonical ?? null,
            common_device: result.common?.device ?? null,
            common_inode: result.common?.inode ?? null,
          });
        } catch {
          available = false;
        }
      await transaction(pool, async (db) => {
        await selectedWorkspace(db, row.workspace_id, true);
        if (row.action === "create")
          await db.query(
            "UPDATE workspaces SET state=$12,failure_code=$13,relative_path=$2,canonical_path=$3,device=$4,inode=$5,common_path=$6,common_device=$7,common_inode=$8,base_revision=$9,source_dirty=$10,snapshot_hash=$11 WHERE id=$1",
            [
              row.workspace_id,
              workspaceRelative(roots, row.command.rootId, result.canonical),
              result.canonical,
              result.device,
              result.inode,
              result.common?.canonical ?? null,
              result.common?.device ?? null,
              result.common?.inode ?? null,
              result.baseRevision,
              result.sourceDirty,
              result.snapshotHash ?? null,
              available ? "ready" : "unavailable",
              available ? null : "WORKSPACE_UNAVAILABLE",
            ],
          );
        else
          await db.query("UPDATE workspaces SET state='removed' WHERE id=$1", [
            row.workspace_id,
          ]);
        await db.query(
          "UPDATE workspace_storage_operations SET state='completed',result=$2,updated_at=now() WHERE id=$1",
          [row.id, JSON.stringify(result)],
        );
      });
    } catch (error) {
      if (
        row.actor_hash.startsWith("schedule:") &&
        row.state === "queued" &&
        error instanceof HarborError &&
        [401, 403].includes(error.statusCode)
      ) {
        await transaction(pool, async (db) => {
          await selectedWorkspace(db, row.workspace_id, true);
          const denied = await db.query(
            "UPDATE workspace_storage_operations SET state='failed',failure_code='SCHEDULE_GRANT',updated_at=clock_timestamp() WHERE id=$1 AND state='queued' RETURNING id",
            [row.id],
          );
          if (denied.rowCount)
            await db.query(
              "UPDATE workspaces SET state='failed',failure_code='SCHEDULE_GRANT' WHERE id=$1 AND state='creating'",
              [row.workspace_id],
            );
        });
        continue;
      }
      // Ambiguous transport/COMMIT outcomes remain pending and read the same receipt next tick.
      if ((error as { code?: string }).code !== "WORKSPACE_STORAGE_FAILED")
        await pool.query(
          "UPDATE workspaces SET failure_code='STORAGE_RECONCILIATION_PENDING' WHERE id=$1",
          [row.workspace_id],
        );
      if ((error as { code?: string }).code === "WORKSPACE_STORAGE_FAILED")
        await transaction(pool, async (db) => {
          await selectedWorkspace(db, row.workspace_id, true);
          await db.query(
            "UPDATE workspaces SET state=$2,failure_code='WORKSPACE_STORAGE_FAILED' WHERE id=$1",
            [row.workspace_id, row.action === "create" ? "failed" : "ready"],
          );
          await db.query(
            "UPDATE workspace_storage_operations SET state='failed',failure_code='WORKSPACE_STORAGE_FAILED',updated_at=now() WHERE id=$1",
            [row.id],
          );
        });
    }
  }
}
