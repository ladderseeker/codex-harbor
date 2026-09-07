import { transaction } from "../../storage/src/index.ts";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { digest, HarborError } from "../../policy/src/index.ts";
import {
  requireAuthority,
  type AuthorityConfig,
} from "../../policy/src/authority.ts";
import { selectedWorkspace } from "../../workspaces/src/service.ts";
export type TerminalScope =
  | "terminal:read"
  | "terminal:control"
  | "terminal:terminate";
const gone = () =>
  new HarborError(409, "TERMINAL_STATE", "Terminal is not running");
export async function terminalRow(db: PoolClient, id: string) {
  const t = (
    await db.query(
      "SELECT t.*,w.name AS workspace_name FROM terminals t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=$1",
      [id],
    )
  ).rows[0];
  if (!t) throw new HarborError(404, "NOT_FOUND", "Terminal not found");
  return t;
}
export async function terminalGrant(
  db: PoolClient,
  t: any,
  actor: string,
  c: AuthorityConfig,
  scope: TerminalScope,
) {
  return requireAuthority(db, actor, c, {
    projectId: t.project_id,
    scope,
    ...(scope === "terminal:control"
      ? { permissionProfile: t.permission_profile }
      : {}),
  });
}
/** Lock parent rows before the terminal, including output-only writes: a second
 * UPDATE in one transaction can recheck unchanged foreign keys in PostgreSQL. */
export async function lockTerminalResource(db: PoolClient, id: string) {
  const before = await terminalRow(db, id);
  await selectedWorkspace(db, before.workspace_id, true);
  await db.query("SELECT id FROM terminals WHERE id=$1 FOR UPDATE", [id]);
  return terminalRow(db, id);
}
/** Same authority -> project -> workspace -> terminal order for API and final wire grants. */
export async function lockedTerminal(
  db: PoolClient,
  id: string,
  actor: string,
  c: AuthorityConfig,
  scope: TerminalScope,
) {
  const before = await terminalRow(db, id);
  await terminalGrant(db, before, actor, c, scope);
  const t = await lockTerminalResource(db, id);
  await terminalGrant(db, t, actor, c, scope);
  return t;
}
export async function requireController(
  db: PoolClient,
  t: any,
  actor: string,
  b: any,
) {
  if (t.state !== "running") throw gone();
  if (
    Number(t.generation) !== b.generation ||
    Number(t.controller_epoch) !== b.epoch ||
    t.controller_actor !== actor ||
    t.controller_id !== b.controllerId
  )
    throw new HarborError(
      409,
      "CONTROLLER_STALE",
      "Take control explicitly before sending input",
    );
  const live = (
    await db.query(
      "SELECT 1 FROM terminals WHERE id=$1 AND controller_until>clock_timestamp() AND deadline>clock_timestamp()",
      [t.id],
    )
  ).rowCount;
  if (!live)
    throw new HarborError(
      409,
      "CONTROLLER_EXPIRED",
      "Terminal control lease expired",
    );
}
export async function controlRate(db: PoolClient, t: any) {
  const r = await db.query(
    "UPDATE terminals SET control_count=CASE WHEN control_window IS NULL OR control_window<=clock_timestamp()-interval '1 second' THEN 1 ELSE control_count+1 END,control_window=CASE WHEN control_window IS NULL OR control_window<=clock_timestamp()-interval '1 second' THEN clock_timestamp() ELSE control_window END WHERE id=$1 AND (control_window IS NULL OR control_window<=clock_timestamp()-interval '1 second' OR control_count<4) RETURNING id",
    [t.id],
  );
  if (!r.rowCount)
    throw new HarborError(
      429,
      "CONTROL_RATE_LIMIT",
      "Terminal controls are limited to four per second",
    );
}
export async function acquireControl(
  db: PoolClient,
  t: any,
  actor: string,
  b: any,
) {
  if (t.state !== "running") throw gone();
  if (
    Number(t.generation) !== b.generation ||
    Number(t.controller_epoch) !== b.expectedEpoch
  )
    throw new HarborError(
      409,
      "CONTROLLER_STALE",
      "Control changed; refresh before taking control",
    );
  if (t.input_uncertain && !b.acknowledgeUncertainInput)
    throw new HarborError(
      409,
      "INPUT_UNCERTAIN",
      "Acknowledge uncertain input before taking control",
    );
  if (
    !(
      await db.query(
        "SELECT 1 FROM terminals WHERE id=$1 AND deadline>clock_timestamp()",
        [t.id],
      )
    ).rowCount
  )
    throw gone();
  await controlRate(db, t);
  const controllerId = randomUUID();
  const row = (
    await db.query(
      "UPDATE terminals SET controller_actor=$2,controller_id=$3,controller_epoch=controller_epoch+1,controller_until=clock_timestamp()+interval '20 seconds',input_sequence=0,input_uncertain=false,resize_sequence=0,resize_pending=false,heartbeat_at=NULL,input_frame_window=NULL,input_frames=0 WHERE id=$1 RETURNING controller_epoch,controller_until",
      [t.id, actor, controllerId],
    )
  ).rows[0];
  return {
    controllerId,
    epoch: Number(row.controller_epoch),
    until: row.controller_until,
    generation: Number(t.generation),
    sequence: 0,
  };
}
export function decodeInput(data: string) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  )
    throw new HarborError(
      400,
      "INVALID_INPUT",
      "Input must be canonical base64",
    );
  const bytes = Buffer.from(data, "base64");
  if (
    bytes.length < 1 ||
    bytes.length > 4096 ||
    bytes.toString("base64") !== data
  )
    throw new HarborError(
      413,
      "INPUT_LIMIT",
      "Input must contain 1–4096 bytes",
    );
  return bytes;
}
export const inputView = (r: any) => ({
  epoch: Number(r.epoch),
  sequence: Number(r.sequence),
  state: r.state,
  failureCode: r.failure_code,
});
export async function inputOutcome(
  db: PoolClient,
  t: any,
  actor: string,
  b: any,
) {
  const bytes = decodeInput(b.data),
    hash = digest(bytes.toString("base64"));
  const old = (
    await db.query(
      "SELECT * FROM terminal_input WHERE terminal_id=$1 AND epoch=$2 AND sequence=$3",
      [t.id, b.epoch, b.sequence],
    )
  ).rows[0];
  if (old) {
    if (
      old.hash !== hash ||
      old.actor_hash !== actor ||
      old.controller_id !== b.controllerId ||
      Number(t.generation) !== b.generation
    )
      throw new HarborError(
        409,
        "INPUT_CONFLICT",
        "Sequence already identifies different input",
      );
    return inputView(old);
  }
  if (Number(t.generation) !== b.generation)
    throw new HarborError(409, "TERMINAL_STATE", "Terminal generation changed");
  return {
    epoch: b.epoch,
    sequence: b.sequence,
    state:
      b.epoch < Number(t.controller_epoch) ||
      (b.epoch === Number(t.controller_epoch) &&
        b.sequence <= Number(t.input_sequence))
        ? "expired"
        : "missing",
    failureCode: null,
  };
}
export async function acceptInput(
  db: PoolClient,
  t: any,
  actor: string,
  b: any,
) {
  const outcome = await inputOutcome(db, t, actor, b);
  if (!["missing", "expired"].includes(outcome.state)) return outcome;
  const bytes = decodeInput(b.data),
    hash = digest(bytes.toString("base64"));
  await requireController(db, t, actor, b);
  if (b.sequence <= Number(t.input_sequence))
    throw new HarborError(
      410,
      "INPUT_OUTCOME_EXPIRED",
      "Old input outcome expired; input will not be replayed",
    );
  if (b.sequence !== Number(t.input_sequence) + 1)
    throw new HarborError(
      409,
      "INPUT_SEQUENCE_GAP",
      "Reconcile the preceding input before sending more",
    );
  const pending = (
    await db.query(
      "SELECT count(*) AS rows,coalesce(sum(octet_length(bytes)),0) AS bytes FROM terminal_input WHERE terminal_id=$1 AND state IN ('accepted','dispatching')",
      [t.id],
    )
  ).rows[0];
  if (
    Number(pending.rows) >= 128 ||
    Number(pending.bytes) + bytes.length > 65536
  )
    throw new HarborError(
      429,
      "INPUT_PENDING_LIMIT",
      "Terminal pending input capacity reached",
    );
  const rate = (
    await db.query(
      "UPDATE terminals SET input_bytes=CASE WHEN input_window>clock_timestamp()-interval '1 minute' THEN input_bytes ELSE 0 END,input_window=CASE WHEN input_window>clock_timestamp()-interval '1 minute' THEN input_window ELSE clock_timestamp() END,input_frames=CASE WHEN input_frame_window>clock_timestamp()-interval '1 second' THEN input_frames ELSE 0 END,input_frame_window=CASE WHEN input_frame_window>clock_timestamp()-interval '1 second' THEN input_frame_window ELSE clock_timestamp() END WHERE id=$1 RETURNING input_bytes,input_frames",
      [t.id],
    )
  ).rows[0];
  if (
    Number(rate.input_bytes) + bytes.length > 262144 ||
    Number(rate.input_frames) >= 20
  )
    throw new HarborError(
      429,
      "INPUT_RATE_LIMIT",
      "Terminal input rate limit reached",
    );
  await db.query(
    "UPDATE terminals SET input_sequence=$2,input_bytes=input_bytes+$3,input_frames=input_frames+1 WHERE id=$1",
    [t.id, b.sequence, bytes.length],
  );
  const input = (
    await db.query(
      "INSERT INTO terminal_input(terminal_id,epoch,sequence,actor_hash,controller_id,hash,bytes,state) VALUES($1,$2,$3,$4,$5,$6,$7,'accepted') RETURNING *",
      [t.id, b.epoch, b.sequence, actor, b.controllerId, hash, bytes],
    )
  ).rows[0];
  return inputView(input);
}
export async function pruneInput(db: PoolClient, id: string) {
  await db.query(
    "DELETE FROM terminal_input WHERE terminal_id=$1 AND (epoch,sequence) IN (SELECT epoch,sequence FROM terminal_input WHERE terminal_id=$1 AND state IN ('delivered','denied','uncertain') ORDER BY epoch DESC,sequence DESC OFFSET 128)",
    [id],
  );
}
export async function resize(db: PoolClient, t: any, actor: string, b: any) {
  await requireController(db, t, actor, b);
  if (b.sequence < Number(t.resize_sequence))
    throw new HarborError(
      410,
      "RESIZE_EXPIRED",
      "Old resize will not be replayed",
    );
  if (b.sequence === Number(t.resize_sequence)) {
    if (t.resize_cols !== b.cols || t.resize_rows !== b.rows)
      throw new HarborError(409, "RESIZE_CONFLICT", "Resize sequence changed");
    return { accepted: true };
  }
  const rate = (
    await db.query(
      "UPDATE terminals SET resize_count=CASE WHEN resize_window>clock_timestamp()-interval '1 second' THEN resize_count ELSE 0 END,resize_window=CASE WHEN resize_window>clock_timestamp()-interval '1 second' THEN resize_window ELSE clock_timestamp() END WHERE id=$1 RETURNING resize_count",
      [t.id],
    )
  ).rows[0];
  if (rate.resize_count >= 4)
    throw new HarborError(
      429,
      "RESIZE_RATE_LIMIT",
      "Resize rate limit reached",
    );
  await db.query(
    "UPDATE terminals SET resize_sequence=$2,resize_cols=$3,resize_rows=$4,resize_pending=true,resize_count=resize_count+1 WHERE id=$1",
    [t.id, b.sequence, b.cols, b.rows],
  );
  return { accepted: true };
}
export async function heartbeat(db: PoolClient, t: any, actor: string, b: any) {
  await requireController(db, t, actor, b);
  const result = await db.query(
    "UPDATE terminals SET heartbeat_at=clock_timestamp(),controller_until=least(deadline,clock_timestamp()+interval '20 seconds') WHERE id=$1 AND (heartbeat_at IS NULL OR heartbeat_at<=clock_timestamp()-interval '5 seconds') RETURNING controller_until",
    [t.id],
  );
  if (!result.rowCount)
    throw new HarborError(
      429,
      "HEARTBEAT_RATE_LIMIT",
      "Heartbeat too frequent",
    );
  return { until: result.rows[0].controller_until };
}
export async function pruneOutput(db: PoolClient, id: string) {
  const removed = await db.query(
    "WITH ranked AS (SELECT sequence,created_at,row_number() OVER(ORDER BY sequence DESC) AS n,sum(octet_length(bytes)) OVER(ORDER BY sequence DESC) AS total FROM terminal_output WHERE terminal_id=$1),removed AS (DELETE FROM terminal_output WHERE terminal_id=$1 AND sequence IN (SELECT sequence FROM ranked WHERE n>256 OR total>2097152 OR created_at<=clock_timestamp()-interval '24 hours') RETURNING sequence) SELECT max(sequence) AS floor FROM removed",
    [id],
  );
  if (removed.rows[0].floor !== null)
    await db.query(
      "UPDATE terminals SET output_floor=greatest(output_floor,$2) WHERE id=$1",
      [id, removed.rows[0].floor],
    );
}
export async function outputSnapshot(db: PoolClient, t: any, cursor: number) {
  await pruneOutput(db, t.id);
  const fresh = await terminalRow(db, t.id),
    floor = Number(fresh.output_floor),
    latest = Number(fresh.output_sequence);
  if (cursor > latest)
    throw new HarborError(
      400,
      "CURSOR_INVALID",
      "Output cursor is ahead of this terminal",
    );
  const rows = (
    await db.query(
      "SELECT sequence,bytes FROM terminal_output WHERE terminal_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 16",
      [t.id, Math.max(cursor, floor)],
    )
  ).rows;
  return {
    generation: Number(t.generation),
    floor,
    latest,
    gap: cursor < floor,
    lost: fresh.output_lost,
    cursor: rows.length
      ? Number(rows.at(-1).sequence)
      : Math.max(cursor, floor),
    chunks: rows.map((r) => ({
      sequence: Number(r.sequence),
      data: r.bytes.toString("base64"),
    })),
  };
}

export async function maintainTerminalOutput(pool: Pool) {
  const expired = await pool.query(
    "SELECT DISTINCT terminal_id FROM terminal_output WHERE created_at<=clock_timestamp()-interval '24 hours' LIMIT 256",
  );
  for (const row of expired.rows)
    await transaction(pool, async (db) => {
      await lockTerminalResource(db, row.terminal_id);
      await pruneOutput(db, row.terminal_id);
    });
}
