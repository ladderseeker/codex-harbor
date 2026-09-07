import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { HarborError, digest } from "../../../packages/policy/src/index.ts";
import {
  event,
  publicRow,
  transaction,
} from "../../../packages/storage/src/index.ts";

export interface HistoryContext {
  pool: Pool;
  lockWorkspace?(db: PoolClient, sessionId: string): Promise<void>;
  command(req: any, fn: (db: PoolClient) => Promise<any>): Promise<any>;
}
/** Resource authorization may be wrapped here when workspace/PAT modules are installed. */
export function historyRoutes(
  app: FastifyInstance,
  { pool, command, lockWorkspace }: HistoryContext,
) {
  app.get("/api/v1/history", async (req) => {
    const query = z
      .object({
        q: z.string().max(120).default(""),
        state: z.enum(["active", "archived", "all"]).default("active"),
        projectId: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().max(1024).optional(),
      })
      .strict()
      .parse(req.query);
    const filter = digest(
      JSON.stringify([query.q, query.state, query.projectId ?? null]),
    );
    let before: { createdAt: string; id: string } | undefined;
    if (query.cursor) {
      try {
        const parsed = z
          .object({
            filter: z.literal(filter),
            createdAt: z.iso.datetime(),
            id: z.uuid(),
          })
          .strict()
          .parse(
            JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")),
          );
        before = parsed;
      } catch {
        throw new HarborError(
          400,
          "INVALID_CURSOR",
          "History cursor does not match these filters",
        );
      }
    }
    return transaction(pool, async (db) => {
      await db.query("SET LOCAL statement_timeout='2s'");
      const rows = (
        await db.query(
          `SELECT s.*,to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,left(coalesce((SELECT m.text FROM messages m WHERE m.session_id=s.id AND ($1='' OR strpos(lower(m.text),lower($1))>0) ORDER BY m.created_at,m.id LIMIT 1),''),240) AS snippet FROM sessions s WHERE ($2='all' OR s.archived=($2='archived')) AND ($3::uuid IS NULL OR s.project_id=$3) AND ($1='' OR strpos(lower(s.title),lower($1))>0 OR EXISTS(SELECT 1 FROM messages m WHERE m.session_id=s.id AND strpos(lower(m.text),lower($1))>0)) AND ($4::timestamptz IS NULL OR (s.created_at,s.id)<($4::timestamptz,$5::uuid)) ORDER BY s.created_at DESC,s.id DESC LIMIT $6`,
          [
            query.q,
            query.state,
            query.projectId ?? null,
            before?.createdAt ?? null,
            before?.id ?? null,
            query.limit + 1,
          ],
        )
      ).rows;
      const page = rows.slice(0, query.limit),
        last = page.at(-1);
      return {
        sessions: page.map(({ cursor_created_at: _, ...row }) =>
          publicRow(row),
        ),
        nextCursor:
          rows.length > query.limit && last
            ? Buffer.from(
                JSON.stringify({
                  filter,
                  createdAt: last.cursor_created_at,
                  id: last.id,
                }),
              ).toString("base64url")
            : null,
      };
    });
  });
  // Retained P003 API spelling; archival now changes visibility only.
  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/archive",
    async (req) => {
      z.object({})
        .strict()
        .parse(req.body ?? {});
      return command(req, async (db) => {
        await lockWorkspace?.(db, req.params.id);
        const old = (
          await db.query("SELECT * FROM sessions WHERE id=$1 FOR UPDATE", [
            req.params.id,
          ])
        ).rows[0];
        if (!old)
          throw new HarborError(404, "NOT_FOUND", "Conversation not found");
        if (old.archived) return { session: publicRow(old) };
        const row = (
          await db.query(
            "UPDATE sessions SET archived=true,archived_at=now(),metadata_revision=metadata_revision+1 WHERE id=$1 RETURNING *",
            [old.id],
          )
        ).rows[0];
        await event(db, old.id, "session.metadata", {
          title: row.title,
          archived: true,
          revision: Number(row.metadata_revision),
        });
        return { session: publicRow(row) };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/metadata",
    async (req) => {
      const body = z
        .object({
          expectedRevision: z.number().int().nonnegative(),
          title: z.string().trim().min(1).max(200).optional(),
          archived: z.boolean().optional(),
        })
        .strict()
        .refine((b) => b.title !== undefined || b.archived !== undefined)
        .parse(req.body);
      return command(req, async (db) => {
        await lockWorkspace?.(db, req.params.id);
        const old = (
          await db.query("SELECT * FROM sessions WHERE id=$1 FOR UPDATE", [
            req.params.id,
          ])
        ).rows[0];
        if (!old)
          throw new HarborError(404, "NOT_FOUND", "Conversation not found");
        if (Number(old.metadata_revision) !== body.expectedRevision)
          throw new HarborError(
            409,
            "STALE_REVISION",
            "Conversation details changed; refresh before editing",
          );
        const row = (
          await db.query(
            "UPDATE sessions SET title=coalesce($2,title),archived=coalesce($3,archived),archived_at=CASE WHEN $3::boolean IS NULL THEN archived_at WHEN $3 THEN coalesce(archived_at,now()) ELSE NULL END,metadata_revision=metadata_revision+1 WHERE id=$1 RETURNING *",
            [old.id, body.title ?? null, body.archived ?? null],
          )
        ).rows[0];
        await event(db, old.id, "session.metadata", {
          title: row.title,
          archived: row.archived,
          revision: Number(row.metadata_revision),
        });
        return { session: publicRow(row) };
      });
    },
  );
}
