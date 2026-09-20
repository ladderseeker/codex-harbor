import type { Message } from "../../../packages/contracts/src/index.ts";

export type ConversationEntry =
  | { kind: "message"; id: string; message: Message }
  | { kind: "activity"; id: string; messages: Message[] };

/** Preserve order and operation boundaries; absent ownership never combines records. */
export function groupConversationMessages(
  messages: Message[],
): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  for (const message of messages) {
    const previous = entries.at(-1);
    if (message.role !== "tool")
      entries.push({ kind: "message", id: message.id, message });
    else if (
      message.operationId &&
      previous?.kind === "activity" &&
      previous.messages[0]?.operationId === message.operationId
    )
      previous.messages.push(message);
    else
      entries.push({ kind: "activity", id: message.id, messages: [message] });
  }
  return entries;
}

export function ConversationActivity({ messages }: { messages: Message[] }) {
  const running = messages.some((message) => message.status === "streaming");
  return (
    <details className="conversation-activity">
      <summary>
        {messages.length} {messages.length === 1 ? "command" : "commands"} ·{" "}
        {running ? "Running…" : "Completed"}
      </summary>
      <div className="activity-details">
        {messages.map((message, index) => (
          <section key={message.id} aria-label={`Command ${index + 1}`}>
            <p className="activity-label">
              Command {index + 1} ·{" "}
              {message.status === "streaming" ? "Running…" : "Result"}
            </p>
            <pre className="message-text" tabIndex={0}>
              {message.text}
            </pre>
          </section>
        ))}
        <small>
          Command output is limited to 32 KiB per command and 256 KiB per
          conversation.
        </small>
      </div>
    </details>
  );
}
