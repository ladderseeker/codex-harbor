import type { Pool, PoolClient } from "pg";
import { transaction } from "../../../packages/storage/src/index.ts";
import {
  selectedWorkspace,
  verifyWorkspace,
} from "../../../packages/workspaces/src/service.ts";
/** Revalidation lost its captured runtime; undo every reservation and retry later. */
export class WorkspaceAdmissionChanged extends Error {}
export async function workspaceAdmission(
  pool: Pool,
  claim: (db: PoolClient) => Promise<boolean>,
) {
  try {
    return await transaction(pool, claim);
  } catch (error) {
    if (error instanceof WorkspaceAdmissionChanged) return false;
    throw error;
  }
}
export async function claimWorkspace(
  db: PoolClient,
  workspaceId: string,
  sessionId: string,
  generation: number,
  continuingOwnedRuntime = false,
  sharedPersonal = false,
) {
  const w = await selectedWorkspace(db, workspaceId, true);
  if (w.state !== "ready" || w.project_archived)
    throw Error("Workspace unavailable or archived");
  await verifyWorkspace(w);
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
    (w.writer_owner_id &&
      !(
        continuingOwnedRuntime &&
        w.writer_kind === "conversation" &&
        w.writer_session_id === sessionId &&
        Number(w.writer_generation) === generation
      )) ||
    (
      await db.query(
        "SELECT 1 FROM workspace_storage_operations WHERE project_id=$1 AND state IN ('queued','dispatching')",
        [w.project_id],
      )
    ).rowCount
  )
    return false;
  if (sharedPersonal) return true;
  if (
    (
      await db.query(
        "SELECT 1 FROM conversation_runtimes WHERE workspace_id=$1 LIMIT 1",
        [workspaceId],
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
        "UPDATE workspaces SET writer_session_id=NULL,writer_generation=NULL WHERE id=$1 AND writer_kind='conversation' AND writer_session_id=$2 AND writer_generation=$3",
        [s.workspace_id, sessionId, generation],
      );
  });
}
