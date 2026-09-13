import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { event } from "../../../packages/storage/src/index.ts";

const commandLimit = 32768;
function bounded(text: string, limit = commandLimit) {
  const bytes = Buffer.from(text);
  return bytes.length <= limit
    ? text
    : bytes.subarray(0, limit - 100).toString("utf8") +
        "\n[Command output truncated at 32 KiB]";
}

// Called under the session lock and the active operation generation fence.
// Native completed items are authoritative: deltas may be partial or absent.
export async function saveConversationOutput(
  db: PoolClient,
  sessionId: string,
  operationId: string,
  method: string,
  p: any,
) {
  const item = p.item;
  const assistantDelta = method === "item/agentMessage/delta";
  const commandDelta = method === "item/commandExecution/outputDelta";
  const assistantFinal =
    method === "item/completed" && item?.type === "agentMessage";
  const commandItem =
    ["item/started", "item/completed"].includes(method) &&
    item?.type === "commandExecution";
  if (!assistantDelta && !assistantFinal && !commandDelta && !commandItem)
    return;
  const itemId = item?.id ?? p.itemId;
  if (typeof itemId !== "string" || !itemId)
    throw Error("Missing native output item id");
  const existing = (
    await db.query(
      "SELECT text,role,operation_id,status FROM messages WHERE session_id=$1 AND native_item_id=$2 FOR UPDATE",
      [sessionId, itemId],
    )
  ).rows[0];
  const role = assistantDelta || assistantFinal ? "assistant" : "tool";
  if (
    existing &&
    (existing.operation_id !== operationId || existing.role !== role)
  )
    throw Error("Native output item ownership mismatch");
  if (
    (assistantDelta || commandDelta || method === "item/started") &&
    existing?.status === "complete"
  )
    return;
  let text: string;
  if (assistantDelta || commandDelta) {
    if (typeof p.delta !== "string") throw Error("Invalid native output delta");
    text = (existing?.text ?? "") + p.delta;
  } else if (assistantFinal) {
    if (typeof item.text !== "string") throw Error("Invalid native message");
    text = item.text;
  } else {
    const heading = `$ ${item.command}\nDirectory: ${item.cwd}\n`;
    text =
      typeof item.aggregatedOutput === "string"
        ? heading + item.aggregatedOutput
        : (existing?.text ?? heading);
    if (method === "item/completed")
      text =
        bounded(text, commandLimit - 256) +
        `\nStatus: ${item.status}; exit code: ${item.exitCode ?? "unavailable"}`;
  }
  if (role === "tool") text = bounded(text);
  const total = (
    await db.query(
      "SELECT coalesce(sum(octet_length(text)),0) AS bytes,count(*) AS count,coalesce(sum(octet_length(text)) FILTER (WHERE role='tool'),0) AS tool_bytes FROM messages WHERE session_id=$1",
      [sessionId],
    )
  ).rows[0];
  const added =
    Buffer.byteLength(text) - Buffer.byteLength(existing?.text ?? "");
  // Command diagnostics must not consume the final response's storage budget.
  if (
    role === "tool" &&
    (Number(total.tool_bytes) + added > 262144 ||
      Number(total.bytes) + added > 2097152 ||
      (!existing && Number(total.count) >= 1900))
  ) {
    const notice =
      "Further command diagnostics are omitted: the conversation output limit was reached. Assistant responses continue separately.";
    if (
      Number(total.bytes) + Buffer.byteLength(notice) <= 2097152 &&
      Number(total.count) < 2000
    ) {
      const saved = await db.query(
        "INSERT INTO messages(id,session_id,operation_id,native_item_id,role,text,status) VALUES($1,$2,$3,$4,'system',$5,'complete') ON CONFLICT(session_id,native_item_id) DO NOTHING RETURNING id",
        [
          randomUUID(),
          sessionId,
          operationId,
          "harbor-command-output-limit",
          notice,
        ],
      );
      if (saved.rowCount)
        await event(db, sessionId, "message.completed", { role: "system" });
    }
    return;
  }
  if (
    text.length > 262144 ||
    Number(total.bytes) + added > 2097152 ||
    (!existing && Number(total.count) >= 2000)
  )
    throw Error("Conversation output quota");
  const status = method === "item/completed" ? "complete" : "streaming";
  await db.query(
    "INSERT INTO messages(id,session_id,operation_id,native_item_id,role,text,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(session_id,native_item_id) DO UPDATE SET text=EXCLUDED.text,status=EXCLUDED.status",
    [randomUUID(), sessionId, operationId, itemId, role, text, status],
  );
  await event(
    db,
    sessionId,
    status === "complete" ? "message.completed" : "message.delta",
    {
      itemId,
      ...(assistantDelta ? { delta: p.delta } : { role }),
    },
  );
}
