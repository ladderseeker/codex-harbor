# P008 — Scheduled tasks

- Decision: Draft
- Delivery: Planned
- Dependencies: [P003](003-parallel-project-workspaces.md), [P007](007-session-history-and-recovery.md)
- Outcome: The owner schedules project work, leaves Harbor, and later reviews each occurrence's result or request for attention.

## Scope and user/API flow

Create one-time and recurring schedules with prompt, project, workspace mode, model/effort, permitted profile, timezone, next-run preview, overlap policy, and missed-run policy. Provide pause/resume, run-now, cancel-current-run, occurrence history, and an attention inbox. Scheduled work uses the same durable conversation/approval machinery as manual work.

Default a standalone occurrence to a new conversation and worktree. Reusing an existing conversation is explicit and respects its active turn. A paused schedule stops future admission, not an already-running occurrence; cancellation is separate. Email/Slack/GitHub event triggers and outbound notifications are excluded. Authenticated domain API routes are included; P002 adds PAT access when installed.

## Contracts and policy

Persist schedule revision/owner, timezone/rule, next due time, effective policy, and occurrence identity. Create occurrence and dispatch intent transactionally. A unique occurrence key combines schedule, revision, and intended occurrence time. The queue may retry safe internal work, but ambiguous Codex delivery requires P007 reconciliation.

Choose and expose timezone/DST semantics explicitly: skip nonexistent local times and run once at the first matching instant for an ambiguous repeated local time unless the owner selects a different supported policy. Default to recording missed occurrences without unbounded catch-up; default overlapping occurrences to a visible skipped result. Clock adjustments and restarts must not duplicate occurrence identity.

Revalidate current project access, model support, resource limits, and permission ceiling at execution. Unattended work never treats absence as approval. Approval deadlines have explicit wait/deny/interruption behavior. Schedules with revoked authority, removed projects, unavailable runtimes, or unknown recovery state fail or wait visibly. Protect all management/history endpoints and rendered prompts/results.

## Independent acceptance

Use P003/P007 fixtures with a controllable scheduler time source and real PostgreSQL/pg-boss workers. Test the actual server scheduling logic; advancing a browser clock alone is insufficient.

1. **P008-01:** Create a one-time and recurring task, close every browser, advance to due time, and reopen. Assert one occurrence, intended workspace, and accessible final result.
2. **P008-02:** Test timezone conversion, next-run preview, nonexistent/repeated DST times, and wall-clock jumps. Assert the documented occurrence times and identities.
3. **P008-03:** Restart workers and simulate downtime/overlap. Assert configured skip/bounded catch-up behavior and no backlog explosion.
4. **P008-04:** Crash between occurrence creation, queue admission, dispatch, and acknowledgement. Assert deduplication or explicit uncertainty, never automatic repeat of an uncertain effect.
5. **P008-05:** Pause/resume, run-now with a repeated idempotency key, and cancel an active occurrence. Assert separate future/current-run semantics and accurate history.
6. **P008-06:** Require approval while offline, change permissions, remove the project, or exhaust a quota. Assert safe waiting/denial and useful attention states without unauthorized execution.
7. **P008-07:** Run a bounded real Codex scheduled occurrence with dedicated credentials and no browser open. Assert the result and history through the delivered API/UI.

## Delivery and verification

Use planned `pnpm check`, `pnpm test`, `pnpm test:e2e`, and relevant live/contract/isolation lanes. Record scheduler clock/seed, timezone database/runtime versions, occurrence keys, and failure-injection points under the [shared verification contract](README.md#shared-verification-contract).

Add schedule/occurrence migrations and backup registration; exercise restore integration when P009 is present. Restored schedules initially remain paused until recovery establishes missed/uncertain state. Document recurrence, overlap, approval, and downtime semantics as implemented. Verify the complete feature and its independent review before changing delivery status.
