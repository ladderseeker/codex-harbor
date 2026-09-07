import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { HarborError } from "../../../packages/policy/src/index.ts";
import {
  ATTACHMENT_LIMITS,
  validateMedia,
  safeName,
  hashBytes,
} from "../../../packages/attachments/src/media.ts";
import {
  attachmentView,
  lockSession,
} from "../../../packages/attachments/src/store.ts";
type Command = (
  req: any,
  run: (db: PoolClient) => Promise<unknown>,
) => Promise<unknown>;
export function attachmentRoutes(
  app: FastifyInstance,
  pool: Pool,
  command: Command,
) {
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 262144 },
    (_req, body, done) => done(null, body),
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/attachments",
    async (req) =>
      command(req, async (db) => {
        const b = z
          .object({
            name: z.string().min(1).max(240),
            mediaType: z.enum(["image/png", "text/plain"]),
            size: z.number().int().positive().max(262144),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .parse(req.body);
        if (b.mediaType === "text/plain" && b.size > 65536)
          throw new HarborError(
            413,
            "ATTACHMENT_LIMIT",
            "Text files must be at most 64 KiB",
          );
        const s = await lockSession(db, req.params.id);
        await db.query("SELECT pg_advisory_xact_lock(740020)");
        const records = (
          await db.query(
            "SELECT count(*)::int AS total,count(*) FILTER(WHERE session_id=$1)::int AS local FROM attachments",
            [s.id],
          )
        ).rows[0];
        if (
          records.total >= 10000 ||
          records.local >= ATTACHMENT_LIMITS.sessionCount
        )
          throw new HarborError(
            429,
            "ATTACHMENT_QUOTA",
            "Attachment metadata limit reached; wait for expired uploads to be collected",
          );
        const total = (
          await db.query(
            "SELECT coalesce(sum(expected_size),0)::bigint AS bytes FROM attachments WHERE state IN ('uploading','staged','attached')",
          )
        ).rows[0];
        const local = (
          await db.query(
            "SELECT count(*)::int AS count,coalesce(sum(expected_size),0)::bigint AS bytes FROM attachments WHERE session_id=$1 AND state IN ('uploading','staged','attached')",
            [s.id],
          )
        ).rows[0];
        if (
          Number(total.bytes) + b.size > ATTACHMENT_LIMITS.instanceBytes ||
          local.count >= 32 ||
          Number(local.bytes) + b.size > ATTACHMENT_LIMITS.sessionBytes
        )
          throw new HarborError(
            429,
            "ATTACHMENT_QUOTA",
            "Attachment storage limit reached",
          );
        const row = (
          await db.query(
            "INSERT INTO attachments(id,session_id,project_id,name,declared_type,expected_size,expected_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              randomUUID(),
              s.id,
              s.project_id,
              safeName(b.name),
              b.mediaType,
              b.size,
              b.sha256,
            ],
          )
        ).rows[0];
        return { attachment: attachmentView(row) };
      }),
  );
  app.put<{ Params: { id: string } }>(
    "/api/v1/attachments/:id/content",
    { bodyLimit: 262144 },
    async (req) => {
      if (!Buffer.isBuffer(req.body))
        throw new HarborError(
          400,
          "INVALID_UPLOAD",
          "Binary upload body required",
        );
      const bytes = req.body;
      req.body = { sha256: hashBytes(bytes), size: bytes.length };
      return command(req, async (db) => {
        const initial = (
          await db.query("SELECT session_id FROM attachments WHERE id=$1", [
            req.params.id,
          ])
        ).rows[0];
        if (!initial)
          throw new HarborError(404, "NOT_FOUND", "Attachment not found");
        await lockSession(db, initial.session_id);
        const a = (
          await db.query("SELECT * FROM attachments WHERE id=$1 FOR UPDATE", [
            req.params.id,
          ])
        ).rows[0];
        if (
          a.expected_hash !== hashBytes(bytes) ||
          a.expected_size !== bytes.length
        )
          throw new HarborError(
            409,
            "UPLOAD_CONTENT_CONFLICT",
            "Reselected file does not match this upload",
          );
        if (a.state === "staged" || a.state === "attached")
          return { attachment: attachmentView(a) };
        if (
          a.state !== "uploading" ||
          new Date(a.expires_at).getTime() <= Date.now()
        )
          throw new HarborError(
            409,
            "UPLOAD_EXPIRED",
            "Upload expired or was removed",
          );
        const content = validateMedia(bytes, a.declared_type);
        const row = (
          await db.query(
            "UPDATE attachments SET state='staged',content=$2,media_type=declared_type,size=$3,digest=$4 WHERE id=$1 RETURNING *",
            [a.id, content, content.length, hashBytes(content)],
          )
        ).rows[0];
        return { attachment: attachmentView(row) };
      });
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/attachments",
    async (req) => {
      if (
        !(
          await pool.query("SELECT id FROM sessions WHERE id=$1", [
            req.params.id,
          ])
        ).rowCount
      )
        throw new HarborError(404, "NOT_FOUND", "Conversation not found");
      return {
        attachments: (
          await pool.query(
            "SELECT id,session_id,name,state,media_type,declared_type,size,expected_size,digest,expected_hash,operation_id,expires_at FROM attachments WHERE session_id=$1 ORDER BY created_at,id",
            [req.params.id],
          )
        ).rows.map(attachmentView),
      };
    },
  );
  for (const mode of ["content", "preview"])
    app.get<{ Params: { id: string } }>(
      `/api/v1/attachments/:id/${mode}`,
      async (req, reply) => {
        const a = (
          await pool.query(
            "SELECT * FROM attachments WHERE id=$1 AND state IN ('staged','attached')",
            [req.params.id],
          )
        ).rows[0];
        if (!a)
          throw new HarborError(
            404,
            "NOT_FOUND",
            "Attachment content unavailable",
          );
        if (mode === "preview" && a.media_type !== "image/png")
          throw new HarborError(
            415,
            "PREVIEW_UNSUPPORTED",
            "Only validated PNG has an inline preview",
          );
        reply
          .header("content-type", a.media_type)
          .header(
            "content-disposition",
            mode === "preview"
              ? "inline"
              : `attachment; filename="attachment${a.media_type === "image/png" ? ".png" : ".txt"}"`,
          )
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header("x-content-type-options", "nosniff");
        return reply.send(a.content);
      },
    );
  app.delete<{ Params: { id: string } }>(
    "/api/v1/attachments/:id",
    async (req) =>
      command(req, async (db) => {
        const row = (
          await db.query("SELECT * FROM attachments WHERE id=$1", [
            req.params.id,
          ])
        ).rows[0];
        if (!row)
          throw new HarborError(404, "NOT_FOUND", "Attachment not found");
        await lockSession(db, row.session_id);
        const a = (
          await db.query("SELECT * FROM attachments WHERE id=$1 FOR UPDATE", [
            row.id,
          ])
        ).rows[0];
        if (a.state === "attached")
          throw new HarborError(
            409,
            "ATTACHMENT_REFERENCED",
            "Submitted files cannot be removed",
          );
        await db.query(
          "UPDATE attachments SET state='deleted',content=NULL WHERE id=$1",
          [a.id],
        );
        await db.query(
          "UPDATE conversation_drafts SET attachment_ids=array_remove(attachment_ids,$2::uuid),revision=revision+1,updated_at=now() WHERE session_id=$1 AND $2::uuid=ANY(attachment_ids)",
          [a.session_id, a.id],
        );
        return { deleted: true };
      }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/draft",
    async (req) => {
      if (
        !(
          await pool.query("SELECT id FROM sessions WHERE id=$1", [
            req.params.id,
          ])
        ).rowCount
      )
        throw new HarborError(404, "NOT_FOUND", "Conversation not found");
      const draft = (
        await pool.query(
          "SELECT CASE WHEN updated_at>now()-interval '24 hours' THEN text ELSE '' END AS text,CASE WHEN updated_at>now()-interval '24 hours' THEN attachment_ids ELSE '{}'::uuid[] END AS \"attachmentIds\",revision FROM conversation_drafts WHERE session_id=$1",
          [req.params.id],
        )
      ).rows[0];
      return {
        draft: draft
          ? { ...draft, revision: Number(draft.revision) }
          : { text: "", attachmentIds: [], revision: 0 },
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/draft",
    async (req) =>
      command(req, async (db) => {
        const b = z
          .object({
            text: z
              .string()
              .max(32768)
              .refine((x) => Buffer.byteLength(x) <= 32768),
            attachmentIds: z.array(z.uuid()).max(4),
            expectedRevision: z.number().int().nonnegative(),
          })
          .strict()
          .parse(req.body);
        await lockSession(db, req.params.id);
        await db.query(
          "INSERT INTO conversation_drafts(session_id) VALUES($1) ON CONFLICT DO NOTHING",
          [req.params.id],
        );
        const draft = (
          await db.query(
            "SELECT revision FROM conversation_drafts WHERE session_id=$1 FOR UPDATE",
            [req.params.id],
          )
        ).rows[0];
        if (Number(draft.revision) !== b.expectedRevision)
          throw new HarborError(
            409,
            "DRAFT_CONFLICT",
            "This draft changed in another tab; reload it before saving",
          );
        if (new Set(b.attachmentIds).size !== b.attachmentIds.length)
          throw new HarborError(
            400,
            "INVALID_DRAFT",
            "Duplicate attachment reference",
          );
        const rows = (
          await db.query(
            "SELECT id FROM attachments WHERE session_id=$1 AND id=ANY($2::uuid[]) AND state='staged' AND expires_at>now() FOR UPDATE",
            [req.params.id, b.attachmentIds],
          )
        ).rows;
        if (rows.length !== b.attachmentIds.length)
          throw new HarborError(
            409,
            "ATTACHMENT_UNAVAILABLE",
            "A selected draft attachment is unavailable",
          );
        const result = (
          await db.query(
            'UPDATE conversation_drafts SET text=$2,attachment_ids=$3,revision=revision+1,updated_at=now() WHERE session_id=$1 RETURNING text,attachment_ids AS "attachmentIds",revision',
            [req.params.id, b.text, b.attachmentIds],
          )
        ).rows[0];
        return { draft: { ...result, revision: Number(result.revision) } };
      }),
  );
}
