# Maximum-size source capture does not fit its framed upload

- Severity: Low
- Status: In progress
- Owner: P010 implementer; separate verifier reviewer checks the correction
- Affected files: `infra/self/transport.py`, `infra/self/commands.py`, `infra/self/worker.py`, `infra/self/exchange.py`, source-transfer boundary tests
- Acceptance: [P010-01/03/07](../design/proposals/010-self-development.md#independent-acceptance)

## Evidence and impact — 13 September 2026

Independent source review of frozen verifier checkpoint `bd372e1` found that `transport.py:163–166` accepts an archive of exactly 300 MiB. `commands.py:113–125` prepends its protocol header, while `worker.py:363–366` and `exchange.py:77–79` cap the complete upload at 300 MiB. The accepted archive therefore cannot fit once framing is included; transfer fails and the job becomes uncertain.

The consumer mismatch predates this checkpoint; the new producer ceiling does not itself align the framing allowance. This is a source-proven boundary case, not a runtime reproduction or a claim that an observed full candidate failed for this reason. The review found no additional report-authority, artifact/evidence binding, ready-settlement or capacity-release defect in the bounded verifier increment. Actual complete candidate execution remains a separate pending gate.

## Correction and next steps

Align accepted archive bytes with the bounded total upload, including its protocol header, while preserving an explicit finite wire limit. Add a focused boundary regression for the largest accepted payload and rejection immediately beyond it; exercise the real framing/consumer boundary without treating an unexecuted 300 MiB fixture as runtime evidence. The implementer has the finding. Record the correction's source identity, commands/environment/results, independent review and main integration before resolving and archiving.
