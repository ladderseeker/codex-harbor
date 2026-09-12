import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { HarborError, digest } from "../../policy/src/index.ts";
import {
  requireAuthority,
  lockOwnerIdentity,
} from "../../policy/src/authority.ts";
import { selectedWorkspace } from "../../workspaces/src/service.ts";
import type { Config } from "../../../apps/api/src/config.ts";

export function configured(c: Config) {
  if (!c.HARBOR_PREVIEW_DOMAIN || !c.HARBOR_PREVIEW_SOCKET)
    throw new HarborError(
      503,
      "PREVIEWS_UNAVAILABLE",
      "Private preview DNS, TLS and relay are not configured",
    );
  if (
    new URL(c.HARBOR_ORIGIN).hostname.endsWith("." + c.HARBOR_PREVIEW_DOMAIN) ||
    new URL(c.HARBOR_ORIGIN).hostname === c.HARBOR_PREVIEW_DOMAIN
  )
    throw new HarborError(
      503,
      "PREVIEWS_UNAVAILABLE",
      "Preview origins must be separate from Harbor",
    );
}
export function previewOrigin(p: { hostname: string }, c: Config) {
  configured(c);
  if (
    !/^[a-f0-9]{32}\./.test(p.hostname) ||
    !p.hostname.endsWith("." + c.HARBOR_PREVIEW_DOMAIN)
  )
    throw new HarborError(
      409,
      "PREVIEW_IDENTITY",
      "Preview hostname is unavailable",
    );
  return (
    "https://" +
    p.hostname +
    (c.HARBOR_PREVIEW_HTTPS_PORT === 443
      ? ""
      : ":" + c.HARBOR_PREVIEW_HTTPS_PORT)
  );
}
export async function previewRow(db: PoolClient, id: string) {
  const r = await db.query(
    "SELECT p.*,coalesce((SELECT id FROM preview_stops s WHERE s.preview_id=p.id AND s.generation=p.generation ORDER BY created_at DESC LIMIT 1),retirement_ack) AS last_stop_id FROM previews p WHERE p.id=$1",
    [id],
  );
  if (!r.rowCount) throw new HarborError(404, "NOT_FOUND", "Preview not found");
  return r.rows[0];
}
export async function lockedPreview(db: PoolClient, id: string) {
  const before = await previewRow(db, id);
  const w = await selectedWorkspace(db, before.workspace_id, true);
  await db.query("SELECT id FROM previews WHERE id=$1 FOR UPDATE", [id]);
  return { p: await previewRow(db, id), w };
}
export async function requirePreviewAuthority(
  db: PoolClient,
  p: any,
  actor: string,
  c: Config,
  action: "read" | "start" | "stop" | "open",
) {
  const owner = await requireAuthority(db, actor, c, {
    projectId: p.project_id,
    scope: action === "read" ? "previews:read" : "previews:manage",
    ...(action === "start" ? { permissionProfile: p.permission_profile } : {}),
  });
  if (action === "start" || action === "stop")
    await requireAuthority(db, actor, c, {
      projectId: p.project_id,
      scope: action === "start" ? "execute" : "cancel",
      ...(action === "start"
        ? { permissionProfile: p.permission_profile }
        : {}),
    });
  if (action === "open" && owner.kind !== "browser")
    throw new HarborError(
      403,
      "BROWSER_REQUIRED",
      "Only an owner browser can open preview content",
    );
  return owner;
}
export async function commandSlot(db: PoolClient, p: any) {
  const r = await db.query(
    "UPDATE previews SET command_count=command_count+1 WHERE id=$1 AND command_count<128 RETURNING id",
    [p.id],
  );
  if (!r.rowCount)
    throw new HarborError(
      429,
      "PREVIEW_COMMAND_LIMIT",
      "This preview's command history is full; reserved stop remains available",
    );
}
/** Derived only while holding the current owner browser authority; no secret is stored in a URL or database result. */
export function openingSecrets(
  csrf: string,
  id: string,
  previewId: string,
  generation: number,
) {
  const material = JSON.stringify([id, previewId, generation]);
  const ticket = createHmac("sha256", csrf)
    .update("harbor-preview-ticket\0" + material)
    .digest("base64url");
  const grant = createHmac("sha256", csrf)
    .update("harbor-preview-grant\0" + material)
    .digest("base64url");
  return {
    ticket,
    grant,
    ticketHash: digest(ticket),
    grantHash: digest(grant),
  };
}
export async function revokePreviewAccess(db: PoolClient, id: string) {
  await db.query(
    "UPDATE preview_openings SET revoked=true WHERE preview_id=$1 AND NOT revoked",
    [id],
  );
  await db.query(
    "UPDATE preview_grants SET revoked=true WHERE preview_id=$1 AND NOT revoked",
    [id],
  );
}
/** Fresh checks follow every row wait. The caller separately bounds an in-flight query with its transport lease. */
export async function viewerGrant(
  db: PoolClient,
  c: Config,
  hostname: string,
  hash: string,
) {
  await lockOwnerIdentity(db);
  await db.query("SELECT emergency FROM harbor_meta FOR SHARE");
  const before = (
    await db.query(
      "SELECT g.*,p.hostname FROM preview_grants g JOIN previews p ON p.id=g.preview_id WHERE g.hash=$1 AND p.hostname=$2",
      [hash, hostname],
    )
  ).rows[0];
  if (!before)
    throw new HarborError(
      401,
      "PREVIEW_ACCESS",
      "Open a private preview from Harbor",
    );
  const owner = await requireAuthority(db, before.actor_hash, c, {
    projectId: (await previewRow(db, before.preview_id)).project_id,
  });
  if (owner.kind !== "browser")
    throw new HarborError(403, "BROWSER_REQUIRED", "Owner browser required");
  await db.query("SELECT id FROM previews WHERE id=$1 FOR SHARE", [
    before.preview_id,
  ]);
  await db.query("SELECT id FROM preview_grants WHERE id=$1 FOR SHARE", [
    before.id,
  ]);
  await requireAuthority(db, before.actor_hash, c);
  const row = (
    await db.query(
      `SELECT g.id AS grant_id,g.actor_hash,p.id AS preview_id,p.generation,p.runner_id,p.relay_id,p.port,p.hostname,
    LEAST(g.expires_at,b.expires_at,b.last_seen+($3*interval '1 second'),clock_timestamp()+interval '5 seconds') AS lease_until
    FROM preview_grants g JOIN previews p ON p.id=g.preview_id JOIN browser_sessions b ON b.hash=g.actor_hash
    WHERE g.id=$1 AND p.hostname=$2 AND NOT g.revoked AND g.expires_at>clock_timestamp() AND g.generation=p.generation
      AND p.state='ready' AND NOT p.retired AND NOT (SELECT emergency FROM harbor_meta)`,
      [before.id, hostname, c.HARBOR_IDLE_SECONDS],
    )
  ).rows[0];
  if (!row)
    throw new HarborError(
      401,
      "PREVIEW_ACCESS",
      "Preview access expired or stopped; open it again from Harbor",
    );
  return {
    ...row,
    generation: Number(row.generation),
    leaseUntil: new Date(row.lease_until).getTime(),
  };
}
