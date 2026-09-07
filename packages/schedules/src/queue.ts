import type { PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
export const SCHEDULE_QUEUE = "harbor-schedule-occurrence";
export async function initializeScheduleQueue(boss: PgBoss) {
  await boss.createQueue(SCHEDULE_QUEUE, {
    retryLimit: 3,
    retryDelay: 2,
    expireInSeconds: 60,
    retentionSeconds: 86400,
    deleteAfterSeconds: 86400,
  });
}
/** Pass the actual caller transaction; a COMMIT failure cannot orphan a wakeup. */
export async function enqueueOccurrence(
  boss: PgBoss,
  db: PoolClient,
  occurrenceId: string,
  epoch: number,
) {
  const id = await boss.send(
    SCHEDULE_QUEUE,
    { occurrenceId, epoch },
    {
      id: occurrenceId,
      db: { executeSql: (sql, values) => db.query(sql, values) },
    },
  );
  if (id !== occurrenceId)
    throw Error("Schedule occurrence queue identity conflict");
}
