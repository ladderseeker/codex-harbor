import type { PoolClient } from "pg";
import { HarborError } from "../../policy/src/index.ts";
export async function lockIntentAdmission(db: PoolClient, owner: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "browser-intents:" + owner,
  ]);
}
/** Exact retained-key reconciliation precedes this check. Call before external effects. */
export async function admitOrdinaryIntent(db: PoolClient, owner: string) {
  await lockIntentAdmission(db, owner);
  if (
    Number(
      (
        await db.query(
          "SELECT count(*) FROM intents WHERE actor=$1 AND control_target IS NULL",
          [owner],
        )
      ).rows[0].count,
    ) >= 10000
  )
    throw new HarborError(
      429,
      "INTENT_QUOTA",
      "Ordinary request history capacity reached; reserved controls remain available",
    );
}
