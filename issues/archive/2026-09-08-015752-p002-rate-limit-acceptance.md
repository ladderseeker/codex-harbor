# Make the rate-limit acceptance burst deterministic

- Severity: Medium
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-08
- Owner: P006 regression implementer; independent runtime reviewer; main-agent integration
- Recorded: 2026-09-08
- Affected files: tests/e2e/p002.ts
- Acceptance: [P002-06](../../design/proposals/002-programmatic-api-access.md#independent-acceptance), critical regression gate

## Evidence and impact

P006 critical run `harbor-e2e-78be409ad3` failed the inherited P002 assertion around line 1161: a sequential loop of at most 205 project reads did not observe HTTP 429. The failing harness retained neither request counts by status nor elapsed burst time. A timing explanation is plausible from the source, but is not established for that run.

The production ordinary-IP bucket permits 200 requests in a 10-second interval starting at its first request. Crossing a reset while issuing 205 sequential reads can distribute them across two permitted intervals. This makes the existing assertion an unreliable release gate, even if the limiter enforces its contract correctly. No production limit defect has been reproduced.

## Correction and next steps

Replace the test loop with a finite, fixed-concurrency read-only burst and an explicit elapsed deadline, retaining sanitized status counts and duration on failure. Assert ordinary success as well as the declared retryable rate-limit response. Preserve the production 200/10-second policy; add no request retry or mutation. Review the correction independently and run the complete critical suite on the corrected source before closing this record. The historical failure remains unexplained unless new evidence supports attribution.

## Reviewed correction checkpoint — 8 September 2026

The separate reviewer found no actionable defect in the test-only correction: concurrency 8, at most 405 reads, a nine-second request budget, an explicit sub-ten-second assertion, and status/elapsed evidence. Run `harbor-e2e-82771d0087` recorded 195 successful reads and five retryable HTTP 429 responses in 375 milliseconds. Production rate policy was unchanged. The complete run subsequently failed in [P007 cleanup](../2026-09-08-020429-p007-regression-evidence.md), so this checkpoint is specific rate-test evidence, not a successful full critical regression or an explanation of the original uninstrumented failure.


## Resolution — 8 September 2026

Test commit `75f023061f9af8cf5238b6621223c084eefaa9e2`, included in reviewed P006 handoff `f033824b495c1b42fe2c6fd9e9d94bac8db8db3f`, preserves the production policy and makes the request/count/deadline contract explicit. Independent review closed with no actionable finding. Full critical `pnpm test:e2e` passed as `harbor-e2e-211efe006b` on Node 24.11.1, Codex 0.153.4 and Chromium 1194, with identical start/end source `1f83957bf23aa55479a6a05679ff9e6bdf8fb03f5437b97d2ad120e13dfc1204`, 876 files. Its retained rate result is 195 successful reads and five retryable 429s in 372 ms. Full check passed before execution. Root imported the exact reviewed test bytes.

The [terminal integration report](../../docs/reports/2026-09-08-p006-development.md#final-reviewed-branch-handoff) preserves the test-only deltas and failed checkpoints. This closes the unreliable rate assertion, not a production defect or a retrospective explanation of the uninstrumented historical failure. The separate P007 observation remains open with improved diagnostics.
