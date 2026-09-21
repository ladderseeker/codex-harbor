import type { PoolClient } from "pg";
import { event } from "./index.ts";
import { lockSessionResource } from "./session-lock.ts";
export const runtimeProjection = (alias: string) =>
  `(SELECT json_build_object('state',cr.state,'generation',cr.generation,'lastActivityAt',cr.last_activity_at,'idleUntil',cr.idle_until) FROM conversation_runtimes cr WHERE cr.session_id=${alias}.id)`;
export const workspaceRuntimeProjection = (alias: string) =>
  `(SELECT coalesce(json_agg(json_build_object('sessionId',cr.session_id,'title',s.title,'state',cr.state,'generation',cr.generation,'lastActivityAt',cr.last_activity_at,'idleUntil',cr.idle_until) ORDER BY cr.created_at,cr.session_id),'[]'::json) FROM conversation_runtimes cr JOIN sessions s ON s.id=cr.session_id WHERE cr.workspace_id=${alias}.id)`;
export type QueueReason =
  | "session_busy"
  | "active_capacity"
  | "runtime_capacity"
  | "protected_capacity"
  | "retirement_unknown"
  | "workspace_busy"
  | "maintenance";
export async function queueReason(
  db: PoolClient,
  operation: { id: string; session_id: string },
  reason: QueueReason,
) {
  await lockSessionResource(db, operation.session_id);
  const changed = await db.query(
    "UPDATE operations SET queue_reason=$2 WHERE id=$1 AND state='queued' AND queue_reason IS DISTINCT FROM $2 RETURNING id",
    [operation.id, reason],
  );
  if (changed.rowCount)
    await event(db, operation.session_id, "operation.queued", {
      operationId: operation.id,
      queueReason: reason,
    });
}
export async function runtimeState(
  db: PoolClient,
  sessionId: string,
  generation: number,
  state: string,
  activity = false,
) {
  await lockSessionResource(db, sessionId);
  const changed = await db.query(
    "UPDATE conversation_runtimes SET state=$3,last_activity_at=CASE WHEN $4 THEN clock_timestamp() ELSE last_activity_at END,idle_until=CASE WHEN $3='idle' THEN CASE WHEN $4 THEN clock_timestamp()+interval '30 minutes' ELSE coalesce(idle_until,last_activity_at+interval '30 minutes') END ELSE NULL END WHERE session_id=$1 AND generation=$2 AND (state IS DISTINCT FROM $3 OR $4) RETURNING session_id",
    [sessionId, generation, state, activity],
  );
  if (changed.rowCount)
    await event(db, sessionId, "runtime.changed", { generation, state });
}
