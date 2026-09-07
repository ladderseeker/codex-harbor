# Make the rate-limit acceptance burst deterministic

- Severity: Medium
- Status: In progress
- Owner: P006 regression implementer; independent runtime reviewer; main-agent integration
- Recorded: 2026-09-08
- Affected files: tests/e2e/p002.ts
- Acceptance: [P002-06](../design/proposals/002-programmatic-api-access.md#independent-acceptance), critical regression gate

## Evidence and impact

P006 critical run `harbor-e2e-78be409ad3` failed the inherited P002 assertion around line 1161: a sequential loop of at most 205 project reads did not observe HTTP 429. The failing harness retained neither request counts by status nor elapsed burst time. A timing explanation is plausible from the source, but is not established for that run.

The production ordinary-IP bucket permits 200 requests in a 10-second interval starting at its first request. Crossing a reset while issuing 205 sequential reads can distribute them across two permitted intervals. This makes the existing assertion an unreliable release gate, even if the limiter enforces its contract correctly. No production limit defect has been reproduced.

## Correction and next steps

Replace the test loop with a finite, fixed-concurrency read-only burst and an explicit elapsed deadline, retaining sanitized status counts and duration on failure. Assert ordinary success as well as the declared retryable rate-limit response. Preserve the production 200/10-second policy; add no request retry or mutation. Review the correction independently and run the complete critical suite on the corrected source before closing this record. The historical failure remains unexplained unless new evidence supports attribution.

## Reviewed correction checkpoint — 8 September 2026

The separate reviewer found no actionable defect in the test-only correction: concurrency 8, at most 405 reads, a nine-second request budget, an explicit sub-ten-second assertion, and status/elapsed evidence. Run `harbor-e2e-82771d0087` recorded 195 successful reads and five retryable HTTP 429 responses in 375 milliseconds. Production rate policy was unchanged. The complete run subsequently failed in [P007 cleanup](2026-09-08-020429-p007-regression-evidence.md), so this checkpoint is specific rate-test evidence, not a successful full critical regression or an explanation of the original uninstrumented failure.
