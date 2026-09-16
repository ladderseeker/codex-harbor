import type {
  Message,
  Operation,
} from "../../../packages/contracts/src/index.ts";

/** One action bar per settled turn, anchored to its final assistant body fragment. */
export function completedAssistantResponses(
  messages: Message[],
  operations: Operation[],
): Map<string, string> {
  const turns = new Map(
    operations
      .filter((operation) => operation.kind === "turn")
      .map((operation) => [operation.id, operation.state]),
  );
  const groups = new Map<string, Message[]>();
  let legacyTurn = "initial";
  for (const message of messages) {
    if (message.role === "user") legacyTurn = message.id;
    if (message.role !== "assistant") continue;
    const key = message.operationId ?? `legacy:${legacyTurn}`;
    const fragments = groups.get(key) ?? [];
    fragments.push(message);
    groups.set(key, fragments);
  }
  const result = new Map<string, string>();
  for (const fragments of groups.values()) {
    const last = fragments.at(-1)!;
    const operationState = last.operationId
      ? turns.get(last.operationId)
      : undefined;
    const settled = operationState
      ? ["succeeded", "failed", "interrupted", "cancelled"].includes(
          operationState,
        )
      : !last.operationId;
    if (!settled || fragments.some((message) => message.status === "streaming"))
      continue;
    const text = fragments.map((message) => message.text).join("\n\n");
    if (text) result.set(last.id, text);
  }
  return result;
}
