import { scheduleTarget } from "./targets.ts";
import { effectiveSettings } from "../../policy/src/models.ts";
import { occurrenceCapacity } from "./capacity.ts";
import { schedulerNow } from "./clock.ts";
import type { PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { randomUUID } from "node:crypto";
import {
  requireAuthority,
  type AuthorityConfig,
} from "../../policy/src/authority.ts";
import {
  authorizePermission,
  digest,
  HarborError,
} from "../../policy/src/index.ts";
import { createScheduleSchema } from "./schema.ts";
import { nextMinutes, timeFingerprint, type IntendedMinute } from "./time.ts";
import { enqueueOccurrence } from "./queue.ts";
import { scheduleActor } from "./authority.ts";
export interface ScheduleAuthorityConfig extends AuthorityConfig {
  models: string[];
  HARBOR_FIXTURE_MODE?: string;
  HARBOR_PERMISSION_CEILING: "read-only" | "workspace-write";
}
export async function createActivatedSchedule(
  db: PoolClient,
  actor: string,
  c: ScheduleAuthorityConfig,
  input: unknown,
) {
  const b = createScheduleSchema.parse(input);
  const need = {
    scope: "schedules:manage" as const,
    projectId: b.projectId,
    permissionProfile:
      b.config.workspaceMode === "standalone"
        ? "workspace-write"
        : b.config.permissionProfile,
  };
  const authority = await requireAuthority(db, actor, c, need);
  await requireAuthority(db, actor, c, { ...need, scope: "execute" });
  if (authority.kind === "schedule")
    throw new HarborError(
      403,
      "SCHEDULE_AUTHORITY",
      "An execution grant cannot manage schedules",
    );
  authorizePermission(
    need.permissionProfile as any,
    c.HARBOR_PERMISSION_CEILING,
  );
  await effectiveSettings(db, b.config.model, b.config.effort, c.models);
  await db.query("SELECT pg_advisory_xact_lock(740028)");
  const project = (
    await db.query(
      "SELECT id FROM projects WHERE id=$1 AND archived_at IS NULL FOR SHARE",
      [b.projectId],
    )
  ).rows[0];
  if (!project)
    throw new HarborError(
      409,
      "PROJECT_UNAVAILABLE",
      "Select an available project",
    );
  const counts = (
    await db.query(
      "SELECT count(*) AS total,count(*) FILTER(WHERE project_id=$1) AS project,count(*) FILTER(WHERE state='enabled') AS enabled,count(*) FILTER(WHERE project_id=$1 AND state='enabled') AS project_enabled FROM schedules",
      [b.projectId],
    )
  ).rows[0];
  if (
    Number(counts.total) >= 256 ||
    Number(counts.project) >= 64 ||
    Number(counts.enabled) >= 64 ||
    Number(counts.project_enabled) >= 16
  )
    throw new HarborError(429, "SCHEDULE_QUOTA", "Schedule capacity reached");
  await scheduleTarget(db, b.projectId, b.config, !!c.HARBOR_FIXTURE_MODE);
  const now = await schedulerNow(db);
  const preview = await nextMinutes(b.config.rule, now);
  b.config.rule.timezone = preview[0].timezone;
  const id = randomUUID(),
    grantId = randomUUID();
  await requireAuthority(db, actor, c, need);
  await requireAuthority(db, actor, c, { ...need, scope: "execute" });
  await db.query(
    "INSERT INTO schedules(id,project_id,title,state,grant_epoch,cursor_at,next_due_at,time_fingerprint) VALUES($1,$2,$3,'enabled',1,$4,$5,$6)",
    [
      id,
      b.projectId,
      b.title,
      now,
      preview[0].instant,
      timeFingerprint().digest,
    ],
  );
  await db.query(
    "INSERT INTO schedule_versions(schedule_id,revision,rule_revision,config,prompt,prompt_hash) VALUES($1,1,1,$2,$3,$4)",
    [id, JSON.stringify(b.config), b.prompt, digest(b.prompt)],
  );
  await db.query(
    `INSERT INTO schedule_grants(id,schedule_id,config_revision,epoch,identity_pin,instance_id,source_pat_id,expires_at)
    VALUES($1,$2,1,1,$3,$4,$5,LEAST(clock_timestamp()+($6*interval '1 day'),COALESCE((SELECT expires_at FROM api_tokens WHERE id=$5),'infinity'::timestamptz)))`,
    [
      grantId,
      id,
      digest(c.HARBOR_OIDC_ISSUER + "\0" + c.HARBOR_OWNER_SUBJECT),
      process.env.HARBOR_INSTANCE_ID ?? "harbor",
      authority.tokenId ?? null,
      b.grantDays,
    ],
  );
  await db.query("UPDATE schedules SET active_grant_id=$2 WHERE id=$1", [
    id,
    grantId,
  ]);
  return { id, grantId, revision: 1, preview };
}
/** Caller transaction owns the occurrence, cursor and pg-boss job together. */
export async function admitRecurringOccurrence(
  db: PoolClient,
  boss: PgBoss,
  c: ScheduleAuthorityConfig,
  scheduleId: string,
  minute: IntendedMinute,
  nextDue: string | null,
  expected?: {
    configRevision: number;
    ruleRevision: number;
    grantId: string;
    batch: unknown;
  },
) {
  // Idempotent internal reconciliation is not another activation or public disclosure.
  const prior = (
    await db.query(
      "SELECT id FROM schedule_occurrences WHERE schedule_id=$1 AND kind='recurring' AND local_minute=$2 AND rule_revision=COALESCE($3::integer,(SELECT rule_revision FROM schedules WHERE id=$1))",
      [scheduleId, minute.local, expected?.ruleRevision ?? null],
    )
  ).rows[0];
  if (prior) return { id: prior.id, replayed: true };
  const hint = (
    await db.query("SELECT active_grant_id FROM schedules WHERE id=$1", [
      scheduleId,
    ])
  ).rows[0];
  if (!hint?.active_grant_id)
    throw new HarborError(409, "SCHEDULE_PAUSED", "Schedule is paused");
  // Source actor locking must precede schedule/project/workspace locks.
  const grant = (
    await db.query("SELECT source_pat_id FROM schedule_grants WHERE id=$1", [
      hint.active_grant_id,
    ])
  ).rows[0];
  if (grant.source_pat_id)
    await requireAuthority(db, "pat:" + grant.source_pat_id, c, {
      scope: "schedules:manage",
    });
  else await db.query("SELECT pg_advisory_xact_lock_shared(740016)");
  await db.query("SELECT pg_advisory_xact_lock(740028)");
  const row = (
    await db.query(
      "SELECT s.*,v.config,v.prompt FROM schedules s JOIN schedule_versions v ON v.schedule_id=s.id AND v.revision=s.config_revision WHERE s.id=$1 FOR UPDATE OF s",
      [scheduleId],
    )
  ).rows[0];
  const accepted = (
    await db.query(
      "SELECT id FROM schedule_occurrences WHERE schedule_id=$1 AND kind='recurring' AND rule_revision=$2 AND local_minute=$3",
      [scheduleId, expected?.ruleRevision ?? row.rule_revision, minute.local],
    )
  ).rows[0];
  if (accepted) return { id: accepted.id, replayed: true };
  const expectedMatches =
    !expected ||
    !!(
      await db.query(
        "SELECT id FROM schedules WHERE id=$1 AND config_revision=$2 AND rule_revision=$3 AND active_grant_id=$4 AND catch_up=$5",
        [
          scheduleId,
          expected.configRevision,
          expected.ruleRevision,
          expected.grantId,
          JSON.stringify(expected.batch),
        ],
      )
    ).rowCount;
  if (
    !expectedMatches ||
    row.state !== "enabled" ||
    new Date(minute.instant) <= row.cursor_at ||
    row.active_grant_id !== hint.active_grant_id
  )
    throw new HarborError(
      409,
      "SCHEDULE_CHANGED",
      "Schedule cursor or grant changed",
    );
  const observedNow = await schedulerNow(db);
  if (Date.parse(minute.instant) > Date.parse(observedNow))
    throw new HarborError(409, "SCHEDULE_NOT_DUE", "Occurrence is not due");
  const unresolved = (
    await db.query(
      "SELECT count(*) AS total,count(*) FILTER(WHERE schedule_id=$1) AS schedule FROM schedule_occurrences WHERE state IN ('accepted','preparing_workspace','queued_turn','running','attention') OR (state='uncertain' AND acknowledged_at IS NULL)",
      [scheduleId],
    )
  ).rows[0];
  if (Number(unresolved.total) >= 256)
    throw new HarborError(
      429,
      "SCHEDULE_ACTIVE_QUOTA",
      "Global unresolved occurrence capacity reached",
    );
  if (Number(unresolved.schedule) > 0)
    throw new HarborError(
      409,
      "SCHEDULE_OVERLAP",
      "Another occurrence remains active",
    );
  await occurrenceCapacity(db, scheduleId);
  const counts = (
    await db.query(
      "SELECT count(*) AS total,count(*) FILTER(WHERE schedule_id=$1) AS schedule FROM schedule_occurrences",
      [scheduleId],
    )
  ).rows[0];
  if (Number(counts.total) >= 8192 || Number(counts.schedule) >= 256)
    throw new HarborError(
      429,
      "SCHEDULE_HISTORY_QUOTA",
      "Occurrence history capacity reached",
    );
  const result = await insertOccurrence(
    db,
    boss,
    c,
    row,
    "recurring",
    minute.instant,
    minute,
  );
  await db.query(
    "UPDATE schedules SET cursor_at=$2,next_due_at=$3,last_observed_at=$4,updated_at=clock_timestamp() WHERE id=$1",
    [scheduleId, minute.instant, nextDue, observedNow],
  );
  return result;
}

/** Stable identities and queue wakeup share the caller's already-authorized admission transaction. */
export async function insertOccurrence(
  db: PoolClient,
  boss: PgBoss,
  c: ScheduleAuthorityConfig,
  row: any,
  kind: "recurring" | "manual",
  intendedAt: string,
  minute?: IntendedMinute,
) {
  const id = randomUUID(),
    turnId = randomUUID(),
    storageId = randomUUID();
  const sessionId =
    row.config.workspaceMode === "existing"
      ? row.config.sessionId
      : randomUUID();
  const workspaceId =
    row.config.workspaceMode === "existing"
      ? (
          await db.query(
            "SELECT workspace_id FROM sessions WHERE id=$1 AND project_id=$2",
            [sessionId, row.project_id],
          )
        ).rows[0]?.workspace_id
      : randomUUID();
  if (!workspaceId)
    throw new HarborError(
      409,
      "SCHEDULE_TARGET",
      "Conversation target is unavailable",
    );
  await db.query(
    `INSERT INTO schedule_occurrences(id,schedule_id,config_revision,rule_revision,grant_id,kind,local_minute,intended_at,snapshot,prompt,state,workspace_id,session_id,turn_id,storage_operation_id,cancel_operation_id)
    VALUES($1,$2,$3,$4,$5,$15,$6,$7,$8,$9,'accepted',$10,$11,$12,$13,$14)`,
    [
      id,
      row.id,
      row.config_revision,
      row.rule_revision,
      row.active_grant_id,
      minute?.local ?? null,
      intendedAt,
      JSON.stringify({
        configRevision: row.config_revision,
        ...(minute ?? {
          instant: intendedAt,
          timezone: row.config.rule.timezone,
          manual: true,
        }),
      }),
      row.prompt,
      workspaceId,
      sessionId,
      turnId,
      storageId,
      randomUUID(),
      kind,
    ],
  );
  await requireAuthority(db, scheduleActor(row.active_grant_id, id), c, {
    scope: "execute",
    projectId: row.project_id,
    permissionProfile: row.config.permissionProfile,
    internalOperation: {
      kind: row.config.workspaceMode === "standalone" ? "workspace" : "turn",
      id: row.config.workspaceMode === "standalone" ? storageId : turnId,
    },
  });
  const epoch = Number(
    (
      await db.query("SELECT epoch FROM schedule_grants WHERE id=$1", [
        row.active_grant_id,
      ])
    ).rows[0].epoch,
  );
  await enqueueOccurrence(boss, db, id, epoch);
  return { id, replayed: false };
}
