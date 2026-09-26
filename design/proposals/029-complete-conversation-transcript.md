# P029 — Complete conversation transcript

## Metadata

- ID: P029
- Status: Draft
- Priority: High, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: The conversation shows what Codex is doing and what it changed, and what the owner decided: reasoning summaries, plans, file edits with diffs, web searches, tool calls, approvals, answers and cancellations, and a short summary at the end of each turn, live and after reload.
- Authorization: Proposal writing only. Implementation, commits to `main` and deployment need the owner's separate go-ahead.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529` and the pinned Codex 0.153.4 generated protocol.
- Dependencies: [P028](028-live-conversation-streaming.md) must be Implemented first, because each new item type streams through its incremental event contract. A pinned-runtime contract run must confirm which notifications 0.153.4 actually emits for each item type; items that are never emitted are dropped from scope, not simulated.
- Source issues: [Conversation report downloads](../../issues/2026-09-20-120000-conversation-report-downloads.md), only its "discoverable conversation artifact references" obligation, shared with [P031](031-project-file-downloads.md); a partial transfer, so the issue stays in the inbox.
- Design references: [Conversations and access](../systems/001-conversations-and-access.md), [interface](../systems/006-interface.md), [UI guide](../design-tokens.html), [prototype](../prototypes/harbor-redesign.html), [architecture compatibility boundary](../architecture.md#official-foundation-and-compatibility-boundary).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P029-01–P029-11.

## Problem, outcome and exclusions

The pinned protocol defines 19 thread item types, plus turn-level plan, diff and token-usage notifications. Harbor's [output persistence](../../apps/supervisor/src/conversation-output.ts) keeps two of them: assistant text and command execution. Everything else is dropped. During a long turn the owner sees "working" and, at most, raw command output; afterwards there is no record of which files changed, what the plan was or which searches and tools ran. Reasoning summaries, which explain slow turns, never appear. This is the largest gap between Harbor and the official Codex clients.

After this change, the transcript persists and renders these items in order with the existing messages:

1. **Reasoning summaries**, collapsed by default and streamed while the model thinks. Raw reasoning content is not shown.
2. **Plans**, as a checklist that updates in place from `turn/plan/updated`.
3. **File changes**, listing each path with its kind and a collapsed diff, plus a per-turn aggregate diff from `turn/diff/updated`.
4. **Web searches, MCP tool calls and dynamic tool calls**, showing the query or tool, its status and bounded results.
5. **Context compaction** and **review-mode** markers, as one-line notices.
6. **A turn footer** with duration, files changed, commands run and token usage when the runtime reports it.
7. **Unknown or unsupported item types** as a neutral one-line row naming the type, so nothing disappears silently.
8. **Owner decisions**: each approval, decline, expiry, input answer, cancellation and interruption leaves a one-line record at its place in the turn. Today answered cards disappear and a cancelled request has no marker, as the review's [walkthrough](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough) found.

Excluded: approving individual hunks, reverting or undoing changes, image generation display, collaboration and sub-agent views, raw reasoning text, file downloads (P031) and any new permission.

## Dependencies and current design

The current conversation design persists assistant and tool messages as durable history with bounded tool output. This plan adds typed transcript items with the same ownership: rows belong to the conversation and operation, are written before their events and survive reload. Diffs and tool results count against the existing tool-output budget or a documented separate budget; they never consume the assistant text budget.

Adapter parsing stays inside the adapter boundary. The contract run named in Dependencies records, for 0.153.4, the notification sequence per item type and the fields present, and the design cites it.

## Source issues

From the report-download issue this plan takes only the obligation to make artifacts discoverable, covered by P029-03 and P029-10: a file-change row names each changed path, relative to the project when it is inside it. Linking those rows to downloads belongs to whichever of this plan and [P031](031-project-file-downloads.md) executes second: if P031 is already Implemented, this plan links each existing file row to P031's route; otherwise P031 adds the links. All other obligations stay with P031. This plan adds a dated note to the issue; the issue stays open until P031 completes the transfer.

## User and API flows

1. While a turn runs, new rows appear as their items start. Reasoning shows a one-line live status that expands to the summary. Plans update in place.
2. File-change rows list paths; expanding one shows its diff with added and removed lines styled by the existing token set. The turn footer links to the aggregate diff.
3. After reload, every row and footer is identical to the live view.
4. The snapshot and message-page routes from P028 return the new item kinds; API clients that only understand messages still receive assistant text and command output unchanged.

New visual states, including reasoning, plan, diff and footer rows, must be specified in the UI guide and demonstrated in the prototype before application use.

## Contracts, state and security

- **Storage.** A migration adds an item kind and a bounded structured payload to transcript rows, or a sibling table keyed by conversation and native item ID. The choice is settled before acceptance; both keep `(created_at, id)` ordering and P028's revision contract.
- **Bounds.** Per-item and per-turn limits for diffs, search results and tool payloads, with explicit truncation notices. A single oversized item never throws or makes the turn uncertain; it is truncated and labelled.
- **Rendering.** Diffs, paths, tool arguments and results are untrusted text, rendered literally. No HTML from tool output or diffs is interpreted. A path becomes a link only to P031's authorized download route, never a link built from the raw path.
- **Privacy.** Only reasoning summaries are stored; raw reasoning content is not requested or stored.

## Implementation brief

Run the pinned-runtime contract probe first and record the observed notifications. Then extend the adapter's typed events, persistence, contracts, snapshot and browser rendering per item type, starting with file changes and reasoning summaries, which matter most to the owner. The fixture Codex server gains deterministic streams for each supported type.

## Exact file fence

- `design/proposals/029-complete-conversation-transcript.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `packages/codex-adapter/src/index.ts`
- `apps/supervisor/src/main.ts`
- `apps/supervisor/src/conversation-output.ts`
- `apps/api/src/server.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/ConversationActivity.tsx`
- `apps/web/src/TranscriptItems.tsx`
- `apps/web/src/Icons.tsx`
- `apps/web/src/styles.css`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `packages/storage/src/migrations/022_transcript_items.sql`
- `tests/fixtures/codex/server.mjs`
- `tests/contract/adapter.test.ts`
- `tests/integration/conversation-activity.test.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p029.ts`
- `docs/user/conversations.md`
- `issues/2026-09-20-120000-conversation-report-downloads.md`

Main renumbers the migration if another plan claims 022 first.

## Verification and acceptance

- **P029-01:** The pinned-runtime contract run records which item types and notifications 0.153.4 emits for a reasoning turn, a plan, a file edit, a web search and an MCP call, using isolated state and no personal credentials.
- **P029-02:** Through the real browser, API, PostgreSQL and supervisor with the fixture, each supported item type appears live in order and identically after reload.
- **P029-03:** A turn that edits three files shows three file rows with correct diffs and a footer whose aggregate diff matches the fixture's `turn/diff/updated`.
- **P029-04:** Oversized diffs and tool results are truncated with a notice, and the turn completes normally.
- **P029-05:** An unknown item type renders a neutral row and does not break the stream.
- **P029-06:** Hostile content in paths, diffs and tool results, such as HTML, control characters and very long lines, renders literally.
- **P029-07:** Desktop and mobile layouts, keyboard focus and expand or collapse behavior match the prototype.
- **P029-08:** Conversations created before the migration still display.
- **P029-09:** An approved, a declined and an expired approval, an answered input request, a cancelled turn and an interrupted turn each leave the matching record, live and after reload, and the records never include hidden request content beyond what the card showed.
- **P029-10:** A file row names a path inside the project relative to the project, and any other path as reported, without a link. If P031 is Implemented when this plan executes, selecting a row for an existing file inside the project downloads it through P031's route, and a deleted file shows P031's missing-file state.
- **P029-11:** `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:contract`, a bounded live smoke check with dedicated test credentials, `pnpm test:e2e --design` with P029's scenarios, the full critical `pnpm test:e2e`, and the P018 concurrency and P024 attachment lanes pass. A missing live credential leaves P029 Accepted, linked to the [live runtime credentials issue](../../issues/2026-09-07-171225-live-runtime-credentials.md).

Gate: behavioral plus adapter contract and live smoke, because the adapter changes.

## Rollout and recovery

The migration is additive and needs `allow_new_migrations` and a checkpoint. Items received before deployment stay as they were; there is no backfill of dropped history.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
