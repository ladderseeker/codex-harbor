# Common-use delivery scope and retained work — 13 September 2026

The owner replaced simultaneous P001–P012 delivery with a common-use release, followed by individual features selected from actual need. [D009](../../design/decisions/009-common-use-release.md) records that decision; the [proposal index](../../design/proposals/README.md#current-delivery-queue) owns the current queue. This report records the candidate work and deferral handoff. It does not claim a verified release.

## Candidate and verification

The starting candidate is main `2d88e99`, containing P001–P008 and P011 implementation. Its recorded source digest is `991fb86c4a2cefe8908c57df9e69435ae15ae07144c1be184fc1d1fc0b5517c4` across 1,036 source/configuration files. The independent scope audit inspected the retained passing `46bafa3212` critical result and matching local check/build/integration/contracts evidence. That critical lane covers P001/P002/P003/P005/P007 with real Harbor components and external Codex/OIDC fixtures; it is not live-account or Linux isolation evidence.

Only the shared conversation acknowledgement correction is selected from the advanced feature branches. Its [dedicated report](2026-09-13-common-use-acknowledgement.md) records three extraction/harness review rounds and the final passing critical run `1704c722e8` at exact source `ce2531fdc5a176d21a65b160d3800678fe89497518ac8f9ddd6d1ee268d85403` /1,039 files. Main independently recomputed that source and matched the actual result and contention artifact hashes. Build/check, 11 integration tests and 20 pinned runtime contracts passed on the mapped test-only predecessor sources. The [shared issue is resolved](../../issues/archive/2026-09-13-022009-native-acknowledgement-deadlock.md). P010/P012 implementation, migrations and dependencies are not part of that extraction.

The existing [developer setup](../developer/development.md#run-the-deterministic-application-locally) documents the disposable interactive fixture and canonical checks. The [user guides](../user/README.md) describe implemented behavior. Real installed operation uses the [deployment guide](../developer/deployment.md); its unverified release/recovery gates remain explicit. No new installation, promotion or stable-data mutation was performed for the scope change.

## Required gates remain open

| Gate | Current evidence and next action |
| --- | --- |
| Authenticated real Codex acceptance | The dedicated key was still absent in a presence-only check. [Credential issue](../../issues/2026-09-07-171225-live-runtime-credentials.md). No personal account state was inspected or used. |
| Native history/restart acceptance | The P007 specialist driver is now integrated after two review rounds; five no-model checks passed. Its [report](2026-09-13-p007-live-history-driver.md) and [blocked issue](../../issues/2026-09-13-110315-common-use-live-acceptance.md) retain the still-required real-account execution. |
| Installed release and recovery | P009 retains actual installed conversation/reboot, protected A-to-B restore/fault, promotion/rollback and target-host live/connectivity obligations. The [deployment report](2026-09-08-p009-development.md) distinguishes partial installed results. |
| Protected backup transfer | Automatic approval review rejected the transfer of generated private state and secrets to the owned restore repository. The [original blocker](../../issues/2026-09-07-231526-p009-backup-transfer-approval.md) remains unchanged; no workaround was attempted. |
| Historical intermittent regressions | [P005](../../issues/2026-09-08-044009-p005-selection-regression.md) and [P007](../../issues/2026-09-08-020429-p007-regression-evidence.md) observations remain open. Later passing tests do not establish their original causes. |

No proposal can be archived as Completed merely because this scope is smaller. P001–P008/P011 retain their actual Implemented state; P009 remains In progress; deferred P010/P012 remain In progress. Update and archive each original record after its complete mandatory gates pass.

## Deferred work and recovery

Main independently checked these branch heads and working-tree states during the scope change. Paths below are repository-relative ignored worktrees. Preserve the branches and snapshots; they are recovery locations, not release artifacts.

| Work | Preserved checkpoint and owner | Remaining state |
| --- | --- | --- |
| P010/P012 combined integration | `integration/self-extensions-20260913` at `e5f76b54c3e56367345e6d75c9150b31a65c5e19`; runtime implementer; `.test-runs/worktrees/integration-self-extensions-20260913` | 28 dirty entries preserved, including P010 admission and full-flow driver drafts. The owned `.test-runs/p010-deferral-20260913/handoff.json`, file snapshot and patch retain exact hashes. Handoff SHA256: `c1bf329100cd0f20f645052b188b40dc2840e8e418983ea74ac3999e713fb45e`. |
| P010 deployment module | `implementation/p010-deployment-module-20260913` at `9bbb83bdd8f8d59ee54bb182a7cde8558eae8a9f`; module implementer; `.test-runs/worktrees/p010-deployment-module-20260913` | Seven dirty entries retain administrator shared-lock integration. Frozen installed driver has local checks but no installed execution or independent driver review. Do not merge it as completed acceptance. |
| P010 dispatch protocol | `codex/p010-dispatch-protocol-20260913` at `02d8ca61dde7c5e6fdadd2e914c8955e98aec741`; protocol implementer; `.test-runs/worktrees/p010-dispatch-protocol-20260913` | Clean worktree; explicitly unverified WIP commit, with `.test-runs/HANDOFF.md`. Production typecheck preceded the new unexecuted test file. Combined Python integration, race tests and independent review remain pending. |
| P012 managed extensions | `codex/p012-extensions` at `e160dba2025f95a9887000e06a4e5f92157146bb`; extension implementer; `.test-runs/worktrees/p012` | Clean worktree; retain qualified managed/native evidence and unresolved main, live and installed gates. |

The root `.test-runs/common-use-release-20260913/deferred-work.json` records the independently observed heads and dirty filenames. Temporary stashes are reconciled and the stash list is empty; existing named recovery references are preserved. The unrelated root `.pnpm-store/` remains untouched.

P010's cache-transfer, private-tools recovery, capacity and full isolation/candidate gates remain with P010. Its work was paused without a new VM action, transfer, guest launch or deployment. Deferral does not resolve those findings. Review this handoff and the proposal's source issues before resuming; do not restart the entire roadmap.
