import type { Pool, PoolClient } from "pg";
import { transaction } from "../../../packages/storage/src/index.ts";
import {
  selectedWorkspace,
  verifyWorkspace,
} from "../../../packages/workspaces/src/service.ts";
export async function claimWorkspace(
  db: PoolClient,
  workspaceId: string,
  sessionId: string,
  generation: number,
) {
  const w = await selectedWorkspace(db, workspaceId, true);
  if (w.state !== "ready" || w.project_archived)
    throw Error("Workspace unavailable or archived");
  await verifyWorkspace(w);
  if (
    w.writer_session_id ||
    (
      await db.query(
        "SELECT 1 FROM workspace_storage_operations WHERE project_id=$1 AND state IN ('queued','dispatching')",
        [w.project_id],
      )
    ).rowCount
  )
    return false;
  await db.query(
    "UPDATE workspaces SET writer_session_id=$2,writer_generation=$3 WHERE id=$1",
    [workspaceId, sessionId, generation],
  );
  return true;
}
export async function releaseWorkspace(
  pool: Pool,
  sessionId: string,
  generation: number,
) {
  await transaction(pool, async (db) => {
    const s = (
      await db.query("SELECT workspace_id FROM sessions WHERE id=$1", [
        sessionId,
      ])
    ).rows[0];
    if (!s) return;
    await selectedWorkspace(db, s.workspace_id, true);
    const uncertain = await db.query(
      "SELECT 1 FROM operations WHERE session_id=$1 AND kind='turn' AND (state IN ('dispatching','running','waiting_approval','waiting_input') OR (state='uncertain' AND uncertainty_acknowledged_at IS NULL)) LIMIT 1",
      [sessionId],
    );
    if (!uncertain.rowCount)
      await db.query(
        "UPDATE workspaces SET writer_session_id=NULL,writer_generation=NULL WHERE id=$1 AND writer_session_id=$2 AND writer_generation=$3",
        [s.workspace_id, sessionId, generation],
      );
  });
}
