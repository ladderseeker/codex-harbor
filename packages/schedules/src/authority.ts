import { timeFingerprint } from "./time.ts";
import type { PoolClient } from "pg";
import type {
  Authority,
  AuthorityConfig,
  AuthorityNeed,
} from "../../policy/src/authority.ts";
import {
  authorizePermission,
  digest,
  HarborError,
} from "../../policy/src/index.ts";
const actorPattern = /^schedule:([a-f0-9-]{36}):([a-f0-9-]{36})$/;
export function scheduleActor(grantId: string, occurrenceId: string) {
  return `schedule:${grantId}:${occurrenceId}`;
}
/** Called only by the shared server-side authority resolver, never HTTP authentication. */
export async function requireScheduleAuthority(
  db: PoolClient,
  actor: string,
  c: AuthorityConfig,
  need: AuthorityNeed,
  sourceAuthority: (actor: string, need: AuthorityNeed) => Promise<Authority>,
): Promise<Authority> {
  const matched = actorPattern.exec(actor);
  const deny = () => {
    throw new HarborError(
      401,
      "SCHEDULE_GRANT",
      "Schedule grant expired, paused or changed",
    );
  };
  if (!matched || !need.internalOperation || need.scope !== "execute")
    return deny();
  const [, grantId, occurrenceId] = matched;
  const grant = (
    await db.query(
      "SELECT schedule_id,source_pat_id FROM schedule_grants WHERE id=$1",
      [grantId],
    )
  ).rows[0];
  if (!grant) return deny();
  // The owner identity gate is already held. Source PAT precedes schedule/grant,
  // project/workspace/session locks; subsequent checks reuse that lock order.
  const source = grant.source_pat_id
    ? await sourceAuthority("pat:" + grant.source_pat_id, {
        scope: "execute",
        projectId: need.projectId,
        permissionProfile:
          need.internalOperation.kind === "workspace"
            ? "workspace-write"
            : need.permissionProfile,
      })
    : undefined;
  if (source && !source.scopes?.includes("schedules:manage")) return deny();
  await db.query("SELECT id FROM schedules WHERE id=$1 FOR SHARE", [
    grant.schedule_id,
  ]);
  await db.query("SELECT id FROM schedule_grants WHERE id=$1 FOR SHARE", [
    grantId,
  ]);
  const pin = digest(c.HARBOR_OIDC_ISSUER + "\0" + c.HARBOR_OWNER_SUBJECT);
  const row = (
    await db.query(
      `SELECT o.*,g.epoch,g.one_shot,s.project_id,s.state AS schedule_state,s.active_grant_id,s.time_fingerprint,v.config,v.prompt_hash
    FROM schedule_grants g JOIN schedules s ON s.id=g.schedule_id
    JOIN schedule_occurrences o ON o.grant_id=g.id
    JOIN schedule_versions v ON v.schedule_id=o.schedule_id AND v.revision=o.config_revision
    WHERE g.id=$1 AND o.id=$2 AND g.config_revision=o.config_revision AND NOT g.revoked AND g.expires_at>clock_timestamp()
      AND g.identity_pin=$3 AND g.instance_id=$4 AND (SELECT identity_pin FROM harbor_meta)=$3
      AND NOT (SELECT emergency FROM harbor_meta)
      AND EXISTS(SELECT 1 FROM projects p WHERE p.id=s.project_id AND p.archived_at IS NULL)
      AND (g.source_pat_id IS NULL OR EXISTS(SELECT 1 FROM api_tokens p WHERE p.id=g.source_pat_id AND NOT p.revoked AND p.expires_at>clock_timestamp() AND p.identity_pin=$3 AND p.instance_id=$4 AND p.scopes@>ARRAY['execute','schedules:manage']::text[] AND s.project_id=ANY(p.project_ids)))
      AND o.state IN ('accepted','preparing_workspace','queued_turn','running')`,
      [grantId, occurrenceId, pin, process.env.HARBOR_INSTANCE_ID ?? "harbor"],
    )
  ).rows[0];
  if (
    !row ||
    row.project_id !== need.projectId ||
    row.config_revision !== row.snapshot.configRevision ||
    row.prompt_hash !== digest(row.prompt ?? "")
  )
    return deny();
  if (
    row.one_shot
      ? row.kind !== "manual"
      : row.schedule_state !== "enabled" || row.active_grant_id !== grantId
  )
    return deny();
  if (
    row.time_fingerprint !== timeFingerprint().digest ||
    !c.HARBOR_PERMISSION_CEILING
  )
    return deny();
  authorizePermission(
    need.internalOperation.kind === "workspace"
      ? "workspace-write"
      : row.config.permissionProfile,
    c.HARBOR_PERMISSION_CEILING,
  );
  const target =
    need.internalOperation.kind === "workspace"
      ? row.storage_operation_id
      : row.turn_id;
  if (target !== need.internalOperation.id) return deny();
  if (
    need.internalOperation.kind === "workspace" &&
    row.config.workspaceMode !== "standalone"
  )
    return deny();
  if (
    need.permissionProfile &&
    need.permissionProfile !== row.config.permissionProfile
  )
    return deny();
  if (need.permissionProfile)
    authorizePermission(
      need.permissionProfile as any,
      row.config.permissionProfile,
    );
  return {
    kind: "schedule",
    hash: actor,
    csrf: "",
    projectIds: [row.project_id],
    scopes: ["execute"],
    permissionProfile: row.config.permissionProfile,
  };
}
