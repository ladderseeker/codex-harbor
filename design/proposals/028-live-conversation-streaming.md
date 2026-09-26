# P028 — Live conversation streaming

## Metadata

- ID: P028
- Status: Draft
- Priority: High, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Replies stream into the open conversation as small incremental updates, long conversations open quickly and load older messages on demand, conversations never wait for each other's output or runtime starts, and an oversized reply is truncated instead of ending the conversation.
- Authorization: On 27 September 2026 the owner authorized evaluation and revision of the open proposals, followed by commit and push of these document changes to `main`. Feature implementation, live experiments and deployment are outside this audit.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529`, plus the local fixture measurements in the [review](../../docs/reports/2026-09-25-project-review.md#streaming-and-responsiveness).
- Dependencies: [P025](025-clean-supervisor-shutdown-and-restart.md) must be Implemented first for complete launch/retirement task ownership; that dependency is currently missing. P028 owns base streaming/pages/counters; [P021](021-long-conversation-history-and-capacity.md) and [P029](029-complete-conversation-transcript.md) build on it. P032 is a recommended earlier optimization, not a correctness dependency.
- Source issues: [One oversized reply makes a conversation uncertain](../../issues/2026-09-25-120000-output-limit-uncertain-turn.md), all obligations.
- Design references: [API, events and state transitions](../architecture.md#api-events-and-state-transitions), [conversations and access](../systems/001-conversations-and-access.md), [interface](../systems/006-interface.md), [UI guide](../design-tokens.html), [prototype](../prototypes/harbor-redesign.html).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P028-01–P028-12.

## Review note — 27 September 2026

Read-only source review against `e6c2a138563139650af46fe51af44c6eb6c28743`; the original baseline in Metadata and dated evidence remain historical. The plan now requires P025 task ownership, preserves the one-hour capability authorization ceiling, covers every message writer and separates bounded message/control retrieval. Schema, byte budgets and measured workload definitions still require settlement before acceptance. This audit runs documentation checks only and adopts no canonical feature contract, performs no application/runtime/Linux acceptance and closes no issue.

## Problem, outcome and exclusions

Every streamed text chunk from Codex currently costs the whole pipeline a full pass over the conversation:

- The supervisor's [output persistence](../../apps/supervisor/src/conversation-output.ts) runs one transaction per native delta. Each one sums the size of every message in the conversation, rewrites the message's complete text, inserts an event and prunes replay, under exclusive row locks on the project, workspace and conversation, so conversations in the same project also wait for each other's writes.
- The API's event stream polls PostgreSQL every 250 ms per open stream, and each poll runs a replay prune that takes the same three locks and updates the conversation row even when nothing changed. The [snapshot route](../../apps/api/src/server.ts) returns every message, operation and approval of the conversation while holding the same locks.
- The [browser](../../apps/web/src/App.tsx) ignores event payloads. Events trigger a full snapshot refetch, and events that arrive during a fetch are merged into one more fetch, so a streaming reply still causes back-to-back refetches, often in identical pairs. A 15-second snapshot poll runs even in hidden tabs, and capabilities and the project's workspace list are polled every 4 seconds.
- The supervisor's single loop awaits a Codex model-discovery probe whenever the last attempt is more than a minute old, starting a Codex process each time, and awaits each runtime start inline, so approvals and cancellations for other conversations wait behind it.
- An assistant reply over 262,144 characters, or output that would take the conversation past 2 MiB or 2,000 messages, throws inside output persistence and makes the running turn uncertain. In the personal profiles such a conversation can never take another turn, as the [source issue](../../issues/2026-09-25-120000-output-limit-uncertain-turn.md) records.

The cost of streaming therefore grows with conversation length, twice: in database writes and in bytes sent to the browser. The review's [walkthrough](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough) measured up to 2.35 MB for one reply and about 1 MB a minute for an idle open conversation of about 220,000 characters, and a burst of eight conversations from one browser reached the API's request limit.

After this change:

1. Deltas are coalesced per item for at most 250 ms and persisted as appends, with per-conversation size counters kept on the session row instead of recomputed. A flush locks only the conversation row for writing, so conversations in the same project no longer wait for each other.
2. Each flush emits one event carrying the appended text and the message revision. The browser applies it directly and refetches only on a revision mismatch, a replay gap or an unknown event.
3. The event stream wakes on PostgreSQL `LISTEN/NOTIFY` and keeps only a slow fallback poll. Snapshots read from one consistent database snapshot without write locks, and replay age cleanup moves to supervisor maintenance while count pruning remains bounded on writes, so reading a conversation never writes.
4. A snapshot returns a bounded recent window plus a cursor. The transcript loads older messages when the owner scrolls up.
5. Discovery refreshes at startup, after account changes, on the owner's "Check again" and by 30 minutes after the last successful refresh, outside the dispatch loop. Single-flight execution and bounded backoff preserve the existing one-hour fail-closed capability freshness ceiling in both API and dispatch policy. Runtime starts use P025's tracked-task registry, so slow probes/starts do not block other conversations' controls.
6. An idle open conversation makes no snapshot request and its reads cause no database write. Capability and workspace changes reach the browser as events or through a poll of a minute or more, and hidden tabs stop polling until they are visible again, apart from the notification refresh that [P030](030-composer-and-conversation-flow.md) adds.
7. Output that would cross a storage limit is truncated at the limit with a visible notice, and the turn continues to its native end instead of becoming uncertain. Admission keeps refusing new turns in a full conversation, as today.

Excluded: new transcript item types, owned by P029; changing the lifetime history limits of 2 MiB and 2,000 messages, owned by [P021](021-long-conversation-history-and-capacity.md), since this plan only stops those limits from making a turn uncertain; session-list pagination; and changes to runtime isolation.

## Dependencies and current design

The architecture already treats database notifications as wakeups rather than durable messages and requires deduplication by event sequence, so `LISTEN/NOTIFY` and incremental application fit the existing contract. The current design's snapshot is unbounded; this plan changes it to a bounded window with explicit older pages, which takes over the retrieval part of P021, including its requirement that pages compose across an API restart and a stream resync. P021 keeps its capacity and retention scope.

The [storage lock order](../../packages/storage/src/session-lock.ts) takes the project, workspace and conversation rows `FOR UPDATE`. Every path that changes a project, a workspace or a conversation's binding keeps that order and those locks. Output flushes instead take `FOR KEY SHARE` on the project and workspace rows and `FOR UPDATE` on the conversation row. `FOR KEY SHARE` still conflicts with deleting or re-keying the parent rows and with the exclusive locks above, so the binding check keeps its meaning, while flushes in two conversations of one project no longer conflict. The conversation design records this lighter mode.

## Source issues

The [output-limit issue](../../issues/2026-09-25-120000-output-limit-uncertain-turn.md) transfers completely: truncation instead of uncertainty, and its recheck in the fixture and personal VPS profiles, map to P028-10, and the personal VPS lane runs under P028-12. Its severity (Medium) is retained. On completion the issue moves to the archive with a pointer to this plan.

## User and API flows

1. Opening a conversation shows its newest messages immediately. Scrolling to the top loads the previous page, keeping the reading position; a visible control does the same for keyboard users.
2. During a turn, text appears progressively with no full refetch. After a reconnect, the stream resumes from the browser's cursor; after a replay gap, the browser reloads the recent window.
3. The model list stays available only within the shared one-hour authorization freshness ceiling. Over-age or unavailable capabilities visibly refuse new turn admission; cached models never authorize indefinitely. "Check again" requests a bounded authenticated single-flight refresh, not merely another capabilities read.
4. The snapshot route accepts `limit`, and a new `GET /api/v1/sessions/{id}/messages?before={cursor}&limit={n}` returns older pages with the same authorization as the snapshot, including for read-scoped API tokens.

The "load earlier messages" state is new and must appear in the UI guide and prototype before the application uses it.

## Contracts, state and security

- **Messages and accounting.** Add/backfill message revisions and session counters. Every writer uses consistent accounting: user admission, assistant/command output, system notices, authoritative replacements, completion status and native recovery repair. Replacements may shrink text; counters remain exact under the same resource fence. Preserve separate command-output limits and assistant headroom. Before acceptance choose immutable first-seen ordering, preserving exact timestamp precision plus ID or an explicit ordinal; coalescing must not reorder native item starts.
- **Events and buffering.** An initial bounded row event supplies message/native-item identity, operation, role/kind, immutable order, status and revision. Append events retain `itemId`/`delta`, add `messageId`/revision and apply only at the exact next revision; duplicate sequence/revision is harmless. Final-only native items and completion without a final item remain representable. Authoritative final replacements, command headings/status and truncation notices use a bounded correction protocol: main must settle chunked corrections or authorized bounded single-item retrieval before acceptance. They never force unbounded full text into an event or refetch the whole conversation per delta. Coalescing has finite item/count/byte limits within the existing mailbox budget and a maximum 250 ms wait. Flush preceding content before lifecycle/request markers; bind buffers to exact runtime generation/operation/item, and fence/drain them on cancellation, disconnect, persistence failure and shutdown. Exhaustion has an explicit bounded failure/reconciliation outcome, not silent loss.
- **Snapshots and pages.** Proposed message-window targets are 200 messages and 512 KiB of serialized message data; unresolved-control summaries and detail pages have separate finite budgets, so 512 KiB is not a whole-response promise. Main must settle exact count, UTF-8 serialized-response, item/correction and control-detail limits and routes before acceptance. Every actionable approval stays reachable through bounded authenticated summaries/pages, with operation metadata needed to render each returned message. Existing oversized items have a bounded retrieval path, never an endless resync loop. Bind cursors to session and exact immutable order. Read snapshot rows/cursor in one read-only `REPEATABLE READ` transaction; event sequence advances under the session lock in the same transaction as state. Merge old page responses by identity/revision, never overwriting newer streamed state. After replay gaps, explicitly reset/refill retained depth or bridge between the new recent window and retained older pages; do not silently leave a missing middle window.
- **Limits.** Truncation happens inside the flush that would cross a limit: the stored text ends at the limit, and later text for that item, including any excess in its final item, is dropped with the retained omission marker. Once the conversation's byte or message limit is reached, later items of the turn are dropped too. One bounded system notice per turn records the omission; reserve or explicitly bound its one-record/byte overshoot before acceptance. Admission then refuses further work at full conversation capacity. Truncate at valid Unicode boundaries and distinguish the per-item character limit from aggregate UTF-8 bytes; authoritative completion never restores omitted bytes. The operation's state follows the native turn, never the truncation.
- **Replay and wakeups.** Preserve the hard 2,000-event count bound by batched pruning in each output/event transaction; maintenance handles age cleanup and readers apply the seven-day expiry/gap rule immediately without writes. Watermarks remain durable. The API has one dedicated listener connection without long transactions: commit `LISTEN`, then perform a new database catch-up read, and repeat on reconnect, following [PostgreSQL 17 LISTEN](https://www.postgresql.org/docs/17/sql-listen.html). Send only bounded opaque identity wakeups after commit, best effort; [NOTIFY](https://www.postgresql.org/docs/17/sql-notify.html) has payload/queue limits, so notification failure must not roll back already persisted output. A slow fallback poll remains authoritative. Recheck stream authority periodically even without events, preserve stream quotas, and bound drain/backpressure for slow clients.
- **Security.** Authorization, CSRF and rate limits for new routes match the snapshot route. Read-scoped API tokens may use the older-pages route, as they may use the snapshot, and the programmatic API guide describes the window and its pages. Appended text keeps the existing literal and Markdown rendering rules.

## Implementation brief

Read the architecture's event section, conversation design and delivered P025 task-ownership contract first. Reserve active-turn and runtime-member capacity durably before parallel launch tasks; enforce one task per session/generation, bounded concurrency and fresh authority/generation checks immediately before native send. Cancellation, emergency stop, account replacement and shutdown fence/join all pending tasks. Settle cache refresh routing, exact schemas/byte budgets, correction/page composition and reproducible Linux workload/rate/measurement definitions before acceptance; these are missing design inputs, not worker discretion. Change persistence, events, the stream, the snapshot and the browser's event handling together, since each depends on the next. Keep a compatibility/resync path for retained events without revisions; all migrated message rows receive revisions. Preserve old clients' documented bounded retrieval behavior or require an explicit reload. Measure with the fixture before and after, using the same scenarios as P028-01 to P028-04.

## Exact file fence

The paths below are a prospective feature-implementation fence, not authorization to edit them during this audit. The current audit edits only the fourteen selected Draft proposals. Main must settle any missing new paths and check provisional decision/migration numbering before acceptance.

- `design/proposals/028-live-conversation-streaming.md`
- `design/architecture.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/supervisor/src/main.ts`
- `apps/supervisor/src/conversation-output.ts`
- `apps/supervisor/src/runtime-mailbox.ts`
- `apps/supervisor/src/retirement.ts`
- `apps/supervisor/src/recovery.ts`
- `apps/api/src/server.ts`
- `apps/api/src/token-access.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/Workspaces.tsx`
- `apps/web/src/styles.css`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `packages/storage/src/index.ts`
- `packages/storage/src/replay.ts`
- `packages/storage/src/maintenance.ts`
- `packages/storage/src/session-lock.ts`
- `packages/storage/src/turns.ts`
- `packages/policy/src/models.ts`
- `packages/storage/src/migrations/021_conversation_output_counters.sql`
- `tests/fixtures/codex/server.mjs`
- `tests/integration/conversation-stream.test.ts`
- `tests/contract/adapter.test.ts`
- `tests/contract/history.test.ts`
- `tests/e2e/p007.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p028.ts`
- `tests/personal-vps/concurrency.ts`
- `tests/personal-vps/e2e.ts`
- `docs/user/conversations.md`
- `docs/developer/programmatic-api.md`
- `issues/2026-09-25-120000-output-limit-uncertain-turn.md`
- `issues/archive/2026-09-25-120000-output-limit-uncertain-turn.md`

The migration number is provisional: main gives it the next unused number when execution starts, so migrations always land in numeric order.

## Verification and acceptance

- **P028-01:** In a conversation already holding 1.5 MiB in 1,500 messages, the fixture streams a 200 KiB reply as 4,000 deltas. After the initial load the browser makes no snapshot request during the stream, and the final text equals the native final item.
- **P028-02:** Database work scales with flushed items/bytes, with bounded writes/fragments and no whole-conversation aggregate. Instrument the statement/work budget, including count pruning, every message writer and recovery replacements; counters and revisions match persisted rows after migration and repair.
- **P028-03:** On the supported Linux target, the proposed p95 fixture-delta-to-render target is at most 750 ms. Before acceptance record hardware/environment, fixed delta cadence/duration/burst shape, clock/measurement method and any upper-bound requirement; retain actual measurements, not an assumed pass.
- **P028-04:** Opening the same conversation keeps its serialized message-window payload within 512 KiB and separately enforces the accepted control/response budgets, showing newest messages and reachable unresolved controls. Include oversized legacy items and many pending approvals. Loading older pages while a reply streams gives the correct order with no duplicates or gaps. A read-scoped API token reads the same window and older pages.
- **P028-05:** Dropping the stream mid-reply resumes from the cursor without duplicates. A forced replay gap reloads the window. After API/listener restart, dropped notifications and stream resync, retained and subsequent pages compose without duplicates/gaps. Produce more than a full window during disconnection, race an older page with final replacement, and include same-timestamp items and stale responses. Authority revocation still closes an idle stream.
- **P028-06:** For ten idle minutes immediately after successful discovery, no new Codex process starts. Single-flight startup/account/manual/30-minute refresh works; failed refresh with capabilities reaching one hour refuses new admission consistently in API and dispatch. Concurrent Check again calls do not spawn duplicate probes.
- **P028-07:** With the fixture delaying runtime start for one conversation by five seconds, an approval answer and a cancellation in another conversation reach their runtime within one second under the fixed healthy fixture workload. Repeat with slow discovery; concurrent starts respect both capacity budgets, cancellation/account change/shutdown fence in-flight tasks and no stale send occurs.
- **P028-08:** Conversations created before the migration display, stream and paginate correctly.
- **P028-09:** With the P028-01 conversation open and idle for ten minutes, the browser makes no snapshot request and averages under 50 KB a minute, and the stream route performs no write. Each event causes at most one snapshot request, and only on a revision mismatch, replay gap or explicitly unsupported event. Measure the burst under the unchanged limiter; P032 does not waive request-reduction assertions. Starting and messaging eight conversations in quick succession from one browser produces no HTTP 429.
- **P028-10:** A fixture reply of 300,000 characters is stored truncated at the per-message limit with one visible notice, the turn completes, and the next turn is accepted. A turn whose output crosses 2 MiB, and one whose new items would exceed 2,000 messages, also complete with one notice, and the next turn is refused with the storage-limit explanation. The personal VPS Linux lane repeats all three cases, including multibyte Unicode, split boundaries, authoritative final-only/replacement items and bounded one-notice overshoot.
- **P028-11:** Two conversations in the same project stream replies at the same time. Neither conversation's flushes wait on the other's locks, and both meet the P028-03 latency bound.
- **P028-12:** `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e --design` with P028's scenarios, the full critical `pnpm test:e2e`, the personal VPS Linux lane, the P018 concurrency lane and the P024 attachment lane pass. Pinned `pnpm test:contract` and a bounded source-matched live integration check are required for changed discovery/start/recovery scheduling even if adapter source is unchanged. Main allocates the exact run-owned live driver before acceptance; unavailable runtime/credential evidence remains linked and blocks completion.

Gate: behavioral plus pinned/live integration and personal VPS Linux lifecycle/concurrency regression. Existing unchanged sandbox primitives may reuse identified evidence with its source/limits; it does not prove the new task scheduling or shutdown behavior.

## Rollout and recovery

The migration adds columns and backfills them; it needs `allow_new_migrations` and a checkpoint during promotion. Rolling back after it runs means restoring that checkpoint, so the candidate must pass the full gate first. Existing browser tabs recover through the compatibility path or a reload.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
