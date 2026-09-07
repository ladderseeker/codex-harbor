import { lockOwnerIdentity } from "../../policy/src/authority.ts";
import type { Pool } from "pg";
import { transaction } from "../../storage/src/index.ts";
/** Native turn state remains authoritative; attention never fabricates a terminal result. */
export async function settleOccurrences(pool: Pool) {
  const rows = (
    await pool.query(
      `SELECT id,schedule_id FROM schedule_occurrences WHERE state IN ('queued_turn','running','attention','uncertain') ORDER BY updated_at LIMIT 4`,
    )
  ).rows;
  for (const hint of rows)
    await transaction(pool, async (db) => {
      await lockOwnerIdentity(db);
      await db.query("SELECT pg_advisory_xact_lock(740028)");
      await db.query("SELECT id FROM schedules WHERE id=$1 FOR UPDATE", [
        hint.schedule_id,
      ]);
      const row = (
        await db.query(
          `SELECT o.*,t.state AS turn_state,t.uncertainty_acknowledged_at
      FROM schedule_occurrences o LEFT JOIN operations t ON t.id=o.turn_id WHERE o.id=$1 FOR UPDATE OF o`,
          [hint.id],
        )
      ).rows[0];
      if (!row?.turn_state) return;
      const state = (
        {
          queued: "queued_turn",
          dispatching: "queued_turn",
          running: "running",
          waiting_approval: "attention",
          waiting_input: "attention",
          succeeded: "succeeded",
          failed: "failed",
          interrupted: "cancelled",
          uncertain: "uncertain",
        } as Record<string, string>
      )[row.turn_state];
      if (!state) return;
      const terminal = [
        "succeeded",
        "failed",
        "cancelled",
        "uncertain",
      ].includes(state);
      const reason =
        row.turn_state === "waiting_approval"
          ? "APPROVAL_REQUIRED"
          : row.turn_state === "waiting_input"
            ? "INPUT_REQUIRED"
            : state === "uncertain"
              ? "DELIVERY_UNCERTAIN"
              : state === "failed"
                ? "TURN_FAILED"
                : null;
      await db.query(
        `UPDATE schedule_occurrences SET state=$2,reason=$3,
      started_at=CASE WHEN $2 IN ('running','attention') THEN COALESCE(started_at,clock_timestamp()) ELSE started_at END,
      ended_at=CASE WHEN $4 THEN COALESCE(ended_at,clock_timestamp()) ELSE ended_at END,
      acknowledged_at=COALESCE(acknowledged_at,$5),updated_at=clock_timestamp() WHERE id=$1`,
        [row.id, state, reason, terminal, row.uncertainty_acknowledged_at],
      );
      if (terminal && state !== "uncertain" && row.kind === "recurring")
        await db.query(
          `UPDATE schedules s SET state='completed',reason=NULL,updated_at=clock_timestamp()
          FROM schedule_versions v WHERE s.id=$1 AND s.state='enabled' AND s.config_revision=$2
          AND s.active_grant_id=$3 AND v.schedule_id=s.id AND v.revision=s.config_revision AND v.config->'rule'->>'kind'='once'`,
          [row.schedule_id, row.config_revision, row.grant_id],
        );
      if (state === "uncertain")
        await db.query(
          "UPDATE schedules SET state='attention',reason='DELIVERY_UNCERTAIN',updated_at=clock_timestamp() WHERE id=$1 AND state='enabled'",
          [row.schedule_id],
        );
    });
}
