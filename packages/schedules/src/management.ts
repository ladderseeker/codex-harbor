import { scheduleTarget } from "./targets.ts";
import { occurrenceCapacity } from "./capacity.ts";
import { insertOccurrence } from "./admission.ts";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { requireAuthority } from "../../policy/src/authority.ts";
import {
  HarborError,
  digest,
  authorizePermission,
} from "../../policy/src/index.ts";
import { effectiveSettings } from "../../policy/src/models.ts";
import type { ScheduleAuthorityConfig } from "./admission.ts";
import { createScheduleSchema, scheduleConfigSchema } from "./schema.ts";
import { nextMinutes, timeFingerprint } from "./time.ts";
import { schedulerNow } from "./clock.ts";
export function expectedRevision(schedule: any, revision: number) {
  if (schedule.config_revision !== revision)
    throw new HarborError(
      409,
      "SCHEDULE_REVISION",
      "Schedule changed; reload before saving",
    );
}
export async function pauseSchedule(db: PoolClient, s: any, revision: number) {
  expectedRevision(s, revision);
  await db.query(
    "UPDATE schedules SET state='paused',reason='OWNER_PAUSED',catch_up=NULL,updated_at=clock_timestamp() WHERE id=$1",
    [s.id],
  );
  // Already-sent runtime work retains its running grant; future admission does not.
  await db.query(
    "UPDATE schedule_grants SET revoked=true WHERE schedule_id=$1",
    [s.id],
  );
  return {
    schedule: { id: s.id, revision: s.config_revision, state: "paused" },
  };
}
export async function editSchedule(
  db: PoolClient,
  s: any,
  revision: number,
  input: unknown,
) {
  expectedRevision(s, revision);
  const b = createScheduleSchema.parse(input);
  if (b.projectId !== s.project_id)
    throw new HarborError(
      409,
      "SCHEDULE_PROJECT",
      "Create a new schedule to change project",
    );
  const old = (
    await db.query(
      "SELECT config FROM schedule_versions WHERE schedule_id=$1 AND revision=$2",
      [s.id, s.config_revision],
    )
  ).rows[0];
  await db.query(
    "DELETE FROM schedule_versions WHERE (schedule_id,revision) IN (SELECT v.schedule_id,v.revision FROM schedule_versions v WHERE v.schedule_id=$1 AND v.revision<>$2 AND NOT EXISTS(SELECT 1 FROM schedule_grants g WHERE g.schedule_id=v.schedule_id AND g.config_revision=v.revision) AND NOT EXISTS(SELECT 1 FROM schedule_occurrences o WHERE o.schedule_id=v.schedule_id AND o.config_revision=v.revision) ORDER BY v.revision LIMIT 1)",
    [s.id, s.config_revision],
  );
  if (
    Number(
      (
        await db.query(
          "SELECT count(*) FROM schedule_versions WHERE schedule_id=$1",
          [s.id],
        )
      ).rows[0].count,
    ) >= 32
  )
    throw new HarborError(
      429,
      "SCHEDULE_VERSION_QUOTA",
      "Retained schedule revision capacity reached",
    );
  const ruleRevision =
      s.rule_revision +
      (JSON.stringify(scheduleConfigSchema.parse(old.config).rule) ===
      JSON.stringify(b.config.rule)
        ? 0
        : 1),
    next = s.config_revision + 1;
  await db.query(
    "INSERT INTO schedule_versions(schedule_id,revision,rule_revision,config,prompt,prompt_hash) VALUES($1,$2,$3,$4,$5,$6)",
    [
      s.id,
      next,
      ruleRevision,
      JSON.stringify(b.config),
      b.prompt,
      digest(b.prompt),
    ],
  );
  await db.query(
    "UPDATE schedule_grants SET revoked=true WHERE schedule_id=$1",
    [s.id],
  );
  await db.query(
    "UPDATE schedules SET title=$2,config_revision=$3,rule_revision=$4,state='paused',reason='CONFIGURATION_CHANGED',catch_up=NULL,active_grant_id=NULL,updated_at=clock_timestamp() WHERE id=$1",
    [s.id, b.title, next, ruleRevision],
  );
  return { schedule: { id: s.id, revision: next, state: "paused" } };
}
/** Caller owns schedule admission/row lock, acquired after the source browser or PAT. */
export async function activateSchedule(
  db: PoolClient,
  s: any,
  actor: string,
  c: ScheduleAuthorityConfig,
  revision: number,
  days: number,
  oneShot = false,
) {
  expectedRevision(s, revision);
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new HarborError(
      400,
      "SCHEDULE_EXPIRY",
      "Grant duration must be 1–90 days",
    );
  const version = (
    await db.query(
      "SELECT * FROM schedule_versions WHERE schedule_id=$1 AND revision=$2",
      [s.id, s.config_revision],
    )
  ).rows[0];
  const config = version.config;
  const need = {
    scope: "schedules:manage" as const,
    projectId: s.project_id,
    permissionProfile:
      config.workspaceMode === "standalone"
        ? "workspace-write"
        : config.permissionProfile,
  };
  const authority = await requireAuthority(db, actor, c, need);
  await requireAuthority(db, actor, c, { ...need, scope: "execute" });
  if (authority.kind === "schedule")
    throw new HarborError(
      403,
      "SCHEDULE_AUTHORITY",
      "An execution grant cannot activate schedules",
    );
  authorizePermission(need.permissionProfile, c.HARBOR_PERMISSION_CEILING);
  await effectiveSettings(db, config.model, config.effort, c.models);
  await scheduleTarget(db, s.project_id, config, !!c.HARBOR_FIXTURE_MODE);
  await db.query(
    "DELETE FROM schedule_grants WHERE id IN (SELECT g.id FROM schedule_grants g WHERE g.schedule_id=$1 AND g.id IS DISTINCT FROM $2 AND (g.revoked OR g.expires_at<clock_timestamp()) AND NOT EXISTS(SELECT 1 FROM schedule_occurrences o WHERE o.grant_id=g.id) AND NOT EXISTS(SELECT 1 FROM schedule_commands c WHERE c.schedule_id=g.schedule_id AND c.grant_epoch=g.epoch) ORDER BY g.epoch LIMIT 1)",
    [s.id, s.active_grant_id],
  );
  if (
    Number(
      (
        await db.query(
          "SELECT count(*) FROM schedule_grants WHERE schedule_id=$1",
          [s.id],
        )
      ).rows[0].count,
    ) >= 32
  )
    throw new HarborError(
      429,
      "SCHEDULE_GRANT_QUOTA",
      "Retained schedule grant capacity reached",
    );
  if (!oneShot && s.state !== "enabled") {
    const counts = (
      await db.query(
        "SELECT count(*) AS total,count(*) FILTER(WHERE project_id=$1) AS own FROM schedules WHERE state='enabled'",
        [s.project_id],
      )
    ).rows[0];
    if (Number(counts.total) >= 64 || Number(counts.own) >= 16)
      throw new HarborError(
        429,
        "SCHEDULE_QUOTA",
        "Enabled schedule capacity reached",
      );
  }
  const now = await schedulerNow(db);
  const preview = oneShot ? [] : await nextMinutes(config.rule, now);
  await requireAuthority(db, actor, c, need);
  await requireAuthority(db, actor, c, { ...need, scope: "execute" });
  const id = randomUUID(),
    epoch = s.grant_epoch + 1;
  if (!oneShot)
    await db.query(
      "UPDATE schedule_grants SET revoked=true WHERE schedule_id=$1 AND NOT one_shot",
      [s.id],
    );
  await db.query(
    `INSERT INTO schedule_grants(id,schedule_id,config_revision,epoch,identity_pin,instance_id,source_pat_id,expires_at,one_shot)
    VALUES($1,$2,$3,$4,$5,$6,$7,LEAST(clock_timestamp()+($8*interval '1 day'),COALESCE((SELECT expires_at FROM api_tokens WHERE id=$7),'infinity'::timestamptz)),$9)`,
    [
      id,
      s.id,
      s.config_revision,
      epoch,
      digest(c.HARBOR_OIDC_ISSUER + "\0" + c.HARBOR_OWNER_SUBJECT),
      process.env.HARBOR_INSTANCE_ID ?? "harbor",
      authority.tokenId ?? null,
      days,
      oneShot,
    ],
  );
  if (oneShot)
    await db.query("UPDATE schedules SET grant_epoch=$2 WHERE id=$1", [
      s.id,
      epoch,
    ]);
  else
    await db.query(
      "UPDATE schedules SET grant_epoch=$2,active_grant_id=$3,state='enabled',reason=NULL,cursor_at=GREATEST(cursor_at,$4),next_due_at=$5,catch_up=NULL,last_observed_at=$4,time_fingerprint=$6,updated_at=clock_timestamp() WHERE id=$1",
      [s.id, epoch, id, now, preview[0].instant, timeFingerprint().digest],
    );
  return {
    grantId: id,
    epoch,
    preview,
    schedule: {
      id: s.id,
      revision: s.config_revision,
      state: oneShot ? s.state : "enabled",
    },
  };
}

export async function runScheduleNow(
  db: PoolClient,
  boss: import("pg-boss").PgBoss,
  s: any,
  actor: string,
  c: ScheduleAuthorityConfig,
  revision: number,
) {
  expectedRevision(s, revision);
  const counts = (
    await db.query(
      "SELECT count(*) AS total,count(*) FILTER(WHERE schedule_id=$1) AS own FROM schedule_occurrences WHERE state IN ('accepted','preparing_workspace','queued_turn','running','attention') OR (state='uncertain' AND acknowledged_at IS NULL)",
      [s.id],
    )
  ).rows[0];
  if (Number(counts.own) > 0)
    throw new HarborError(
      409,
      "SCHEDULE_OVERLAP",
      "Another occurrence remains unresolved",
    );
  if (Number(counts.total) >= 256)
    throw new HarborError(
      429,
      "SCHEDULE_ACTIVE_QUOTA",
      "Unresolved occurrence capacity reached",
    );
  if (
    Number(
      (
        await db.query(
          "SELECT count(*) FROM schedule_grants WHERE schedule_id=$1 AND one_shot AND created_at>clock_timestamp()-interval '1 hour'",
          [s.id],
        )
      ).rows[0].count,
    ) >= 10
  )
    throw new HarborError(
      429,
      "SCHEDULE_RUN_RATE",
      "Run-now limit is ten per hour",
    );
  await occurrenceCapacity(db, s.id);
  const grant = await activateSchedule(db, s, actor, c, revision, 1, true);
  const version = (
    await db.query(
      "SELECT config,prompt FROM schedule_versions WHERE schedule_id=$1 AND revision=$2",
      [s.id, s.config_revision],
    )
  ).rows[0];
  const now = await schedulerNow(db);
  const result = await insertOccurrence(
    db,
    boss,
    c,
    {
      ...s,
      ...version,
      active_grant_id: grant.grantId,
      grant_epoch: grant.epoch,
    },
    "manual",
    now,
  );
  return {
    occurrence: { id: result.id, state: "accepted" },
    schedule: { id: s.id, revision: s.config_revision, state: s.state },
  };
}
