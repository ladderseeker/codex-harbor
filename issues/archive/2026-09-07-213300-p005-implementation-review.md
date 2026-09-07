# P005 implementation review findings

- Severity: Medium
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-07
- Owner: [P005](../../design/proposals/005-attachments-and-rich-input.md)
- Recorded: 2026-09-07
- Affected files: packages/attachments/src/store.ts; packages/attachments/src/media.ts; apps/web/src/Attachments.tsx
- Acceptance: P005-02/04/05

## Round 1 evidence

A separate agent reviewed the in-progress P005 implementation based on `fb6127a`. Production work and acceptance coverage were still changing, so this is a bounded finding batch rather than a frozen-source completion review. The reviewer read the API, draft/attachment store, parser, publication/mount, adapter and upload UI paths without modifying them or repeating tests.

| Finding | Impact and required correction |
| --- | --- |
| Draft cleanup selects sessions only from expired attachment records. | Text-only drafts and drafts referencing only already-attached files can retain their text indefinitely after the promised expiry. Select expired nonempty drafts independently, clear their private payload/references under the same coordination, and prove that referenced submitted content remains intact. |
| Pause during asynchronous hashing or upload-record creation does not stop the later binary transfer. | The UI can show a paused attempt which subsequently starts sending bytes. Give the whole attempt a cancellation identity, check it after asynchronous boundaries, and reconcile any already-accepted metadata under the same upload identity. Exercise pause before hashing finishes and while metadata creation is pending. |
| PNG chunk names are decoded with ASCII before their exact bytes are validated. | High-bit byte aliases can be interpreted as known critical chunk names when CRC is recomputed. Reject invalid chunk-type bytes before decoding/classification and add a malformed-CRC-valid regression alongside valid PNG acceptance. |

These are source-review findings; their real API/UI/parser reproductions and corrected-source results belong in the closing evidence. No additional actionable publication/mount/adapter defect was reported in this bounded read. That observation does not close acceptance coverage or the later combined-feature authority review.

## Disposition

The feature corrections and three review rounds are complete in commit `088c15a`; combined-feature integration remains in progress. Preserve the same attachment and turn identities across ambiguous responses, keep expired draft cleanup separate from referenced-content deletion, and retain explicit supported-media limits. Verify the final project/workspace identity and current authority integration before resolution and archival. The [dedicated live-account gate](../2026-09-07-171225-live-runtime-credentials.md) remains separate.

## Round 2 follow-up

The second review accepted the three original corrections and their evidence, then identified a Medium stale-response defect. A delayed accepted turn from conversation A could invoke its old draft reload after the owner switched to B, change shared readiness/generation, then discard the response and leave B's composer loading. The correction guards the captured render generation and current session before any shared mutation, including an A-to-B-to-A transition.

The attachment Linux boundary passed at source `dac75e7972f4c58dc008cf428725ffd390497764d1bbdaa6d0896ab94de63c11` (818 files). The later UI/acceptance-only correction changes the full source digest; it does not by itself invalidate the unchanged publication/mount evidence. Final reports must identify both checkpoints and the exact delta, alongside the final application result.

## Round 3 and integration checkpoint

The separate reviewer closed the focused stale-completion review with no remaining actionable finding. Full P001/P002/P005 E2E run `474e555564` exited 0 at source `3bc9345e363d6d614da725da402492f51c06d68a21fba9c83a5a111db37f85c5` (818 files, identical start/end), including a held A turn response followed by B's editable, persisted draft. Check and build passed; 11 integration checks and 14 real-runtime contracts passed on the unchanged underlying modules. The Linux checkpoint above retains its distinct source digest. The dedicated live lane exited 2 without credentials and made no model request.

Commit `088c15a` preserves this reviewed feature checkpoint. The implementation originally assumed P001's Local checkout; its P003 integration must pass the managed project identity separately from the selected derived workspace. Current P002 authority and P007 recovery integration also require combined acceptance before this issue is archived. These remaining obligations keep the issue active; completed source review alone is not combined-feature evidence.

## Resolution — 7 September 2026

The original draft expiry, early pause, PNG validation and stale conversation completion findings are resolved after three feature review rounds. A separate cumulative integration review closed with no actionable finding across P002 current authority, P003 project/checkout identity, P007 recovery association and the combined UI. Reviewed integration commits `c8ba37b`/`cb6be0d` preserve source `b4de09a4f03ab6857b9c966e21a7a3dfcdd932afdb366ff0b1da9c7a7ba88d71` (854 files).

On macOS arm64 with explicitly selected Node 24.11.1, pnpm 12.3.4, PostgreSQL 17.6, Chromium 1194 and Codex 0.153.4, full P001/P002/P005/P007 E2E `harbor-e2e-055d710de4` and P003 workspace regression `harbor-workspaces-052aaf86a4` exited 0 with that same start/end source. Check passed on that source; build, 11 integration checks and 16 contracts passed before its diagnostics-only test delta. Actual Linux API/PostgreSQL/supervisor publication, deferred COMMIT retry, Local/derived native mounts and identity denials passed on source `3f216ef3586a65f2fb273d25bb0827453a3b8789872dd2bf05f7bee5f2f1ca97` (854 files). Only two application E2E files changed afterward; production and Linux assertions are byte-identical. The Linux host used Ubuntu 24.04 arm64, kernel 6.8.0-134, Docker 29.1.3, Node 24.11.1 and actual XFS project quotas. All run-owned resources were cleaned, preserving the VM baseline.

The [integration report](../../docs/reports/2026-09-07-p005-integration.md) identifies each source/checkpoint, review and limitation. A one-off visibility timeout without a captured failure page remains a separate [acceptance diagnostic finding](../2026-09-07-224419-p005-reload-visibility.md); no production fix is claimed for that unexplained failure. The mandatory dedicated live-account response gate remains blocked, so resolving this review does not make P005 Verified or completed. Earlier sections retain intermediate state and evidence.
