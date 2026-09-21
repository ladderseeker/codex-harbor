import { transaction, type DB } from "./index.ts";
import { lockSessionResource } from "./session-lock.ts";
export const REPLAY_LIMIT = 2000;
/** Pool calls own the resource transaction; client callers already hold parents
 * and session. The watermark remains durable after replay becomes empty. */
export async function pruneReplay(
  db: DB,
  id: string,
  at = new Date(),
): Promise<{ sequence: string; replay_floor: string } | undefined> {
  if (!("release" in db))
    return transaction(db, async (tx) => {
      await lockSessionResource(tx, id);
      return pruneReplay(tx, id, at);
    });
  const row = await db.query(
    `WITH locked AS MATERIALIZED (SELECT id,sequence FROM sessions WHERE id=$1 FOR UPDATE), removed AS (DELETE FROM events e USING locked s WHERE e.session_id=s.id AND (e.sequence<=s.sequence-2000 OR e.created_at<$2::timestamptz-interval '7 days') RETURNING e.sequence) UPDATE sessions SET replay_floor=greatest(replay_floor,coalesce((SELECT max(sequence) FROM removed),replay_floor)) WHERE id=$1 RETURNING sequence,replay_floor`,
    [id, at],
  );
  return row.rows[0] as { sequence: string; replay_floor: string } | undefined;
}
