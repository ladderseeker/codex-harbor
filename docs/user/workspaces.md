# Projects and workspaces

Choose a project in the sidebar, open its ellipsis **Project details**, then **Manage workspaces**. Each project keeps its original **Local** workspace. A **Git Worktree** starts from an explicit committed revision and excludes Local's uncommitted changes. **Copy** creates an independent snapshot of a non-Git folder after your acknowledgement.

Choose **New conversation workspace** before creating a conversation. That conversation keeps its workspace permanently; its sidebar entry identifies the selection. Conversations in different workspaces can run concurrently. Conversations sharing one workspace queue until its previous runtime and background processes have stopped.

Managed Git worktrees share their project's Git metadata. Keep that in mind when changing branches or repository metadata through external tools. The supported import profile ignores hooks, filters and repository configuration; external Git metadata and submodules are unsupported. Copy rejects symlinks and special files and is limited to 256 MiB and 10,000 entries. A project retains at most 16 current workspaces including Local, subject to available quota.

Creation and removal show their durable progress. Retry the existing request after an interrupted response; Harbor keeps its operation identity. Only clean, inactive derived checkouts can be removed. Local cannot be removed, and archival preserves folders and conversation history. Missing or replaced folders become unavailable rather than switching to another path.

An uncertain conversation keeps its workspace reserved. **Release uncertain reservation** requires acknowledging unknown effects and identifies the expected conversation/generation. Harbor must confirm its processes are stopped before another conversation can use the workspace. Failure keeps the reservation and offers a bounded retry. Release preserves original uncertainty and existing file changes; it does not repeat the old request.

Workspace management currently requires the owner browser session. Existing API-token grants do not automatically enable new workspace-management routes. See [developer setup and verification](../developer/workspaces.md) for commands, and the [implementation report](../reports/2026-09-07-p003-workspaces.md) for passed checks and the pending real-account gate.
