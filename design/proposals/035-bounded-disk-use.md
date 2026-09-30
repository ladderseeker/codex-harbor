# P035 — Bounded disk use on the personal VPS

## Metadata

- ID: P035
- Status: Accepted
- Priority: Urgent. The owner set it on 30 September 2026 by choosing to fix the disk leak before continuous integration.
- Created: 2026-09-30
- Owner: Main conversation. A fresh-context implementer does the implementation.
- Outcome: Harbor no longer makes Codex download its plugin catalog, and it starts a capability probe only when the stored capabilities are stale. The personal VPS deploy tooling does five new things:
  - checks free space before it writes;
  - keeps Codex scratch and package caches out of checkpoints;
  - removes its own partial copies when a step fails;
  - reports disk use;
  - on explicit request, prunes old checkpoints and releases under a fixed retention rule.
- Authorization: On 30 September 2026 the owner reported that the VPS disk had filled, asked for this analysis, and chose "Disk fix first" on the thread's decision card: "I plan and build the leak fix now; CI (P026) and clean shutdown (P025) follow it." That choice authorizes this plan and its implementation in the repository. Later that day the owner allowed branch commits, then directed that finished work go straight to `main` without a pull request or owner review; [P036](036-cloud-agent-sessions.md) records that rule, and the automatic reviews still run. Every VPS workflow run other than `preflight` still needs the owner's go-ahead. The owner has since uninstalled Harbor from the VPS, so this plan changes no installed instance.
- Baseline: `main` at `92310786d8c502e3dec4a6a45188a488fa969356`. See [Baseline checks](#baseline-checks) for what ran on it.
- Dependencies: Nothing blocks execution. Two gates need infrastructure that this thread's container lacks, and they block completion:
  - The real-stack end-to-end suite needs a Docker engine with Compose. Starting a Docker daemon in this container was refused.
  - The personal VPS Linux lane needs systemd and a delegated cgroup v2 subtree. This container has neither, so the personal runtime launch contracts fail here with "Personal cgroup delegation unavailable".
  - [P026](026-continuous-integration.md) or another supported Linux host supplies them. They stay open until then, with P035-01, which needs a personal launch. [An issue](../../issues/2026-09-30-040032-p035-unverified-gates.md) records all three.

  The bounded live smoke needed the owner's permission to copy this container's ChatGPT credential. The owner gave it on 30 September 2026, and the smoke ran; see [Review and findings](#review-and-findings).
- Source issues: [Personal VPS disk growth](../../issues/2026-09-30-015210-personal-vps-disk-growth.md).
- Design references:
  - [official foundation](../architecture.md#official-foundation-and-compatibility-boundary);
  - [release, retention and rollback rules](../architecture.md#release-retention-and-rollback-rules);
  - [managed installation and recovery](../systems/004-deployment-and-profiles.md#managed-installation-and-recovery), for its disk-pressure rule;
  - the [personal VPS profile](../systems/004-deployment-and-profiles.md#personal-vps-profile);
  - [development and extensions](../systems/005-development-and-extensions.md), for disabled plugin surfaces;
  - the [GitHub Actions deployment guide](../../docs/developer/github-actions-deploy.md);
  - the [personal VPS guide](../../docs/developer/personal-vps.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P035-01 to P035-10.

## Problem, outcome and exclusions

The [source issue](../../issues/2026-09-30-015210-personal-vps-disk-growth.md) records how the owner's 80 GB VPS disk filled. Two runtime problems combine:

- Codex 0.153.4 syncs OpenAI's plugin catalog, about 100 MB on disk, into `CODEX_HOME/.tmp` whenever an app-server starts with a missing or stale copy, and it abandons the partial download when the process ends first.
- Harbor starts and retires a short-lived Codex runtime every minute to refresh model and account capabilities, and on every dispatch tick while no capability record exists.

On an instance with no conversation running, the result is one abandoned download a minute. Deploys then multiply the waste: every promotion copies all native state, the waste included, into a checkpoint that is never deleted. Staged releases are never deleted either, and no deploy step checks free space.

After this change:

1. **No plugin catalog.**
   - Every personal runtime, local or VPS, starts Codex with `-c features.plugins=false` in addition to the file credential store.
   - Codex then creates no `.tmp/plugins`, `.tmp/plugins-clone-*` or `.tmp/git-*` entries in Harbor's Codex home.
   - This follows the architecture: plugins need a separate assessment before they appear functional, and no plan has done one.
2. **Discovery only when needed.** The supervisor starts a capability probe only in three cases:
   - no capability record exists;
   - the stored account is not signed in;
   - the record is at least 30 minutes old.

   The following limits apply:

   - After any attempt, the next one waits at least 60 seconds.
   - The only exception is an attempt that succeeded and whose record was deleted since, as a credential change does. The probe then runs on the next tick, as it does today.
   - A failed attempt always waits the full 60 seconds.
   - A signed-in idle instance starts two probes an hour instead of sixty. The API's one-hour freshness window for models is unchanged.
3. **Checkpoints without scratch or caches.**
   - A promotion checkpoint still contains the verified database dump, the instance configuration, the units and drop-ins, the AppArmor profile and private state.
   - Private state now excludes three things:
     - the PostgreSQL data directory, as today;
     - `codex-home/.tmp`;
     - everything in each `home/development/<project>` directory except `data`, `state` and `config`.
   - Those three subdirectories are the XDG data, state and configuration homes. Everything else there is the XDG cache home and the npm and pnpm caches.
4. **Disk-pressure refusal.**
   - `build` and `promote` refuse before they change anything if the write would leave less than the reserve free. The reserve is the larger of 2 GiB and 5% of the filesystem.
   - `build` needs four times the installed release's allocated size free on each filesystem it writes to.
   - `promote` needs the checkpoint estimate free on the backup filesystem. The estimate is the allocated size of the state it will copy, plus the instance configuration, plus the database size.
   - The refusal message names the filesystem, the need, the reserve and the free space.
5. **Owned cleanup on failure.**
   - A checkpoint that fails deletes its own partial directory before the old release restarts.
   - A build that fails deletes the staging directory it created.
   - A staging directory that already existed is still refused and left for inspection, as today.
6. **Disk report.** `preflight` adds a read-only `disk` section containing:
   - free, total and reserve bytes for each filesystem that holds releases, checkpoints, instance state and deploy work;
   - the build and checkpoint needs, and whether each would fit;
   - the size of the Codex scratch directory;
   - each release and checkpoint, with its size and whether `prune` would keep it;
   - the total bytes that `prune` would free.

   When `prune` cannot run, the section says why and lists nothing to remove; the report itself still succeeds.
7. **Explicit prune.** A new `deploy-release prune --instance NAME [--keep-checkpoints N]` action, with N from 1 to 10 and a default of 2, runs as root.
   - It keeps the installed release, every release that a process runs from, the newest N checkpoints that `deploy-release` wrote, and the releases those checkpoints name.
   - It deletes every other release and every other checkpoint that `deploy-release` wrote.
   - It removes `state/codex-home/.tmp` from each kept checkpoint that `deploy-release` wrote.
   - It leaves other backup directories, names starting with a dot, such as `.staging-*`, symbolic links and everything outside the release and backup directories untouched.
   - Releases and checkpoints are shared by every instance on a host, so it runs only on a single-instance host. With another instance configuration present, it refuses and changes nothing.
   - It prints what it removed and the bytes freed.
   - The deploy workflow offers it as the `prune` action.
8. **Container log limit.** The installer renders PostgreSQL's container log with the `json-file` driver, `max-size` 10m and `max-file` 3.
9. **Documentation.** Current designs and guides describe all of the above. They explain how to remove leftover catalog downloads from a Codex home that predates this change.

Excluded:

- the pg-boss wake-up volume and retention, and the per-start growth of Codex's SQLite files, which stay in the source issue;
- the managed runner launcher, which starts Codex under restricted egress and would need the managed Linux isolation lane;
- turn admission at disk thresholds;
- automatic pruning after every promotion, which the owner can select later;
- off-host backup, which has [its own issue](../../issues/2026-09-26-034258-personal-vps-off-host-backup.md);
- per-delta message rewrites, which [P028](028-live-conversation-streaming.md) owns;
- the fresh-install deployment guide that the owner requested for after this fix, which gets its own plan.

## Dependencies and current design

The [architecture](../architecture.md#official-foundation-and-compatibility-boundary) says that plugins and connectors each require separate assessment, and that none should appear functional merely because the desktop offers them. [Design 005](../systems/005-development-and-extensions.md) disables unsupported plugin surfaces in generated extension configuration. The personal guardian nevertheless leaves Codex's default `plugins` feature on. Item 1 corrects that under the current design, so no decision record is needed.

[Design 004](../systems/004-deployment-and-profiles.md#managed-installation-and-recovery) requires disk pressure to preserve the healthy installation, fail closed and clean only owned staging. The [architecture's retention rules](../architecture.md#release-retention-and-rollback-rules) require the following:

- keep the old release and compatible state for recovery;
- mark eligible objects, recheck references, then delete only approved namespace paths;
- show storage use and retention consequences to the owner.

Items 3 to 7 apply those rules to the personal VPS deploy tooling. [Design 004's personal VPS profile](../systems/004-deployment-and-profiles.md#personal-vps-profile) requires model discovery to pass pinned-runtime contracts. Item 2 changes only when discovery runs, not what it reads.

Nothing in this plan changes the database schema, the API, the browser, runtime permissions, mounts, network policy or the systemd units. Adding a native argument changes how the runtime launches. So the workflow's launch gate applies: an actual supported Linux run, together with pinned real-runtime contracts and a bounded live smoke.

[P025](025-clean-supervisor-shutdown-and-restart.md) also edits `local-runtime.ts`, `main.ts` and `deploy-release`, so the two plans run one after the other, as D013 requires.

## Source issues

The [disk growth issue](../../issues/2026-09-30-015210-personal-vps-disk-growth.md), severity High, maps to this plan as follows:

| Mechanism in the issue | Acceptance |
| --- | --- |
| 1, plugin catalog downloads | P035-01 and P035-02 |
| 2, per-minute and per-tick discovery | P035-03 |
| 3, full-state checkpoints and no checkpoint pruning | P035-04 and P035-07 |
| 4, unpruned releases | P035-07 |
| 5, no disk-pressure guard and leftover partial copies | P035-05 and P035-06 |
| Disk use not shown to the owner | P035-08 |
| PostgreSQL container log without limits | P035-09 |

The issue keeps five observations: the pg-boss wake-up volume, Codex SQLite growth per start, the managed launcher, disk-threshold turn admission, and the deploy build cache with leftover upload directories. So the transfer is partial and the issue stays in the inbox.

## User and API flows

No browser page or public API changes.

- **Owner.** Models and account readiness keep appearing as today, from a record refreshed at most every 30 minutes, or every minute while not signed in.
- **Administrator.**
  - `preflight` shows disk use and what `prune` would remove.
  - `build` and `deploy` refuse with a clear message when space is short, before any service stops.
  - `prune` frees space on request.
  - A failed deploy step leaves no partial copy of its own.

## Contracts, state and security

- **Runtime arguments.** The guardian starts exactly `-c cli_auth_credentials_store="file" -c features.plugins=false app-server --listen stdio://`. One exported constant defines these arguments, and tests import it. Nothing else about the environment, sandbox, mounts or cgroup changes.
- **Discovery schedule.**
  - A pure function decides whether a probe is due, from three inputs: the current time, the last attempt's time and outcome, and the stored record's age and signed-in state.
  - The supervisor reads the record's age with `extract(epoch from now() - updated_at)` and its signed-in state from `data->'account'->>'authenticated'`.
  - The attempt is recorded before the probe starts and marked successful only after the capability write and retirement succeed.
  - The existing guards for `discovering`, credential mutation, maintenance and required activation stay first.
  - Personal startup still deletes the stored record, so the first tick probes at once.
- **Checkpoint content.**
  - Copied content keeps `cp -a` fidelity.
  - Directories rebuilt because a child was excluded get the source's mode, owner, group and timestamps.
  - A restore from a new checkpoint lacks Codex scratch and package caches. Codex recreates `.tmp` when it needs it, and package managers refill their caches.
  - The receipt keeps its current fields.
- **Space checks.** Allocated sizes come from `lstat` block counts. Symbolic links are never followed, and each hard-linked inode is counted once. The checks run before `build` writes anything and before `promote` stops the API.
- **Prune authority.**
  - Prune runs as root and considers only direct children of `/opt/harbor-personal/releases` and `/var/lib/harbor-personal-backups`.
  - It never follows or deletes through symbolic links.
  - A checkpoint counts as written by `deploy-release` only when its `receipt.json` parses with string fields `release`, `databaseSha256` and `createdAt`, `createdAt` matches `YYYYMMDDTHHMMSSZ`, and the directory name ends with `-` plus that value.
  - Before deleting each release, prune rechecks that no process runs from it and that it is not the installed release.
  - Prune does not lock against a concurrent SSH `build` or `promote`. The workflow's concurrency group serializes workflow runs, and the guide tells administrators not to run prune during a deploy.
- **Errors.** Messages follow the script's existing rule and never print configuration values or subprocess environments.

## Implementation brief

Read these first:

- this plan and the [source issue](../../issues/2026-09-30-015210-personal-vps-disk-growth.md);
- the sections under Design references;
- [AGENTS.md](../../AGENTS.md);
- the [workflow gate](../workflow.md#implementation-and-verification-gate);
- the [implementer role](../../docs/developer/agents/implementer.md).

Work on the current branch without committing.

1. `packages/codex-adapter/src/local-runtime.ts`:
   - Export `PERSONAL_RUNTIME_ARGS` with the exact arguments above.
   - Generate the guardian's `spawn` call from that constant, using `JSON.stringify` inside the template.
   - Keep a short comment on why plugins are off.
2. `apps/supervisor/src/discovery-schedule.ts` (new): export `DISCOVERY_REFRESH_SECONDS = 1800`, `DISCOVERY_RETRY_MS = 60000` and `discoveryDue(now, last, stored)`.
   - `last` is `{ at, failed }` or undefined.
   - `stored` is `{ ageSeconds, authenticated }` or undefined.
   - A recent attempt is one less than `DISCOVERY_RETRY_MS` ago. Return values:

     | Stored record | Last attempt | `discoveryDue` returns |
     | --- | --- | --- |
     | None | Recent and failed | False |
     | None | Anything else | True |
     | Present | Recent | False |
     | Present | Not recent | True if not signed in or at least `DISCOVERY_REFRESH_SECONDS` old; otherwise false |

3. `apps/supervisor/src/main.ts`: replace `lastDiscovery` and its 60-second test in `discover()` with the schedule function and the record query described under Contracts. Change nothing else in discovery.
4. `infra/personal-vps/deploy-release`:
   - Add path-parameterized helpers, defaulting to the module constants, for:
     - the checkpoint copy;
     - allocated size;
     - the reserve and space check;
     - the prune plan and its execution;
     - the disk report.
   - Use them in `checkpoint`, `build`, `promote` and `preflight`.
   - Add the `prune` subcommand with `--keep-checkpoints`.
   - Keep `freeBytes` in the preflight output for compatibility.
5. `.github/workflows/deploy-vps.yml`:
   - Add `prune` to the action choices and update the description.
   - Run the build step only for `build` and `deploy`, and add a prune step for `prune` that writes `prune.log`.
   - Include `prune.log` in the summary.
6. `infra/personal-vps/harbor-personal`: add the `logging` option to the PostgreSQL service only.
7. Tests. Add:
   - the argument assertion to the fake-binary test in `tests/contract/local-runtime.test.ts`, which prints its arguments and compares them with the constant;
   - a new test in `tests/contract/plugins.test.ts`, which follows the existing native contract's run-owned home pattern and needs no account or network;
   - `tests/integration/discovery-schedule.test.ts`;
   - `tests/deployment/deploy_release_test.py`, which loads the script as `deploy-release` loads `harbor-personal`;
   - the logging assertion in `tests/deployment/personal_vps_test.py`.
8. Documentation:
   - Update the Actions and Limits sections of `docs/developer/github-actions-deploy.md`: checkpoint content, space checks, the disk report and `prune`.
   - Update `docs/developer/personal-vps.md`: the plugin catalog is off; discovery refreshes every 30 minutes; the log limit; how to remove the leftover catalog copy and downloads (`.tmp/plugins*` and `.tmp/git-*`) from an older Codex home while the supervisor is stopped.
   - Update the personal VPS profile in `design/systems/004-deployment-and-profiles.md` with one short paragraph on bounded disk use.
   - Do not edit historical reports or archived records.

Main owns this plan's closing record and the source issue. Return new decisions or paths outside the fence to main before depending on them.

## Exact file fence

- `packages/codex-adapter/src/local-runtime.ts`
- `apps/supervisor/src/main.ts`
- `apps/supervisor/src/discovery-schedule.ts` (new)
- `infra/personal-vps/deploy-release`
- `infra/personal-vps/harbor-personal`
- `.github/workflows/deploy-vps.yml`
- `tests/contract/local-runtime.test.ts`
- `tests/contract/plugins.test.ts` (new)
- `tests/integration/discovery-schedule.test.ts` (new)
- `tests/deployment/deploy_release_test.py` (new)
- `tests/deployment/personal_vps_test.py`
- `docs/developer/github-actions-deploy.md`
- `docs/developer/personal-vps.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/proposals/035-bounded-disk-use.md` (main only)
- `issues/2026-09-30-015210-personal-vps-disk-growth.md` (main only)

Run-owned scratch goes under `.test-runs/p035-*`, which Git ignores, or the OS temporary directory. The P035-02 contract uses its own private Codex home under `.test-runs/`.

## Verification and acceptance

- **P035-01:** The guardian starts the native binary with exactly `PERSONAL_RUNTIME_ARGS`. The fake-binary contract prints its arguments and compares them. This runs wherever a personal launch works: macOS, or Linux with delegated cgroups.
- **P035-02:** The pinned Codex 0.153.4 binary, started with `PERSONAL_RUNTIME_ARGS` in a fresh private run-owned home, must meet three conditions:
  - it answers `initialize`, `model/list` and `account/read`;
  - it is killed after two seconds;
  - it leaves no `plugins`, `plugins-clone-*` or `git-*` entry under `.tmp`.

  In addition, `codex -c features.plugins=false features list` reports `plugins` false, while `codex features list` reports it true. The test is skipped when `HARBOR_LOCAL_CONTRACT_BINARY` is unset. For evidence that the negative assertion discriminates, the source issue records flagless starts that leave `plugins*` and `git-*` entries, and a check with Harbor's arguments minus the flag that leaves `.tmp/plugins`, `plugins.sha` and `plugins.sync.lock`.
- **P035-03:** `discoveryDue` returns the documented result for each case:
  - no record, with no attempt, a recent successful attempt, a recent failed attempt, and an old failed attempt;
  - a fresh signed-in record;
  - a 29-minute and a 30-minute signed-in record;
  - a not-signed-in record, both within 60 seconds of the last attempt and after it;
  - a clock that moved backwards.
- **P035-04:** For a temporary state tree, the checkpoint copy must do all of the following:
  - copy `control`;
  - copy `codex-home` without `.tmp`;
  - copy `home` except each `development/<project>` entry other than `data`, `state` and `config`;
  - skip `postgres`;
  - preserve file contents, modes and symbolic links;
  - give rebuilt directories the source's mode, owner and timestamps.
- **P035-05:** With `shutil.disk_usage` patched:
  - `build` refuses before writing when any filesystem it writes to lacks four times the installed release plus the reserve;
  - `promote` refuses before stopping the API when the backup filesystem lacks the estimate plus the reserve;
  - both messages name the need, reserve and free bytes, and no service or file changes;
  - the reserve is the larger of 2 GiB and 5%.
- **P035-06:** When the checkpoint copy fails partway, the partial checkpoint directory is gone before the old release restarts. A build failure after the staging copy started removes that staging directory. A staging directory that already existed is refused and left untouched.
- **P035-07:** Given releases, checkpoints written by `deploy-release`, unrecognized checkpoints and a release with a simulated running process, `prune` must meet all of the following:
  - it keeps the installed release, the running release, the newest N recognized checkpoints and the releases they name;
  - it deletes only the other recognized checkpoints and releases;
  - it strips `state/codex-home/.tmp` from each kept recognized checkpoint and from no other backup directory;
  - it leaves unrecognized checkpoints, names starting with a dot, such as `.staging-*`, and symbolic links untouched;
  - on a host with another instance configuration, it refuses and changes nothing;
  - it rejects N outside 1 to 10;
  - its printed plan equals what it deletes.
- **P035-08:** The `preflight` disk report lists each filesystem once, with free, total and reserve bytes, the build and checkpoint needs and whether each fits, the Codex scratch size, each release and checkpoint with its size and keep decision, and the total bytes prune would free. When prune cannot run, because of another instance or a backup root that is a symbolic link, the report says why and lists no releases, checkpoints or removals. It modifies nothing.
- **P035-09:** The installer renders PostgreSQL with the `json-file` log driver, `max-size` 10m and `max-file` 3, and leaves the routing service unchanged.
- **P035-10:** The applicable gate passes:
  - `pnpm build`, `pnpm check` and `pnpm test`;
  - `pnpm test:contract` with `HARBOR_LOCAL_CONTRACT_BINARY` set to the pinned binary;
  - `pnpm test:deployment:contract`;
  - the critical `pnpm test:e2e` suite;
  - the personal VPS Linux lanes `node --import tsx tests/personal-vps/e2e.ts` and `--concurrency`;
  - a bounded live smoke: one short turn through the pinned runtime with `PERSONAL_RUNTIME_ARGS` in a disposable workspace, which reads a canary file and edits a file in place.

  The last three need a Docker engine, systemd with delegated cgroups and a permitted account copy respectively. Where one is unavailable, it is recorded as unverified, never as passed. The baseline failures listed below are not attributed to this change.

### Baseline checks

These ran on `9231078` on 30 September 2026. The environment was a cloud Linux container running as root, with cgroup v1, Node 24.11.1, pnpm 12.3.4 and pinned Codex 0.153.4.

- `pnpm build`, `pnpm check` and `pnpm test` passed; `pnpm test` reported 51 passing.
- `pnpm test:deployment:contract` failed one unrelated managed-tooling test, `review_test.Review.test_actual_process_capture_limit_timeout_and_failure` ("RuntimeError not raised").
- `pnpm test:contract` with the pinned binary passed 23 of 28. The five failures all launch personal or Linux-native runtimes that need delegated cgroups or the Linux attachment lane. Four of them report "Personal cgroup delegation unavailable". The fifth, the P024 attachment contract, reports "UNVERIFIED P024-03" because it needs a nonroot Linux host.

## Rollout and recovery

No installed instance exists: the owner removed Harbor from the VPS on 30 September 2026. The next installation uses this code from the start. The installer renders the log limit, and every runtime starts with plugins off.

A Codex home carried over from an older installation may still hold the plugin catalog copy and abandoned downloads, `.tmp/plugins*` and `.tmp/git-*`. The personal VPS guide says how to remove them while the supervisor is stopped.

Nothing migrates. Reverting the commit restores the old behavior. Checkpoints written by this version restore the same way as before, without Codex scratch and package caches.

## Review and findings

### Round 1, 30 September 2026

The design and provenance reviewers read `d33487f` against the baseline `9231078`, over this plan's fence. Both reproduced the runnable gate with main's results: `pnpm build`, `pnpm check` and `pnpm test` passed, and `pnpm test:contract` and `pnpm test:deployment:contract` failed only their baseline tests.

The design reviewer reported one blocker, one major and three minor findings, five nits and one unrelated observation. The provenance reviewer reported one major finding, the same as the design blocker, four minor findings, five nits and observations outside this plan. Main's dispositions:

- **Accepted, and fixed by the implementer in `9da83f6`:**
  - `prune` stripped Codex scratch from backup directories that `deploy-release` did not write. It now strips only the kept checkpoints that it wrote, and it never reads a receipt under a name that starts with a dot.
  - `prune` treated the host-wide release and backup directories as one instance's. It now refuses on a host with another instance configuration, and the report shows it unavailable.
  - A backup directory that is a symbolic link made `preflight`, and so every workflow action, fail. The report now says why prune is unavailable instead.
  - Discovery attempt times used the wall clock. They now use `performance.now()`.
  - Nits: the cleanup command also removes the complete catalog copy, the script's help mentions prune, the full-disk sentence names preflight, P035-02 asserts the pinned version, the P035-05 tests assert the mount point, and the two guides date the uninstall.
- **Accepted, and fixed by main in `d050fa3`:** the proxy-less evidence row is relabeled, and P035-02 cites other discrimination evidence; the 35 GB a day is conditional, with the observed range and SIGKILL retirement; Dependencies states the smoke's authorization and scope; the baseline count and size conventions are corrected; and the source issue records the deploy build's pnpm cache and leftover upload directories.
- **Evidence retention:** main copied the baseline, gate and reproduction logs into `.test-runs/p035-evidence/` and recorded the smoke's binary identity in `.test-runs/p035-live/smoke-identity.json`. Both are ignored storage in a disposable container, so the delivery entry keeps the identities and results that matter.
- **Accepted limitation:** a checkpoint copies each top-level entry with its own `cp -a`, so a hard link between two entries becomes two files. Harbor's state has no such links today.
- **Handled by [P036](036-cloud-agent-sessions.md):** `AGENTS.md` names only `build` and `deploy` as needing the owner's go-ahead. P036 extends that to every action other than `preflight`, which covers `prune`.
- **Recorded as issues:** Codex's [other default features](../../issues/2026-09-30-033835-personal-runtime-default-features.md), the history contract [running the host's login profile](../../issues/2026-09-30-033836-contract-test-login-shell.md), and the managed helper's [capture-limit truncation](../../issues/2026-09-30-032022-deploy-run-capture-limit.md).
- **Observation:** P006-01 failed once, after 319 ms, in the implementer's baseline copy under `/tmp`, and it passed in every run in the repository checkout. It is not attributed to this plan.

## Closing record

Pending until the [completion conditions](../workflow.md#proposal-completion-and-archive) pass.
