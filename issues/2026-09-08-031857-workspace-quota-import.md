# Workspace validator fails while loading the quota module

- Severity: High
- Status: In progress
- Owner: P003/P009; installed-module integration implementer
- Affected files: `infra/storage/workspace-paths.py`, `infra/storage/quota.py`, supported Linux workspace/file acceptance
- Acceptance: [P003-01–06](../design/proposals/003-parallel-project-workspaces.md#independent-acceptance) where the fixed workspace helper is used; [P009-01](../design/proposals/009-portable-deployment-and-restore.md#independent-acceptance) and installed P004 file inspection

## Evidence — 8 September 2026

After correcting the separate [web-asset packaging failure](2026-09-08-031032-p009-installed-web-assets.md), the fresh installed browser loaded and created a project. File inspection then failed through both direct and storage-IPC paths, before launching a file helper. The workspace validator raised `IndentationError` while loading quota definitions.

`workspace-paths.py` extracts definitions by splitting `quota.py` at the text `try:main()` and compiling the prefix. P009 made that quota dispatcher import-safe with an `if __name__=='__main__':` guard. The text split leaves a dangling `if` with no body, so every invocation of the validator fails before request validation. The module's guarded import is the correct available interface.

Main independently reproduced the syntax failure against revision `cfc49d2` by compiling only the extracted prefix: `IndentationError`, line 139, `expected an indented block`. This read-only diagnostic executed no quota or filesystem operation. The exact quota source SHA-256 is `74baea36a2466f0bd065a918aeb134b9a963d3969915a1a3e703ebe6bb376936`; the validator SHA-256 is `431c98ceba8312929cd59b7d87ee05096a9c597b50420ce7b8bd99a399d6ef0b`.

## Impact and next steps

The combined release cannot perform operations that invoke this fixed workspace validator. The failure is closed to execution but blocks required workspace/file behavior. Earlier isolated P003 and P004 results retain their exact source identities and do not establish this later combination's Linux behavior.

Replace textual quota loading with its guarded module import without invoking the command dispatcher. Check the other definition-loading call sites for the same changed guard. Verify the actual validator, supported Local/derived workspace paths and installed file flow on Linux, plus the changed feature and critical regressions. Independent review must inspect the correction and matching artifact/source evidence before this same issue is archived. A compile-only pass or an unavailable-data response is insufficient to close the behavioral gate.
