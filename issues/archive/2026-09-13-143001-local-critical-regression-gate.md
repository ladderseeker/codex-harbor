# Critical browser regression did not reach the replay-gap scenario

- Severity: High (mandatory verification gate)
- Archive disposition: Resolved
- Resolution date: 2026-09-13
- Owner: P013 / regression maintainer
- Affected files: `tests/e2e/run.ts:1004`; relevant application cause not established.
- Evidence date: 2026-09-13.
- Proposal: [P013](../../design/proposals/archive/013-personal-local-experience.md).

## Evidence and impact

`pnpm test:e2e` exited 1 on macOS Node 24.11.1 after the attachment/history association and P002 programmatic checks passed. At line 1004, following retention maintenance and navigation to the retained conversation, `getByLabel('Message Codex')` did not appear within five seconds. Artifacts remain in `.test-runs/harbor-e2e-6d2d3823db/`; the harness did not retain a failure URL/DOM/network snapshot at this point.

Independent bounded source assessment found no evidence establishing whether this is an application regression, authentication/loading failure or harness problem. Do not call it pre-existing or flaky. The local runtime changes are profile-gated, but that fact alone cannot establish an unrelated cause. The earlier passed `1704c722e8` report remains historical evidence at its own source digest.

The separate personal local E2E passed, and the owner completed a real native account conversation. Those outcomes do not replace this required critical regression. P013 remains Implemented and unverified.

## Original next action (completed)

Add bounded secret-free diagnostics at the failure point (page URL path, DOM/console error, failed API status/route, target snapshot presence), then perform one instrumented rerun. Investigate and fix any established application defect and independently review the result. Do not repeatedly rerun an unchanged suite without additional evidence.

See the [local delivery report](../../docs/reports/2026-09-13-personal-local-experience.md) for completed checks and their limits.

## Resolution — 13 September 2026

The instrumented critical suite passed under P014 at source `9edea343237543c013862ce86f6f9f55ce5d327b39f1cfaef5e18f126bb84904` (1,057 files, matching start/end digest), macOS Node 24.11.1, Chromium 1194, real Caddy/API/PostgreSQL/supervisor with external OIDC/Codex fixtures. Command: `pnpm test:e2e`; artifact: `.test-runs/harbor-e2e-a8116c0385/`. This includes the retained-conversation composer and subsequent replay-gap assertions. Structural failure diagnostics now retain bounded same-origin routes/status and target-snapshot status without secrets.

Three implementation review rounds and an independent bounded test-correction review found no remaining critical findings. New sidebar selectors were scoped to chat links and composer drop coverage was added; a mistaken text-attachment path assertion was corrected to the existing inline-text contract. No production cause is established for the original uncaptured failure, and no such cause is inferred from unrelated later test failures. The current mandatory regression gate is satisfied; P013 overall closure remains a separate lifecycle action. See the [P014 evidence report](../../docs/reports/2026-09-13-frontend-redesign.md).

## Ownership navigation — 20 September 2026

The disposition and evidence above are historical. Retired proposal references identify feature lineage; any unfinished inherited acceptance is retained in the [active inbox](../) and the [current subsystem designs](../../design/systems/). The P017 baseline migration did not resolve another finding or rerun this record’s checks.
