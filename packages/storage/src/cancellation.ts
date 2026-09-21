import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { HarborError } from "../../policy/src/index.ts";
import { capacity } from "./capacity.ts";
import { event } from "./index.ts";
import { lockSessionResource } from "./session-lock.ts";
export async function requestTurnCancellation(
  db: PoolClient,
  turnId: string,
  options: {
    actor: string;
    operationId?: string;
    authorize: (db: PoolClient) => Promise<void>;
  },
) {
  const found = await db.query(
    "SELECT session_id FROM operations WHERE id=$1",
    [turnId],
  );
  if (!found.rowCount)
    throw new HarborError(404, "NOT_FOUND", "Turn not found");
  await lockSessionResource(db, found.rows[0].session_id);
  const r = await db.query("SELECT * FROM operations WHERE id=$1 FOR UPDATE", [
    turnId,
  ]);
  const o = r.rows[0];
  if (!o || o.kind !== "turn")
    throw new HarborError(404, "NOT_FOUND", "Turn not found");
  if (
    ![
      "queued",
      "dispatching",
      "running",
      "waiting_approval",
      "waiting_input",
    ].includes(o.state)
  )
    throw new HarborError(
      409,
      "TURN_TERMINAL",
      "This turn is no longer cancellable",
    );
  await options.authorize(db);
  const pending = await db.query(
    "SELECT id,state,control_attempts FROM operations WHERE session_id=$1 AND kind='cancel' AND payload->>'operationId'=$2 LIMIT 1",
    [o.session_id, o.id],
  );
  if (pending.rows[0] && pending.rows[0].state !== "failed")
    return {
      operation: pending.rows[0],
      message: "Stop already requested; interruption is not yet confirmed",
    };
  if (pending.rows[0]) {
    if (pending.rows[0].control_attempts >= 3)
      throw new HarborError(
        429,
        "CONTROL_ATTEMPTS",
        "Cancellation attempts exhausted; use emergency stop",
      );
    await db.query(
      "UPDATE operations SET state='queued',actor_hash=$2,control_attempts=control_attempts+1,updated_at=now() WHERE id=$1",
      [pending.rows[0].id, options.actor],
    );
    return {
      operation: { id: pending.rows[0].id, state: "queued" },
      message: "Stop requested again",
    };
  }
  await capacity(db, o.session_id, "cancel");
  const id = options.operationId ?? randomUUID();
  await db.query(
    "INSERT INTO operations(id,session_id,kind,state,payload,actor_hash) VALUES($1,$2,'cancel','queued',$3,$4)",
    [id, o.session_id, JSON.stringify({ operationId: o.id }), options.actor],
  );
  await event(db, o.session_id, "cancel.requested", {
    operationId: o.id,
  });
  return {
    operation: { id, state: "queued" },
    message: "Stop requested; interruption is not yet confirmed",
  };
}
