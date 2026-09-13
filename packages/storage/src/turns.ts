import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { associateAttachments } from "../../attachments/src/store.ts";
import { turnSchema } from "../../contracts/src/index.ts";
import {
  sessionWorkspace,
  verifyWorkspace,
} from "../../workspaces/src/service.ts";
import { capacity } from "./capacity.ts";
import { event, publicRow } from "./index.ts";
import { HarborError, authorizePermission } from "../../policy/src/index.ts";
import { effectiveSettings } from "../../policy/src/models.ts";
export async function acceptConversationTurn(
  db: PoolClient,
  sessionId: string,
  input: unknown,
  c: {
    HARBOR_PERMISSION_CEILING: "read-only" | "workspace-write";
    HARBOR_MAX_QUEUED: number;
    models: string[];
  },
  options: {
    actor: string;
    operationId?: string;
    authorize: (db: PoolClient) => Promise<void>;
  },
) {
  const b = turnSchema.parse(input);
  authorizePermission(b.permissionProfile, c.HARBOR_PERMISSION_CEILING);
  await effectiveSettings(db, b.model, b.effort, c.models);
  if (!c.models.includes(b.model))
    throw new HarborError(403, "MODEL_DENIED", "Model unavailable");
  const selected = await sessionWorkspace(db, sessionId, true);
  await db.query("SELECT * FROM sessions WHERE id=$1 FOR UPDATE", [sessionId]);
  const s = (await db.query("SELECT * FROM sessions WHERE id=$1", [sessionId]))
    .rows[0];
  if (s.background_stop_requested)
    throw new HarborError(
      409,
      "BACKGROUND_STOPPING",
      "Wait for background development processes to stop before continuing",
    );
  if (selected.project_archived || selected.state !== "ready")
    throw new HarborError(
      409,
      "WORKSPACE_UNAVAILABLE",
      "Conversation workspace is unavailable or archived",
    );
  await verifyWorkspace(selected);
  await capacity(db, s.id, "turn");
  const total = await db.query(
    "SELECT coalesce(sum(octet_length(text)),0) AS bytes,count(*) AS count FROM messages WHERE session_id=$1",
    [s.id],
  );
  if (
    Number(total.rows[0].bytes) + Buffer.byteLength(b.text) > 2097152 ||
    Number(total.rows[0].count) >= 2000
  )
    throw new HarborError(
      429,
      "HISTORY_QUOTA",
      "Conversation storage limit reached",
    );
  if (
    (
      await db.query(
        "SELECT 1 FROM operations WHERE session_id=$1 AND state='uncertain' AND uncertainty_acknowledged_at IS NULL LIMIT 1",
        [s.id],
      )
    ).rowCount
  )
    throw new HarborError(
      409,
      "UNCERTAIN",
      "Resolve uncertain delivery before new work",
    );
  if ((await db.query("SELECT emergency FROM harbor_meta")).rows[0].emergency)
    throw new HarborError(409, "EMERGENCY_STOP", "Dispatch is stopped");
  await db.query("SELECT pg_advisory_xact_lock(740015)");
  if (
    Number(
      (
        await db.query(
          "SELECT count(*) FROM operations WHERE state IN ('queued','dispatching','running','waiting_approval','waiting_input')",
        )
      ).rows[0].count,
    ) >= c.HARBOR_MAX_QUEUED
  )
    throw new HarborError(429, "QUEUE_QUOTA", "Queue limit reached");
  await options.authorize(db);
  const id = options.operationId ?? randomUUID();
  const r = await db.query(
    "INSERT INTO operations(id,session_id,kind,state,payload,actor_hash) VALUES($1,$2,'turn','queued',$3,$4) RETURNING *",
    [id, s.id, JSON.stringify(b), options.actor],
  );
  await associateAttachments(
    db,
    s.id,
    id,
    b.attachmentIds,
    b.model,
    b.draftRevision,
  );
  await db.query(
    "INSERT INTO messages(id,session_id,operation_id,role,text,status) VALUES($1,$2,$3,'user',$4,'complete')",
    [randomUUID(), s.id, id, b.text],
  );
  await db.query(
    "UPDATE sessions SET state=CASE WHEN state IN ('running','waiting_approval','waiting_input') THEN state ELSE 'queued' END WHERE id=$1",
    [s.id],
  );
  const named = await db.query(
    "UPDATE sessions SET title=harbor_conversation_title($2),title_source='automatic',metadata_revision=metadata_revision+1 WHERE id=$1 AND title_source='pending' AND title='New conversation' AND harbor_conversation_title($2) IS NOT NULL RETURNING title,metadata_revision",
    [s.id, b.text],
  );
  if (named.rowCount)
    await event(db, s.id, "session.metadata", {
      title: named.rows[0].title,
      archived: s.archived,
      revision: Number(named.rows[0].metadata_revision),
    });
  await event(db, s.id, "operation.queued", { operationId: id });
  return { operation: publicRow(r.rows[0]) };
}
