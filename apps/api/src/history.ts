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
        order: z.enum(["created", "updated", "queried"]).default("created"),
        selectedId: z.uuid().optional(),
      })
      .strict()
      .refine((q) => q.order === "updated" || q.selectedId === undefined, {
        message: "selectedId requires updated order",
      })
      .parse(req.query);
    const filter = digest(
      JSON.stringify(
        query.order === "created"
          ? [query.q, query.state, query.projectId ?? null]
          : [
              query.q,
              query.state,
              query.projectId ?? null,
              query.order,
              query.selectedId ?? null,
            ],
      ),
    );
    let before: { timestamp: string; id: string; priority: number } | undefined;
    if (query.cursor) {
      try {
        const value = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString("utf8"),
        );
        if (query.order === "created") {
          const parsed = z
            .object({
              filter: z.literal(filter),
              createdAt: z.iso.datetime(),
              id: z.uuid(),
            })
            .strict()
            .parse(value);
          before = { timestamp: parsed.createdAt, id: parsed.id, priority: 0 };
        } else if (query.order === "updated") {
          const parsed = z
            .object({
              filter: z.literal(filter),
              updatedAt: z.iso.datetime(),
              id: z.uuid(),
              priority: z.union([z.literal(0), z.literal(1)]),
            })
            .strict()
            .parse(value);
          before = {
            timestamp: parsed.updatedAt,
            id: parsed.id,
            priority: parsed.priority,
          };
        } else {
          const parsed = z
            .object({
              filter: z.literal(filter),
              queriedAt: z.iso.datetime(),
              id: z.uuid(),
            })
            .strict()
            .parse(value);
          before = { timestamp: parsed.queriedAt, id: parsed.id, priority: 0 };
        }
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
      const updated = query.order === "updated";
      const queried = query.order === "queried";
      const timestamp = queried
        ? "coalesce(latest_query.created_at,s.created_at)"
        : updated
          ? "s.updated_at"
          : "s.created_at";
      const priority = updated
        ? "CASE WHEN s.id=$7::uuid THEN 1 ELSE 0 END"
        : "0";
      const keyset = updated
        ? `(${priority},${timestamp},s.id)<($8::int,$4::timestamptz,$5::uuid)`
        : `(${timestamp},s.id)<($4::timestamptz,$5::uuid)`;
      const queryTime = queried
        ? " LEFT JOIN LATERAL (SELECT m.created_at FROM messages m WHERE m.session_id=s.id AND m.role='user' ORDER BY m.created_at DESC,m.id DESC LIMIT 1) latest_query ON true"
        : "";
      const rows = (
        await db.query(
          `SELECT s.*,${priority} AS cursor_priority,to_char(${timestamp} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_timestamp,left(coalesce((SELECT m.text FROM messages m WHERE m.session_id=s.id AND ($1='' OR strpos(lower(m.text),lower($1))>0) ORDER BY m.created_at,m.id LIMIT 1),''),240) AS snippet FROM sessions s${queryTime} WHERE ($2='all' OR s.archived=($2='archived')) AND ($3::uuid IS NULL OR s.project_id=$3) AND ($1='' OR strpos(lower(s.title),lower($1))>0 OR EXISTS(SELECT 1 FROM messages m WHERE m.session_id=s.id AND strpos(lower(m.text),lower($1))>0)) AND ($4::timestamptz IS NULL OR ${keyset}) ORDER BY ${updated ? "cursor_priority DESC," : ""}${timestamp} DESC,s.id DESC LIMIT $6`,
          [
            query.q,
            query.state,
            query.projectId ?? null,
            before?.timestamp ?? null,
            before?.id ?? null,
            query.limit + 1,
            ...(updated
              ? [query.selectedId ?? null, before?.priority ?? null]
              : []),
          ],
        )
      ).rows;
      const page = rows.slice(0, query.limit),
        last = page.at(-1);
      return {
        sessions: page.map(
          ({ cursor_timestamp: _, cursor_priority: __, ...row }) =>
            publicRow(row),
        ),
        nextCursor:
          rows.length > query.limit && last
            ? Buffer.from(
                JSON.stringify({
                  filter,
                  ...(updated
                    ? {
                        updatedAt: last.cursor_timestamp,
                        priority: last.cursor_priority,
                      }
                    : queried
                      ? { queriedAt: last.cursor_timestamp }
                      : { createdAt: last.cursor_timestamp }),
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
            "UPDATE sessions SET title=coalesce($2,title),title_source=CASE WHEN $2::text IS NULL THEN title_source ELSE 'manual' END,archived=coalesce($3,archived),archived_at=CASE WHEN $3::boolean IS NULL THEN archived_at WHEN $3 THEN coalesce(archived_at,now()) ELSE NULL END,metadata_revision=metadata_revision+1 WHERE id=$1 RETURNING *",
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
