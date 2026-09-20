# P007 implementation review findings

- Severity: High
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-07
- Owner: [P007](../../design/proposals/archive/007-session-history-and-recovery.md)
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

The implementer is batching fixes, followed by focused regressions, the complete changed-feature/critical suite, and independent re-review. P007 remains active and In progress. The [dedicated live-account gate](../2026-09-07-171225-live-runtime-credentials.md) remains a separate prerequisite; fixture/native non-model checks cannot close it. Record the corrected source identity and results before resolving and archiving this review issue.

## Corrective review checkpoint — 7 September 2026

Two independent review rounds now close on feature commit `93a034a444cc95b6d8da8f5c6a905d1fc0f256c9`, source digest `90aa34aa3d55516ce3e4a0209cb697d10011a07d8314f07955a4499470e5a507` (812 files). Check/build, nine integration tests, thirteen contracts and full real P001/P007 E2E `harbor-e2e-2f859a3a33` passed; the E2E source digest matched at both ends. The implementer recorded Node 26.7.0, pnpm 12.3.4, Chromium 1194 and Codex 0.153.4 with disposable external fixtures.

The second review required an event inserted between snapshot and subscription, plus supervisor restart while durable recovery settlement remained pending. Those assertions were corrected. A later real database-outage run exposed an unhandled error from a checked-out PostgreSQL client, beyond the earlier idle-pool handling. The final fix keeps query errors and the supervisor's fatal lease response intact while preventing an unrelated API process crash; exact owned-backend termination and full database-outage/recovery tests passed and received focused independent review. Duplicate React keys in adjacent history/recovery controls were also corrected and visually checked.

All six original findings and the subsequent bounded corrections passed their feature-branch checks. This issue stays active until P003/P002 integration and the combined regression are recorded; independent branch evidence does not establish shared writer/recovery behavior.

## Resolution — 7 September 2026

All findings are resolved after two feature review rounds and separate P002/P003/P007 integration review with no remaining actionable finding. Combined acceptance covers active archival, current authority, restart settlement, exact workspace generation release, derived-checkout preservation, repeated recovery and explicit new-input continuation. Original uncertain work remains visible and is never automatically replayed.

Reviewed integration `0118dfe`/`ca1a2cf` has source `2976f6286a9aea9645e2a27dfcb497e677c5268d5ff034593752dc98211b40bd` (842 files). Node 24.11.1 on macOS arm64 passed check/build, 9 integration tests, 15 pinned Codex 0.153.4 contracts and 8 workspace tests. Full real Harbor P001/P002/P007 E2E `harbor-e2e-10d1a7178a` and workspace E2E `harbor-workspaces-a5ce817a7b` exited 0 with identical start/end digests. Runs used PostgreSQL 17.6, Chromium 1194 and disposable external OIDC/Codex fixtures; cleanup affected only run-owned resources. Independent review accepted the unchanged native boundary's separate P003 Linux evidence.

The [integration report](../../docs/reports/2026-09-07-p007-history-integration.md) records exact checks and limitations. This resolves this finding, not its proposals: the [dedicated live-account gate](../2026-09-07-171225-live-runtime-credentials.md) and separately tracked gateway/deployment obligations remain open. Earlier sections preserve historical discovery and intermediate status.

## Ownership navigation — 20 September 2026

The disposition and evidence above are historical. Retired proposal references identify feature lineage; any unfinished inherited acceptance is retained in the [active inbox](../) and the [current subsystem designs](../../design/systems/). The P017 baseline migration did not resolve another finding or rerun this record’s checks.
