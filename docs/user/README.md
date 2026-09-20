# User guides

## Design and evidence ownership — 20 September 2026

[Current subsystem designs](../../design/systems/) own behavior and limits; the [issue inbox](../../issues/) owns unfinished acceptance. Historical proposal IDs below identify feature lineage and evidence, not active execution. Future changes follow a newly selected proposal under the [workflow](../../design/workflow.md); baseline reconciliation did not rerun application gates.

Harbor's conversation, attachment, API-token, workspace and history/recovery features are implemented with required verification gates still open. These guides describe the available interface; the [current designs](../../design/systems/) and [issue inbox](../../issues/) distinguish available behavior from remaining delivery gates.

- [Conversations and account setup](conversations.md): owner login, project selection, text requests, approvals, cancellation, storage visibility, searchable history, archival and explicit uncertainty recovery.
- [Attachments and saved drafts](attachments.md): select, drop, paste, upload recovery, supported files and limits.
- [API tokens](api-tokens.md): create, limit, and revoke credentials for external clients.
- [Projects and workspaces](workspaces.md): choose Local, Git Worktree or Copy, coordinate conversations and recover an uncertain reservation.
- [Workspace terminals](terminals.md): run a confined shell, detach/reconnect, take control, inspect a bounded output tail and terminate background work.
- [Scheduled work](schedules.md): timing previews, bounded grants, standalone results and explicit attention/recovery; implemented with live and protected-restore verification pending.
- [Private project previews](previews.md): existing package scripts on separate authenticated origins; implemented with protected restore and upstream verification pending.
- [Developer setup](../developer/development.md): disposable local instance and current runtime prerequisites.
