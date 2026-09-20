# File and Git tools

## Design and evidence ownership — 20 September 2026

[Current subsystem designs](../../design/systems/) own behavior and limits; the [issue inbox](../../issues/) owns unfinished acceptance. Historical proposal IDs below identify feature lineage and evidence, not active execution. Future changes follow a newly selected proposal under the [workflow](../../design/workflow.md); baseline reconciliation did not rerun application gates.

Harbor provides authenticated file views, a Monaco editor, downloads and reviewed Git actions. Its canonical limits and acceptance obligations are in [P004](../../design/systems/002-workspaces-and-resources.md). The [feature evidence report](../reports/2026-09-08-p004-files.md) records its application/Linux checks and two completed implementation review rounds. Subsequent installed evidence and remaining verification gates are recorded in the [module report](../reports/2026-09-08-installed-module-integration.md).

Use the selected workspace's **Files and changes** button. Text drafts stay in the open browser tab. A save changes the file only; stage and commit are separate actions. A stale save leaves the draft intact. **Refresh revision, keep draft** loads the current revision without replacing draft text, after which Save is a new deliberate operation. Closing an unsaved draft requires an explicit choice; browser reload does not recover unsaved browser memory.

The Changes view distinguishes staged and unstaged content. Select a complete file or the displayed server-derived hunks. Renames and executable-mode changes require a whole-file selection. Unstage modifies the index and leaves worktree bytes alone. A commit includes every explicitly reviewed staged entry; open each staged diff before submitting. Managed Git uses fixed author information, skips project hooks/filters/signing, and has no network access. It does not push, run package installation, or execute repository commands in the API process.

Binary, oversized, unsupported Git metadata and path denials are explicit results. Downloads are attachment responses for the exact inspected revision. File references encode the selected workspace and exact relative filename bytes; callers must use returned references rather than inventing native paths. API clients need explicit `files:read`, `files:write`, `git:read` or `git:write` scopes and project grants. Both write scopes also require a workspace-write ceiling. Existing tokens gain no new scopes.

## Runtime and verification

Writes require the supported Linux filesystem boundary and managed project profile described in the [workspace guide](workspaces.md). The API sends fixed read requests over the private storage socket; the supervisor owns durable write dispatch. Neither the API nor the coding runner receives a host Docker socket. The fixed file helper has its own image, UID 10001, read-only root filesystem, no network and only the selected checkout/common mounts. Root-owned receipts and the four-slot ledger live beneath `HARBOR_LAUNCHER_STATE_DIR`, outside project mounts.

Build the candidate image from the repository root:

```sh
docker build -f infra/files/Dockerfile -t codex-harbor-files:2.39.5-p004 .
```

On a disposable supported Linux verification host, use the existing dedicated XFS mount/control-root setup and run:

```sh
pnpm test:isolation --files
```

This entry point creates fresh namespaces, PostgreSQL/Caddy services, owner authentication, projects and quota slots; it uses the real API, supervisor, storage service and file helper. OIDC and Codex are labeled external fixtures. Run-owned resources are recorded and cleaned up; existing projects or personal Codex state are never test inputs. The process needs the trusted root/Docker authority required by that isolated verification profile. Browser dependencies must be installed in its test environment.

The smaller `pnpm test:e2e --files` lane uses the same real Harbor application and fixed helper with private disposable filesystem fixtures. It requires Linux for writes. `node --import tsx tests/files/e2e.ts --render-only` checks authenticated editor rendering/CSP on macOS or Linux and explicitly makes no write/isolation claim. A macOS Docker Desktop experiment observed different reported inode values across successive helper containers for the same replacement bytes/timestamps; native Linux preserved the identity. This is an observed environment difference, not a diagnosis of Desktop internals or a reason to weaken revision checks.

Monaco 0.56.0 assets and its worker are served from authenticated local builds. The build adapter changes only pinned trusted style factories/renderers to use the document's nonce and CSSOM. It does not relax script CSP, enable unsafe inline styles, patch global DOM methods, or render repository HTML. Browser acceptance asserts hostile text remains text, the style nonce matches, no CSP violation occurs, and desktop/mobile controls remain usable.

## Uncertain effects and capacity

After an ambiguous helper/DB result or supervisor crash, the original operation remains uncertain and retains its typed workspace reservation. **Inspect and fence file operation** confirms exact helper retirement and reads the durable receipt/current state without replaying the original save or Git command. Review the report and explicitly acknowledge unknown effects before releasing the reservation. This does not undo a changed file or commit. Queued dependent mutations fail when their predecessor becomes uncertain; release does not start them later. A later mutation needs a new intent and current revisions. Other conversation/workspace recovery controls cannot clear a file-owned reservation.

Ordinary writes are bounded to 128 retained operations per workspace and 4,096 per instance, with four queued per workspace. At capacity new writes fail before helper effects. Exact retained retries and the separately reserved inspection/release flow remain available. The candidate retains operation/receipt evidence rather than silently deleting unresolved state to make room. Failed inspections have at most three deliberate attempts; exhausted or unconfirmed retirement remains blocked for administrator recovery.

P009's module inventory must include the file tables, receipt directory and slot ledger/lock before a deployed checkpoint can cover this feature. Restore/rollback is governed by the shared deployment compatibility contract; an old binary must not run against typed reservations it cannot honor.

The installed package pins the file-helper image alongside the runner/Git images. `HARBOR_FILE_SOCKET` selects the existing storage socket; `/files` admits only fixed read actions. Maintenance retains queued writes without dispatching them, permits bounded inspection/release, and blocks checkpoint completion on unresolved effects. Restored inspections and source receipts cannot release destination ownership; a fresh inspection is required. See the [installed module report](../reports/2026-09-08-installed-module-integration.md) for current integration evidence and limits.
