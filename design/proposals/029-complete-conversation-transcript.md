# P029 — Complete conversation transcript

## Metadata

- ID: P029
- Status: Draft
- Priority: High, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: The conversation shows what Codex is doing and what it changed, and what the owner decided: reasoning summaries, plans, file edits with diffs, web searches, tool calls, approvals, answers and cancellations, and a short summary at the end of each turn, live and after reload.
- Authorization: On 27 September 2026 the owner authorized evaluation and revision of the open proposals, followed by commit and push of these document changes to `main`. Feature implementation, live experiments and deployment are outside this audit.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529` and the pinned Codex 0.153.4 generated protocol.
- Dependencies: [P028](028-live-conversation-streaming.md) must be Implemented first, because each new item type streams through its incremental event contract. Before acceptance a capability matrix must distinguish generated-schema shape, observed pinned 0.153.4 notifications, unsupported configurations and unverified cases. A silent bounded probe does not prove an item is never emitted. Main explicitly amends Draft scope if core evidence is missing; the implementer cannot silently drop promised item types.
- Source issues: [Conversation report downloads](../../issues/2026-09-20-120000-conversation-report-downloads.md), partial observed patch-reference discoverability only, alongside [P031](031-project-file-downloads.md). Command-created report references remain an unmet obligation in the existing issue; completion of both plans alone does not authorize archival.
- Design references: [Conversations and access](../systems/001-conversations-and-access.md), [interface](../systems/006-interface.md), [UI guide](../design-tokens.html), [prototype](../prototypes/harbor-redesign.html), [architecture compatibility boundary](../architecture.md#official-foundation-and-compatibility-boundary).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P029-01–P029-11.

## Review note — 27 September 2026

Read-only source review against `e6c2a138563139650af46fe51af44c6eb6c28743`; the original baseline in Metadata and dated evidence remain historical. Capability evidence, reducers, storage budgets and decision provenance need explicit pre-acceptance settlement. File-change rows cover observed patches only; command-created report discovery remains an open obligation. This audit runs documentation checks only and adopts no canonical feature contract, performs no application/runtime/Linux acceptance and closes no issue.

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

The current conversation design persists assistant and tool messages as durable history with bounded tool output. This plan adds typed transcript items with the same ownership: rows belong to the conversation and operation, are written before their events and survive reload. Before acceptance main selects the store and exact per-kind/item/turn/conversation budgets, including diffs, arguments, results, replay and footer metadata; these remain unresolved design blockers. They preserve P028's page/correction/accounting bounds and do not consume the assistant text budget.

Adapter parsing stays inside the adapter boundary. The contract run records the 0.153.4 sequence and fields actually observed, with explicit MCP/dynamic-tool prerequisites and unsupported/unverified configurations. Main allocates a run-owned probe driver, finite model-call/time budget, redacted artifacts and confirmed cleanup before acceptance; no ordinary owner history/configuration or private third-party data is imported.

## Source issues

From the report-download issue this plan covers observed patch references through P029-03/P029-10: a file-change row names its reported path, relative to the project when inside it. Shell/Python-written reports may have no native file-change item, so these rows do not establish complete report discoverability. Linking those rows to downloads belongs to whichever of this plan and [P031](031-project-file-downloads.md) executes second: if P031 is already Implemented and its capability permits the path/profile, this plan links each eligible existing file row to P031's route; otherwise P031 adds the links. P031 retains its bounded project-file access/download obligations. This plan adds a dated note to the issue. The issue stays open for command-created conversational artifact discovery until a selected plan covers and verifies that obligation. Neither the two completion states nor P031's fallback Files panel alone is sufficient archival evidence; no scanner is added here.

## User and API flows

1. While a turn runs, new rows appear as their items start. Reasoning shows a one-line live status that expands to the summary. Plans update in place.
2. File-change rows list paths; expanding one shows its diff with added and removed lines styled by the existing token set. The turn footer links to the aggregate diff.
3. After reload, every row and footer is identical to the live view.
4. The snapshot and message-page routes from P028 return the new item kinds; API clients that only understand messages still receive assistant text and command output unchanged.

New visual states, including reasoning, plan, diff and footer rows, must be specified in the UI guide and demonstrated in the prototype before application use.

## Contracts, state and security

- **Storage.** A migration adds an item kind and a bounded structured payload to transcript rows, or a sibling table keyed by conversation and native item ID. The choice is settled before acceptance; both inherit P028's selected immutable ordering/cursor and revision contract.
- **Bounds.** Set numerical per-kind/item/turn/conversation limits before acceptance, with labelled truncation and bounded unknown-type labels. Enforce ingestion/buffering bounds before payloads can exhaust the raw mailbox; do not retain raw unsupported objects. Oversized supported content alone must not poison a healthy turn. Preserve distinct protocol/storage failure and reconciliation behavior.
- **Rendering.** Diffs, paths, tool arguments and results are untrusted text, rendered literally. No HTML from tool output or diffs is interpreted. A path becomes a link only to P031's authorized download route, never a link built from the raw path.
- **Reducers and privacy.** Preserve indexed reasoning-summary deltas and authoritative final reconciliation, without requesting raw reasoning or retaining unsolicited raw reasoning in durable history, events or saved probe artifacts. Settle item-plan versus turn-plan updates, failed/attempted versus confirmed file edits and final diff semantics using pinned evidence. Footer durations identify their measured boundary; label reported cumulative or last-call tokens honestly rather than inventing per-turn usage.
- **Owner decisions.** Materialize records transactionally from actual Harbor decisions/state, independently of native item output. Deduplicate by approval/attempt/control identity; answer acceptance, delivery and execution stay distinct, as do cancellation request and confirmed interruption. Integrate P019 when present; otherwise preserve known/unknown historical expiry and delivery provenance without fabricated causes.

## Implementation brief

After main allocates and authorizes the bounded probe, record observed notifications and settle capability/store/budget/reducer decisions before accepting feature implementation. Then extend the adapter's typed events, persistence, contracts, snapshot and browser rendering per item type, starting with file changes and reasoning summaries, which matter most to the owner. The fixture Codex server gains deterministic streams for each supported type.

## Exact file fence

The paths below are a prospective feature-implementation fence, not authorization to edit them during this audit. The current audit edits only the fourteen selected Draft proposals. Main must settle any missing new paths and check provisional decision/migration numbering before acceptance.

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
- `apps/web/src/api.ts`
- `apps/web/src/ConversationActivity.tsx`
- `apps/web/src/TranscriptItems.tsx`
- `apps/web/src/Icons.tsx`
- `apps/web/src/styles.css`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `packages/storage/src/migrations/022_transcript_items.sql`
- `packages/storage/src/deployment-modules.ts`
- `tests/deployment/modules.ts`
- `tests/fixtures/codex/server.mjs`
- `tests/contract/adapter.test.ts`
- `tests/integration/conversation-activity.test.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p029.ts`
- `docs/user/conversations.md`
- `docs/developer/programmatic-api.md`
- `issues/2026-09-20-120000-conversation-report-downloads.md`
- `issues/archive/2026-09-20-120000-conversation-report-downloads.md`

The exact live-probe/helper paths and any additional store/restore paths are acceptance blockers until main adds them; the registry paths above change if the selected store requires them. The migration number is provisional: main gives it the next unused number when execution starts, so migrations always land in numeric order.

## Verification and acceptance

- **P029-01:** The pinned-runtime contract run records which item types and notifications 0.153.4 emits for a reasoning turn, a plan, a file edit, a web search and an MCP call, using isolated run-owned state on the VPS host with only the VPS Codex credential copied in under standing credential permission and a selected probe brief. Record supported configuration, bounded calls/time and clean retirement; absence of an event stays unverified unless supported evidence establishes unavailability.
- **P029-02:** Through the real browser, API, PostgreSQL and supervisor with the fixture, each supported item type appears live in order and identically after reload, including indexed summary parts, plan updates, duplicate/out-of-order final reconciliation and explicitly labelled token semantics.
- **P029-03:** A turn that edits three files shows three file rows with correct diffs and a footer whose aggregate diff matches the fixture's `turn/diff/updated`.
- **P029-04:** Oversized diffs and tool results are truncated with a notice, and the turn completes normally within ingestion/mailbox/replay/page budgets; a bounded unknown label cannot persist a raw hostile payload.
- **P029-05:** An unknown item type renders a neutral row and does not break the stream.
- **P029-06:** Hostile content in paths, diffs and tool results, such as HTML, control characters and very long lines, renders literally.
- **P029-07:** Desktop and mobile layouts, keyboard focus and expand or collapse behavior match the prototype.
- **P029-08:** Conversations created before the migration still display.
- **P029-09:** An approved, a declined and an expired approval, an answered input request, a cancelled turn and an interrupted turn each leave the matching record, live and after reload, and records never include hidden request content beyond what the card showed. Cover accepted-but-not-delivered answers, ambiguous delivery, duplicate attempts, cancellation request before confirmation and crash/restart; historical unknown expiry causes stay unknown.
- **P029-10:** A file row names a path inside the project relative to the project, and any other path as reported, without a link. If P031 is Implemented when this plan executes, selecting an eligible row for an existing allowed file downloads it through P031's route only in a profile exposing that capability; denied control paths remain unlinked, and a deleted file shows P031's missing-file state. A shell-written report without a file-change event does not fabricate a row or close the outstanding discovery obligation.
- **P029-11:** `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:contract`, a bounded live smoke check on the VPS host under the owner's standing authorization for the VPS Codex credential, copied into fresh run-owned state there, `pnpm test:e2e --design` with P029's scenarios, the full critical `pnpm test:e2e`, and the P018 concurrency and P024 attachment lanes pass. A missing live credential leaves P029 Accepted, linked to the [live runtime credentials issue](../../issues/2026-09-07-171225-live-runtime-credentials.md).

Gate: behavioral plus adapter contract and live smoke, because the adapter changes.

## Rollout and recovery

The migration is additive and needs `allow_new_migrations` and a checkpoint. Items received before deployment stay as they were; there is no backfill of dropped history or invented approval/expiry provenance. Validate backup registration and old-client/rollback compatibility for the chosen store before promotion.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
