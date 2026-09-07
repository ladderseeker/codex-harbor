import type { PoolClient } from "pg";
import { requestTurnCancellation } from "../../storage/src/cancellation.ts";
import { selectedWorkspace } from "../../workspaces/src/service.ts";
import { HarborError } from "../../policy/src/index.ts";
import { requireAuthority } from "../../policy/src/authority.ts";
import type { ScheduleAuthorityConfig } from "./admission.ts";
export async function cancelOccurrence(
  db: PoolClient,
  s: any,
  id: string,
  actor: string,
  c: ScheduleAuthorityConfig,
  expectedAttempt = 1,
) {
  const need = { scope: "cancel" as const, projectId: s.project_id };
  await requireAuthority(db, actor, c, need);
  const o = (
    await db.query(
      "SELECT * FROM schedule_occurrences WHERE id=$1 AND schedule_id=$2 FOR UPDATE",
      [id, s.id],
    )
  ).rows[0];
  if (!o) throw new HarborError(404, "NOT_FOUND", "Occurrence not found");
  if (
    ![
      "accepted",
      "preparing_workspace",
      "queued_turn",
      "running",
      "attention",
    ].includes(o.state)
  )
    throw new HarborError(
      409,
      "OCCURRENCE_TERMINAL",
      "This occurrence is no longer cancellable",
    );
  if (
    (await db.query("SELECT 1 FROM operations WHERE id=$1", [o.turn_id]))
      .rowCount
  ) {
    const result = await requestTurnCancellation(db, o.turn_id, {
      actor,
      operationId: o.cancel_operation_id,
      authorize: async (db) => {
        await requireAuthority(db, actor, c, need);
        const pending = (
          await db.query(
            "SELECT state,control_attempts FROM operations WHERE session_id=$1 AND kind='cancel' AND payload->>'operationId'=$2 LIMIT 1",
            [o.session_id, o.turn_id],
          )
        ).rows[0];
        const next =
          pending?.state === "failed"
            ? Number(pending.control_attempts) + 1
            : 1;
        if (expectedAttempt !== next)
          throw new HarborError(
            409,
            "CONTROL_ATTEMPT_CHANGED",
            "Reload the cancellation outcome before retrying",
          );
      },
    });
    await db.query(
      "UPDATE schedule_occurrences SET cancel_operation_id=$2 WHERE id=$1",
      [o.id, result.operation.id],
    );
    return { occurrence: { id: o.id, state: o.state }, ...result };
  }
  if (
    (await db.query("SELECT 1 FROM workspaces WHERE id=$1", [o.workspace_id]))
      .rowCount
  ) {
    await selectedWorkspace(db, o.workspace_id, true);
    await requireAuthority(db, actor, c, need);
    const storage = (
      await db.query(
        "SELECT state FROM workspace_storage_operations WHERE id=$1 FOR UPDATE",
        [o.storage_operation_id],
      )
    ).rows[0];
    if (storage?.state === "queued") {
      await db.query(
        "UPDATE workspace_storage_operations SET state='failed',failure_code='CANCELLED',updated_at=clock_timestamp() WHERE id=$1",
        [o.storage_operation_id],
      );
      await db.query(
        "UPDATE workspaces SET state='failed',failure_code='CANCELLED' WHERE id=$1 AND state='creating'",
        [o.workspace_id],
      );
    }
  }
  await requireAuthority(db, actor, c, need);
  await db.query(
    "UPDATE schedule_occurrences SET state='cancelled',reason='OWNER_CANCELLED',ended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",
    [o.id],
  );
  return {
    occurrence: { id: o.id, state: "cancelled" },
    message:
      "Turn was not admitted; already accepted workspace preparation may still settle",
  };
}
