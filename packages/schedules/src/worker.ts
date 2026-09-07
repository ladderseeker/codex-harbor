import type { Pool, PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { transaction } from "../../storage/src/index.ts";
import { lockScheduleOwner } from "./locking.ts";
import { deploymentAdmission } from "../../storage/src/deployment.ts";
import { HarborError } from "../../policy/src/index.ts";
import { planSchedule } from "./planner.ts";
import { advanceOccurrence, type ScheduleExecutionConfig } from "./phases.ts";
import { settleOccurrences } from "./settlement.ts";
import { pruneScheduleHistory } from "./capacity.ts";
let maintainedAt = 0;
export async function processSchedules(
  pool: Pool,
  boss: PgBoss,
  c: ScheduleExecutionConfig,
  fence: (db: PoolClient) => Promise<void>,
) {
  await settleOccurrences(pool);
  if (Date.now() - maintainedAt > 60000) {
    await transaction(pool, pruneScheduleHistory);
    maintainedAt = Date.now();
  }
  const schedules = (
    await pool.query(
      "SELECT id,config_revision,grant_epoch FROM schedules WHERE state='enabled' ORDER BY last_planned_at NULLS FIRST,id LIMIT 16",
    )
  ).rows;
  for (const schedule of schedules) {
    await transaction(pool, async (db) => {
      await lockScheduleOwner(db);
      await deploymentAdmission(db, true);
      await fence(db);
    });
    try {
      await planSchedule(pool, boss, c, schedule.id, fence);
    } catch (error) {
      if (!(error instanceof HarborError)) throw error;
      await transaction(pool, async (db) => {
        await lockScheduleOwner(db);
        await deploymentAdmission(db, true);
        await db.query(
          "UPDATE schedules SET state='attention',reason=$2 WHERE id=$1 AND state='enabled' AND config_revision=$3 AND grant_epoch=$4",
          [
            schedule.id,
            error.code,
            schedule.config_revision,
            schedule.grant_epoch,
          ],
        );
        await fence(db);
      });
    }
    await pool.query(
      "UPDATE schedules SET last_planned_at=clock_timestamp() WHERE id=$1",
      [schedule.id],
    );
  }
  const rows = (
    await pool.query(
      "SELECT id,schedule_id FROM schedule_occurrences WHERE state IN ('accepted','preparing_workspace') ORDER BY updated_at,id LIMIT 4",
    )
  ).rows;
  for (const row of rows)
    try {
      await advanceOccurrence(pool, c, row.id, fence);
    } catch (error) {
      if (!(error instanceof HarborError)) throw error;
      await transaction(pool, async (db) => {
        await lockScheduleOwner(db);
        await deploymentAdmission(db, true);
        await db.query("SELECT pg_advisory_xact_lock(740028)");
        await fence(db);
        await db.query("SELECT id FROM schedules WHERE id=$1 FOR UPDATE", [
          row.schedule_id,
        ]);
        const occurrence = (
          await db.query(
            "SELECT * FROM schedule_occurrences WHERE id=$1 FOR UPDATE",
            [row.id],
          )
        ).rows[0];
        if (
          !occurrence ||
          !["accepted", "preparing_workspace"].includes(occurrence.state)
        )
          return;
        const overlap = ["WORKSPACE_BUSY", "SCHEDULE_OVERLAP"].includes(
          error.code,
        );
        const schedule = (
          await db.query("SELECT state FROM schedules WHERE id=$1", [
            occurrence.schedule_id,
          ])
        ).rows[0];
        const state = overlap
          ? "skipped"
          : schedule.state === "paused"
            ? "cancelled"
            : "failed";
        await db.query(
          "UPDATE schedule_occurrences SET state=$2,reason=$3,ended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",
          [row.id, state, error.code],
        );
        if (!overlap)
          await db.query(
            "UPDATE schedules SET state='attention',reason=$2 WHERE id=$1 AND state='enabled'",
            [occurrence.schedule_id, error.code],
          );
      });
    }
}
