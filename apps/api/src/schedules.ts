import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { Config } from "./config.ts";
import {
  requireAuthority,
  type Authority,
  type Scope,
} from "../../../packages/policy/src/authority.ts";
import { HarborError, digest } from "../../../packages/policy/src/index.ts";
import { transaction } from "../../../packages/storage/src/index.ts";
import { registerProgrammaticRoute } from "./token-access.ts";
import { createActivatedSchedule } from "../../../packages/schedules/src/admission.ts";
import {
  createScheduleSchema,
  scheduleConfigSchema,
} from "../../../packages/schedules/src/schema.ts";
import { scheduleCommand } from "../../../packages/schedules/src/commands.ts";
import {
  activateSchedule,
  editSchedule,
  pauseSchedule,
  runScheduleNow,
} from "../../../packages/schedules/src/management.ts";
import { cancelOccurrence } from "../../../packages/schedules/src/cancel.ts";
import {
  nextMinutes,
  timeFingerprint,
} from "../../../packages/schedules/src/time.ts";
import { schedulerNow } from "../../../packages/schedules/src/clock.ts";
const revision = z.number().int().positive();
const querySchema = z
  .object({
    projectId: z.uuid().optional(),
    state: z
      .enum(["all", "enabled", "paused", "attention", "completed"])
      .default("all"),
    q: z.string().max(120).default(""),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(1024).optional(),
  })
  .strict();
function cursor(value: string | undefined, filter: string) {
  if (!value) return undefined;
  try {
    const parsed = z
      .object({
        filter: z.literal(filter),
        at: z.iso.datetime(),
        id: z.uuid(),
        issued: z.number().int(),
      })
      .strict()
      .parse(JSON.parse(Buffer.from(value, "base64url").toString()));
    if (
      Date.now() - parsed.issued > 300000 ||
      parsed.issued > Date.now() + 5000
    )
      throw Error();
    return parsed;
  } catch {
    throw new HarborError(
      400,
      "INVALID_CURSOR",
      "Cursor expired or does not match these filters",
    );
  }
}
function nextCursor(rows: any[], limit: number, filter: string) {
  const last = rows[Math.min(rows.length, limit) - 1];
  return rows.length > limit
    ? Buffer.from(
        JSON.stringify({
          filter,
          at: last.cursor_at,
          id: last.id,
          issued: Date.now(),
        }),
      ).toString("base64url")
    : null;
}
function scheduleView(s: any, detail = false) {
  return {
    id: s.id,
    projectId: s.project_id,
    title: s.title,
    revision: s.config_revision,
    ruleRevision: s.rule_revision,
    state: s.state,
    reason: s.reason,
    nextDueAt: s.next_due_at,
    updatedAt: s.updated_at,
    config: s.config,
    ...(detail ? { prompt: s.prompt } : {}),
    grant: s.grant_epoch_value
      ? {
          epoch: s.grant_epoch_value,
          expiresAt: s.grant_expires_at,
          revoked: s.grant_revoked,
          source: s.source_pat_id ? "token" : "owner",
        }
      : null,
    retention: s.last_pruned ?? null,
  };
}
function occurrenceView(o: any) {
  return {
    id: o.id,
    scheduleId: o.schedule_id,
    state: o.state,
    reason: o.reason,
    kind: o.kind,
    localMinute: o.local_minute,
    intendedAt: o.intended_at,
    startedAt: o.started_at,
    endedAt: o.ended_at,
    acknowledgedAt: o.acknowledged_at,
    provenance: o.snapshot,
    sessionId: o.existing_session_id ?? null,
    workspaceId: o.existing_workspace_id ?? null,
    turnId: o.existing_turn_id ?? null,
    cancellation: o.cancel_state
      ? { state: o.cancel_state, attempts: o.cancel_attempts }
      : null,
  };
}
const scheduleSql = `SELECT s.*,v.config,v.prompt,g.epoch AS grant_epoch_value,g.expires_at AS grant_expires_at,g.revoked AS grant_revoked,g.source_pat_id,to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM schedules s JOIN schedule_versions v ON v.schedule_id=s.id AND v.revision=s.config_revision LEFT JOIN schedule_grants g ON g.id=s.active_grant_id`;
const occurrenceSql = `SELECT o.*,ss.id AS existing_session_id,w.id AS existing_workspace_id,t.id AS existing_turn_id,c.state AS cancel_state,c.control_attempts AS cancel_attempts,to_char(o.intended_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM schedule_occurrences o JOIN schedules s ON s.id=o.schedule_id LEFT JOIN sessions ss ON ss.id=o.session_id LEFT JOIN workspaces w ON w.id=o.workspace_id LEFT JOIN operations t ON t.id=o.turn_id LEFT JOIN operations c ON c.id=o.cancel_operation_id`;
export function scheduleRoutes(
  app: FastifyInstance,
  context: {
    pool: Pool;
    c: Config;
    boss: PgBoss;
    authority: (req: any) => Authority;
    command: (
      req: any,
      fn: (db: PoolClient) => Promise<unknown>,
    ) => Promise<unknown>;
  },
) {
  const { pool, c, boss, authority, command } = context;
  const resource = async (db: Pool | PoolClient, req: any) => {
    if (req.params?.id) {
      const row = (
        await db.query("SELECT project_id FROM schedules WHERE id=$1", [
          z.uuid().parse(req.params.id),
        ])
      ).rows[0];
      if (!row) throw new HarborError(404, "NOT_FOUND", "Schedule not found");
      return { projectId: row.project_id };
    }
    return { projectId: req.body?.projectId ?? req.query?.projectId };
  };
  for (const [method, path, scope] of [
    ["GET", "/api/v1/schedules", "schedules:read"],
    ["GET", "/api/v1/schedules/:id", "schedules:read"],
    ["POST", "/api/v1/schedules/preview", "schedules:read"],
    ["POST", "/api/v1/schedules", "schedules:manage"],
    ["PUT", "/api/v1/schedules/:id", "schedules:manage"],
    ["POST", "/api/v1/schedules/:id/activation", "schedules:manage"],
    ["POST", "/api/v1/schedules/:id/pause", "schedules:manage"],
    ["POST", "/api/v1/schedules/:id/runs", "schedules:manage"],
    ["GET", "/api/v1/schedules/:id/runs", "schedules:read"],
    [
      "POST",
      "/api/v1/schedules/:id/runs/:occurrenceId/cancel",
      "schedules:manage",
    ],
    ["GET", "/api/v1/schedule-attention", "schedules:read"],
  ] as const)
    registerProgrammaticRoute(method, path, { scope, resource });
  const read = async (
    req: any,
    fn: (db: PoolClient, a: Authority) => Promise<unknown>,
  ) =>
    transaction(pool, async (db) => {
      const a = await requireAuthority(db, authority(req).hash, c, {
        scope: "schedules:read",
        ...(await resource(db, req)),
      });
      const result = await fn(db, a);
      await requireAuthority(db, authority(req).hash, c, {
        scope: "schedules:read",
        ...(await resource(db, req)),
      });
      return result;
    });
  app.get("/api/v1/schedules", async (req) =>
    read(req, async (db, a) => {
      const q = querySchema.parse(req.query),
        filter = digest(
          JSON.stringify([q.projectId, q.state, q.q, a.projectIds ?? null]),
        ),
        before = cursor(q.cursor, filter);
      const rows = (
        await db.query(
          `${scheduleSql} WHERE ($1::uuid[] IS NULL OR s.project_id=ANY($1)) AND ($2::uuid IS NULL OR s.project_id=$2) AND ($3='all' OR s.state=$3) AND ($4='' OR strpos(lower(s.title),lower($4))>0) AND ($5::timestamptz IS NULL OR (s.created_at,s.id)<($5,$6::uuid)) ORDER BY s.created_at DESC,s.id DESC LIMIT $7`,
          [
            a.projectIds ?? null,
            q.projectId ?? null,
            q.state,
            q.q,
            before?.at ?? null,
            before?.id ?? null,
            q.limit + 1,
          ],
        )
      ).rows;
      return {
        schedules: rows.slice(0, q.limit).map((s) => scheduleView(s)),
        nextCursor: nextCursor(rows, q.limit, filter),
        limits: {
          enabledPerProject: 16,
          enabledGlobal: 64,
          retainedPerProject: 64,
          retainedGlobal: 256,
        },
      };
    }),
  );
  app.get("/api/v1/schedules/:id", async (req: any) =>
    read(req, async (db) => {
      const row = (
        await db.query(`${scheduleSql} WHERE s.id=$1`, [req.params.id])
      ).rows[0];
      if (!row) throw new HarborError(404, "NOT_FOUND", "Schedule not found");
      return { schedule: scheduleView(row, true) };
    }),
  );
  app.post("/api/v1/schedules/preview", async (req) =>
    read(req, async (db) => {
      const b = z
        .object({ projectId: z.uuid(), rule: scheduleConfigSchema.shape.rule })
        .strict()
        .parse(req.body);
      return {
        preview: await nextMinutes(b.rule, await schedulerNow(db)),
        timeEngine: timeFingerprint(),
      };
    }),
  );
  app.post("/api/v1/schedules", async (req, reply) =>
    reply
      .code(201)
      .send(
        await command(req, (db) =>
          createActivatedSchedule(db, authority(req).hash, c, req.body),
        ),
      ),
  );
  const mutate = async (
    req: any,
    scope: Scope,
    control: Parameters<typeof scheduleCommand>[2]["control"],
    fn: (db: PoolClient, s: any) => Promise<unknown>,
  ) =>
    scheduleCommand(
      pool,
      c,
      {
        actor: authority(req).hash,
        scheduleId: z.uuid().parse(req.params.id),
        key: req.headers["idempotency-key"],
        route: req.method + " " + req.url.split("?")[0],
        body: req.body ?? {},
        need: { scope },
        control,
      },
      fn,
    );
  app.put("/api/v1/schedules/:id", async (req: any) => {
    const b = z
      .object({ expectedRevision: revision, schedule: createScheduleSchema })
      .strict()
      .parse(req.body);
    return mutate(req, "schedules:manage", undefined, (db, s) =>
      editSchedule(db, s, b.expectedRevision, b.schedule),
    );
  });
  app.post("/api/v1/schedules/:id/activation", async (req: any) => {
    const b = z
      .object({
        expectedRevision: revision,
        grantDays: z.number().int().min(1).max(90).default(30),
      })
      .strict()
      .parse(req.body);
    return mutate(req, "schedules:manage", undefined, (db, s) =>
      activateSchedule(
        db,
        s,
        authority(req).hash,
        c,
        b.expectedRevision,
        b.grantDays,
      ),
    );
  });
  app.post("/api/v1/schedules/:id/pause", async (req: any) => {
    const b = z.object({ expectedRevision: revision }).strict().parse(req.body);
    return mutate(req, "schedules:manage", { kind: "pause" }, (db, s) =>
      pauseSchedule(db, s, b.expectedRevision),
    );
  });
  app.post("/api/v1/schedules/:id/runs", async (req: any, reply) => {
    const b = z.object({ expectedRevision: revision }).strict().parse(req.body);
    return reply
      .code(202)
      .send(
        await mutate(req, "schedules:manage", undefined, (db, s) =>
          runScheduleNow(
            db,
            boss,
            s,
            authority(req).hash,
            c,
            b.expectedRevision,
          ),
        ),
      );
  });
  app.post(
    "/api/v1/schedules/:id/runs/:occurrenceId/cancel",
    async (req: any, reply) => {
      const b = z
        .object({ expectedAttempt: z.number().int().min(1).max(3).default(1) })
        .strict()
        .parse(req.body ?? {});
      return reply.code(202).send(
        await mutate(
          req,
          "schedules:manage",
          {
            kind: "cancel",
            occurrenceId: z.uuid().parse(req.params.occurrenceId),
            attempt: b.expectedAttempt,
          },
          (db, s) =>
            cancelOccurrence(
              db,
              s,
              req.params.occurrenceId,
              authority(req).hash,
              c,
              b.expectedAttempt,
            ),
        ),
      );
    },
  );
  const runs = async (req: any, attention: boolean) =>
    read(req, async (db, a) => {
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          cursor: z.string().max(1024).optional(),
          projectId: z.uuid().optional(),
        })
        .strict()
        .parse(req.query);
      const filter = digest(
          JSON.stringify([
            req.params?.id ?? null,
            attention,
            q.projectId ?? null,
            a.projectIds ?? null,
          ]),
        ),
        before = cursor(q.cursor, filter);
      const rows = (
        await db.query(
          `${occurrenceSql} WHERE ($1::uuid[] IS NULL OR s.project_id=ANY($1)) AND ($2::uuid IS NULL OR o.schedule_id=$2) AND ($3::uuid IS NULL OR s.project_id=$3) AND (NOT $4 OR (o.state IN ('attention','uncertain') AND o.acknowledged_at IS NULL) OR (s.state='attention' AND o.reason IS NOT NULL)) AND (o.ended_at IS NULL OR o.ended_at>=clock_timestamp()-interval '90 days' OR (o.state='uncertain' AND o.acknowledged_at IS NULL)) AND ($5::timestamptz IS NULL OR (o.intended_at,o.id)<($5,$6::uuid)) ORDER BY o.intended_at DESC,o.id DESC LIMIT $7`,
          [
            a.projectIds ?? null,
            req.params?.id ?? null,
            q.projectId ?? null,
            attention,
            before?.at ?? null,
            before?.id ?? null,
            q.limit + 1,
          ],
        )
      ).rows;
      return {
        occurrences: rows.slice(0, q.limit).map(occurrenceView),
        nextCursor: nextCursor(rows, q.limit, filter),
        retention: { days: 90, perSchedule: 256, unresolvedPreserved: true },
      };
    });
  app.get("/api/v1/schedules/:id/runs", async (req) => runs(req, false));
  app.get("/api/v1/schedule-attention", async (req) => runs(req, true));
}
