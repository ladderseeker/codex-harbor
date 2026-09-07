# Managed workspace validation loses the created workspace identity

- Severity: High
- Status: In progress
- Owner: P003/P009 installed-module integration; P008 owns the corresponding schedule worker call
- Affected files: `apps/supervisor/src/workspace-storage.ts`, `packages/workspaces/src/service.ts`, `infra/storage/workspace-service.ts`, `infra/storage/workspace-paths.py`, P008 standalone workspace preparation
- Acceptance: [P003-01–06](../design/proposals/003-parallel-project-workspaces.md#independent-acceptance), installed [P009-01](../design/proposals/009-portable-deployment-and-restore.md#independent-acceptance), derived-workspace P004 acceptance and standalone P008 execution

## Evidence — 8 September 2026

Actual managed-XFS application acceptance on the two owned Linux hosts exposed a completed workspace creation followed by `WORKSPACE_UNAVAILABLE`. The P004 UI showed a derived checkout with a base revision but only one ready workspace instead of two. P008 persisted a completed storage operation and a created copy with unavailable state; the schedule failed before any turn dispatched. The separate direct P003 Linux helper lane passed and therefore did not cover this application-level handoff.

At reviewed module checkpoint `a2f9389b5ec477076b159175108d121ea90ba3b3`, source `e396763b9bf29632dda51a47f651c086ec24599c667e7399e90d09af212b19ff` /961 files, `processWorkspaceStorage` calls `verifyWorkspace` after creation with only canonical path, device and inode. In the managed deployment, that verifier sends a `workspaceValidate` command through the private storage socket. The command requires a workspace ID and the correct kind/common-directory identity, which the call discarded. The fixed storage service rejects the incomplete identity; the supervisor catches this and records the workspace as unavailable even though its filesystem effect completed. Main independently inspected this source path.

This failure occurs after correcting the separate [quota module import](archive/2026-09-08-031857-workspace-quota-import.md). It is not evidence that the import correction failed. The initial independent module source review found no issue before these actual application results; its closure is superseded for this boundary pending the correction and review below.

The bounded caller audit also found that `workspaceValidate` sends checkout identity in `source` and the common-directory identity in `identity.common`. The Python validator chooses `source` before `identity`, so its common inode check is skipped on this path; the Node service checks the expected common pathname and kind. Main identified this from source, and the implementer independently confirmed it. The downstream fixed helper/runner still performs its own identity validation; no out-of-scope execution is established. Readiness validation itself must check the recorded common directory rather than relying on that later boundary.

## Impact and next steps

Installed derived/copy creation cannot provide the ready workspace required by file workflows or standalone schedules. Validation fails closed; the observed runs did not dispatch an ordinary turn. Preserve the completed storage receipt and exact filesystem identity rather than creating the workspace again or weakening validation.

Pass the captured workspace ID, root and kind together with the returned canonical/device/inode and optional common-directory identity into post-create validation. Audit other `verifyWorkspace` callers for this contract. Apply the corresponding correction to the schedule worker. Check the supplied common-directory identity under the existing trusted storage lock, including explicit wrong-inode and symlink denials. Independently review these corrections, run actual managed application creation/ready/use for Git and copy workspaces, and retain strict wrong-identity denials. Record exact source/run evidence and critical regressions before archiving this issue. Direct helper acceptance or macOS process-only tests cannot close the installed application gate.

## Corrected module checkpoint — 8 September 2026

Root `2bdb5ef` imports the complete caller/common correction at `77b2ad5`, production `f13afc57…ad1d27`. Independent review accepted first Local-to-Git compatibility and explicit wrong-common-inode/symlink denials. Exact-source Linux workspace acceptance `xfs-25f78396-daf3-43bb-86dd-06db9585a177` and complete managed file run `44ad9cde66` (test-driver-only source delta) passed; final installed ordinary/fault lanes `61563bc3`/`cff10b97` also passed on immutable `8c11ca94…84f22`. The [module report](../docs/reports/2026-09-08-installed-module-integration.md#final-installed-outcome-and-review-closure) retains their precise scopes.

The corresponding P008 standalone worker correction is in reviewed `cc38b94` and its integration worktree, with actual managed copy evidence and a passing later integrated feature/critical run. Complete that committed root handoff and its remaining metadata bridge check before archiving this multi-owner issue. The shared module defect is corrected; the active next action is P008 integration, not weakening or repeating workspace allocation.
