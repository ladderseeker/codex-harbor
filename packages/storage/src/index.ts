import { createHash } from "node:crypto";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import type { HarborEvent } from "../../contracts/src/index.ts";
export type DB = pg.Pool | pg.PoolClient;
export function createPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    query_timeout: 15000,
  });
}
export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(740011)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS harbor_migrations(version text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = new URL("./migrations/", import.meta.url);
    for (const version of (await readdir(directory))
      .filter((name) => /^\d{3}_[a-z_]+\.sql$/.test(name))
      .sort()) {
      const sql = await readFile(new URL(version, directory), "utf8");
      const digest = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(
        "SELECT digest FROM harbor_migrations WHERE version=$1",
        [version],
      );
      if (existing.rowCount) {
        if (existing.rows[0].digest !== digest)
          throw Error("Applied database migration digest mismatch");
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO harbor_migrations(version,digest) VALUES($1,$2)",
          [version, digest],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(740011)");
    client.release();
  }
}
export async function transaction<T>(
  pool: pg.Pool,
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function event(db: DB, id: string, type: string, data: unknown) {
  const r = await db.query(
    "UPDATE sessions SET sequence=sequence+1,updated_at=now() WHERE id=$1 RETURNING sequence",
    [id],
  );
  const seq = Number(r.rows[0].sequence);
  const row = await db.query(
    "INSERT INTO events(session_id,sequence,type,data) VALUES($1,$2,$3,$4) RETURNING created_at",
    [id, seq, type, JSON.stringify(data)],
  );
  return {
    schemaVersion: 1,
    conversationId: id,
    sequence: seq,
    type,
    timestamp: row.rows[0].created_at.toISOString(),
    data,
  } satisfies HarborEvent;
}
export function publicRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(
        ([k]) =>
          ![
            "native_thread_id",
            "native_turn_id",
            "actor_hash",
            "answer_actor_hash",
            "payload",
            "root_id",
            "relative_path",
            "canonical_path",
            "device",
            "inode",
            "process_inspection",
          ].includes(k),
      )
      .map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        v instanceof Date
          ? v.toISOString()
          : k === "generation" || k === "sequence"
            ? Number(v)
            : v,
      ]),
  );
}
/** Caller holds this conversation lock before changing any turn state. */
export async function deriveSessionState(db: DB, sessionId: string) {
  await db.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [sessionId]);
  const states = await db.query(
    "SELECT state FROM operations WHERE session_id=$1 AND kind='turn' ORDER BY created_at DESC,id DESC",
    [sessionId],
  );
  const rows = states.rows.map((r) => r.state as string);
  const state = rows.includes("uncertain")
    ? "uncertain"
    : (rows.find((s) =>
        [
          "running",
          "waiting_approval",
          "waiting_input",
          "dispatching",
        ].includes(s),
      ) ?? (rows.includes("queued") ? "queued" : (rows[0] ?? "idle")));
  await db.query("UPDATE sessions SET state=$2 WHERE id=$1", [
    sessionId,
    state,
  ]);
  return state;
}
/** Configuration rotation revokes legacy and mismatched grants before admission. */
export async function bindIdentity(pool: pg.Pool, pin: string) {
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(740016)");
    await db.query(
      "UPDATE browser_sessions SET revoked=true WHERE identity_pin<>$1",
      [pin],
    );
    await db.query("UPDATE harbor_meta SET identity_pin=$1", [pin]);
  });
}
