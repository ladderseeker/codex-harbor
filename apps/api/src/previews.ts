import type { FastifyInstance } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "../../../packages/storage/src/index.ts";
import {
  HarborError,
  authorizePermission,
} from "../../../packages/policy/src/index.ts";
import { requireAuthority } from "../../../packages/policy/src/authority.ts";
import { selectedWorkspace } from "../../../packages/workspaces/src/service.ts";
import {
  previewCreate,
  previewStart,
  previewStop,
  previewOpen,
  previewView,
} from "../../../packages/previews/src/contracts.ts";
import {
  configured,
  previewOrigin,
  previewRow,
  lockedPreview,
  requirePreviewAuthority,
  commandSlot,
  openingSecrets,
  revokePreviewAccess,
} from "../../../packages/previews/src/store.ts";
import { registerProgrammaticRoute } from "./token-access.ts";
import type { TerminalApi } from "./terminals.ts";

export function previewRoutes(app: FastifyInstance, h: TerminalApi) {
  const { pool, c, command } = h;
  for (const [method, path, action] of [
    ["GET", "/api/v1/workspaces/:id/previews", "read"],
    ["POST", "/api/v1/previews", "start"],
    ["GET", "/api/v1/previews/:id", "read"],
    ["GET", "/api/v1/previews/:id/logs", "read"],
    ["PATCH", "/api/v1/previews/:id", "start"],
    ["POST", "/api/v1/previews/:id/start", "start"],
    ["POST", "/api/v1/previews/:id/stop", "stop"],
    ["DELETE", "/api/v1/previews/:id", "stop"],
  ] as const)
    registerProgrammaticRoute(method, path, {
      scope: action === "read" ? "previews:read" : "previews:manage",
      resource: async (db, req) => {
        const workspace =
          path.includes("workspaces") || path === "/api/v1/previews";
        const row = (
          await db.query(
            workspace
              ? "SELECT project_id FROM workspaces WHERE id=$1"
              : "SELECT project_id,permission_profile FROM previews WHERE id=$1",
            [
              workspace
                ? (req.body?.workspaceId ?? req.params.id)
                : req.params.id,
            ],
          )
        ).rows[0];
        if (!row)
          throw new HarborError(
            404,
            "NOT_FOUND",
            "Preview workspace not found",
          );
        return {
          projectId: row.project_id,
          ...(action === "start"
            ? {
                permissionProfile:
                  req.body?.permissionProfile ?? row.permission_profile,
              }
            : {}),
        };
      },
    });
  app.get<{ Params: { id: string } }>(
    "/api/v1/workspaces/:id/previews",
    async (req) =>
      transaction(pool, async (db) => {
        const w = await selectedWorkspace(db, req.params.id);
        await requireAuthority(db, h.actor(req), c, {
          projectId: w.project_id,
          scope: "previews:read",
        });
        return {
          available: !!c.HARBOR_PREVIEW_DOMAIN && !!c.HARBOR_PREVIEW_SOCKET,
          previews: (
            await db.query(
              "SELECT p.*,coalesce((SELECT id FROM preview_stops s WHERE s.preview_id=p.id AND s.generation=p.generation ORDER BY created_at DESC LIMIT 1),retirement_ack) AS last_stop_id FROM previews p WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 32",
              [w.id],
            )
          ).rows.map(previewView),
        };
      }),
  );
  app.post("/api/v1/previews", async (req, reply) => {
    configured(c);
    const b = previewCreate.parse(req.body);
    authorizePermission(b.permissionProfile, c.HARBOR_PERMISSION_CEILING);
    return reply.code(201).send(
      await command(req, async (db) => {
        const before = await selectedWorkspace(db, b.workspaceId);
        await requirePreviewAuthority(
          db,
          {
            project_id: before.project_id,
            permission_profile: b.permissionProfile,
          },
          h.actor(req),
          c,
          "start",
        );
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('preview-capacity',0))",
        );
        const w = await selectedWorkspace(db, b.workspaceId, true);
        if (w.state !== "ready" || w.project_archived)
          throw new HarborError(
            409,
            "WORKSPACE_UNAVAILABLE",
            "Workspace is unavailable or archived",
          );
        const count = (
          await db.query(
            "SELECT count(*) AS total,count(*) FILTER(WHERE project_id=$1) AS project FROM previews",
            [w.project_id],
          )
        ).rows[0];
        if (Number(count.total) >= 128 || Number(count.project) >= 32)
          throw new HarborError(
            429,
            "PREVIEW_RECORD_LIMIT",
            "Remove retired preview records before creating more",
          );
        const p = (
          await db.query(
            "INSERT INTO previews(id,project_id,workspace_id,name,script,port,hostname,permission_profile,actor_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
            [
              randomUUID(),
              w.project_id,
              w.id,
              b.name,
              b.script,
              b.port,
              randomBytes(16).toString("hex") + "." + c.HARBOR_PREVIEW_DOMAIN,
              b.permissionProfile,
              h.actor(req),
            ],
          )
        ).rows[0];
        return { preview: previewView(p) };
      }),
    );
  });
  app.get<{ Params: { id: string } }>("/api/v1/previews/:id", async (req) =>
    transaction(pool, async (db) => {
      const p = await previewRow(db, req.params.id);
      await requirePreviewAuthority(db, p, h.actor(req), c, "read");
      return { preview: previewView(p) };
    }),
  );
  app.patch<{ Params: { id: string } }>("/api/v1/previews/:id", async (req) => {
    const b = previewCreate
      .omit({ workspaceId: true })
      .extend({ expectedRevision: z.number().int().positive() })
      .parse(req.body);
    authorizePermission(b.permissionProfile, c.HARBOR_PERMISSION_CEILING);
    return command(req, async (db) => {
      const before = await previewRow(db, req.params.id);
      await requirePreviewAuthority(
        db,
        { ...before, permission_profile: b.permissionProfile },
        h.actor(req),
        c,
        "start",
      );
      const { p } = await lockedPreview(db, req.params.id);
      if (
        !p.retired ||
        p.state === "queued" ||
        p.revision !== b.expectedRevision
      )
        throw new HarborError(
          409,
          "PREVIEW_CONFLICT",
          "Stop this preview and reload its current configuration first",
        );
      await commandSlot(db, p);
      const next = (
        await db.query(
          "UPDATE previews SET name=$2,script=$3,port=$4,permission_profile=$5,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
          [p.id, b.name, b.script, b.port, b.permissionProfile],
        )
      ).rows[0];
      return { preview: previewView(next) };
    });
  });
  app.post<{ Params: { id: string } }>(
    "/api/v1/previews/:id/start",
    async (req, reply) => {
      configured(c);
      const b = previewStart.parse(req.body);
      return reply.code(202).send(
        await command(req, async (db) => {
          const before = await previewRow(db, req.params.id);
          await requirePreviewAuthority(db, before, h.actor(req), c, "start");
          authorizePermission(
            before.permission_profile,
            c.HARBOR_PERMISSION_CEILING,
          );
          await db.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('preview-capacity',0))",
          );
          const { p, w } = await lockedPreview(db, req.params.id);
          if (
            p.revision !== b.expectedRevision ||
            !p.retired ||
            p.state === "queued"
          )
            throw new HarborError(
              409,
              "PREVIEW_CONFLICT",
              "Preview is already queued, running, or awaiting confirmed retirement",
            );
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
          if (
            (
              await db.query(
                "SELECT 1 FROM previews WHERE workspace_id=$1 AND state='queued'",
                [w.id],
              )
            ).rowCount
          )
            throw new HarborError(
              409,
              "PREVIEW_WORKSPACE_BUSY",
              "This workspace already has a queued preview",
            );
          await commandSlot(db, p);
          await revokePreviewAccess(db, p.id);
          const next = (
            await db.query(
              "UPDATE previews SET state='queued',actor_hash=$2,generation=nextval('runtime_generation_seq'),revision=revision+1,stop_attempts=0,failure_code=NULL,exit_code=NULL,deadline=NULL,runner_id=NULL,relay_id=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
              [p.id, h.actor(req)],
            )
          ).rows[0];
          return { preview: previewView(next) };
        }),
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/previews/:id/stop",
    async (req, reply) => {
      const b = previewStop.parse(req.body);
      return reply.code(202).send(
        await command(req, async (db) => {
          const before = await previewRow(db, req.params.id);
          await requirePreviewAuthority(db, before, h.actor(req), c, "stop");
          const { p } = await lockedPreview(db, req.params.id);
          if (Number(p.generation) !== b.expectedGeneration)
            throw new HarborError(
              409,
              "STALE_GENERATION",
              "Reload the current preview before stopping it",
            );
          if (p.state === "stopping")
            return { preview: previewView(p), stopId: p.last_stop_id };
          if (
            p.state === "uncertain" &&
            b.acknowledgeUnconfirmed !== p.last_stop_id
          )
            throw new HarborError(
              409,
              "RETIREMENT_ACK_REQUIRED",
              "Explicitly acknowledge the failed retirement before trying again",
            );
          await revokePreviewAccess(db, p.id);
          if (p.retired) {
            const next = (
              await db.query(
                "UPDATE previews SET state='stopped' WHERE id=$1 RETURNING *",
                [p.id],
              )
            ).rows[0];
            return { preview: previewView(next), stopId: null };
          }
          if (p.stop_attempts >= 3)
            throw new HarborError(
              429,
              "PREVIEW_STOP_LIMIT",
              "Stop attempts are exhausted; SSH runtime recovery is required",
            );
          const id = randomUUID();
          await db.query(
            "INSERT INTO preview_stops(id,preview_id,generation,attempt,actor_hash,acknowledgement) VALUES($1,$2,$3,$4,$5,$6)",
            [
              id,
              p.id,
              p.generation,
              p.stop_attempts + 1,
              h.actor(req),
              b.acknowledgeUnconfirmed ?? null,
            ],
          );
          const next = (
            await db.query(
              "UPDATE previews SET state='stopping',stop_attempts=stop_attempts+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
              [p.id],
            )
          ).rows[0];
          return {
            preview: previewView({ ...next, last_stop_id: id }),
            stopId: id,
          };
        }),
      );
    },
  );
  app.delete<{ Params: { id: string } }>("/api/v1/previews/:id", async (req) =>
    command(req, async (db) => {
      const before = await previewRow(db, req.params.id);
      await requirePreviewAuthority(db, before, h.actor(req), c, "stop");
      const { p } = await lockedPreview(db, req.params.id);
      if (!p.retired || p.state === "queued")
        throw new HarborError(
          409,
          "PREVIEW_ACTIVE",
          "Confirm preview retirement before removing its record",
        );
      for (const table of [
        "preview_grants",
        "preview_openings",
        "preview_logs",
        "preview_stops",
      ])
        await db.query(`DELETE FROM ${table} WHERE preview_id=$1`, [p.id]);
      await db.query("DELETE FROM previews WHERE id=$1", [p.id]);
      return { removed: true };
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/previews/:id/logs",
    async (req) => {
      const q = z
        .object({ cursor: z.coerce.number().int().nonnegative().default(0) })
        .strict()
        .parse(req.query);
      return transaction(pool, async (db) => {
        const before = await previewRow(db, req.params.id);
        await requirePreviewAuthority(db, before, h.actor(req), c, "read");
        const { p } = await lockedPreview(db, req.params.id);
        const rows = (
          await db.query(
            "SELECT sequence,generation,bytes FROM preview_logs WHERE preview_id=$1 AND sequence>$2 AND created_at>clock_timestamp()-interval '24 hours' ORDER BY sequence LIMIT 64",
            [p.id, q.cursor],
          )
        ).rows;
        return {
          preview: previewView(p),
          gap: q.cursor < Number(p.output_floor),
          cursor: rows.length
            ? Number(rows.at(-1).sequence)
            : Math.max(q.cursor, Number(p.output_floor)),
          chunks: rows.map((r) => ({
            sequence: Number(r.sequence),
            generation: Number(r.generation),
            dataBase64: r.bytes.toString("base64"),
          })),
        };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/previews/:id/open",
    async (req) => {
      configured(c);
      const b = previewOpen.parse(req.body);
      return command(req, async (db) => {
        const before = await previewRow(db, req.params.id);
        const owner = await requirePreviewAuthority(
          db,
          before,
          h.actor(req),
          c,
          "open",
        );
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('preview-openings',0))",
        );
        const { p } = await lockedPreview(db, req.params.id);
        if (
          p.state !== "ready" ||
          p.retired ||
          Number(p.generation) !== b.expectedGeneration
        )
          throw new HarborError(
            409,
            "PREVIEW_NOT_READY",
            "Preview is not ready; reload its current state",
          );
        await db.query(
          "DELETE FROM preview_grants WHERE revoked OR expires_at<=clock_timestamp()",
        );
        await db.query(
          "DELETE FROM preview_openings WHERE (revoked OR expires_at<=clock_timestamp()) AND NOT EXISTS(SELECT 1 FROM preview_grants g WHERE g.id=preview_openings.id)",
        );
        const n = (
          await db.query(
            "SELECT count(*) AS total,count(*) FILTER(WHERE actor_hash=$1) AS actor FROM preview_openings WHERE NOT revoked AND consumed_at IS NULL AND expires_at>clock_timestamp()",
            [owner.hash],
          )
        ).rows[0];
        if (Number(n.total) >= 32 || Number(n.actor) >= 8)
          throw new HarborError(
            429,
            "PREVIEW_OPEN_LIMIT",
            "Pending preview openings are full; wait for their short expiry",
          );
        await commandSlot(db, p);
        const id = randomUUID(),
          s = openingSecrets(owner.csrf, id, p.id, Number(p.generation));
        await db.query(
          "INSERT INTO preview_openings(id,preview_id,generation,actor_hash,ticket_hash,grant_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '30 seconds')",
          [id, p.id, p.generation, owner.hash, s.ticketHash, s.grantHash],
        );
        return {
          bootstrapPath: "/api/v1/preview-openings/" + id,
          expiresIn: 30,
        };
      });
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/preview-openings/:id",
    async (req, reply) => {
      const page = await transaction(pool, async (db) => {
        const owner = await requireAuthority(db, h.actor(req), c);
        if (owner.kind !== "browser")
          throw new HarborError(
            403,
            "BROWSER_REQUIRED",
            "Owner browser required",
          );
        const opening = (
          await db.query(
            "SELECT * FROM preview_openings WHERE id=$1 AND actor_hash=$2 AND NOT revoked AND consumed_at IS NULL AND expires_at>clock_timestamp()",
            [req.params.id, owner.hash],
          )
        ).rows[0];
        if (!opening)
          throw new HarborError(
            410,
            "OPENING_EXPIRED",
            "Return to Harbor to prepare a new preview opening",
          );
        const p = await previewRow(db, opening.preview_id);
        await requirePreviewAuthority(db, p, owner.hash, c, "open");
        if (
          p.state !== "ready" ||
          p.retired ||
          p.generation !== opening.generation
        )
          throw new HarborError(
            409,
            "PREVIEW_NOT_READY",
            "Preview is no longer ready",
          );
        return {
          origin: previewOrigin(p, c),
          ...openingSecrets(owner.csrf, opening.id, p.id, Number(p.generation)),
        };
      });
      const nonce = randomBytes(24).toString("base64");
      reply.header(
        "content-security-policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${page.origin}; base-uri 'none'; frame-ancestors 'none'`,
      );
      reply.header("cross-origin-opener-policy", "same-origin");
      reply.header("referrer-policy", "origin");
      return reply
        .type("text/html")
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><title>Open private preview</title></head><body><form method="post" action="${page.origin}/__harbor/exchange"><input type="hidden" name="ticket" value="${page.ticket}"><button>Open private preview</button></form><script nonce="${nonce}">document.forms[0].submit()</script></body></html>`,
        );
    },
  );
}
