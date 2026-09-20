import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  groupConversationMessages,
  ConversationActivity,
} from "../../apps/web/src/ConversationActivity.tsx";
import type { Message } from "../../packages/contracts/src/index.ts";
const message = (
  id: string,
  operationId: string | null,
  role: Message["role"] = "tool",
): Message => ({
  id,
  operationId,
  role,
  text: "<script>literal</script>\n  diagnostic",
  status: "complete",
  createdAt: "",
});
test("activity groups consecutive tools only within known matching operations", () => {
  const groups = groupConversationMessages([
    message("a", "1"),
    message("b", "1"),
    message("c", "2"),
    message("d", "2", "assistant"),
    message("e", "2"),
    message("f", null),
    message("g", null),
    message("h", "2", "system"),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.kind, g.id]),
    [
      ["activity", "a"],
      ["activity", "c"],
      ["message", "d"],
      ["activity", "e"],
      ["activity", "f"],
      ["activity", "g"],
      ["message", "h"],
    ],
  );
  const first = groups[0];
  assert.equal(first.kind === "activity" && first.messages.length, 2);
});
test("activity starts closed while streaming, keeps literal diagnostics and stable first-record identity", () => {
  const messages = [
    message("a", "1"),
    { ...message("b", "1"), status: "streaming" },
  ];
  const html = renderToStaticMarkup(
    createElement(ConversationActivity, { messages }),
  );
  assert.match(html, /2 commands · Running/);
  assert.doesNotMatch(html, /<details[^>]*open|<script>|Harbor message|<time/);
  assert.match(html, /&lt;script&gt;literal&lt;\/script&gt;/);
  assert.equal(
    groupConversationMessages(messages)[0].id,
    groupConversationMessages([...messages, message("c", "1")])[0].id,
  );
});
