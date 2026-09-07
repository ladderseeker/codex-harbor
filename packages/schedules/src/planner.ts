import { occurrenceCapacity } from "./capacity.ts";
import type { Pool, PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { randomUUID } from "node:crypto";
import { transaction } from "../../storage/src/index.ts";
import { lockScheduleOwner } from "./locking.ts";
import { deploymentAdmission } from "../../storage/src/deployment.ts";
import { HarborError } from "../../policy/src/index.ts";
import {
  admitRecurringOccurrence,
  type ScheduleAuthorityConfig,
} from "./admission.ts";
import { schedulerNow } from "./clock.ts";
import {
  nextMinutes,
  recentMinutes,
  timeFingerprint,
  type IntendedMinute,
} from "./time.ts";
interface Batch {
  rangeFrom?: string;
  through: string;
  next: string | null;
  minutes: IntendedMinute[];
  excluded: string[];
}
/** Persist the catch-up choice once. A later tick cannot refill it as each run finishes. */
export async function planSchedule(
  pool: Pool,
  boss: PgBoss,
  c: ScheduleAuthorityConfig,
  id: string,
  fence?: (db: PoolClient) => Promise<void>,
) {
  const hint = (
    await pool.query(
      `SELECT s.*,v.config FROM schedules s JOIN schedule_versions v ON v.schedule_id=s.id AND v.revision=s.config_revision WHERE s.id=$1`,
      [id],
    )
  ).rows[0];
  if (!hint || hint.state !== "enabled") return;
  const now = await schedulerNow(pool);
  if (
    hint.time_fingerprint !== timeFingerprint().digest ||
    new Date(now) < (hint.last_observed_at ?? hint.cursor_at)
  ) {
    await transaction(pool, async (db) => {
      await lockScheduleOwner(db);
      await deploymentAdmission(db, true);
      await db.query(
        "UPDATE schedules SET state='attention',reason=$2,updated_at=clock_timestamp() WHERE id=$1 AND state='enabled' AND config_revision=$3 AND grant_epoch=$4",
        [
          id,
          hint.time_fingerprint !== timeFingerprint().digest
            ? "TIME_ENGINE_CHANGED"
            : "CLOCK_MOVED_BACKWARD",
          hint.config_revision,
          hint.grant_epoch,
        ],
      );
      await fence?.(db);
    });
    return;
  }
  if (!hint.catch_up && (!hint.next_due_at || hint.next_due_at > new Date(now)))
    return;
  let batch = hint.catch_up as Batch | null;
  if (!batch) {
    const due = (
      await nextMinutes(hint.config.rule, hint.cursor_at.toISOString(), 1)
    )[0];
    const late = Date.parse(now) - Date.parse(due.instant) > 60000;
    let minutes: IntendedMinute[];
    if (!late) minutes = [due];
    else if (hint.config.missedPolicy === "catch_up") {
      const floor = new Date(
        Math.max(hint.cursor_at.getTime(), Date.parse(now) - 86400000),
      ).toISOString();
      minutes = await recentMinutes(hint.config.rule, floor, now);
    } else minutes = [];
    const next =
      hint.config.rule.kind === "once"
        ? null
        : (await nextMinutes(hint.config.rule, now, 1))[0].instant;
    batch = {
      through: now,
      next,
      minutes,
      excluded: minutes.map((m) => m.local),
      ...(late ? { rangeFrom: hint.cursor_at.toISOString() } : {}),
    };
    const saved = await transaction(pool, async (db) => {
      await lockScheduleOwner(db);
      await deploymentAdmission(db, true);
      const r = await db.query(
        "UPDATE schedules SET catch_up=$2,last_observed_at=$3 WHERE id=$1 AND state='enabled' AND config_revision=$4 AND grant_epoch=$5 AND cursor_at=$6 AND catch_up IS NULL RETURNING id",
        [
          id,
          JSON.stringify(batch),
          now,
          hint.config_revision,
          hint.grant_epoch,
          hint.cursor_at,
        ],
      );
      await fence?.(db);
      return !!r.rowCount;
    });
    if (!saved) return;
  }
  if (batch.minutes.length) {
    const minute = batch.minutes[0];
    try {
      await transaction(pool, async (db) => {
        const result = await admitRecurringOccurrence(
          db,
          boss,
          c,
          id,
          minute,
          batch!.next,
          {
            configRevision: hint.config_revision,
            ruleRevision: hint.rule_revision,
            grantId: hint.active_grant_id,
            batch,
          },
        );
        // Exact identity lookup can precede a concurrent pause/edit; only this same batch is consumed.
        await db.query(
          "UPDATE schedules SET catch_up=$2 WHERE id=$1 AND catch_up=$3",
          [
            id,
            JSON.stringify({ ...batch, minutes: batch!.minutes.slice(1) }),
            JSON.stringify(batch),
          ],
        );
        await fence?.(db);
        return result;
      });
    } catch (error) {
      if (
        error instanceof HarborError &&
        error.code === "SCHEDULE_OVERLAP" &&
        !batch.rangeFrom
      ) {
        await transaction(pool, async (db) => {
          await lockScheduleOwner(db);
          await deploymentAdmission(db, true);
          await db.query("SELECT pg_advisory_xact_lock(740028)");
          const current = (
            await db.query(
              "SELECT * FROM schedules WHERE id=$1 AND state='enabled' AND catch_up=$2 FOR UPDATE",
              [id, JSON.stringify(batch)],
            )
          ).rows[0];
          if (!current) return;
          await occurrenceCapacity(db, id);
          const counts = (
            await db.query(
              "SELECT count(*) AS total,count(*) FILTER(WHERE schedule_id=$1) AS own FROM schedule_occurrences",
              [id],
            )
          ).rows[0];
          if (Number(counts.total) >= 8192 || Number(counts.own) >= 256)
            throw new HarborError(
              429,
              "SCHEDULE_HISTORY_QUOTA",
              "Occurrence history capacity reached",
            );
          await db.query(
            `INSERT INTO schedule_occurrences(id,schedule_id,config_revision,rule_revision,kind,local_minute,intended_at,snapshot,state,reason,workspace_id,session_id,turn_id,storage_operation_id,cancel_operation_id,ended_at)
            VALUES($1,$2,$3,$4,'recurring',$5,$6,$7,'skipped','OVERLAP',$8,$9,$10,$11,$12,clock_timestamp()) ON CONFLICT(schedule_id,rule_revision,local_minute) WHERE kind='recurring' DO NOTHING`,
            [
              randomUUID(),
              id,
              current.config_revision,
              current.rule_revision,
              minute.local,
              minute.instant,
              JSON.stringify(minute),
              randomUUID(),
              randomUUID(),
              randomUUID(),
              randomUUID(),
              randomUUID(),
            ],
          );
          await fence?.(db);
          await db.query(
            "UPDATE schedules SET cursor_at=$2,catch_up=$3 WHERE id=$1",
            [
              id,
              minute.instant,
              JSON.stringify({ ...batch, minutes: batch!.minutes.slice(1) }),
            ],
          );
        });
        return;
      }
      if (
        error instanceof HarborError &&
        !["SCHEDULE_OVERLAP", "SCHEDULE_CHANGED", "SCHEDULE_PAUSED"].includes(
          error.code,
        )
      )
        await transaction(pool, async (db) => {
          await lockScheduleOwner(db);
          await deploymentAdmission(db, true);
          await db.query(
            "UPDATE schedules SET state='attention',reason=$2 WHERE id=$1 AND state='enabled' AND config_revision=$3 AND grant_epoch=$4",
            [id, error.code, hint.config_revision, hint.grant_epoch],
          );
          await fence?.(db);
        });
      else if (!(error instanceof HarborError)) throw error;
    }
    return;
  }
  await transaction(pool, async (db) => {
    await lockScheduleOwner(db);
    await deploymentAdmission(db, true);
    await db.query("SELECT pg_advisory_xact_lock(740028)");
    const current = (
      await db.query(
        "SELECT * FROM schedules WHERE id=$1 AND catch_up=$2 FOR UPDATE",
        [id, JSON.stringify(batch)],
      )
    ).rows[0];
    if (!current || current.state !== "enabled") return;
    // Range metadata is explicitly uncounted: it does not invent a number of omitted instants.
    if (batch!.rangeFrom) {
      await occurrenceCapacity(db, id);
      const count = (
        await db.query(
          "SELECT count(*) AS total,count(*) FILTER(WHERE schedule_id=$1) AS per_schedule FROM schedule_occurrences",
          [id],
        )
      ).rows[0];
      if (Number(count.total) >= 8192 || Number(count.per_schedule) >= 256)
        throw new HarborError(
          429,
          "SCHEDULE_HISTORY_QUOTA",
          "Occurrence history capacity reached",
        );
      await db.query(
        `INSERT INTO schedule_occurrences(id,schedule_id,config_revision,rule_revision,kind,intended_at,snapshot,state,reason,workspace_id,session_id,turn_id,storage_operation_id,cancel_operation_id,ended_at)
        VALUES($1,$2,$3,$4,'range',$5,$6,'skipped','MISSED_RANGE',$7,$8,$9,$10,$11,clock_timestamp())`,
        [
          randomUUID(),
          id,
          current.config_revision,
          current.rule_revision,
          batch!.through,
          JSON.stringify({
            from: batch!.rangeFrom,
            through: batch!.through,
            excludedLocalMinutes: batch!.excluded,
            count: null,
          }),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
        ],
      );
    }
    await fence?.(db);
    await db.query(
      "UPDATE schedules SET cursor_at=GREATEST(cursor_at,$2),next_due_at=$3,catch_up=NULL,state=CASE WHEN $3::timestamptz IS NULL AND NOT EXISTS(SELECT 1 FROM schedule_occurrences o WHERE o.schedule_id=$1 AND (o.state IN ('accepted','preparing_workspace','queued_turn','running','attention') OR (o.state='uncertain' AND o.acknowledged_at IS NULL))) THEN 'completed' ELSE state END,updated_at=clock_timestamp() WHERE id=$1",
      [id, batch!.through, batch!.next],
    );
  });
}
