# P030 — Composer and conversation flow

## Metadata

- ID: P030
- Status: Draft
- Priority: Medium, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: The owner can queue a follow-up while Codex works, new conversations start with the settings last used in that project, and conversations that finished, failed or wait for an answer show it in the sidebar and tab title and, with opt-in, through a browser notification.
- Authorization: Proposal writing only. Implementation, commits to `main` and deployment need the owner's separate go-ahead.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529` and the fixture walkthrough recorded in the [review](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough).
- Dependencies: None required. [P028](028-live-conversation-streaming.md) makes attention signals cheaper but is not needed for them.
- Source issues: None.
- Design references: [Conversations and access](../systems/001-conversations-and-access.md), [interface](../systems/006-interface.md), [UI guide](../design-tokens.html), [prototype](../prototypes/harbor-redesign.html).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P030-01–P030-06.

## Problem, outcome and exclusions

The review's [walkthrough](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough) found three everyday workflow gaps, marked P030:

- While a turn runs, Send becomes Cancel turn and the help line says "Wait for this turn to finish before sending another message.", so a follow-up can be typed but not sent. The API already accepts such a turn and queues it with the `session_busy` reason; only the browser refuses.
- Each new conversation starts from the first permission profile, `read-only`, and the default model and effort, so the owner re-selects "Edit project files" and other settings every time.
- Nothing outside the open conversation shows that a turn finished, failed or needs an answer, while unanswered approvals expire after five minutes.

After this change:

1. **Queue follow-ups.** Sending while a turn runs creates a queued turn, shown as a queued message with a Cancel action that uses the existing cancellation route. Queued turns start in order.
2. **Remembered settings.** A new conversation in a project starts with that project's last accepted model, effort and permission profile, within the server's current ceiling.
3. **Attention marks.** The sidebar marks a conversation whose latest turn finished or failed since the owner last viewed it, and one that waits for an approval or an answer. A waiting mark stays until the request is answered or no longer applies, even after the owner views the conversation. The tab title shows the number of marked conversations.
4. **Notifications.** After the owner opts in, the browser shows a notification when a request needs an answer or a turn finishes, while any Harbor tab is open. Selecting it opens the conversation.

Excluded: steering a running turn, which needs adapter contract and live evidence and may follow as its own plan; push notifications with a service worker; how long approvals wait and how answers are delivered, owned by [P019](019-durable-approval-waiting-and-delivery.md); transcript records of approvals, answers and cancellations, owned by [P029](029-complete-conversation-transcript.md); the empty-conversation behavior of New chat, owned by [P020](020-new-conversation-drafts.md); and wording, hidden controls, sign-in pages, the approval card's expiry notice and phone layout, owned by [P033](033-interface-clarity-and-phone-fit.md).

## Dependencies and current design

The conversation design already serializes one active turn per conversation and queues later input with a `session_busy` reason; this plan exposes that in the browser. Attention state is new: the design gains a per-conversation "viewed through" event sequence stored on the server, so marks agree across the owner's devices.

P019's own attention records, which the owner closes after reading a decision's outcome, stay separate from these marks. When P019 lets requests wait longer, the waiting mark follows the same rule: it stays while a request can still be answered.

## Source issues

None.

## User and API flows

1. The owner sends a follow-up during a turn. It appears as queued with Cancel. It starts when the current turn ends; Cancel before then removes it without effect.
2. The owner opens New chat in a project and sees the settings used for that project's last accepted turn.
3. A turn finishes in another conversation. Its sidebar row shows a mark and the tab title shows "(1)". Opening it clears the mark on every device.
4. An approval request arrives in another conversation. Its row shows a waiting mark, which stays after the owner opens the conversation and clears once the owner answers.
5. The owner opts in to notifications from Settings. A request in any conversation shows a browser notification that opens that conversation.

The queued message, attention marks and the notification setting are new states and must be specified in the UI guide and demonstrated in the prototype before application use.

## Contracts, state and security

- **Queue.** No new route. The browser uses the existing turn and cancel routes and shows queue reasons from operation state.
- **Preferences.** Projects store the model, effort and permission of their last accepted turn. Admission still validates them against the current ceiling and model list.
- **Attention.** Sessions store the owner's viewed-through sequence, updated by an idempotent, CSRF-protected route when the owner views a conversation. Listings return an attention state derived on the server: waiting while an approval or input request is pending, otherwise finished or failed when the latest turn ended after the viewed-through sequence.
- **Notifications.** Use the browser Notification API only after an explicit opt-in. Notification text names only the event kind, such as "A conversation needs your answer". It never includes a conversation title, because automatic titles come from the owner's first message, or any message content.

## Implementation brief

Settle the attention rule and the preference storage with the UI guide and prototype first, then implement API, storage and browser changes together.

## Exact file fence

- `design/proposals/030-composer-and-conversation-flow.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/api/src/server.ts`
- `apps/api/src/history.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/History.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/styles.css`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `packages/storage/src/turns.ts`
- `packages/storage/src/migrations/023_conversation_flow.sql`
- `tests/integration/conversation-flow.test.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p014.ts`
- `tests/e2e/p030.ts`
- `docs/user/conversations.md`

Main renumbers the migration if another plan claims 023 first.

## Verification and acceptance

- **P030-01:** A follow-up sent during a running turn is queued, shown with Cancel and starts after the turn; a cancelled follow-up never starts.
- **P030-02:** A new conversation uses the project's last accepted settings; a setting above the current ceiling is refused with an explanation.
- **P030-03:** A finished or failed conversation shows a mark and a title count, cleared on viewing, and the cleared state appears in a second browser context. A conversation waiting for an approval keeps its mark after viewing and loses it once answered or expired.
- **P030-04:** With notifications allowed in the test browser, an approval request and a finished turn produce notifications that contain neither a conversation title nor message content; without opt-in, none appear.
- **P030-05:** The attention route rejects a request without a valid CSRF token, repeating a request changes nothing, and a stale viewed-through sequence from another tab or device never moves the mark backwards.
- **P030-06:** `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e --design` with P030's scenarios, the full critical `pnpm test:e2e`, and the P018 concurrency and P024 attachment lanes pass.

Gate: behavioral. No launch, sandbox or adapter change.

## Rollout and recovery

The migration is additive and needs `allow_new_migrations` and a checkpoint. Existing conversations start with no attention marks, and projects without a stored preference keep today's defaults.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
