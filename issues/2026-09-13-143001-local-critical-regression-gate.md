# Critical browser regression did not reach the replay-gap scenario

- Severity: High (mandatory verification gate)
- Status: Open
- Owner: P013 / regression maintainer
- Affected files: `tests/e2e/run.ts:1004`; relevant application cause not established.
- Evidence date: 2026-09-13.
- Proposal: [P013](../design/proposals/013-personal-local-experience.md).

## Evidence and impact

`pnpm test:e2e` exited 1 on macOS Node 24.11.1 after the attachment/history association and P002 programmatic checks passed. At line 1004, following retention maintenance and navigation to the retained conversation, `getByLabel('Message Codex')` did not appear within five seconds. Artifacts remain in `.test-runs/harbor-e2e-6d2d3823db/`; the harness did not retain a failure URL/DOM/network snapshot at this point.

Independent bounded source assessment found no evidence establishing whether this is an application regression, authentication/loading failure or harness problem. Do not call it pre-existing or flaky. The local runtime changes are profile-gated, but that fact alone cannot establish an unrelated cause. The earlier passed `1704c722e8` report remains historical evidence at its own source digest.

The separate personal local E2E passed, and the owner completed a real native account conversation. Those outcomes do not replace this required critical regression. P013 remains Implemented and unverified.

## Next action

Add bounded secret-free diagnostics at the failure point (page URL path, DOM/console error, failed API status/route, target snapshot presence), then perform one instrumented rerun. Investigate and fix any established application defect and independently review the result. Do not repeatedly rerun an unchanged suite without additional evidence.

See the [local delivery report](../docs/reports/2026-09-13-personal-local-experience.md) for completed checks and their limits.
