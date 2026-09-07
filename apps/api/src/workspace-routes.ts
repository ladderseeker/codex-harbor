import { createWorkspace } from "../../../packages/workspaces/src/create.ts";
import { requireAuthority } from "../../../packages/policy/src/authority.ts";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import {
  HarborError,
  authorizePermission,
} from "../../../packages/policy/src/index.ts";
import { publicRow } from "../../../packages/storage/src/index.ts";
import {
  workspaceView,
  selectedWorkspace,
  inspectWorkspace,
  requireWorkspaceIdle,
  storageWorkspace,
  storedIdentity,
  workspaceRelative,
} from "../../../packages/workspaces/src/service.ts";
export function registerWorkspaceRoutes(
  app: FastifyInstance,
  context: {
    pool: Pool;
    c: Config;
    actor: (req: any) => string;
    command: (
      req: any,
      fn: (db: PoolClient) => Promise<unknown>,
    ) => Promise<unknown>;
  },
) {
  const { pool, c, command, actor } = context;
  const authority = async (db: PoolClient, req: any) => {
    if ((await requireAuthority(db, actor(req), c)).kind !== "browser")
      throw new HarborError(403, "BROWSER_REQUIRED", "Owner browser required");
  };
  app.get<{ Params: { id: string } }>(
    "/api/v1/projects/:id/workspaces",
    async (req) => {
      const project = (
        await pool.query("SELECT id FROM projects WHERE id=$1", [req.params.id])
      ).rows[0];
      if (!project)
        throw new HarborError(404, "NOT_FOUND", "Project not found");
      const rows = (
        await pool.query(
          "SELECT w.*,(SELECT json_build_object('id',r.id,'state',r.state,'failureCode',r.failure_code) FROM workspace_releases r WHERE r.workspace_id=w.id ORDER BY created_at DESC LIMIT 1) AS latest_release FROM workspaces w WHERE project_id=$1 ORDER BY created_at",
          [project.id],
        )
      ).rows;
      return { workspaces: rows.map(workspaceView) };
    },
  );
  app.get<{ Params: { id: string } }>("/api/v1/workspaces/:id", async (req) => {
    const w = await selectedWorkspace(pool, req.params.id);
    const inspection = await inspectWorkspace(pool, w, !!c.HARBOR_FIXTURE_MODE);
    const release = (
      await pool.query(
        "SELECT id,state,failure_code FROM workspace_releases WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1",
        [w.id],
      )
    ).rows[0];
    return {
      workspace: workspaceView(w),
      inspection,
      release: release ? publicRow(release) : null,
    };
  });
  app.post<{ Params: { id: string } }>(
    "/api/v1/workspaces/:id/release",
    async (req) =>
      command(req, async (db) => {
        const b = z
          .object({
            acknowledgeUnknownEffects: z.literal(true),
            expectedSessionId: z.uuid(),
            expectedGeneration: z.number().int().positive(),
          })
          .strict()
          .parse(req.body);
        const owner = actor(req);
        if (owner.startsWith("pat:"))
          throw new HarborError(
            403,
            "BROWSER_REQUIRED",
            "Workspace recovery requires the owner browser",
          );
        const w = await selectedWorkspace(db, req.params.id, true);
        await authority(db, req);
        if (
          w.writer_kind !== "conversation" ||
          w.writer_session_id !== b.expectedSessionId ||
          Number(w.writer_generation) !== b.expectedGeneration
        )
          throw new HarborError(
            409,
            "RESERVATION_CHANGED",
            "Workspace ownership changed",
          );
        const active = await db.query(
          "SELECT 1 FROM operations WHERE session_id=$1 AND kind='turn' AND state IN ('dispatching','running','waiting_approval','waiting_input') LIMIT 1",
          [b.expectedSessionId],
        );
        if (active.rowCount)
          throw new HarborError(
            409,
            "WORKSPACE_ACTIVE",
            "Stop healthy active work before recovery",
          );
        const pending = await db.query(
          "SELECT 1 FROM workspace_releases WHERE workspace_id=$1 AND state IN ('queued','dispatching')",
          [w.id],
        );
        if (pending.rowCount)
          throw new HarborError(
            409,
            "RELEASE_PENDING",
            "Workspace release is already pending",
          );
        const failed = (
          await db.query(
            "SELECT id FROM workspace_releases WHERE workspace_id=$1 AND session_id=$2 AND expected_generation=$3 AND state='failed' ORDER BY created_at DESC LIMIT 1",
            [w.id, b.expectedSessionId, b.expectedGeneration],
          )
        ).rows[0];
        if (failed) {
          await db.query(
            "UPDATE workspace_releases SET state='queued',failure_code=NULL,actor_hash=$2,updated_at=now() WHERE id=$1",
            [failed.id, owner],
          );
          return { release: { id: failed.id, state: "queued" } };
        }
        if (
          Number(
            (
              await db.query(
                "SELECT count(*) FROM workspace_releases WHERE workspace_id=$1",
                [w.id],
              )
            ).rows[0].count,
          ) >= 64
        )
          await db.query(
            "DELETE FROM workspace_releases WHERE id=(SELECT id FROM workspace_releases WHERE workspace_id=$1 AND state IN ('completed','failed') ORDER BY created_at LIMIT 1)",
            [w.id],
          );
        const id = randomUUID();
        await db.query(
          "INSERT INTO workspace_releases(id,workspace_id,session_id,expected_generation,actor_hash) VALUES($1,$2,$3,$4,$5)",
          [id, w.id, b.expectedSessionId, b.expectedGeneration, owner],
        );
        return { release: { id, state: "queued" } };
      }),
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/projects/:id/workspaces",
    async (req) =>
      command(req, async (db) => {
        return createWorkspace(db, req.params.id, req.body, c, {
          actor: actor(req),
          authorize: async (db) => authority(db, req),
        });
      }),
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/workspaces/:id/archive",
    async (req) =>
      command(req, async (db) => {
        z.object({})
          .strict()
          .parse(req.body ?? {});
        const w = await selectedWorkspace(db, req.params.id, true);
        await authority(db, req);
        await requireWorkspaceIdle(db, w);
        if (w.state === "removed")
          throw new HarborError(
            409,
            "WORKSPACE_REMOVED",
            "Workspace was removed",
          );
        await db.query(
          "UPDATE workspaces SET state='archived',archived_at=now() WHERE id=$1",
          [w.id],
        );
        return { workspace: workspaceView(await selectedWorkspace(db, w.id)) };
      }),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/v1/workspaces/:id",
    async (req) =>
      command(req, async (db) => {
        z.object({})
          .strict()
          .parse(req.body ?? {});
        authorizePermission("workspace-write", c.HARBOR_PERMISSION_CEILING);
        const w = await selectedWorkspace(db, req.params.id, true);
        await authority(db, req);
        if (w.kind === "local")
          throw new HarborError(
            409,
            "LOCAL_PRESERVED",
            "Local folders cannot be deleted",
          );
        await requireWorkspaceIdle(db, w, true);
        const inspection = await inspectWorkspace(
          db,
          w,
          !!c.HARBOR_FIXTURE_MODE,
        );
        if (!inspection.available || inspection.dirty)
          throw new HarborError(
            409,
            "WORKSPACE_DIRTY",
            "Unavailable or changed workspaces cannot be removed",
          );
        const prior = (
          await db.query(
            "SELECT id FROM workspace_storage_operations WHERE workspace_id=$1 AND action='remove' AND state='failed' AND retry_authority ORDER BY created_at DESC LIMIT 1",
            [w.id],
          )
        ).rows[0];
        if (prior)
          await db.query(
            "UPDATE workspace_storage_operations SET state='queued',command=jsonb_set(command,'{retryFailed}','true'),actor_hash=$2,failure_code=NULL,result=NULL,updated_at=now() WHERE id=$1",
            [prior.id, actor(req)],
          );
        else {
          if (
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM workspace_storage_operations WHERE project_id=$1",
                  [w.project_id],
                )
              ).rows[0].count,
            ) >= 128
          )
            throw new HarborError(
              429,
              "WORKSPACE_HISTORY_QUOTA",
              "Project workspace operation limit reached",
            );
          const operationId = randomUUID();
          await db.query(
            "INSERT INTO workspace_storage_operations(id,workspace_id,project_id,action,command,actor_hash) VALUES($1,$2,$3,'remove',$4,$5)",
            [
              operationId,
              w.id,
              w.project_id,
              JSON.stringify({
                action: "workspaceRemove",
                operationId,
                rootId: w.root_id,
                relativePath: w.project_relative,
                workspaceId: w.id,
                kind: w.kind,
                sourceSnapshot: w.snapshot_hash ?? undefined,
                identity: storedIdentity(w),
                source: {
                  relativePath: w.relative_path,
                  device: w.device,
                  inode: w.inode,
                },
              }),
              actor(req),
            ],
          );
        }
        await db.query("UPDATE workspaces SET state='removing' WHERE id=$1", [
          w.id,
        ]);
        return { workspace: workspaceView(await selectedWorkspace(db, w.id)) };
      }),
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/projects/:id/archive",
    async (req) =>
      command(req, async (db) => {
        z.object({})
          .strict()
          .parse(req.body ?? {});
        const p = (
          await db.query("SELECT * FROM projects WHERE id=$1 FOR UPDATE", [
            req.params.id,
          ])
        ).rows[0];
        if (!p) throw new HarborError(404, "NOT_FOUND", "Project not found");
        await requireWorkspaceIdle(db, { project_id: p.id }, true);
        return {
          project: publicRow(
            (
              await db.query(
                "UPDATE projects SET archived_at=now() WHERE id=$1 RETURNING *",
                [p.id],
              )
            ).rows[0],
          ),
        };
      }),
  );
}
