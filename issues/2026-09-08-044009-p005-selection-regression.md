# Attachment draft sequence intermittently fails to reach its expected state

- Severity: Medium
- Status: In progress
- Owner: Regression maintainer; P008 implementer investigating the observed run
- Affected files: `tests/e2e/p005.ts`, `apps/web/src/Attachments.tsx`, draft-loading and attachment request boundaries; production cause unestablished
- Acceptance: [P005-01/05](../design/proposals/005-attachments-and-rich-input.md#independent-acceptance), critical regression gate

## Evidence and impact — 8 September 2026

P008 cumulative runs `de494a3ad5` and `9a406b0873` failed the existing `Selected for this message` visibility assertion after navigation and file selection, before the subsequent reload. The latter used source `1f91692c5091df9e9ce401203acc9ca8b5fa58ed2ef9b2581c695f612e62a909` /985 files and awaited an enabled visible Attach control before calling the hidden input's `setInputFiles`.

Inspection after the first failure found that hidden-input automation could bypass the disabled visible control while the rich draft was loading. Waiting for the actual control was an appropriate harness precondition. A subsequent passing run did not establish that this explained the first failure; recurrence with that precondition requires a cause-specific diagnostic. No attachment production change, mutation retry or relaxed assertion has been made. P008's scheduling changes are not established as the cause.

This observation is distinct from the [resolved request-pressure harness issue](archive/2026-09-07-224419-p005-reload-visibility.md), which had a captured 429 at a different boundary. Do not infer a shared cause from similar visible symptoms or treat a successful rerun as a fix.

## Diagnostic checkpoint and next steps

A subsequent test-only diagnostic records bounded request method/path/status/failure metadata and attachment/draft state on failure, omitting headers, bodies, file content and credentials. Cumulative run `6a3bf52ef0` passed on Node 24.11.1 with matching source `c3abd75c6c73174c9650e56d2168703a66227b15a5a770ae2cbeda0e2dfbbec8` /985 files. It supplies no failure diagnostic for the earlier runs. Independent diagnostic review and its final committed identity remain pending.

Retain each original result and inspect the diagnostic if the symptom recurs; do not repeat broad suites solely to reproduce an uncaptured historical failure. Diagnose the observed boundary before changing product or test behavior. Independently review a supported correction and verify the unchanged selection/persistence outcome. If no cause is established, keep this observation Open after the bounded diagnostic is delivered.

## Expanded observation — 8 September 2026

Integrated run `8405f19db0` failed before selection because the visible Attach control remained disabled during the unchanged five-second wait. Run `250f0fb20a` passed readiness and selection but failed the subsequent unchanged draft-saved wait before reload. Neither prior diagnostic catch covered its full failing phase; both original results remain retained. The diagnostic now covers the complete load/readiness/selection/draft-save/reload sequence, preserves the first failure and records its phase without changing assertions, timeouts or mutations.

Critical `177ce1a3c3` passed on Node 24.11.1 at exact source `ad4517f57745bb18accd7c870767acbc22335794d02fb49a1f346e3609df7c09` /998 files; production bytes match the integrated P008 feature checkpoint. Independent review accepted the bounded diagnostic and result. Later phase-label-only refinement is separately type-checked. The passing run does not establish the earlier causes; keep this observation Open after the final diagnostic integrates rather than repeating broad suites solely for an uncaptured failure.
