import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "../../../packages/storage/src/index.ts";
import {
  HarborError,
  authorizePermission,
} from "../../../packages/policy/src/index.ts";
import { requireAuthority } from "../../../packages/policy/src/authority.ts";
import { selectedWorkspace } from "../../../packages/workspaces/src/service.ts";
import {
  terminalCreate,
  terminalControl,
  terminalInput,
  terminalResize,
  terminalHeartbeat,
  terminalTerminate,
  terminalView,
} from "../../../packages/terminals/src/contracts.ts";
import {
  lockedTerminal,
  terminalRow,
  terminalGrant,
  acquireControl,
  controlRate,
  acceptInput,
  inputOutcome,
  resize,
  heartbeat,
  outputSnapshot,
} from "../../../packages/terminals/src/store.ts";
import { registerProgrammaticRoute } from "./token-access.ts";
import type { Config } from "./config.ts";
export type TerminalApi = {
  pool: Pool;
  c: Config;
  actor(req: any): string;
  command(req: any, fn: (db: PoolClient) => Promise<unknown>): Promise<unknown>;
};
export function terminalRoutes(app: FastifyInstance, h: TerminalApi) {
  const { pool, c, command } = h;
  for (const [method, path, scope, workspace] of [
    ["GET", "/api/v1/workspaces/:id/terminals", "terminal:read", true],
    ["POST", "/api/v1/workspaces/:id/terminals", "terminal:control", true],
    ["GET", "/api/v1/terminals/:id", "terminal:read", false],
    ["GET", "/api/v1/terminals/:id/output", "terminal:read", false],
    ["POST", "/api/v1/terminals/:id/control", "terminal:control", false],
    ["POST", "/api/v1/terminals/:id/input", "terminal:control", false],
    ["POST", "/api/v1/terminals/:id/input/outcome", "terminal:control", false],
    ["POST", "/api/v1/terminals/:id/resize", "terminal:control", false],
    ["POST", "/api/v1/terminals/:id/heartbeat", "terminal:control", false],
    ["POST", "/api/v1/terminals/:id/terminate", "terminal:terminate", false],
    ["DELETE", "/api/v1/terminals/:id", "terminal:terminate", false],
  ] as const)
    registerProgrammaticRoute(method, path, {
      scope,
      resource: async (db, req) => {
        const r = (
          await db.query(
            workspace
              ? "SELECT project_id FROM workspaces WHERE id=$1"
              : "SELECT project_id,permission_profile FROM terminals WHERE id=$1",
            [req.params.id],
          )
        ).rows[0];
        if (!r)
          throw new HarborError(
            404,
            "NOT_FOUND",
            "Terminal workspace not found",
          );
        return {
          projectId: r.project_id,
          ...(scope === "terminal:control"
            ? {
                permissionProfile: workspace
                  ? req.body?.permissionProfile
                  : r.permission_profile,
              }
            : {}),
        };
      },
    });
  app.get<{ Params: { id: string } }>(
    "/api/v1/workspaces/:id/terminals",
    async (req) =>
      transaction(pool, async (db) => {
        const w = await selectedWorkspace(db, req.params.id);
        await requireAuthority(db, h.actor(req), c, {
          projectId: w.project_id,
          scope: "terminal:read",
        });
        return {
          terminals: (
            await db.query(
              "SELECT t.*,w.name AS workspace_name FROM terminals t JOIN workspaces w ON w.id=t.workspace_id WHERE t.workspace_id=$1 ORDER BY t.created_at DESC LIMIT 64",
              [w.id],
            )
          ).rows.map(terminalView),
        };
      }),
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/workspaces/:id/terminals",
    async (req, reply) => {
      const b = terminalCreate.parse(req.body);
      authorizePermission(b.permissionProfile, c.HARBOR_PERMISSION_CEILING);
      const result = await command(req, async (db) => {
        const before = await selectedWorkspace(db, req.params.id);
        await requireAuthority(db, h.actor(req), c, {
          projectId: before.project_id,
          scope: "terminal:control",
          permissionProfile: b.permissionProfile,
        });
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('terminal-capacity',0))",
        );
        const w = await selectedWorkspace(db, req.params.id, true);
        if (w.state !== "ready" || w.project_archived)
          throw new HarborError(
            409,
            "WORKSPACE_UNAVAILABLE",
            "Workspace is unavailable or archived",
          );
        if (
          (await db.query("SELECT emergency FROM harbor_meta")).rows[0]
            .emergency
        )
          throw new HarborError(
            409,
            "EMERGENCY_STOPPED",
            "Emergency stop is enabled",
          );
        const counts = (
          await db.query(
            "SELECT count(*) AS total,count(*) FILTER(WHERE project_id=$1) AS project,count(*) FILTER(WHERE workspace_id=$2 AND state='queued') AS queued FROM terminals",
            [w.project_id, w.id],
          )
        ).rows[0];
        if (Number(counts.total) >= 256 || Number(counts.project) >= 64)
          throw new HarborError(
            429,
            "TERMINAL_RECORD_LIMIT",
            "Retired terminal metadata must be explicitly removed before creating more",
          );
        if (Number(counts.queued) >= 2)
          throw new HarborError(
            429,
            "TERMINAL_QUEUE_LIMIT",
            "This workspace already has two queued terminals",
          );
        await requireAuthority(db, h.actor(req), c, {
          projectId: w.project_id,
          scope: "terminal:control",
          permissionProfile: b.permissionProfile,
        });
        const t = (
          await db.query(
            "INSERT INTO terminals(id,project_id,workspace_id,actor_hash,permission_profile,generation,resize_cols,resize_rows) VALUES($1,$2,$3,$4,$5,nextval('runtime_generation_seq'),$6,$7) RETURNING *",
            [
              randomUUID(),
              w.project_id,
              w.id,
              h.actor(req),
              b.permissionProfile,
              b.cols,
              b.rows,
            ],
          )
        ).rows[0];
        return { terminal: terminalView({ ...t, workspace_name: w.name }) };
      });
      return reply.code(202).send(result);
    },
  );
  app.get<{ Params: { id: string } }>("/api/v1/terminals/:id", async (req) =>
    transaction(pool, async (db) => {
      const t = await terminalRow(db, req.params.id);
      await terminalGrant(db, t, h.actor(req), c, "terminal:read");
      return { terminal: terminalView(t) };
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/terminals/:id/output",
    async (req) => {
      const q = z
        .object({ cursor: z.coerce.number().int().nonnegative().default(0) })
        .strict()
        .parse(req.query);
      return transaction(pool, async (db) => {
        const t = await lockedTerminal(
          db,
          req.params.id,
          h.actor(req),
          c,
          "terminal:read",
        );
        return outputSnapshot(db, t, q.cursor);
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/terminals/:id/control",
    async (req) => {
      const b = terminalControl.parse(req.body);
      return command(req, async (db) => {
        const t = await lockedTerminal(
          db,
          req.params.id,
          h.actor(req),
          c,
          "terminal:control",
        );
        return { control: await acquireControl(db, t, h.actor(req), b) };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/terminals/:id/input",
    async (req) => {
      const b = terminalInput.parse(req.body);
      return transaction(pool, async (db) => {
        const t = await lockedTerminal(
          db,
          req.params.id,
          h.actor(req),
          c,
          "terminal:control",
        );
        return { input: await acceptInput(db, t, h.actor(req), b) };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/terminals/:id/input/outcome",
    async (req) => {
      const b = terminalInput.parse(req.body);
      return transaction(pool, async (db) => {
        const t = await lockedTerminal(
          db,
          req.params.id,
          h.actor(req),
          c,
          "terminal:control",
        );
        return { input: await inputOutcome(db, t, h.actor(req), b) };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/terminals/:id/resize",
    async (req) => {
      const b = terminalResize.parse(req.body);
      return transaction(pool, async (db) => {
        const t = await lockedTerminal(
          db,
          req.params.id,
          h.actor(req),
          c,
          "terminal:control",
        );
        return resize(db, t, h.actor(req), b);
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/terminals/:id/heartbeat",
    async (req) => {
      const b = terminalHeartbeat.parse(req.body);
      return transaction(pool, async (db) => {
        const t = await lockedTerminal(
          db,
          req.params.id,
          h.actor(req),
          c,
          "terminal:control",
        );
        return heartbeat(db, t, h.actor(req), b);
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/terminals/:id/terminate",
    async (req, reply) => {
      const b = terminalTerminate.parse(req.body);
      return reply.code(202).send(
        await command(req, async (db) => {
          const t = await lockedTerminal(
            db,
            req.params.id,
            h.actor(req),
            c,
            "terminal:terminate",
          );
          if (Number(t.generation) !== b.generation)
            throw new HarborError(
              409,
              "GENERATION_STALE",
              "Terminal generation changed",
            );
          if (t.retired) return { terminal: terminalView(t) };
          if (t.termination_attempts >= 3)
            throw new HarborError(
              429,
              "TERMINATION_LIMIT",
              "Administrator recovery is required after three unconfirmed termination attempts",
            );
          await controlRate(db, t);
          const r = (
            await db.query(
              "UPDATE terminals SET state=CASE WHEN state='queued' THEN 'terminated' ELSE 'retiring' END,retired=(state='queued'),controller_until=NULL,termination_attempts=termination_attempts+1 WHERE id=$1 RETURNING *",
              [t.id],
            )
          ).rows[0];
          return { terminal: terminalView(r) };
        }),
      );
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/v1/terminals/:id",
    async (req) => {
      z.object({})
        .strict()
        .parse(req.body ?? {});
      return command(req, async (db) => {
        const t = await lockedTerminal(
          db,
          req.params.id,
          h.actor(req),
          c,
          "terminal:terminate",
        );
        if (
          !t.retired ||
          t.writer_epoch !== null ||
          !["terminated", "interrupted", "failed"].includes(t.state)
        )
          throw new HarborError(
            409,
            "TERMINAL_NOT_RETIRED",
            "Confirm exact terminal retirement before deleting metadata",
          );
        await controlRate(db, t);
        await db.query("DELETE FROM terminals WHERE id=$1", [t.id]);
        return { removed: true };
      });
    },
  );
}
