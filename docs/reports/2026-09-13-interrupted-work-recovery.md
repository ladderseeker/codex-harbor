# Interrupted implementation recovery — 13 September 2026

Main resumed at clean commit `9c005f0`. The old temporary P010, P011 and P012 directories remained, but contained no regular source files or Git worktree pointer files. Their saved Git branches and worktree indexes survived in the main repository, with no staged delta at the saved checkpoints. The cause of the temporary-file loss is not established.

New isolated worktrees were restored under the repository's ignored `.test-runs/worktrees/` directory. The old directories and Git recovery metadata were preserved. These are persistent working copies, not candidate installations or production data. The three previously reconciled stash snapshots remain reachable through their named local archive refs; the active stash list remains empty. This recovery did not reapply those stashes.

| Proposal | Preserved checkpoint | Recovered outcome and unfinished ownership |
| --- | --- | --- |
| P010 | `dd65646a3f4551fdd25d5af59e381c5733a8bc2a` | Committed worker/browser foundation and reviewed lifetime fixes restored. Uncommitted guardian, report/orchestration and cache-refresh drafts were not recovered; the implementer owns reconstruction under the unchanged P010/D008 requirements. They were never complete or verified. |
| P011 | `ed59d0997c751040ffacc57f8f8b14e9f5a2383a` | The surviving immutable release and guest source recovered three later production corrections and selected test drivers. Reconciled checkpoint `4218d71` preserves their provenance. Missing later acceptance drafts remain the implementer's work. |
| P012 | `268d86f69d543ad1317e02fd3f68d6f76bce2a8a` | The tested manual-call/input checkpoint, including the shared acknowledgement correction, restored. An unused, only typechecked control draft was lost; the implementer is reconstructing the complete controls outcome rather than claiming that draft delivered it. |

## Surviving verification resources

All four owned Linux VM disks remained open by live virtualization processes. Each existing SSH master passed an explicit control check; fixed read-only commands through the C and D connections confirmed the expected host ownership. No VM was restarted, reinitialized or stopped. The temporary host-side Lima binary, configuration/key files and public bundle copy were absent.

On C, the pristine tools preparation's sealed `guest.qcow2` and certificate remain present under the original `bad492d49108f47a31f3a334288d206c` job. Presence alone does not reverify its contents or establish a successful candidate build. Earlier failed cache/preparation evidence remains distinct from later work.

On D, immutable release `ad5786c849eefbffe1f4046e2682a9efc825f7c00520fae47a4f949db956ba4e`, public source and specifically named sanitized evidence survived. The recovery archive is 10,639,360 bytes with SHA-256 `a3dd9fc2bc59bc5c964ade1d0f5bfa875368784c66ee5a6aa15453625fd72071`. The relay correction and test match their original hashes. Installed browser/drain, exact administrator retirement and local metadata rebind evidence retain their original artifact/source identities and reused-fixture limitations. No protected filesystem restore or source-contact result is inferred from the metadata clone. The [relay issue](../../issues/archive/2026-09-13-022008-preview-retirement-race.md) tracks remaining main integration.

The recovered P011 source passed Node 24.11.1 `pnpm check` and two focused adapter contracts at source `08e5584bdb0d21203f413e405d534910d9d583e7ad4192a2fc2d9d90bb06d2de` across 1,030 files. These checks validate recovery; they do not repeat its full browser or Linux acceptance. P012's historical shared acknowledgement result is separately qualified in the [active deadlock issue](../../issues/2026-09-13-022009-native-acknowledgement-deadlock.md).

## Limits and prevention

New local SSH recovery keys and a bounded public-key enrollment were prepared, but automatic approval review rejected adding persistent administrator access to the four VMs. Enrollment did not execute. Existing authenticated connections remain available, while fresh administrative reconnection and missing Lima management configuration remain [unverified and blocked](../../issues/2026-09-13-022007-test-host-ssh-recovery.md). Private keys were not transferred, and the separate P009 protected backup rejection was not retried.

Long-lived worktrees and evidence now use persistent ignored repository storage. Linux source and fixed test assets use owned persistent guest directories. New work retains source checkpoints, per-resource ownership and an explicit recovery plan for unfinished edits. Current statuses remain P001–P008 Implemented and P009–P012 In progress; no proposal is promoted or archived by this recovery. Full feature scope, independent review and all mandatory live/restore/isolation gates remain unchanged.

Main's inventory and public-access preparation receipts are retained under ignored `.test-runs/recovery-20260913/`; P011's original recovered copies, manifest and evidence are retained in its persistent worktree. Sensitive access material is excluded from Git and public reports.

## Documentation verification

The recovery and lifecycle update was reviewed independently in one bounded round with no actionable findings. On macOS at parent revision `9c005f0`, `node scripts/check-docs.mjs` passed for 95 documents and `git diff --check` passed. This documentation-only validation does not establish an application, recovery-access or deployment gate.

## Local verification access and later delivery — 13 September 2026

A later public-source preparation request for D was rejected before execution because automatic review classified the destination as a remote host and lacked current ownership evidence. A new read-only audit established that the existing SSH master connects solely through loopback to the same user's Lima listener and local macOS virtualization process holding D's original disk. The prior owner supplied an idle handback. The audit remains in `.test-runs/recovery-20260913/d-local-provenance.json`; it contains no key material.

Automatic review then accepted the direct fixed request on the same destination and transport with that new evidence. The immutable P012 preparation contained committed `233cb5e` plus its independently reviewed expected-generation test, excluding credentials, private configuration, native state, Git metadata and dependency directories. Its archive was 4,444,160 bytes, SHA256 `84519191c6ca57a1f058ce15c3697198049941890a0ecad53b4392450896e2bb`. The initial offline install stopped before testing because old public metadata was incomplete. Fresh public dependency preparation retained the frozen lock and supply-chain checks. The first native run exceeded the test's 16 KiB diagnostic capture bound; only its Docker inspect DTO was narrowed under independent review, retaining that bound and every assertion. The corrected native generation/child retirement canary passed at source `0f5227b49e593379ce77e6fff0a0385f3677d47acfde61e0bf63210b6e79f155` /1,036 files. Original failures and exact sources remain separate retained evidence. Current P012 publication/removal changes were not part of that run.

A separately accepted fixed P011 source request supplied the final supported Linux lifecycle evidence. The [main acceptance addendum](2026-09-08-p011-development.md#main-acceptance--13-september-2026) records exact sources, commands, two independent review rounds and main integration. P011 is now Implemented, with its scoped retirement and implementation findings archived; links here follow those same records. This dated addendum supersedes earlier pending integration/status statements only for that completed scope.

No alternate access route, administrative key enrollment, VM restart or protected backup transfer occurred. The separate [persistent SSH recovery rejection](../../issues/2026-09-13-022007-test-host-ssh-recovery.md) and [P009 protected-transfer blocker](../../issues/2026-09-07-231526-p009-backup-transfer-approval.md) remain in force. The available source-only verification does not establish either gate.
