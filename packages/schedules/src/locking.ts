import type { PoolClient } from "pg";
import { lockOwnerIdentity } from "../../policy/src/authority.ts";
/** Take before source actor, deployment and schedule/resource locks. */
export async function lockScheduleOwner(db: PoolClient) {
  await lockOwnerIdentity(db);
  await db.query(
    "SELECT generation,identity_pin,emergency FROM harbor_meta FOR SHARE",
  );
}
