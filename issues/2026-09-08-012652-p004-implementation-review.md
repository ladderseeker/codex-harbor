# Review file workflow corrections and complete integration

- Severity: High; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: High
- Status: Blocked
- Owner: P004 implementer; independent reviewer and main-agent integration

- Recorded: 2026-09-08
- Affected files: apps/web/src/Files.tsx; apps/api/src/files.ts; infra/files/; tests/files/, in the P004 implementation worktree
- Acceptance: [P004-01–06](../design/proposals/archive/004-files-and-change-review.md#independent-acceptance)

## Observed implementation findings

The combined managed-XFS acceptance flow reproduced repeated `FILE_CAPACITY` failures followed by persisted `WORKSPACE_UNAVAILABLE` after its editor/staging/commit phase. Isolated file read and recovery lanes had passed, so those earlier results did not establish the combined outcome. Diagnostics identified the editor's redundant full P003 workspace inspection on each invalidation, multiplying confined helper launches.

The correction carries authorized lease metadata in the bounded file-tree response and coalesces refreshes to one active request group plus one pending refresh. It preserves the real helper limits and does not retry failed mutations or weaken revision checks. Intermediate combined run `harbor-files-b8015c7892` passed after that correction; a separate nested-file invalidation/live replay-gap lane also passed. The earlier graceful API shutdown correction explicitly closes owned file event streams, allowing a restart while the browser retains its unsaved draft.

## Current review and verification

The final managed-XFS lane `harbor-files-627c302c9b` passed on Node 24.11.1 with matching start/end source `f5998b404925e222841e4f1167824cb246bab8e6c6244d5714a01fdf8edff079` over 881 files. Its real Harbor UI/API/PostgreSQL/supervisor/storage/helper assertions include stale drafts, partial staging and exact commit identity, API restart, post-commit result-persistence failure, supervisor restart, explicit uncertainty inspection/release, authority/capacity denials and invalidation. Only external OIDC/Codex boundaries are fixtures. The retained result is in the P004 worktree's `.test-runs/p004-linux-evidence/harbor-files-627c302c9b/`. That run's immediate file-click screenshots captured loading, so a separate render-only run `harbor-files-ae1d2539bc` waited for Monaco and hostile text on the same source before desktop/mobile capture. Both author and main agent inspected those final rendered captures; the render-only result adds no filesystem-isolation claim.

The critical cumulative regression `harbor-e2e-b180a991d0` and separate workspace regression `harbor-workspaces-97f07897b1` also passed on the same matching-source Node 24 candidate. Independent implementation round 1 returned the findings below. P006 shared application integration and P009 module inventory, drain and restored-authority handling remain to be implemented and checked. No complete deployment restore is inferred from the file lane.

## Independent round 1 findings

The reviewer inspected frozen `f5998b40…ff079` without editing it or rerunning the suite. These are concrete source-derived schedules and pinned local dependency evidence, not reviewer-executed reproductions.

1. **High — pending file opening can discard a new draft.** `apps/web/src/Files.tsx:216–239` checks the captured dirty state before awaiting file B, while clean file A remains editable. Holding B's response, editing A and releasing B lets `setContent`/`setText` replace A's new draft. Fence edits made during the pending open or explicitly block them; verify the held-response user flow in the actual UI.
2. **Medium — editor model reads omit the BOM.** `apps/web/src/FileEditor.tsx:70,87` uses `model.getValue()` with pinned Monaco's `preserveBOM=false` default. The first edit/save can strip an original UTF-8 BOM. Preserve it in model reads/comparisons and verify exact BOM/CRLF bytes after a real edit/save.
3. **Medium — inherited umask changes the saved mode.** `infra/files/helper.py:395–400` passes the old safe mode to `os.open` but does not apply `fchmod`. Under umask 022, modes 0666/0775 become 0644/0755. Apply the exact permitted mode before fsync and verify nondefault safe modes alongside the edited bytes.
4. **Medium — the first receipt directory lacks a parent durability barrier.** `infra/files/service.ts:96–98` creates `file-receipts` without fsync of its authority parent. Flushing a receipt and its child directory does not establish persistence of the new parent entry before the file effect. Add that barrier and inject its failure to prove publication is denied before effects.

The implementer accepted all four in one correction batch. The bounded Git/object/authority/retirement/CSP review reported no further actionable finding. Verify the corrections and complete independent round 2 and integration before resolving and archiving this record.

## Corrective feature closure — 8 September 2026

Author commit `9a82f072c3b77740cbbbfb923f400b868eed88ab`, based on `fee16e75ff75ed063fcea84749563553ac1e421a`, records the corrected candidate. Managed-XFS `harbor-files-a475c452df` and critical `harbor-e2e-76c87b1fa9` passed on Node 24.11.1, both with exact start/end source `324022da4ddc36128348a01427cba6028a2bd44bb176848f9b47a34d56d37fa2`, 882 files. Check/build also passed.

The held-response browser case preserves a draft edited during file opening; a real browser edit/save retains exact UTF-8 BOM/CRLF bytes and mode 0775. A targeted native helper assertion preserves mode 0666. Injecting rejection into the actual parent-directory `FileHandle.sync` proves zero receipt and zero file effect; this is a method-failure assertion, not a power-loss experiment. The separate reviewer matched the corrected source and both full results and closed round 2 with no actionable finding in the feature correction scope.

The [feature report](../docs/reports/2026-09-08-p004-files.md) preserves historical checkpoints and their limitations. Main-branch P006/P009 integration remains owned and pending: shared style nonce, typed reservation epoch, module inventory, checkpoint drain and fresh-host restored authority without effect replay. Keep this issue and P004 active until those obligations are closed.

The [combined integration checkpoint](../docs/reports/2026-09-08-p004-p006-integration.md) now records the merged nonce/typed writer behavior and independently corrected shared-Git terminal admission. Focused actual-stack acceptance passed on `f0a4cdf2…cced99` /951; installed module/image/service, drain and restored-authority behavior remains in progress.

## Current integration evidence and remaining blocker — 8 September 2026

Root `04ab86b` includes the reviewed final file/terminal deployment integration. Exact production `f13afc57…ad1d27` passed the recorded host suites and managed Linux checks; immutable artifact `8c11ca94…84f22` passed both ordinary installed browser use and deliberate save-response-loss recovery, actual native PTY/background retirement, inventory and a fresh local synthetic database rebind. Two bounded module review rounds closed, with no remaining actionable source finding in that scope. The [final module report](../docs/reports/2026-09-08-installed-module-integration.md#final-installed-outcome-and-review-closure) distinguishes artifact/source/test-driver identity, reused-fixture qualifications and earlier failed attempts.

Shared writer, nonce, registry, service/image, drain and local restored-authority implementation obligations are now delivered. The proposal is Implemented. This issue remains active and Blocked specifically for its required fresh-host protected filesystem restore/authority evidence under [P009-04](../design/proposals/archive/009-portable-deployment-and-restore.md#independent-acceptance) and the [blocked backup-transfer prerequisite](2026-09-07-231526-p009-backup-transfer-approval.md). The local clone explicitly reports no filesystem restore and cannot close that remaining obligation. No original finding, gate or failed result is silently discarded; append the required fresh-host evidence before resolution/archival.

## Retained acceptance ownership — 20 September 2026

The remaining obligation is the P004 delivery/registry and bounded-persistence contract under P009-04: complete protected fresh-host filesystem/receipt restore, revoked old effect/retry/inspection authority, preserved uncertainty and no source-host effects. Earlier feature, module and installed passes remain valid within their recorded sources. The reopened runtime compatibility issue owns the complete managed deployment outcome.
