# Dedicated credentials are unavailable for live Codex acceptance

- Severity: High; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: High
- Status: Blocked
- Owner: [P001](../design/proposals/archive/001-secure-persistent-conversations.md#source-issues); later proposals inherit this prerequisite only for their required real-account tests

- Recorded: 2026-09-07 17:12:25 Asia/Shanghai
- Category: Verification environment prerequisite
- Affected: P001-08 and subsequent acceptance criteria requiring authenticated real Codex turns; `tests/live/run.ts`

## Evidence

A presence-only environment check found `HARBOR_TEST_OPENAI_API_KEY`, `HARBOR_LIVE_API_KEY`, `OPENAI_API_KEY`, and `HARBOR_TEST_CODEX_HOME` unset. No dedicated test configuration exists in the starting repository. The enabled tool catalog has no OpenAI API-key provisioning tool. Personal Codex state and credentials have not been inspected or reused.

The pinned local Codex executable is version 0.153.4, and the Docker engine reports a Linux aarch64 environment. These permit non-model protocol contracts and actual Linux isolation work; they do not establish authenticated model behavior.

On 2026-09-07, `pnpm test:live` returned exit 2 with an explicit missing-credential result and no model request. The implemented lane now uses the dedicated Linux XFS fixture and production launcher/storage path. Its authenticated scenarios remain unexecuted; this exit is evidence of the blocked gate, not a passing live test.

## Impact and next steps

On 2026-09-13, the common-use scope review repeated a presence-only check of the dedicated key and found it unset. It also identified a separate [P007 live history/restart coverage gap](2026-09-13-110315-common-use-live-acceptance.md). Credential availability alone does not satisfy that unimplemented scenario; this prerequisite record does not imply every required live driver is complete.

Later on 2026-09-13, the bounded P007 driver was implemented, integrated and independently reviewed in two rounds. Its [report](../docs/reports/2026-09-13-p007-live-history-driver.md) records five passing no-model checks and an actual unavailable-prerequisite exit. The earlier missing-driver observation remains historical; authenticated execution is now the outstanding P007 gate and is still blocked by the dedicated credential prerequisite.

The required real-account smoke cannot currently run. This blocks P001 verification and any later proposal's live acceptance gate that remains dependent on the missing credentials. It does not block implementing those paths, deterministic application acceptance, non-model runtime contracts, or Linux isolation tests.

The live runner must accept explicitly configured dedicated test credentials, create fresh run-specific state/workspaces, bound model usage, and redact secrets. Once the credential prerequisite is available, run each required live scenario and record the version, source/artifact identity, command, environment, result, and meaningful limitations. No passing fixture or unavailable-test exit may be counted as live acceptance. Keep this record active until actual live evidence closes the affected gates.

## Retained acceptance ownership — 20 September 2026

Remaining dedicated-account scenarios are P001-08 (conversation/approval/cancel), P003-06 (parallel turns), P005-06 (image/file input), P007-07 (native history/restart/resume), P008-07 (unattended occurrence), P009-01/07 (deployed conversation/account), deferred P010-07 (real coding conversation), and deferred P012-06 (skill and model-directed MCP with effect/input evidence). P002 retains only its applicable inherited runtime boundary; no distinct missing token scenario is invented. Credential availability alone does not prove that every driver exists or passes. Personal P013/P015 owner trials do not close these dedicated managed-profile lanes.
