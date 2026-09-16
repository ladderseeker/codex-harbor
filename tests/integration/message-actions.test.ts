import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageActions } from "../../apps/web/src/MessageActions.tsx";
import { completedAssistantResponses } from "../../apps/web/src/message-responses.ts";
import type { Message, Operation } from "../../packages/contracts/src/index.ts";
const message = (
  id: string,
  role: Message["role"],
  text: string,
  operationId: string | null = "turn",
  status = "complete",
): Message => ({
  id,
  role,
  text,
  operationId,
  status,
  createdAt: "2026-09-15T00:00:00Z",
});
const operation = (state: string): Operation => ({
  id: "turn",
  kind: "turn",
  state,
  sessionId: "session",
  createdAt: "",
  updatedAt: "",
});

test("copy targets one complete assistant turn with exact Markdown fragments and no tool or UI text", () => {
  const messages = [
    message("user", "user", "Question"),
    message("first", "assistant", "# Heading\n\n- item"),
    message("tool", "tool", "SECRET TOOL OUTPUT"),
    message("notice", "system", "State notice"),
    message(
      "last",
      "assistant",
      "```js\n  value();\n```\n\n[Link](https://example.com)",
    ),
  ];
  const responses = completedAssistantResponses(messages, [
    operation("succeeded"),
  ]);
  assert.deepEqual(
    [...responses],
    [
      [
        "last",
        "# Heading\n\n- item\n\n```js\n  value();\n```\n\n[Link](https://example.com)",
      ],
    ],
  );
});

test("intermediate completed fragments have no action bar while the turn is active or uncertain", () => {
  const messages = [message("first", "assistant", "Progress")];
  for (const state of [
    "queued",
    "dispatching",
    "running",
    "waiting_approval",
    "waiting_input",
    "uncertain",
  ])
    assert.equal(
      completedAssistantResponses(messages, [operation(state)]).size,
      0,
    );
  assert.equal(
    completedAssistantResponses(
      [message("first", "assistant", "Partial", "turn", "streaming")],
      [operation("succeeded")],
    ).size,
    0,
  );
  assert.equal(completedAssistantResponses(messages, []).size, 0);
});

test("separate turns and legacy replies never combine across user prompts", () => {
  const messages = [
    message("u1", "user", "Question", null),
    message("a1", "assistant", "Answer 1", null),
    message("u2", "user", "Question 2", null),
    message("a2", "assistant", "Answer 2", null),
  ];
  assert.deepEqual(
    [...completedAssistantResponses(messages, [])],
    [
      ["a1", "Answer 1"],
      ["a2", "Answer 2"],
    ],
  );
});

test("action markup uses keyboard-native controls in copy, like, dislike order", () => {
  const assistant = renderToStaticMarkup(
    createElement(MessageActions, { text: "Raw **body**", assistant: true }),
  );
  const labels = [
    ...assistant.matchAll(/<button[^>]*aria-label="([^"]+)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(labels, [
    "Copy response",
    "Like response",
    "Dislike response",
  ]);
  assert.equal([...assistant.matchAll(/aria-pressed="false"/g)].length, 2);
  const user = renderToStaticMarkup(
    createElement(MessageActions, { text: "User" }),
  );
  assert.equal([...user.matchAll(/<button/g)].length, 1);
  assert.match(user, /aria-label="Copy message"/);
});
