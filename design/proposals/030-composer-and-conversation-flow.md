# P030 — Composer and conversation flow

## Metadata

- ID: P030
- Status: Draft
- Priority: P2, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Everyday chatting needs no workarounds: the owner can queue a follow-up while Codex works, new conversations start with the settings last used in that project, finished or blocked conversations announce themselves, signing in starts from the bare site address, every state explains the next step in plain words, and the interface fits a phone.
- Authorization: Proposal writing only. Implementation, commits to `main` and deployment need the owner's separate go-ahead.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529` and the fixture walkthrough recorded in the [review](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough).
- Dependencies: None required. [P028](028-live-conversation-streaming.md) makes attention signals cheaper but is not needed for them.
- Source issues: None.
- Design references: [Conversations and access](../systems/001-conversations-and-access.md), [interface](../systems/006-interface.md), [UI guide](../design-tokens.html), [prototype](../prototypes/harbor-redesign.html), [public access and identity](../architecture.md#public-access-and-identity).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P030-01–P030-09.

## Problem, outcome and exclusions

The review's [walkthrough](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough) found many small frictions that add up; this plan takes every item it marks P030. The main ones:

- While a turn runs, the composer is disabled with "Wait for this turn to finish before sending another message." The API already accepts and queues such a turn; only the browser refuses.
- Each new conversation starts from the first permission profile, `read-only`, and the default model and effort, so the owner re-selects "Edit project files" and other settings every time.
- Nothing signals that a turn finished, failed or needs an approval unless the owner is looking at that conversation. Unanswered approvals expire after five minutes.
- A signed-out visit to the site's address returns a JSON 401 error instead of the sign-in page, so the owner must bookmark `/auth/login`.
- Some states use internal terms, such as "Native runtime delivery is uncertain", "Fence old runtime and inspect history" and "retirement", and the personal VPS setup prompt asks for an API key that this profile never uses.
- Like and dislike buttons under replies store nothing, and user messages carry two decorative thumb icons.
- Controls meant to be hidden still show, because the stylesheet's `button` display rule overrides the `hidden` attribute. In the personal VPS the project dialog therefore offers workspace, file and terminal tools that the profile cannot use.
- In the personal VPS, an uncertain conversation refuses every new turn and has no recovery by design, but the page only says that automatic recovery is unavailable and replaces the composer with settings for "the separate new operation".
- Sign-in failures show raw JSON, New chat is disabled without a reason during first-run setup, and a new project's empty list reads "No matching conversations".
- On a phone, composer controls are 26 to 30 px tall, menus in the navigation drawer are cut off, dialog actions fall below the fold, and hidden text makes the page taller than the window, so it can shift out of place.

After this change:

1. **Queue follow-ups.** Sending while a turn runs creates a queued turn, shown as a queued message with a Cancel action that uses the existing cancellation route. Queued turns start in order.
2. **Remembered settings.** A new conversation in a project starts with that project's last accepted model, effort and permission profile, within the server's ceiling.
3. **Attention.** The sidebar marks conversations whose latest turn finished, failed or waits for an answer since the owner last viewed them. The tab title shows the count. With the owner's explicit opt-in, the browser shows a notification for approvals, input requests and finished turns while any Harbor tab is open.
4. **Sign-in.** A browser navigation to `/` without a session redirects to `/auth/login`. API routes keep their JSON 401.
5. **Plain language.** Every conversation state and recovery panel names what happened and the next available action in plain words, and the setup prompt matches the profile. An uncertain personal VPS conversation says that its last request may or may not have run and offers a new conversation in the same project. Sign-in failures and first-run steps show a page with a way forward, empty states read as empty, and each control has one name everywhere.
6. **Fewer false controls.** Like and dislike, and the user-message thumb icons, are removed; copy stays. Controls marked hidden stay hidden.
7. **Home-screen install.** A web app manifest and icons let the owner add Harbor to a phone home screen.
8. **Phone fit.** Composer controls and menu items meet a 44 px touch target, menus stay inside the screen, dialog actions stay visible, a streaming reply shows one status line, and the page itself never scrolls out of place.

Excluded: steering a running turn, which needs adapter contract and live evidence and may follow as its own plan; continuing an uncertain personal VPS conversation, which needs its own recovery design; push notifications with a service worker; the empty-conversation behavior of New chat, owned by [P020](020-new-conversation-drafts.md); approval waiting, owned by [P019](019-durable-approval-waiting-and-delivery.md); and transcript content, including records of approvals, answers and cancellations, owned by [P029](029-complete-conversation-transcript.md).

## Dependencies and current design

The conversation design already serializes one active turn per conversation and queues later input with a `session_busy` reason; this plan exposes that in the browser. Attention state is new: the design gains a per-conversation "viewed through" event sequence stored on the server, so marks agree across the owner's devices. The identity design keeps `/auth/login` as the entry point; the redirect only changes the response for signed-out HTML navigations.

## Source issues

None.

## User and API flows

1. The owner sends a follow-up during a turn. It appears as queued with Cancel. It starts when the current turn ends; Cancel before then removes it without effect.
2. The owner opens New chat in a project and sees the settings used for that project's last accepted turn.
3. A turn finishes in another conversation. Its sidebar row shows a mark and the tab title shows "(1)". Opening it clears the mark on every device.
4. The owner opts in to notifications from Settings. An approval request in any conversation shows a browser notification that opens that conversation.
5. A signed-out visit to the bare address lands on the identity provider's sign-in flow and returns to `/`.
6. In the personal VPS, an uncertain conversation stays readable and offers **New conversation** in the same project.

New states, the queued message, attention marks and the notification setting, must be specified in the UI guide and demonstrated in the prototype before application use.

## Contracts, state and security

- **Queue.** No new route. The browser uses the existing turn and cancel routes and shows queue reasons from operation state.
- **Preferences.** Projects store the last accepted model, effort and permission. Admission still validates them against the current ceiling and model list.
- **Attention.** Sessions store the owner's viewed-through sequence, updated by an idempotent, CSRF-protected route when the owner views a conversation. Listings return an attention flag derived from state and that sequence.
- **Redirect.** Only `GET` requests that accept HTML and target application pages redirect; every `/api/` route and asset keeps its current status. The redirect target is fixed, never taken from the request.
- **Notifications.** Use the browser Notification API only after an explicit opt-in. Notification text contains the conversation title and event kind, never message content.

## Implementation brief

Settle the attention marking rule and the preference storage with the UI guide and prototype first, then implement API, storage and browser changes together. Replace jargon strings with reviewed wording, listed in the design, and update tests that assert the removed controls.

## Exact file fence

- `design/proposals/030-composer-and-conversation-flow.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/api/src/server.ts`
- `apps/api/src/history.ts`
- `apps/web/index.html`
- `apps/web/public/manifest.webmanifest`
- `apps/web/public/icon-192.png`
- `apps/web/public/icon-512.png`
- `apps/web/src/App.tsx`
- `apps/web/src/Attachments.tsx`
- `apps/web/src/History.tsx`
- `apps/web/src/MessageActions.tsx`
- `apps/web/src/Credentials.tsx`
- `apps/web/src/Recovery.tsx`
- `apps/web/src/Workspaces.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/styles.css`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `packages/storage/src/migrations/023_conversation_attention.sql`
- `tests/integration/message-actions.test.ts`
- `tests/e2e/message-actions.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p014.ts`
- `tests/e2e/p023.ts`
- `tests/e2e/p030.ts`
- `docs/user/conversations.md`

Main renumbers the migration if another plan claims 023 first.

## Verification and acceptance

- **P030-01:** A follow-up sent during a running turn is queued, shown with Cancel and starts after the turn; a cancelled follow-up never starts.
- **P030-02:** A new conversation uses the project's last accepted settings; a setting above the current ceiling is refused with an explanation.
- **P030-03:** A finished, failed or waiting conversation shows a mark and a title count, cleared on viewing, and the cleared state appears in a second browser context.
- **P030-04:** With notifications allowed in the test browser, an approval request and a finished turn produce notifications without message content; without opt-in, none appear.
- **P030-05:** A signed-out HTML request to `/` redirects to `/auth/login`; signed-out `/api/v1/me` still returns 401 JSON; the redirect target cannot be influenced by the request.
- **P030-06:** Every state and recovery panel string on the reviewed list is replaced; the personal VPS setup prompt no longer mentions an API key; a denied identity and a signed-out visit reach pages with a way forward; a disabled New chat and a new project's empty list explain themselves; and an uncertain personal VPS conversation offers a new conversation.
- **P030-07:** Like, dislike and decorative thumbs are gone; copy works for user and assistant messages; no element with the `hidden` attribute is visible, and the personal VPS project dialog shows no workspace, file or terminal tool.
- **P030-08:** At 390 × 844 with touch, composer controls and menu items have targets of at least 44 px, menus opened in the navigation drawer are fully visible, dialog actions are visible without scrolling, a streaming reply shows one status line, and focusing or scrolling any element never scrolls the page itself. Desktop layout, keyboard focus and the manifest pass the design lane.
- **P030-09:** `pnpm build`, `pnpm check`, `pnpm test`, the design E2E lane with P030's scenarios and the P018 and P024 lanes pass.

Gate: behavioral. No launch, sandbox or adapter change.

## Rollout and recovery

The migration is additive and needs `allow_new_migrations` and a checkpoint. Existing conversations start with no attention marks.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
