# Preserve the history regression's original failure

- Severity: Medium
- Status: Open
- Owner: Regression maintainer; independent runtime reviewer
- Recorded: 2026-09-08
- Affected files: tests/e2e/p007.ts, credential-cleanup assertions
- Acceptance: [P007](../design/proposals/007-session-history-and-recovery.md#independent-acceptance), critical regression gate

## Evidence and impact

Critical run `harbor-e2e-82771d0087` passed P002's corrected rate burst and P005, then failed the inherited P007 credential restoration in a `finally` block: HTTP 200 was expected, but 409 was returned. The cleanup assertion may have replaced an earlier failure in the quota/control-reserve block. Neither the original assertion nor a safe response code was retained, so no production cause or terminal regression is established.

Source inspection provides two leads: an earlier failure can leave the held approval active, and credential cleanup explicitly rejects an overlap with supervisor discovery/recovery. Neither lead explains the historical run without additional evidence.

## Next steps

Preserve the original exception and record bounded assertion location/type, numeric statuses, safe error codes and active state counts separately from cleanup failure. Do not log credential values, payloads or raw request headers. Diagnose the first failure, apply only the supported correction, independently review it and rerun the critical suite. Do not accept an unexplained successful rerun as a fix or silently retry arbitrary failed mutations.

## Diagnostic delivery and current disposition — 8 September 2026

Commit `7aa3d1267e93eb50999fa68ce52a1dcf7df0a080`, included in P006 handoff `f033824b495c1b42fe2c6fd9e9d94bac8db8db3f`, records original assertion metadata separately from cleanup status, a bounded uppercase error code, and active-operation/recovery state counts. If cleanup also throws, the original failure remains the thrown error. No mutation retry or production change was added; the separate reviewer accepted this bounded diagnostic correction.

The first diagnostic edit used an undeclared artifact-path variable; run `4536fcf036` failed during diagnostic writing and establishes no original P007 cause. That test-edit mistake was corrected, and full check passed before the next run. Critical `harbor-e2e-211efe006b` then passed on Node 24.11.1, exact start/end source `1f83957bf23aa55479a6a05679ff9e6bdf8fb03f5437b97d2ad120e13dfc1204`, 876 files. Its cleanup artifact records HTTP 200, no error code, no active operations and no prior quota failure.

The successful instrumented run makes no retrospective claim about the earlier409. Keep this Medium observation Open and inspect the retained bounded diagnostics if it recurs; do not repeat broad suites solely to recreate an uncaptured historical result. The [terminal report](../docs/reports/2026-09-08-p006-development.md#final-reviewed-branch-handoff) preserves the passing regression and distinct historical failures.
