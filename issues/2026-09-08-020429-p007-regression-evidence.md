# Preserve the history regression's original failure

- Severity: Medium
- Status: In progress
- Owner: P006 regression implementer; independent runtime reviewer; main-agent integration
- Recorded: 2026-09-08
- Affected files: tests/e2e/p007.ts, credential-cleanup assertions
- Acceptance: [P007](../design/proposals/007-session-history-and-recovery.md#independent-acceptance), critical regression gate

## Evidence and impact

Critical run `harbor-e2e-82771d0087` passed P002's corrected rate burst and P005, then failed the inherited P007 credential restoration in a `finally` block: HTTP 200 was expected, but 409 was returned. The cleanup assertion may have replaced an earlier failure in the quota/control-reserve block. Neither the original assertion nor a safe response code was retained, so no production cause or terminal regression is established.

Source inspection provides two leads: an earlier failure can leave the held approval active, and credential cleanup explicitly rejects an overlap with supervisor discovery/recovery. Neither lead explains the historical run without additional evidence.

## Next steps

Preserve the original exception and record bounded assertion location/type, numeric statuses, safe error codes and active state counts separately from cleanup failure. Do not log credential values, payloads or raw request headers. Diagnose the first failure, apply only the supported correction, independently review it and rerun the critical suite. Do not accept an unexplained successful rerun as a fix or silently retry arbitrary failed mutations.
