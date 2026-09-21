import { transaction, type DB } from "../../storage/src/index.ts";
import type { Pool } from "pg";
import { HarborError } from "../../policy/src/index.ts";
import { ATTACHMENT_LIMITS, hashBytes } from "./media.ts";
export function attachmentView(row: Record<string, any>) {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    state: row.state,
    mediaType: row.media_type ?? row.declared_type,
    size: row.size ?? row.expected_size,
    digest: row.digest ?? row.expected_hash,
    operationId: row.operation_id,
    expiresAt: row.expires_at,
  };
}
export async function lockSession(db: DB, id: string) {
  const result = await db.query(
    "SELECT * FROM sessions WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!result.rowCount)
    throw new HarborError(404, "NOT_FOUND", "Conversation not found");
  return result.rows[0];
}
export async function associateAttachments(
  db: DB,
  sessionId: string,
  operationId: string,
  ids: string[],
  model: string,
  draftRevision?: number,
) {
  if (new Set(ids).size !== ids.length || ids.length > 4)
    throw new HarborError(
      400,
      "ATTACHMENT_LIMIT",
      "Select up to four distinct files",
    );
  const rows = ids.length
    ? (
        await db.query(
          "SELECT * FROM attachments WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
          [ids],
        )
      ).rows
    : [];
  if (
    rows.length !== ids.length ||
    rows.some(
      (a) =>
        a.session_id !== sessionId ||
        a.state !== "staged" ||
        new Date(a.expires_at).getTime() <= Date.now(),
    )
  )
    throw new HarborError(
      409,
      "ATTACHMENT_UNAVAILABLE",
      "A selected attachment is unavailable or belongs to another conversation",
    );
  if (rows.reduce((n, a) => n + a.size, 0) > ATTACHMENT_LIMITS.turnBytes)
    throw new HarborError(
      413,
      "ATTACHMENT_LIMIT",
      "Selected files exceed the per-turn byte limit",
    );
  await validateAttachmentModalities(db, rows, model);
  if (ids.length)
    await db.query(
      "UPDATE attachments SET state='attached',operation_id=$2 WHERE id=ANY($1::uuid[])",
      [ids, operationId],
    );
  if (draftRevision !== undefined)
    await db.query(
      "UPDATE conversation_drafts SET text='',attachment_ids='{}',revision=revision+1,updated_at=now() WHERE session_id=$1 AND revision=$2",
      [sessionId, draftRevision],
    );
}
export async function validateAttachmentModalities(
  db: DB,
  rows: Record<string, any>[],
  model: string,
) {
  const catalog =
    (
      await db.query(
        "SELECT data FROM runtime_capabilities WHERE updated_at>now()-interval '1 hour'",
      )
    ).rows[0]?.data?.data ?? [];
  const modalities =
    catalog.find((m: any) => (m.model ?? m.id) === model)?.inputModalities ??
    [];
  if (
    rows.some((a) => ["image/png", "image/jpeg"].includes(a.media_type)) &&
    !modalities.includes("image")
  )
    throw new HarborError(
      403,
      "IMAGE_UNSUPPORTED",
      "The selected model does not advertise image input",
    );
  if (
    rows.some((a) =>
      ["text/plain", "application/octet-stream"].includes(a.media_type),
    ) &&
    !modalities.includes("text")
  )
    throw new HarborError(
      403,
      "FILE_UNSUPPORTED",
      "The selected model does not advertise text input",
    );
}
export async function operationAttachments(
  db: DB,
  sessionId: string,
  operationId: string,
) {
  const rows = (
    await db.query(
      "SELECT * FROM attachments WHERE session_id=$1 AND operation_id=$2 AND state='attached' ORDER BY id",
      [sessionId, operationId],
    )
  ).rows;
  for (const row of rows)
    if (!Buffer.isBuffer(row.content) || hashBytes(row.content) !== row.digest)
      throw new HarborError(
        409,
        "ATTACHMENT_INTEGRITY",
        "Attachment content verification failed",
      );
  return rows;
}
export async function maintainAttachments(pool: Pool) {
  const sessions = (
    await pool.query(
      "SELECT session_id FROM (SELECT a.session_id FROM attachments a WHERE (a.state IN ('deleted','expired') AND a.created_at<now()-interval '48 hours') OR (a.state IN ('uploading','staged') AND a.expires_at<now() AND NOT EXISTS(SELECT 1 FROM conversation_drafts d WHERE d.session_id=a.session_id AND a.id=ANY(d.attachment_ids) AND d.updated_at>now()-interval '24 hours')) UNION SELECT session_id FROM conversation_drafts WHERE updated_at<now()-interval '24 hours' AND (text<>'' OR cardinality(attachment_ids)>0)) candidates LIMIT 100",
    )
  ).rows;
  for (const session of sessions)
    await transaction(pool, async (db) => {
      await lockSession(db, session.session_id);
      await db.query(
        "UPDATE conversation_drafts SET text='',attachment_ids='{}',revision=revision+1 WHERE session_id=$1 AND updated_at<now()-interval '24 hours' AND (text<>'' OR cardinality(attachment_ids)>0)",
        [session.session_id],
      );
      await db.query(
        "UPDATE attachments a SET state='expired',content=NULL WHERE session_id=$1 AND state IN ('uploading','staged') AND expires_at<now() AND NOT EXISTS(SELECT 1 FROM conversation_drafts d WHERE d.session_id=a.session_id AND a.id=ANY(d.attachment_ids) AND d.updated_at>now()-interval '24 hours')",
        [session.session_id],
      );
      await db.query(
        "DELETE FROM attachments WHERE session_id=$1 AND state IN ('deleted','expired') AND created_at<now()-interval '48 hours'",
        [session.session_id],
      );
    });
}
