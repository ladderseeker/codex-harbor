# Common-use live history and restart acceptance is incomplete

- Severity: High; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: High
- Status: Blocked
- Owner: P007 live verification; main coordinates the common-use release

- Recorded: 2026-09-13 11:03:15 Asia/Shanghai
- Affected files: `tests/live/run.ts`, `tests/workspaces/live.ts`, P007 live acceptance and current release documentation
- Acceptance: [P007-07](../design/proposals/archive/007-session-history-and-recovery.md#independent-acceptance), with the relevant inherited [P001-08](../design/proposals/archive/001-secure-persistent-conversations.md#independent-acceptance) real-runtime boundary

## Initial audit — root `2d88e99`, 13 September 2026

The common-use scope audit inspected root `2d88e99`. At that revision, the default live command created the real runtime adapter and managed storage directly. The workspace live lane also invoked the runtime directly. These were useful boundary checks, but neither implemented the required native-history restart/resume scenario. There was no history-specific live route in `tests/live/run.ts`.

The deterministic P007 application tests and pinned non-model contracts had separate recorded evidence. They did not establish the bounded authenticated history/restart outcome required by P007-07. At that audit, supplying a test key alone would not have completed the missing scenario. No failure of an actual live history run was claimed: the scenario was then unimplemented and unexecuted. The later implementation is recorded below; authenticated execution remains unverified.

## Next action

Run the implemented `pnpm test:live --history` on the supported trusted Linux/XFS fixture when dedicated test credentials and an explicitly selected supported `HARBOR_TEST_CODEX_MODEL` are configured. Preserve its source identity, two-turn bound, exact retirement/history assertions and owned cleanup. Current acceptance cannot be closed from the no-model driver tests.

This is a specialist native/account check. The existing real Harbor UI/API/database/supervisor deterministic P007 acceptance remains the application-level evidence; the new lane must not describe a direct adapter test as application E2E. Reusing that separation avoids constructing a second application harness while preserving the distinct mandatory real-runtime gate.

The [dedicated credential prerequisite](2026-09-07-171225-live-runtime-credentials.md) remains a separate execution blocker. On 13 September, a presence-only check again found `HARBOR_TEST_OPENAI_API_KEY` unset; no personal credentials were inspected. Keep both obligations visible under [D009](../design/decisions/009-common-use-release.md). Do not close P007 or claim the common-use release fully verified until this acceptance passes.

## Review and closing record

The source gap was identified by the independent common-use scope audit and confirmed by main through the live entry points. This record reports missing acceptance coverage, not an independently reproduced application defect.

On 2026-09-13, driver implementation and two independent review rounds completed at `7e75de8`, then the three test-only files were integrated on the common-use baseline. Exact integrated source `df0d2b97fb062d75378b791f7e981d08171adaba7fcec4bc479f3499ae057dd8` /1,041 passed typecheck, formatting and five no-model checks. Canonical `pnpm test:live --history` returned exit 2 for missing dedicated credentials before resources/model effects. The [driver report](../docs/reports/2026-09-13-p007-live-history-driver.md) retains review scope, logs, source qualifications and the corrected local CLI invocation failure.

The missing driver is now implemented, but actual native/account execution remains unverified. Keep this issue Blocked and P007 active until that mandatory acceptance passes; neither fixture tests nor this partial closing note resolve the gate.
