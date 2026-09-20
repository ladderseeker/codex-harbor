# Maximum-size source capture does not fit its framed upload

- Severity: Low; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: Low
- Status: In progress
- Owner: P010 implementer; separate verifier reviewer checks the correction

Complete deferred outcome and acceptance are tracked in [2026-09-20-000003-self-development-acceptance.md](2026-09-20-000003-self-development-acceptance.md); this record retains its individual finding and correction evidence.

- Affected files: `infra/self/transport.py`, `infra/self/commands.py`, `infra/self/worker.py`, `infra/self/exchange.py`, source-transfer boundary tests
- Acceptance: [P010-01/03/07](../design/proposals/archive/010-self-development.md#independent-acceptance)

## Evidence and impact — 13 September 2026

Independent source review of frozen verifier checkpoint `bd372e1` found that `transport.py:163–166` accepts an archive of exactly 300 MiB. `commands.py:113–125` prepends its protocol header, while `worker.py:363–366` and `exchange.py:77–79` cap the complete upload at 300 MiB. The accepted archive therefore cannot fit once framing is included; transfer fails and the job becomes uncertain.

The consumer mismatch predates this checkpoint; the new producer ceiling does not itself align the framing allowance. This is a source-proven boundary case, not a runtime reproduction or a claim that an observed full candidate failed for this reason. The review found no additional report-authority, artifact/evidence binding, ready-settlement or capacity-release defect in the bounded verifier increment. Actual complete candidate execution remains a separate pending gate.

## Correction and next steps

Align accepted archive bytes with the bounded total upload, including its protocol header, while preserving an explicit finite wire limit. Add a focused boundary regression for the largest accepted payload and rejection immediately beyond it; exercise the real framing/consumer boundary without treating an unexecuted 300 MiB fixture as runtime evidence. The implementer has the finding. Record the correction's source identity, commands/environment/results, independent review and main integration before resolving and archiving.

## Isolated correction and review — 13 September 2026

Checkpoint `81f8d700af14f2a3934ef924d533067586e19599` keeps the 300 MiB source payload ceiling and adds a fixed 4,096-byte framing allowance to the finite wire bound. The local Python peer/pump tests exercise the exact 300 MiB plus 4,096-byte wire limit, one excess byte, and rejection of an oversized requested cap before peer creation. Payload/header validation was source-inspected; no guest or image change is required. The implementer's `python3 -m unittest discover -s tests/self -p exchange_test.py` passed three tests, and the complete `*_test.py` discovery passed 58 tests on the local macOS Python environment.

The original command output was in the tool transcript and was not redirected to raw logs. The explicitly transcript-derived addendum `.test-runs/upload-framing/result-transcript.json` in the P010 worktree has SHA-256 `3cada2cb3208e9f1762769eb474203cfbc2bd802d22b09b67f2457309c2b4565`. A separate reviewer matched its five source/test hashes to the checkpoint, inspected the real boundary tests and closed the Low source finding without another actionable issue. The reviewer did not rerun those tests. Main integration and full actual source-upload/candidate acceptance remain pending; this issue stays In progress.
