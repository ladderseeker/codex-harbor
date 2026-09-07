import { lockScheduleOwner } from "./locking.ts";
import { deploymentAdmission } from "../../storage/src/deployment.ts";
import type { PoolClient } from "pg";
import { HarborError } from "../../policy/src/index.ts";
const settled =
  "NOT EXISTS(SELECT 1 FROM schedule_commands c WHERE c.occurrence_id=schedule_occurrences.id) AND (state IN ('succeeded','failed','cancelled','skipped') OR (state='uncertain' AND acknowledged_at IS NOT NULL))";
/** Caller holds the global schedule admission lock. Cursor identity outlives pruned rows. */
export async function occurrenceCapacity(db: PoolClient, scheduleId: string) {
  await db.query(
    "DELETE FROM schedule_commands WHERE (schedule_id,slot) IN (SELECT schedule_id,slot FROM schedule_commands WHERE schedule_id=$1 AND retry_until<clock_timestamp() LIMIT 128)",
    [scheduleId],
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const counts = (
      await db.query(
        "SELECT count(*) AS total,count(*) FILTER(WHERE schedule_id=$1) AS own FROM schedule_occurrences",
        [scheduleId],
      )
    ).rows[0];
    const own = Number(counts.own) >= 256,
      global = Number(counts.total) >= 8192;
    if (!own && !global) return;
    const row = (
      await db.query(
        `SELECT id,schedule_id,intended_at FROM schedule_occurrences WHERE ${settled} AND ($1::uuid IS NULL OR schedule_id=$1) ORDER BY intended_at,id LIMIT 1`,
        [own ? scheduleId : null],
      )
    ).rows[0];
    if (!row)
      throw new HarborError(
        429,
        "SCHEDULE_HISTORY_QUOTA",
        "Unresolved occurrence history occupies reserved capacity",
      );
    await db.query("SELECT id FROM schedules WHERE id=$1 FOR UPDATE", [
      row.schedule_id,
    ]);
    await db.query(
      "SELECT id FROM schedule_occurrences WHERE id=$1 FOR UPDATE",
      [row.id],
    );
    await db.query(
      "UPDATE schedules SET last_pruned=jsonb_build_object('through',$2::timestamptz,'reason','capacity','count',COALESCE((last_pruned->>'count')::bigint,0)+1) WHERE id=$1",
      [row.schedule_id, row.intended_at],
    );
    await db.query("DELETE FROM schedule_occurrences WHERE id=$1", [row.id]);
  }
  const counts = (
    await db.query(
      "SELECT count(*) AS total,count(*) FILTER(WHERE schedule_id=$1) AS own FROM schedule_occurrences",
      [scheduleId],
    )
  ).rows[0];
  if (Number(counts.total) >= 8192 || Number(counts.own) >= 256)
    throw new HarborError(
      429,
      "SCHEDULE_HISTORY_QUOTA",
      "Occurrence history capacity reached",
    );
}
export async function pruneScheduleHistory(db: PoolClient) {
  await lockScheduleOwner(db);
  await deploymentAdmission(db, true);
  await db.query("SELECT pg_advisory_xact_lock(740028)");
  // Retained control receipts protect history only through their retry window.
  // Maintenance must reclaim them even when a paused schedule has no new commands.
  await db.query(
    "DELETE FROM schedule_commands WHERE (schedule_id,slot) IN (SELECT schedule_id,slot FROM schedule_commands WHERE retry_until<clock_timestamp() ORDER BY retry_until,schedule_id,slot LIMIT 512)",
  );
  const rows = (
    await db.query(
      `SELECT id,schedule_id,intended_at FROM schedule_occurrences WHERE ${settled} AND ended_at<clock_timestamp()-interval '90 days' ORDER BY ended_at LIMIT 256`,
    )
  ).rows;
  for (const row of rows) {
    await db.query("SELECT id FROM schedules WHERE id=$1 FOR UPDATE", [
      row.schedule_id,
    ]);
    await db.query(
      "SELECT id FROM schedule_occurrences WHERE id=$1 FOR UPDATE",
      [row.id],
    );
    await db.query(
      "UPDATE schedules SET last_pruned=jsonb_build_object('through',$2::timestamptz,'reason','age','count',COALESCE((last_pruned->>'count')::bigint,0)+1) WHERE id=$1",
      [row.schedule_id, row.intended_at],
    );
    await db.query("DELETE FROM schedule_occurrences WHERE id=$1", [row.id]);
  }
}
