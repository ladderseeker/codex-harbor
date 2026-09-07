import type { DB } from "./index.ts";
import { HarborError } from "../../policy/src/index.ts";
/** Caller holds the session lock. Outstanding turn slots cannot be spent by another control. */
export async function capacity(
  db: DB,
  id: string,
  kind: "turn" | "recovery" | "cancel",
) {
  const r = (
    await db.query(
      `SELECT (SELECT history_ceiling FROM sessions WHERE id=$1) AS ceiling,(SELECT count(*) FROM operations WHERE session_id=$1)+(SELECT count(*) FROM session_recoveries WHERE session_id=$1) AS retained,(SELECT count(*) FROM operations t WHERE t.session_id=$1 AND t.kind='turn' AND t.state IN ('queued','dispatching','running','waiting_approval','waiting_input') AND NOT EXISTS(SELECT 1 FROM operations c WHERE c.session_id=$1 AND c.kind='cancel' AND c.payload->>'operationId'=t.id::text)) AS reserved`,
      [id],
    )
  ).rows[0];
  const retained = Number(r.retained),
    reserved = Number(r.reserved);
  if (
    (kind === "turn" && retained >= 400) ||
    retained +
      (kind === "turn" ? 2 : 1) +
      Math.max(0, reserved - (kind === "cancel" ? 1 : 0)) +
      (kind === "recovery" ? 0 : 1) >
      Number(r.ceiling)
  )
    throw new HarborError(
      429,
      "HISTORY_QUOTA",
      "Conversation history capacity reached; existing reserved controls and emergency stop remain available",
    );
}
