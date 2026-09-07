import { requireScheduleAuthority } from "../../schedules/src/authority.ts";
import { transaction } from "../../storage/src/index.ts";
import type { Pool, PoolClient } from "pg";
import { digest, HarborError, authorizePermission } from "./index.ts";

export const tokenScopes = [
  "read",
  "execute",
  "approve",
  "cancel",
  "schedules:read",
  "schedules:manage",
  "files:read",
  "files:write",
  "git:read",
  "git:write",
  "terminal:read",
  "terminal:control",
  "terminal:terminate",
  "previews:read",
  "previews:manage",
] as const;
export type Scope = (typeof tokenScopes)[number];
export interface Authority {
  kind: "browser" | "token" | "schedule";
  hash: string;
  csrf: string;
  projectIds?: string[];
  scopes?: Scope[];
  permissionProfile?: string;
  tokenId?: string;
}
export interface AuthorityConfig {
  HARBOR_OIDC_ISSUER: string;
  HARBOR_OWNER_SUBJECT: string;
  HARBOR_IDLE_SECONDS: number;
  HARBOR_PERMISSION_CEILING?: "read-only" | "workspace-write";
}
export interface AuthorityNeed {
  projectId?: string;
  scope?: Scope;
  permissionProfile?: string;
  internalOperation?: { kind: "workspace" | "turn"; id: string };
}
type Config = AuthorityConfig;
export async function requireAuthority(
  db: Pool | PoolClient,
  actor: string,
  c: Config,
  need: AuthorityNeed = {},
): Promise<Authority> {
  if (!("release" in db))
    return transaction(db as Pool, (tx) =>
      requireAuthority(tx, actor, c, need),
    );
  await lockOwnerIdentity(db as PoolClient);
  if (actor.startsWith("schedule:"))
    return requireScheduleAuthority(db, actor, c, need, (source, sourceNeed) =>
      requireAuthority(db, source, c, sourceNeed),
    );
  const pin = digest(c.HARBOR_OIDC_ISSUER + "\0" + c.HARBOR_OWNER_SUBJECT);
  if (!actor.startsWith("pat:")) {
    await db.query(
      "SELECT hash FROM browser_sessions WHERE hash=$1 FOR SHARE",
      [actor],
    );
    const row = (
      await db.query(
        "SELECT csrf FROM browser_sessions WHERE hash=$1 AND NOT revoked AND expires_at>clock_timestamp() AND last_seen>clock_timestamp()-($2*interval '1 second') AND identity_pin=$3 AND (SELECT identity_pin FROM harbor_meta)=$3",
        [actor, c.HARBOR_IDLE_SECONDS, pin],
      )
    ).rows[0];
    if (!row)
      throw new HarborError(401, "AUTH_EXPIRED", "Session expired or revoked");
    return { kind: "browser", hash: actor, csrf: row.csrf };
  }
  await db.query("SELECT id FROM api_tokens WHERE id=$1 FOR SHARE", [
    actor.slice(4),
  ]);
  const row = (
    await db.query(
      "SELECT * FROM api_tokens WHERE id=$1 AND NOT revoked AND expires_at>clock_timestamp() AND identity_pin=$2 AND instance_id=$3 AND (SELECT identity_pin FROM harbor_meta)=$2",
      [actor.slice(4), pin, process.env.HARBOR_INSTANCE_ID ?? "harbor"],
    )
  ).rows[0];
  if (!row)
    throw new HarborError(401, "TOKEN_INVALID", "Token expired or revoked");
  if (need.scope && !row.scopes.includes(need.scope))
    throw new HarborError(
      403,
      "SCOPE_DENIED",
      "Token scope does not permit this operation",
    );
  if (need.projectId && !row.project_ids.includes(need.projectId))
    throw new HarborError(
      403,
      "PROJECT_DENIED",
      "Token does not grant this project",
    );
  if (need.permissionProfile)
    authorizePermission(need.permissionProfile as any, row.permission_profile);
  return {
    kind: "token",
    hash: actor,
    csrf: "",
    tokenId: row.id,
    projectIds: row.project_ids,
    scopes: row.scopes,
    permissionProfile: row.permission_profile,
  };
}
/** Matches bindIdentity's exclusive gate. Acquire before any actor or meta row lock. */
export async function lockOwnerIdentity(db: PoolClient) {
  await db.query("SELECT pg_advisory_xact_lock_shared(740016)");
}
/** Cookie activity cannot revive an idle/absolute-expired row after a lock wait. */
export async function authenticateBrowser(db: Pool, c: Config, hash: string) {
  return transaction(db, async (tx) => {
    await lockOwnerIdentity(tx);
    await tx.query(
      "SELECT hash FROM browser_sessions WHERE hash=$1 FOR UPDATE",
      [hash],
    );
    const authority = await requireAuthority(tx, hash, c);
    await tx.query(
      "UPDATE browser_sessions SET last_seen=clock_timestamp() WHERE hash=$1",
      [hash],
    );
    return authority;
  });
}
export async function authenticateBearer(db: Pool, c: Config, header: string) {
  if (!/^Bearer hbr_[A-Za-z0-9_-]{43}$/.test(header))
    throw new HarborError(401, "TOKEN_INVALID", "Invalid bearer credential");
  const row = (
    await db.query("SELECT id FROM api_tokens WHERE verifier=$1", [
      digest(header.slice(7)),
    ])
  ).rows[0];
  if (!row)
    throw new HarborError(401, "TOKEN_INVALID", "Invalid bearer credential");
  const authority = await requireAuthority(db, "pat:" + row.id, c);
  await db.query("UPDATE api_tokens SET last_used_at=now() WHERE id=$1", [
    row.id,
  ]);
  return authority;
}
