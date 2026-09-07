import type { DB } from "./index.ts";
/** Replay is disposable; durable messages and unresolved operations are not. */
export async function maintain(db: DB, at = new Date()) {
  await db.query(
    "DELETE FROM events e WHERE EXISTS(SELECT 1 FROM sessions s WHERE s.id=e.session_id AND e.sequence<s.sequence-2000) OR (e.created_at<$1::timestamptz-interval '7 days' AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.session_id=e.session_id AND o.state IN ('queued','dispatching','running','waiting_approval','waiting_input','uncertain')))",
    [at],
  );
  await db.query(
    "DELETE FROM intents i WHERE i.created_at<$1::timestamptz-interval '24 hours' AND to_timestamp(split_part(i.key,':',1)::double precision/1000)<$1::timestamptz-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.id::text=i.result->'operation'->>'id' AND o.state IN ('queued','dispatching','running','waiting_approval','waiting_input','uncertain'))",
    [at],
  );
  await db.query("DELETE FROM login_states WHERE expires_at<$1::timestamptz", [
    at,
  ]);
  await db.query(
    "DELETE FROM browser_sessions b WHERE b.expires_at<$1::timestamptz-interval '1 day' AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.actor_hash=b.hash AND o.state IN ('queued','dispatching','running','waiting_approval','waiting_input','uncertain'))",
    [at],
  );
  await db.query(
    "DELETE FROM audits WHERE created_at<$1::timestamptz-interval '30 days'",
    [at],
  );
}
