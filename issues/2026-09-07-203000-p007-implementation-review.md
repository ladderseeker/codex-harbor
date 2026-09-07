# P007 implementation review findings

- Severity: High
- Status: In progress
- Owner: [P007](../design/proposals/007-session-history-and-recovery.md)
- Recorded: 2026-09-07
- Affected files: apps/api/src/server.ts; apps/api/src/history.ts; apps/api/src/recovery.ts; apps/supervisor/src/recovery.ts; apps/web/src/Recovery.tsx; packages/storage/src/capacity.ts; tests/e2e/p007.ts
- Acceptance: P007-01/02/05/06; corresponding inherited P001 safety and storage bounds

## Round 1 evidence

Independent review examined frozen source `3d144bd65f4bc2eecfcada978e434bef121c0a92581fa4db6f04cec3f55e0604` (810 files). The final real P001/P007 browser/API suite passed at that source in `harbor-e2e-8ad35f6562`, using Node 26.7.0, PostgreSQL 17.6, Chromium 1194, and the pinned Codex 0.153.4 interface with external fixtures. These passing scenarios did not cover all of the defects below.

| Severity | Finding and impact | Required correction/evidence |
| --- | --- | --- |
| High | A failed recovery-status write can leave a record in `fencing` with no path to settle it. The owner cannot safely continue. | Retain/reconcile pending settlement after database restoration and supervisor restart; inject status-write failure through the real database. |
| High | Recovery/continuation lacks consistently locked current authority after waits. | Apply the [shared expiry correction](2026-09-07-202308-authority-expiry-after-lock-wait.md), including transactional continuation authority and real lock-wait/expiry checks. |
| High | Ordinary intent admission occurs after the command callback can allocate a project folder. A denied request can leave orphaned storage. | Reserve/check capacity before external effects and prove quota rejection leaves storage unchanged. |
| Medium | A consumed recovery can hide the UI action after a later turn becomes uncertain. | Exercise two recovery cycles in the same real conversation and expose the current unresolved cycle. |
| Medium | Credential mutation intents bypass the new ordinary-intent budget. | Include the existing credential IPC path in bounded admission while preserving emergency stop and retained retries. |
| Medium | Timestamp precision loss in a history cursor can skip records. | Preserve database timestamp precision through keyset pagination and test several records within one millisecond. |

Strengthen the snapshot-to-SSE race assertion and hash existing native/source files across metadata edits. Those assertions must exercise actual pre-existing native history rather than an empty fixture before its first turn.

The reviewer withdrew an initial continuation-result-size concern after inspecting `publicRow`, which removes payloads from that result. It is not an unresolved defect and requires no speculative schema change.

## Disposition

The implementer is batching fixes, followed by focused regressions, the complete changed-feature/critical suite, and independent re-review. P007 remains active and In progress. The [dedicated live-account gate](2026-09-07-171225-live-runtime-credentials.md) remains a separate prerequisite; fixture/native non-model checks cannot close it. Record the corrected source identity and results before resolving and archiving this review issue.
