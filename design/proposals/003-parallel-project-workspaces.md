# P003 — Parallel project workspaces

- Decision: Accepted
- Delivery: In progress
- Dependencies: [P001](001-secure-persistent-conversations.md)
- Outcome: The owner switches among projects and works in several conversations concurrently with clear control of each workspace.

## Scope and user/API flow

Extend first-project setup into project management and a sidebar of projects/conversations. Register or create folders beneath configured allowed roots, choose Local or Git Worktree mode, show the selected branch/revision/path identity, and run independent conversations concurrently. Support a bounded explicit copy option for non-Git projects. A deleted/renamed/unavailable folder produces a recoverable state rather than silently switching a conversation to another path.

Workspace creation, conversation listing, selection, cancellation, and archival use authenticated API operations. If P002 is installed, apply its existing scope machinery; do not require PATs for this feature's verification. A rich file editor, PR service integration, and terminal UI are excluded.

## Contracts and security

[D005](../decisions/005-managed-project-workspaces.md) records the managed Git metadata, fixed helper, quota and workspace admission contract.

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

Use planned `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:isolation`, and relevant contract/live lanes. Record per-run repositories, branch/base revisions, runner IDs, and cleanup ownership as described in the [shared contract](README.md#shared-verification-contract). Tests must never create branches or worktrees in the user's real project repositories.

Extend migrations and backup/restore registration for project/workspace metadata. If P009 is not yet delivered, define the registration contract and test project persistence now; P009 later proves host restore. When P009 exists, add this feature's restore assertions. Review new mount or Git-launch authority independently. Only actual acceptance evidence advances delivery status.

### Uncertain workspace ownership recovery

The D005 owner-browser release command requires explicit unknown-effects acknowledgement and expected session/generation. Acceptance includes stale release rejection, denied authority, failed retirement retaining ownership, and successful reuse by another conversation through the real UI/API. Original uncertain work is preserved without replay.

## Implementation references and remaining gates

The implemented workflow and commands are documented in [Managed project workspaces](../../docs/developer/workspaces.md). Migration 006 owns workspace identities, stable storage operations and recovery reservations. Final review and source-bound evidence remain required before verification.

## Source issues

[Dedicated live-test credentials](../../issues/2026-09-07-171225-live-runtime-credentials.md) remains a High release blocker for **P003-06**. The bounded two-runtime native workspace lane exists, but missing dedicated credentials leave actual authenticated parallel-turn effects unverified. Fixture and accountless Linux results do not waive this gate.
