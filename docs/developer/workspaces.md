# Managed project workspaces

P003 adds Local, Git Worktree and explicit non-Git Copy workspaces. Its boundary is defined by [D005](../../design/decisions/005-managed-project-workspaces.md); the [proposal](../../design/proposals/003-parallel-project-workspaces.md) retains acceptance ownership and the missing live-account gate.

Use **Manage workspaces** to inspect Local and create a derived workspace. Git Worktree uses a detached immutable commit and excludes Local's uncommitted changes. The Local checkout remains in place. Managed worktrees share their project's Git metadata; they are separate checkouts, not mutual security boundaries. External gitdir/alternates, submodules and arbitrary repository Git customization are outside the supported import profile. The fixed helper ignores repository configuration, hooks, filter drivers and global configuration.

Copy is available only for a non-Git source and requires explicit acknowledgement. It snapshots at most 256 MiB, 10,000 entries and 64 directory levels, rejecting symlinks and special files. Copies have independent file contents and inodes. Each project admits at most 16 current workspaces, including Local; quota headroom can impose a lower practical limit.

A conversation permanently selects one workspace. Separate workspaces can run concurrently, with at most four managed active runtimes. Conversations sharing a workspace queue until its previous runtime and background processes are confirmed stopped. Missing or replaced directories become unavailable; restoring the registered inode permits inspection to recover availability. Harbor never substitutes another path.

An uncertain writer keeps its reservation. The owner browser can choose **Release uncertain reservation**, acknowledge unknown effects and stop its processes. The request identifies the expected conversation and generation. Healthy active work and stale requests are rejected. A failed retirement keeps ownership reserved and displays the failure; retry reuses the same recovery record. Successful release permits a different conversation to use the workspace. Original uncertain work remains uncertain and is never replayed; existing file changes remain.

Archive changes metadata and retains source folders and history. Project and workspace archive reject managed work that holds the resource. Conversation archive only changes visibility, including while a turn is active; it does not stop that turn. P007 conversation recovery can release the exact reserved writer after confirmed retirement and then accept separately acknowledged new input, while retaining the original uncertainty. Only clean, inactive derived checkouts can be removed; Local cannot be deleted. Creation/removal return `creating`/`removing` records before their fixed storage operation runs. Poll the workspace endpoint for its durable outcome. Repeating an idempotency key returns the same identity even if the response or final database commit was lost.

## Runtime and storage setup

Use the existing [supported Linux workflow](linux-verification.md), including the trusted XFS storage service. Build the fixed Git helper from the repository root:

```sh
docker build -f infra/git/Dockerfile -t codex-harbor-git:2.39.5-p003 .
```

The image pins Debian Git `1:2.39.5-0+deb12u3`, Python `3.11.2-1+b1`, and the same digest-pinned Node 24.11.1 base. It has no network, runs as UID 10001 with the runner seccomp/capability/resource profile, and reads only the selected source. Only the trusted service invokes Docker; project runners receive no Docker socket or launcher controls.

Project storage extends the existing quota-backed layout with `workspaces/<workspace-id>/checkout` and `git-common`. Registered checkout and common identities are persisted in migration 006. Native histories remain in stable session homes. Worktree runners receive their checkout at `/workspace`, its fixed identity alias, and `/git-common`; read-only profiles make both checkout and common metadata read-only.

The launcher control directory stores bounded workspace operation receipts outside project mounts. Create/remove intents commit before filesystem effects. Receipts reconcile successful effects after transport or database commit failure. Prepared staging is discarded only after exact helper retirement, and helper starts address immutable container IDs. Failed or unknown reconciliation remains visible and prevents another managed writer from racing the operation.

## Verification commands

```sh
pnpm test:workspaces
pnpm test:e2e --workspaces
pnpm test:contract
pnpm test:isolation --workspaces
pnpm test:live --workspaces
```

The first command needs Docker and the built helper image. The workspace E2E lane uses real UI, HTTPS proxy, API, PostgreSQL and supervisor; only Codex and OIDC are external deterministic fixtures. `pnpm test:e2e` retains the P001 critical regression lane and explicitly releases prior uncertain workspace reservations between independent scenarios.

The isolation command requires root authority inside a disposable supported Linux environment with `HARBOR_TEST_XFS_MOUNT` and `HARBOR_TEST_CONTROL_ROOT`, plus the runner, gateway and Git images. It uses the actual API/storage service and production runner launcher. It tests disjoint concurrent mounts, both permission profiles, inode replacement, stable native history and quota enforcement.

The live command additionally needs dedicated `HARBOR_TEST_OPENAI_API_KEY` credentials. It launches two production runtimes against separate managed copies and requires distinct actual file effects. Missing credentials produce a nonzero unverified result, not a skipped pass. Never use ordinary Codex state or personal projects.

## Backup registration

A consistent project backup includes project/workspace/session rows, `workspace_storage_operations`, `workspace_releases`, all managed checkouts, shared Git metadata, native histories, and the matching trusted workspace receipts. Drain writers and reconcile pending storage effects before snapshotting. Restore canonical identities explicitly; do not silently substitute a new inode for a registered checkout. P009 owns complete host restore verification and launcher identity reconciliation.

Removal records its clean authorization and exact checkout/common identity in a durable `removing` receipt before the first unlink. Interrupted removal retains the project metadata reservation; after exact helper retirement it resumes only that recorded deletion without re-inspecting partially removed contents. Failed removals before this checkpoint may retry the same bounded operation and receipt identity; they do not append a new record for each retry. Private storage IPC rejects incomplete responses and enforces an absolute 45-second deadline independently of traffic.

Before publishing a completed receipt on the separate control filesystem, the trusted service retires the exact helper and completes a bounded `syncfs` barrier on the validated project filesystem. Successful effects awaiting this barrier retain an `applied` receipt and their result; flush failure or timeout stays pending and replay flushes without repeating the effect. Removal reconciliation and discarded staging use the same barrier. Process-death tests do not establish physical power-loss behavior; the Linux lane separately verifies the actual barrier and injected kernel-error publication ordering.

An `applied` receipt is not proof that pre-barrier project writes survived a host crash. Creation records bounded hashes of all checkout and common metadata contents plus their exact identities before publication; replay requires an exact match and otherwise remains pending without copying newer source data. Removal replay resumes its recorded exact deletion before flushing. The Linux fault scenario also corrupts an applied checkout and verifies that a successful flush alone cannot publish it.
