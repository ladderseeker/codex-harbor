# P005 attachment checkpoint — 7 September 2026

P005 is Implemented after three independent review rounds. It provides bounded image/text uploads, rich saved drafts, exact attachment association with submitted turns, safe transcript previews/downloads, and trusted read-only Linux publication. It remains unverified: the mandatory dedicated-account image/text response gate is blocked, and cross-feature integration with incoming workspace/history work must be tested by the coordinator.

## Tested source and environment

The final application source digest is `3bc9345e363d6d614da725da402492f51c06d68a21fba9c83a5a111db37f85c5` over 818 files using `sha256-path-and-content-v1`. The final browser result `.test-runs/harbor-e2e-474e555564/result.json` records identical start/end source digests. The Linux result `.test-runs/p005-validated-linux-result.json` records matching start/end `dac75e7972f4c58dc008cf428725ffd390497764d1bbdaa6d0896ab94de63c11`; only the browser draft completion guard and its E2E assertion changed afterward. Launch/storage/adapter code is identical between those checkpoints. Source identity excludes documentation and generated build output; no application source changed during the recorded final runs.

The browser/contract host used macOS, Node 26.7.0, pnpm 12.3.4, Chromium 1194, PostgreSQL 17.6 and Caddy 2.10.2 with pinned Codex 0.153.4. The Linux attachment lane used a dedicated Ubuntu 24.04 arm64 VM, kernel 6.8.0-134, Node 24.11.1, Docker 29.1.3, and a real XFS filesystem with project quotas. All application/test databases, processes, ports, quota directories, native homes and credentials were run-owned; successful cleanup preserved the VM baseline.

## Commands and results

| Check | Result and evidence scope |
| --- | --- |
| `pnpm check` | Passed TypeScript, documentation links, public schema compilation and maintained formatting. |
| `pnpm build` | Passed TypeScript and Vite build. |
| `pnpm test` | 11/11 passed, including malformed PNG/UTF-8 boundaries and existing integration regressions. |
| `pnpm test:contract` | 14/14 passed, including exact scoped `localImage`/text inputs, caller-path denial and pinned real-runtime initialization/model/account smoke. No authenticated model response is implied. |
| `pnpm test:e2e` | Full P001/P002/P005 real Harbor browser/API/PostgreSQL/supervisor stack passed. Only external OIDC/Codex are deterministic fixtures. |
| `HARBOR_TEST_XFS_MOUNT=/srv/harbor-verification pnpm test:isolation --attachments` | Passed actual API/blob association, trusted quota-backed publication, deferred COMMIT rejection with same-inode retry, pinned native initialization/thread, read-only session mount and content/directory identity rejection. External OIDC and model-capability catalog are fixtures. |
| `pnpm test:live --attachments` | Exit 2 before a model request: dedicated `HARBOR_TEST_OPENAI_API_KEY` unavailable. This is an unmet mandatory gate, not a pass. |

The adapter contract run preceded the cleanup-candidate SQL adjustment; adapter and fixture input code were unchanged. The final integration/Linux runs include that adjustment. The later UI-only completion guard passed a fresh check/build and the complete browser suite; it did not require repeating unchanged integration or Linux boundaries. Earlier development runs exposed and corrected both test assumptions and implementation defects; their results do not supersede the final recorded source.

## Acceptance and review evidence

P005-01–05 coverage includes real file selection, drag/drop, clipboard paste, submission and transcript reload; exact external-fixture image/text references; complete-body hash enforcement; partial socket disconnect; pause during preflight and binary transfer; same-file reselect after reload; lost committed upload and turn responses without duplicate rows/operations; safe malformed/name/type handling; anonymous and cross-session denials; image modality denial; 32-record, 4 MiB session, 100 MiB instance and 512 KiB turn bounds; and draft CAS, expiry, deletion and submitted-content retention. The 100 MiB test seeds only run-owned valid per-session reservations to reach the global boundary; final admission is exercised through the authenticated API. Mobile evidence shows persisted image/text references and downloads with no horizontal clipping; desktop evidence shows the approval/composer state.

Independent review round 1 found three bounded defects: text-only/attached-only draft expiry did not select cleanup candidates, Pause could miss metadata/hash preparation, and PNG ASCII decoding accepted high-bit chunk aliases. Fixes select expired drafts independently and exclude ineligible cleanup candidates, retain a logical pause through all preflight waits, and validate raw PNG chunk-name bytes and the reserved bit. Real browser/database regressions cover the first two; parser plus authenticated upload regressions cover the malformed chunk case. Independent round 2 verified those fixes and found one remaining stale completion race: an old conversation's delayed accepted response could mutate a newly opened draft's loading state before discarding its stale result. The correction checks the captured render generation and current conversation before any shared-state mutation. A real held-response regression opens B while A's accepted response waits, then releases A and verifies B remains editable and its subsequent draft edit persists. Focused round 3 verified the exact correction, including stale A→B→A closures, with no remaining actionable finding. The final full browser run passed the new regression. Three independent review rounds are complete.

Expanded acceptance also found missing snapshot operation IDs, which prevented transcript attachment linkage after reload. The snapshot and public contract now include the operation reference. Draft responses carry a conversation/reload generation fence; publication rechecks the model's advertised modality before resolving files. Both are included in the tested source.

The Linux failure test uses a real deferred PostgreSQL constraint trigger to reject the publication transaction's final COMMIT after files exist. Repeating publication verifies and reuses the exact inode. Host-controlled content corruption and directory replacement are rejected. The lane does not simulate physical power loss, a hostile kernel, or a real image-aware model response.

## Remaining gates and current documentation

[P005](../../design/proposals/archive/005-attachments-and-rich-input.md) stays active. P005-06 requires the [dedicated live credential gate](../../issues/2026-09-07-171225-live-runtime-credentials.md); the runnable live variant requires a bounded completed response identifying the synthetic red image and exact text. Incoming P002 authority refinements and P003/P007 integration require their combined coordinator-owned validation; isolated branch evidence does not close those cross-feature gates.

The [user guide](../user/attachments.md) describes supported files, limits, drafts and recovery. The [developer guide](../developer/attachments.md) documents the implemented API/storage and test commands. P009 must register attachment/draft blobs and materialized quota directories and revalidate their identities during restore. Permanent deletion of submitted content, automatic document conversion and public sharing remain outside P005's accepted scope.

## Later integration record

The subsequent [workspace/history integration report](2026-09-07-p005-integration.md) records the combined P002/P003/P007 checkpoint. The source digests and results above remain the original feature evidence.

## Navigation and ownership addendum — 20 September 2026

P017 reconciled legacy planning records into the [proposal archive](../../design/proposals/archive/). [Current subsystem designs](../../design/systems/) now own requirements, and unfinished acceptance belongs to the [issue inbox](../../issues/) until a new proposal is selected. Historical statements here about active proposal states, queues, permissions and recovery locations describe the recorded date. This addendum changes navigation/ownership only: original tested sources, commands, results, review rounds and limitations above remain historical evidence. No application gate was rerun for the documentation migration. Historical raw artifacts or worktrees not present in this checkout were not newly verified.
