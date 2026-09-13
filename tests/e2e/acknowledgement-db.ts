/** Owned test connections; no shared pool can inherit the advisory transaction. */
import pg from "pg";
export function acknowledgementPool(connectionString: string, timeout = 5000) {
  if (
    !connectionString ||
    !Number.isInteger(timeout) ||
    timeout < 100 ||
    timeout > 5000
  )
    throw Error("Bounded acknowledgement test connection required");
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: timeout,
    query_timeout: timeout,
    statement_timeout: timeout,
    idleTimeoutMillis: timeout,
  });
  pool.on("error", () => {});
  pool.on("connect", (client) => client.on("error", () => {}));
  return pool;
}
export async function releaseAcknowledgementGate(
  gate: Pick<pg.PoolClient, "query" | "release">,
  committed: boolean,
  errors: string[],
) {
  try {
    if (!committed) await gate.query("ROLLBACK");
  } catch {
    errors.push("GATE_RELEASE_FAILED");
  } finally {
    // Even a lost rollback response cannot return an open transaction to a pool.
    // These are dedicated one-case connections, so always discard this client.
    try {
      gate.release(true);
    } catch {
      errors.push("GATE_DESTROY_FAILED");
    }
  }
}
