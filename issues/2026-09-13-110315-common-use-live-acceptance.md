# Common-use live history and restart acceptance is incomplete

- Severity: High
- Status: In progress
- Recorded: 2026-09-13 11:03:15 Asia/Shanghai
- Owner: P007 verification (bounded native-history driver); main coordinates the common-use release
- Affected files: `tests/live/run.ts`, `tests/workspaces/live.ts`, P007 live acceptance and current release documentation
- Acceptance: [P007-07](../design/proposals/007-session-history-and-recovery.md#independent-acceptance), with the relevant inherited [P001-08](../design/proposals/001-secure-persistent-conversations.md#independent-acceptance) real-runtime boundary

## Evidence and impact

The common-use scope audit inspected root `2d88e99`. The default live command creates the real runtime adapter and managed storage directly. The workspace live lane also invokes the runtime directly. These are useful boundary checks, but neither implements a Harbor conversation's native-history restart/resume scenario. There is no history-specific live route in `tests/live/run.ts`.

The deterministic P007 application tests and pinned non-model contracts have separate recorded evidence. They do not establish the bounded authenticated history/restart outcome required by P007-07. Supplying a test key alone will not complete that missing scenario. No failure of an actual live history run is claimed: that acceptance remains unimplemented and unexecuted.

## Next action

Implement a bounded P007 live history/restart scenario against the pinned runtime using fresh, run-owned managed workspace and native state. Complete a turn, confirm retirement of the exact owned runtime, reopen/read/resume its persisted thread in a new runtime generation, and complete one explicit new turn without resending the original input. Preserve exact source/artifact identity, model, deadlines, results and owned cleanup; add independent review and the appropriate no-model driver checks before running it.

This is a specialist native/account check. The existing real Harbor UI/API/database/supervisor deterministic P007 acceptance remains the application-level evidence; the new lane must not describe a direct adapter test as application E2E. Reusing that separation avoids constructing a second application harness while preserving the distinct mandatory real-runtime gate.

The [dedicated credential prerequisite](2026-09-07-171225-live-runtime-credentials.md) remains a separate execution blocker. On 13 September, a presence-only check again found `HARBOR_TEST_OPENAI_API_KEY` unset; no personal credentials were inspected. Keep both obligations visible under [D009](../design/decisions/009-common-use-release.md). Do not close P007 or claim the common-use release fully verified until this acceptance passes.

## Review and closing record

The source gap was identified by the independent common-use scope audit and confirmed by main through the live entry points. This record reports missing acceptance coverage, not an independently reproduced application defect. A bounded driver is now being implemented in an isolated worktree; execution evidence and resolution remain pending.
