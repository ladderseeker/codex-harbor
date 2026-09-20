# P003 — Parallel project workspaces

- Record status: Finished
- Archive disposition: Baseline reconciled
- Reconciled: 2026-09-20 under [D013](../../decisions/013-evidence-based-delivery-workflow.md)
- Inspected source: `008227355bd05cb27dc13f4fbb585ef709b474b0`
- Baseline classification: Implemented managed-workspace baseline; authenticated parallel-turn evidence remains open.
- Current design: [Subsystem contract](../../systems/002-workspaces-and-resources.md)

## Reconciled baseline

Local, Git worktree and copy records, writer coordination, creation/removal and recovery are present in `apps/api/src/workspace-routes.ts`, `apps/supervisor/src/workspace-*.ts`, `packages/workspaces/src/` and migration 006. The workspace report records `b012ef67…dd972`; later installed-module evidence records corrected checkout/common identity handling.

[Historical evidence](../../../docs/reports/2026-09-07-p003-workspaces.md) retains its original commands, artifacts, review rounds and limitations. This documentation migration ran no application, account, isolation, restore or deployment check. Finished describes reconciliation of this legacy record; it does not establish completion of its original plan.

## Unresolved obligation ownership

- **P003-06 authenticated real parallel-turn effects** → [2026-09-07-171225-live-runtime-credentials.md](../../../issues/2026-09-07-171225-live-runtime-credentials.md).
- **Delivery and verification: complete project/workspace host restore under P009-04** → [2026-09-07-073831-codex-runtime-compatibility.md](../../../issues/2026-09-07-073831-codex-runtime-compatibility.md).

These issues are in the inbox awaiting owner selection. Future execution requires a new cohesive proposal; this archived ID is historical lineage, not an active work owner. Original acceptance identifiers below remain stable evidence references.

## Historical plan and evidence

The following original plan, states and dated notes are preserved as non-normative history. Later dated evidence may supersede an earlier checkpoint; current requirements live in the subsystem design above. Historical statements about active queues, permissions, available worktrees or pending gates describe their original context and grant no present execution authority.

- Decision: Accepted
- Delivery: Implemented
- Dependencies: [P001](001-secure-persistent-conversations.md)
- Outcome: The owner switches among projects and works in several conversations concurrently with clear control of each workspace.

## Scope and user/API flow

Extend first-project setup into project management and a sidebar of projects/conversations. Register or create folders beneath configured allowed roots, choose Local or Git Worktree mode, show the selected branch/revision/path identity, and run independent conversations concurrently. Support a bounded explicit copy option for non-Git projects. A deleted/renamed/unavailable folder produces a recoverable state rather than silently switching a conversation to another path.

Workspace creation, conversation listing, selection, cancellation, and archival use authenticated API operations. If P002 is installed, apply its existing scope machinery; do not require PATs for this feature's verification. A rich file editor, PR service integration, and terminal UI are excluded.

## Contracts and security

[D005](../../decisions/005-managed-project-workspaces.md) records the managed Git metadata, fixed helper, quota and workspace admission contract.

Persist stable project/workspace IDs, registered canonical roots, workspace type, base revision, native path mapping, ownership, and lifecycle. Enforce per-project runner mounts and resource budgets. Worktrees provide separate checkouts while sharing repository metadata; they are not a security boundary. Show how uncommitted source changes are handled before workspace creation. Do not delete dirty worktrees automatically.

Admission coordination is per workspace across managed runs and delivered editor/Git/terminal clients. Serialize conflicting managed writers; permit parallel work in separate workspaces. This is cooperative coordination, not a guarantee against arbitrary scripts or external SSH writes. Resource removal rechecks active leases and background work. Project archival never implies permission to delete source folders.

## Independent acceptance

Use P001 setup with two known Git repositories and one non-Git fixture. No file-editor, terminal, history-search, or scheduler feature is needed.

1. **P003-01:** Add multiple projects through the UI/API, create conversations, switch selection, and reload. Assert project/session identities and displayed workspace choices remain correct.
2. **P003-02:** Run two delayed conversations concurrently in different worktrees. Assert independent outputs and file markers in their intended checkouts, with no accidental overwrite of the original checkout.
3. **P003-03:** Submit conflicting managed work to one Local workspace. Assert visible queuing/coordination and correct cancellation, without claiming coordination blocks an out-of-band test writer.
4. **P003-04:** Exercise a non-Git copy and an unavailable/renamed source folder. Assert explicit lifecycle states, no unintended path fallback, and no automatic source deletion.
5. **P003-05:** Attempt traversal, symlink swaps, another project's paths, excessive workspace creation, and dirty/active workspace removal. Assert denial or explicit conflict before a destructive action.
6. **P003-06:** Run actual Linux isolation probes between project runners and a bounded real-Codex parallel-turn smoke. Assert access boundaries and supported runtime concurrency separately from fixture-based UI behavior.

## Delivery and verification

Use planned `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:isolation`, and relevant contract/live lanes. Record per-run repositories, branch/base revisions, runner IDs, and cleanup ownership as described in the [shared contract](../../workflow.md#implementation-and-verification-gate). Tests must never create branches or worktrees in the user's real project repositories.

Extend migrations and backup/restore registration for project/workspace metadata. If P009 is not yet delivered, define the registration contract and test project persistence now; P009 later proves host restore. When P009 exists, add this feature's restore assertions. Review new mount or Git-launch authority independently. Only actual acceptance evidence advances delivery status.

### Uncertain workspace ownership recovery

The D005 owner-browser release command requires explicit unknown-effects acknowledgement and expected session/generation. Acceptance includes stale release rejection, denied authority, failed retirement retaining ownership, and successful reuse by another conversation through the real UI/API. Original uncertain work is preserved without replay.

## Implementation references and remaining gates

The implemented workflow and commands are documented in [Managed project workspaces](../../../docs/developer/workspaces.md) and the [user guide](../../../docs/user/workspaces.md). Migration 006 owns workspace identities, stable storage operations and recovery reservations. The [implementation report](../../../docs/reports/2026-09-07-p003-workspaces.md) records two completed feature review rounds, separate P002/P003 integration review and passing application/Linux evidence at source `b012ef67ca4bc6cf35c190256f50504f53b6c32f4d3e4f1e77bdb50f35cdd972` (831 files), integrated through `ea8816f`. P003 remains unverified pending its dedicated live-account gate and applicable upstream obligations.

## Source issues

[Created workspace validation identity](../../../issues/archive/2026-09-08-035221-workspace-validation-identity.md) is High and Resolved. Root `e1b754a` includes both the shared caller/common correction and P008 worker handoff. Independent review, actual managed Linux creation/use, installed file/terminal acceptance and subsequent scheduling integration passed on their recorded sources. Direct helper evidence was not substituted for that application-level handoff.

[Workspace quota import](../../../issues/archive/2026-09-08-031857-workspace-quota-import.md) is Resolved. The guarded import passed independently reviewed actual Linux workspace/full file and installed acceptance on production `f13afc57…ad1d27`. Earlier failures remain historical evidence; live and the separately tracked worker integration gate remain open.

[Dedicated live-test credentials](../../../issues/2026-09-07-171225-live-runtime-credentials.md) remains a High release blocker for **P003-06**. The bounded two-runtime native workspace lane exists, but missing dedicated credentials leave actual authenticated parallel-turn effects unverified. Fixture and accountless Linux results do not waive this gate.

The [P003 implementation review](../../../issues/archive/2026-09-07-210500-p003-implementation-review.md) is Resolved after bounded IPC, durable removal/retry, filesystem barrier and combined authorization checks. The [shared authority finding](../../../issues/archive/2026-09-07-202308-authority-expiry-after-lock-wait.md) is Resolved after P003 and P007 passed current-authority and writer-generation checks. P003 remains active for the dedicated live-account gate.

## Implementation record

- 2026-09-07: Started isolated implementation on the committed P001 foundation under the owner's roadmap authorization. Managed Local/Git Worktree/copy behavior, trusted metadata ownership, writer coordination, and complete UI/API/Linux acceptance belong to this delivery. Material storage/Git decisions are recorded before use; P001's remaining gates stay visible.
