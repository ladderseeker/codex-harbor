# P028 — Live conversation streaming

## Metadata

- ID: P028
- Status: Draft
- Priority: P1, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Replies stream into the open conversation as small incremental updates, long conversations open quickly and load older messages on demand, and one conversation starting a runtime or refreshing models never pauses the others.
- Authorization: Proposal writing only. Implementation, commits to `main` and deployment need the owner's separate go-ahead.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529`, plus the local fixture measurements in the [review](../../docs/reports/2026-09-25-project-review.md#streaming-and-responsiveness).
- Dependencies: None required. Deciding [P027](027-personal-first-product-scope.md) first lets this plan skip managed-only verification lanes. [P029](029-complete-conversation-transcript.md) builds on the event contract defined here.
- Source issues: None.
- Design references: [API, events and state transitions](../architecture.md#api-events-and-state-transitions), [conversations and access](../systems/001-conversations-and-access.md), [interface](../systems/006-interface.md), [UI guide](../design-tokens.html), [prototype](../prototypes/harbor-redesign.html).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P028-01–P028-10.

## Problem, outcome and exclusions

Every streamed text chunk from Codex currently costs the whole pipeline a full pass over the conversation:

- The supervisor's [output persistence](../../apps/supervisor/src/conversation-output.ts) runs one transaction per native delta. Each one sums the size of every message in the conversation, rewrites the message's complete text, inserts an event and prunes replay, all under the session lock.
- The API's event stream polls PostgreSQL every 250 ms per open stream, and each poll runs a replay prune that locks and updates the conversation row even when nothing changed. The [snapshot route](../../apps/api/src/server.ts) returns every message, operation and approval of the conversation while holding the same session lock.
- The [browser](../../apps/web/src/App.tsx) ignores event payloads. Each event triggers a full snapshot refetch, repeated back to back while events keep arriving and often duplicated. A 15-second snapshot poll runs even in hidden tabs, and capabilities and the project's workspace list are polled every 4 seconds.
- The supervisor's single loop awaits a Codex model-discovery probe roughly once a minute, starting a Codex process each time, and awaits each runtime start inline, so approvals and cancellations for other conversations wait behind it.

The cost of streaming therefore grows with conversation length, twice: in database writes and in bytes sent to the browser. The review's [walkthrough](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough) measured up to 2.35 MB for one reply and about 1 MB a minute for an idle open conversation of about 220,000 characters, and a burst of eight conversations from one browser reached the API's request limit.

After this change:

1. Deltas are coalesced per item for at most 250 ms and persisted as appends, with per-conversation size counters kept on the session row instead of recomputed.
2. Each flush emits one event carrying the appended text and the message revision. The browser applies it directly and refetches only on a revision mismatch, a replay gap or an unknown event.
3. The event stream wakes on PostgreSQL `LISTEN/NOTIFY` and keeps only a slow fallback poll. Snapshots read without the session write lock, and replay pruning moves to supervisor maintenance.
4. A snapshot returns a bounded recent window plus a cursor. The transcript loads older messages when the owner scrolls up.
5. Discovery runs at startup, after account changes, on the owner's "Check again", and when the stored result is older than six hours, never inside the dispatch loop. Runtime starts run as tracked tasks, so approvals and cancellations are handled on every tick.
6. An idle open conversation makes no snapshot request and causes no database write. Capability and workspace changes reach the browser as events or through a poll of a minute or more, and hidden tabs stop polling until they are visible again.

Excluded: new transcript item types, owned by P029; the lifetime history limits of 2 MiB and 2,000 messages, owned by [P021](021-long-conversation-history-and-capacity.md); session-list pagination; and changes to runtime isolation.

## Dependencies and current design

The architecture already treats database notifications as wakeups rather than durable messages and requires deduplication by event sequence, so `LISTEN/NOTIFY` and incremental application fit the existing contract. The current design's snapshot is unbounded; this plan changes it to a bounded window with explicit older pages, which also covers the retrieval part of P021's second flow. P021 keeps its capacity and retention scope.

## Source issues

None.

## User and API flows

1. Opening a conversation shows its newest messages immediately. Scrolling to the top loads the previous page, keeping the reading position; a visible control does the same for keyboard users.
2. During a turn, text appears progressively with no full refetch. After a reconnect, the stream resumes from the browser's cursor; after a replay gap, the browser reloads the recent window.
3. The model list stays available between discoveries, marked stale only when discovery has failed for longer than the documented bound. "Check again" requests a refresh.
4. The snapshot route accepts `limit`, and a new `GET /api/v1/sessions/{id}/messages?before={cursor}&limit={n}` returns older pages with the same authorization as the snapshot.

The "load earlier messages" state is new and must appear in the UI guide and prototype before the application uses it.

## Contracts, state and security

- **Messages.** A migration adds a `revision` to messages and output counters to sessions, backfilled from existing rows. Appends increment the revision. Quota checks read the counters.
- **Events.** `message.delta` carries `{messageId, itemId, revision, append}`; `message.completed` carries the final revision and, when the final native text differs from the streamed text, the full final text. Existing event types keep their shapes. Event payloads stay bounded; an oversized flush is split.
- **Snapshots.** The window is bounded by count and bytes, for example 200 messages and 512 KiB, and always includes unresolved operations and pending approvals. Cursors bind the session and the `(created_at, id)` order.
- **Notifications.** The API holds one listener connection per process and fans out wakeups to its streams. Missed notifications are covered by a fallback poll of a few seconds. Stream limits per owner are unchanged.
- **Security.** Authorization, CSRF and rate limits for new routes match the snapshot route. Appended text keeps the existing literal and Markdown rendering rules.

## Implementation brief

Read the architecture's event section, the conversation design and the current output, snapshot and stream code first. Change persistence, events, the stream, the snapshot and the browser's event handling together, since each depends on the next. Keep a compatibility path in the browser for events without a revision, for conversations created before the migration. Measure with the fixture before and after, using the same scenarios as P028-01 to P028-04.

## Exact file fence

- `design/proposals/028-live-conversation-streaming.md`
- `design/architecture.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/supervisor/src/main.ts`
- `apps/supervisor/src/conversation-output.ts`
- `apps/api/src/server.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/Workspaces.tsx`
- `apps/web/src/styles.css`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `packages/storage/src/index.ts`
- `packages/storage/src/replay.ts`
- `packages/storage/src/turns.ts`
- `packages/storage/src/migrations/021_conversation_output_counters.sql`
- `tests/fixtures/codex/server.mjs`
- `tests/integration/conversation-stream.test.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p028.ts`
- `tests/personal-vps/concurrency.ts`
- `docs/user/conversations.md`

If another plan claims migration 021 first, main renames the new migration to the next free number before execution.

## Verification and acceptance

- **P028-01:** In a conversation already holding 1.5 MiB in 1,500 messages, the fixture streams a 200 KiB reply as 4,000 deltas. After the initial load the browser makes no snapshot request during the stream, and the final text equals the native final item.
- **P028-02:** Database work per flush is bounded: one message write and one event per item, with no whole-conversation aggregate. The test counts statements.
- **P028-03:** On the local stack, the 95th percentile time from fixture delta to rendered text is at most 750 ms.
- **P028-04:** Opening the same conversation transfers at most 512 KiB for the snapshot and shows the newest messages. Loading older pages while a reply streams gives the correct order with no duplicates or gaps.
- **P028-05:** Dropping the stream mid-reply resumes from the cursor without duplicates. A forced replay gap reloads the window.
- **P028-06:** Over ten idle minutes the supervisor starts no Codex process. Models remain listed, and "Check again" refreshes them.
- **P028-07:** With the fixture delaying runtime start for one conversation by five seconds, an approval answer and a cancellation in another conversation reach their runtime within one second.
- **P028-08:** Conversations created before the migration display, stream and paginate correctly.
- **P028-09:** With the P028-01 conversation open and idle for ten minutes, the browser makes no snapshot request and averages under 50 KB a minute, and the stream route performs no write. Each event causes at most one snapshot request, and only on a revision mismatch or gap. Starting and messaging eight conversations in quick succession from one browser produces no HTTP 429.
- **P028-10:** `pnpm build`, `pnpm check`, `pnpm test`, the design E2E lane with P028's scenarios, the P018 concurrency lane and the P024 attachment lane pass. The adapter is unchanged, so earlier contract evidence is reused with its tested revision.

Gate: behavioral. Launch and isolation boundaries are unchanged; the personal VPS Linux lane runs as a regression because supervisor scheduling changes.

## Rollout and recovery

The migration adds columns and backfills them; it needs `allow_new_migrations` and a checkpoint during promotion. Rolling back after it runs means restoring that checkpoint, so the candidate must pass the full gate first. Existing browser tabs recover through the compatibility path or a reload.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
