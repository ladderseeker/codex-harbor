# Workspace validator fails while loading the quota module

- Severity: High
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-08
- Owner: P003/P009; installed-module integration implementer
- Affected files: `infra/storage/workspace-paths.py`, `infra/storage/quota.py`, supported Linux workspace/file acceptance
- Acceptance: [P003-01–06](../../design/proposals/archive/003-parallel-project-workspaces.md#independent-acceptance) where the fixed workspace helper is used; [P009-01](../../design/proposals/archive/009-portable-deployment-and-restore.md#independent-acceptance) and installed P004 file inspection

## Evidence — 8 September 2026

After correcting the separate [web-asset packaging failure](2026-09-08-031032-p009-installed-web-assets.md), the fresh installed browser loaded and created a project. File inspection then failed through both direct and storage-IPC paths, before launching a file helper. The workspace validator raised `IndentationError` while loading quota definitions.

`workspace-paths.py` extracts definitions by splitting `quota.py` at the text `try:main()` and compiling the prefix. P009 made that quota dispatcher import-safe with an `if __name__=='__main__':` guard. The text split leaves a dangling `if` with no body, so every invocation of the validator fails before request validation. The module's guarded import is the correct available interface.

Main independently reproduced the syntax failure against revision `cfc49d2` by compiling only the extracted prefix: `IndentationError`, line 139, `expected an indented block`. This read-only diagnostic executed no quota or filesystem operation. The exact quota source SHA-256 is `74baea36a2466f0bd065a918aeb134b9a963d3969915a1a3e703ebe6bb376936`; the validator SHA-256 is `431c98ceba8312929cd59b7d87ee05096a9c597b50420ce7b8bd99a399d6ef0b`.

## Impact and next steps

The combined release cannot perform operations that invoke this fixed workspace validator. The failure is closed to execution but blocks required workspace/file behavior. Earlier isolated P003 and P004 results retain their exact source identities and do not establish this later combination's Linux behavior.

Replace textual quota loading with its guarded module import without invoking the command dispatcher. Check the other definition-loading call sites for the same changed guard. Verify the actual validator, supported Local/derived workspace paths and installed file flow on Linux, plus the changed feature and critical regressions. Independent review must inspect the correction and matching artifact/source evidence before this same issue is archived. A compile-only pass or an unavailable-data response is insufficient to close the behavioral gate.

## Resolution — 8 September 2026

The guarded module import is included in reviewed module checkpoint `77b2ad5`, root integration `2bdb5ef`, source `f13afc57f3956a7b457e567da02f1bb00ad214405c52c7a3d28f2d5c94ad1d27` /961 files. It loads definitions without invoking the command dispatcher. Independent source review and actual Linux behavior close the broken-import finding; the later caller/common identity correction remains a distinct tracked obligation.

Actual `pnpm test:isolation --workspaces` passed at that exact source in `xfs-25f78396-daf3-43bb-86dd-06db9585a177`, including first Local-to-worktree creation and strict supplied-common identity denials. Complete managed file application run `harbor-files-44ad9cde66` passed at `5ab432bd979d419a2a6112a4efd568422b198713fd22ddf1afe6cd4ca8ca763e` /961; only the installed test driver differed from the same production bytes. Ubuntu/Linux XFS, real Harbor UI/API/PostgreSQL/supervisor and the fixed helper were used; external OIDC/Codex were fixtures in that application lane.

Immutable artifact `8c11ca945b654d27fe1f787db0ef5b56ce3d269a88fe3883167d3820c8848f22` then passed complete installed ordinary and deliberate-response-loss lanes `61563bc3` and `cff10b97` with a fresh external Chromium client and Node 24.11.1 Harbor. Both explicitly reused the owned installation after documented fixture resets; earlier failed attempts remain preserved. Check/build and matching host critical `5ddd82e4c7`, workspace `fc670a1dba` and terminal `6b1cb43f5f` suites passed. Two module source/correction rounds and final independent result review found no remaining actionable finding in this import correction. The [module report](../../docs/reports/2026-09-08-installed-module-integration.md) records exact identities and limitations; these results do not establish protected filesystem restore or live-account acceptance.

## Ownership navigation — 20 September 2026

The disposition and evidence above are historical. Retired proposal references identify feature lineage; any unfinished inherited acceptance is retained in the [active inbox](../) and the [current subsystem designs](../../design/systems/). The P017 baseline migration did not resolve another finding or rerun this record’s checks.
