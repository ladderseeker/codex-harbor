# P009 development checkpoint — 8 September 2026

P009 remains **In progress and unverified** after two closed independent implementation review rounds. This report records partial development evidence and the reviewed feature handoff. It does not establish the complete P009-01–07 acceptance, protected backup/restore, promotion/rollback or live-account behavior.

The implementation is isolated on `codex/p009-deployment`, based on `d4f9e96` and incorporating reviewed P005/P007 through `fa65f6a`. Current source identity and local check results are recorded in the review handoff. The [operator development guide](../developer/deployment.md) and [D006](../../design/decisions/006-portable-release-and-restore.md) distinguish implemented interfaces from missing acceptance.

## Actual installed-profile evidence

Environment: disposable Ubuntu 24.04 arm64 VM A, Linux 6.8.0-134, Docker 29.1.3, Compose 2.40.3, Node 24.11.1, pnpm 12.3.4, XFS project quotas and pinned Restic 0.19.1. No personal project, ordinary Codex home or dedicated model credential was used.

| Check | Actual result and limit |
| --- | --- |
| Fresh immutable installation | Root storage/supervisor, unprivileged API, private Unix-socket PostgreSQL and Caddy started. Actual HTTPS owner login and API project creation passed. |
| UID/socket/database boundary | Runner/unrelated UIDs could not connect to private IPC/PG sockets. API could not read model keys/project roots or replace socket entries. PostgreSQL had no network; wrong SCRAM password was rejected. |
| Reboot | The first attempt exposed the fixture's nonpersistent XFS mount. Exact existing `quota.img` was verified/remounted and given a scoped fstab entry; services gained `RequiresMountsFor`. The next reboot returned healthy services and preserved project device `1792`/inode `1170179`, with no rebinding. There were zero conversation sessions, so this is not conversation/native-history reboot evidence. |
| Health transport | Ambient VM HTTP proxy variables produced a false localhost 502 after boot. Direct loopback and certificate-verified HTTPS returned 200. Administrator readiness now uses a fixed direct HTTPS probe without inherited proxy routing. Backup routing was not changed. |
| Project allocation COMMIT loss | A real deferred PostgreSQL COMMIT failure after private storage allocation left the directory without a project row. The same create retry failed explicitly. A fresh owner existing-project registration recovered exactly the original inode. Checkpoint inventory refuses unregistered managed directories. |
| Installed native runner | Artifact `91e4917e06883e1b6db36cc86241fbdca9af33a66e892b58ff19c5cb98b2ef5b` passed actual Codex 0.153.4 initialization/account read/thread-start metadata, nonroot/RO/capability/NNP/cgroup/IPv4/IPv6 confinement, fixed-gateway upstream 401 and fronting/absolute-target/query denials, and confirmed retirement. No model request was made. The pinned empty thread was not readable before a persisted turn; this is recorded as a capability boundary, not history-read evidence. |

Earlier runtime artifact `f7490e28eec65a338e920aff83f944a45af986643dfa544991a528cff5d17ecd` established service/project/UID checks but failed actual native launch. P009 changed the runner image to its immutable SHA while an old argument insertion still searched for the tag. The failed lookup placed Docker environment flags inside Codex arguments. The corrected selected-image lookup and explicit missing-boundary error are present in the later passing artifact. No installed artifact was edited in place or promoted through the blocked checkpoint gate.

The tested immutable images were runner `sha256:65cd9c5659eb3b40e2f96276726a1777b91540c339657a434e5827640792f932`, gateway `sha256:366a019fdbbe7f51ed5ecfff4b31d9519a629641c2f50350fe278bec60912001`, Git `sha256:11029e631bba5350059252fb0d91a8aa66f18c6880c5330aff8e354c5342b353`, PostgreSQL `sha256:a7e5b4a98674a8374a4a6d1e5649db3bb0350415c14e0506a19d1ebbd2077326`, and Caddy `sha256:e4fbcda567e70ee6d01cac492d2919157bf6ca4daf3a52a35f0eea306bb15439`.

## Commands and scope

The installed checks used `tests/deployment/{prepare.ts,admit.py,owner.ts,privileges.py,preserved.py,allocation-loss.ts,native.ts}` against fresh run-owned resources. `preserved.py` compares stored identities; it never updates them. `native.ts` imports the installed immutable adapter/runner rather than a project process fixture. The external OIDC fixture alone supplies test identity; Harbor runs in production mode.

Local contracts cover authenticated extraction of binary files/symlinks, corrupted/missing/unsafe inventory, exact predecessor migration compatibility, readiness deadlines and actual Unix response EOF/slow-drip settlement. They do not substitute for fresh-host restore or physical power-loss evidence. The initial sandboxed Node 24 socket test hit a native runtime assertion under the sandbox restriction; the same two fresh synthetic Unix-socket cases passed outside that restriction.

## Blocked and remaining acceptance

[Automatic approval review rejected the protected A→B backup transfer](../../issues/2026-09-07-231526-p009-backup-transfer-approval.md). No Harbor backup payload was transferred or retried by another route. The dedicated repository was provisioned as an empty directory (no Restic initialization is claimed here); separate SFTP connectivity/confinement probes are not backup acceptance.

The exact rejected source remains the earlier untouched `deploy-f1694c7e` instance/artifact `40f139a8104bb7026f665cec12056460fcaa3aa859a19bb8287d2b26148462d3`. Later local development fixtures do not silently change that approval payload. Any final request must identify the concrete current artifact/private payload/destination explicitly.

Outstanding gates include full protected snapshot verification and A→B restore, revocation/re-encryption/rebinding and no-replay assertions, restore-process-loss/corruption/disk-pressure cases, actual compatible promotion/rollback and inserted-migration upgrade, administrator stale-lock recovery, full deployed conversation reboot/history, and dedicated real-account acceptance. Two independent review rounds and their focused corrections have closed; the remaining mandatory acceptance gates still prevent completion. The mandatory [live-account gate](../../issues/2026-09-07-171225-live-runtime-credentials.md) remains blocked; no fallback to personal credentials is permitted.

## Independent review round 1 and focused correction checkpoint

The first implementation review found six High blockers in frozen source `3d69c240815de3678516fd70b5cc4fa29506336e3a1a9bee8a09b92418c5753a`: missing administrator process-wrapper parameters, CLI status shadowing, producer/restore file-bound mismatch, live Caddy state without snapshot/registry equality verification, unsafe clearing of an unclaimed quota slot, and failure to inspect native history after legitimate derived-checkout removal. Earlier installed-artifact evidence did not cover these later source defects. At this checkpoint the corrections awaited round-two review; its later closure is recorded below, while P009 remains unverified.

Corrected source `2ae952b318729bbb08525635a0ae4a04e21d2fe91cd38fdbf2cb33b045285c1f` (892 files) passed the dedicated Linux `node --import tsx tests/deployment/publication.ts` lane. It preserved unknown pool bytes, injected actual SIGKILL after a partial private claim, reconciled that exact inode, left another slot untouched, preserved native canary bytes, kept removed checkout metadata without recreating it, and passed real XFS admission/syncfs. Cleanup confirmed only that fresh fixture’s paths/quota IDs were removed. This is synthetic same-host publication evidence, not protected snapshot transfer, native-thread validation or physical power-loss evidence.

Fresh immutable artifact `6dd02dba8efa54179667afef6e48c2623986d32a76e1bed68ea8cae4355b9dc8`, built from that source, installed in disposable instance `deploy-29946354`. Its packaged `harborctl status` reported all four service roles active and readiness ready; packaged preflight and actual UID/socket/SCRAM probes passed. No earlier installed artifact was changed. Later changes add the unconfirmed-Caddy-stop regression and make Local metadata selection a left join so a missing inspection mount fails explicitly rather than dropping a retained history from the probe. The latter is a narrow probe-query correction, outside the installed status/XFS-publication checks. The exact final source/check results are in the review handoff.

Local regressions cover actual harmless process capture/file input/timeout/failure, read-only CLI status dispatch, sparse oversize rejection before hashing, corrupted snapshot content rejection, and removed-workspace inspection mount selection. Protected transfer and complete native-history activation remain unexecuted gates. Secret-free summaries are retained under `.test-runs/p009-round1-linux.json`; the earlier allocation-loss summary explicitly identifies its provenance as a later transcription of the original successful tool result.

## Focused round 2 metadata contract

The dedicated registry is selected from the authenticated snapshot's top-level source paths, so an ordinary project `registry.json` remains valid. Pinned Restic 0.19.1 `ls --json` omits symlink targets; bounded `cat tree` reads validate each exact target instead. Immutable snapshot reads use `--no-lock` under Harbor's administrator lock, avoiding repository lock-file writes under the strict small-file output bound. Missing or concurrently removed snapshot content fails verification; backup and integrity-check mutations retain Restic locking.

`python3 tests/deployment/restic-cli.py <pinned-restic>` passed on the dedicated Linux VM using only fresh public synthetic text/symlink files, a disposable local repository/password, and no network destination or Harbor state. It exercised actual `ls`/`cat tree` schema, ordinary registry filenames, restored symlinks, and changed-target rejection. The preceding attempt exposed small-file output limits interfering with Restic lock creation and failed by deadline; the corrected immutable read mode passed. Seventeen local Python contracts also passed. This is a CLI metadata contract, not protected backup/restore acceptance.

## Reviewed feature handoff — 2026-09-08

Two independent implementation review rounds closed with no remaining actionable finding in their bounded scope. Round 1 corrected six High findings; round 2 corrected the registry filename collision and verified actual pinned CLI metadata handling. The tested source is `b6599ab31a6b4690b54a9bd0632f3c668e98ebb88b2905f1f7f82066327a4289` (893 files). Parent integration verification ran Node 24.11.1 `pnpm check` and the full critical E2E suite successfully. E2E `harbor-e2e-d47ae72678` records identical start/end source, Codex 0.153.4 and Chromium 1194; result: `.test-runs/harbor-e2e-d47ae72678/result.json`. Logs: `.test-runs/p009-root-final-check-20260908.log` and `.test-runs/p009-root-final-e2e-20260908.log`.

The isolated public Restic CLI result is recorded separately in `.test-runs/p009-restic-cli-contract.json`. Earlier installed artifacts retain their historical evidence; this handoff does not relabel them as the final source. No protected transfer or promotion was retried. P009 remains **In progress**, with A→B checkpoint/restore, promotion/rollback and dedicated live-account gates outstanding. Later P004/P006 state integration is a separate reviewed change; the current registry refuses unknown module tables.

## Main integration and remaining scope — 2026-09-08

The feature handoff is commit `dc721162eab1d748344b1f38cdca1cef28749f29`. Main integrated its delta against the shared `fa65f6a` baseline while preserving newer archive/index history. Root source remains exactly `b6599ab3…7a4289` over 893 files; the only merge conflict was a proposal issue-link insertion. Root documentation checks passed for 68 files, so no application or Linux rerun was needed for this documentation-only difference.

A scope audit confirmed that separate restored-host off-host destination enrollment/update is still unimplemented. Current restore source and ongoing backup destination share one configuration; B cannot treat its own repository as an off-host target. P009 is completing that flow, with available administrator stale-lock and allocation-inventory checks, before another bounded independent review. This is required remaining work, not a passed gate. The [active implementation issue](../../issues/2026-09-08-005028-p009-implementation-review.md) tracks it separately from the two completed baseline review rounds and the unchanged transfer/live blockers.
