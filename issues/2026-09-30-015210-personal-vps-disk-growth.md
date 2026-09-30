# Personal VPS disk fills with abandoned Codex downloads and unpruned deploy copies

- Severity: High. The owner reported on 30 September 2026 that the VPS's 80 GB disk filled up soon after a deployment. A full disk stops PostgreSQL writes and every Harbor operation.
- Owner: [P035](../design/proposals/035-bounded-disk-use.md) takes the obligations mapped under [Ownership](#ownership). The remaining observations await owner selection in this inbox.
- Status: Open. The mechanisms come from source inspection and a local reproduction with Codex 0.153.4 on 30 September 2026. Nobody inspected the VPS for this record. The owner uninstalled Harbor from it the same day, so no host measurement of the failure exists.
- Recorded: 30 September 2026.
- Related: [GitHub Actions deployment limits](../docs/developer/github-actions-deploy.md#limits), [deployment and profiles design](../design/systems/004-deployment-and-profiles.md#managed-installation-and-recovery), [release and retention rules](../design/architecture.md#release-retention-and-rollback-rules) and the [off-host backup issue](2026-09-26-034258-personal-vps-off-host-backup.md).

## Mechanisms

1. **Codex downloads its plugin catalog on every start and abandons partial copies.**
   - Codex 0.153.4 enables its stable `plugins` feature by default, as `codex features list` shows.
   - When an app-server starts, Codex compares its copy of `https://github.com/openai/plugins` with upstream. If the copy is missing or stale, Codex clones the repository, about 100 MB on disk, into `CODEX_HOME/.tmp/plugins-clone-XXXXXX` and moves it to `.tmp/plugins` only after the clone completes. Every such start also leaves an empty `.tmp/plugins.sync.lock`.
   - A process that exits first, whether killed or closed normally, leaves the partial clone behind. A start whose copy is current still leaves a `.tmp/git-XXXXXX` directory of about 16 KB when it ends early.
   - The personal guardian in [local-runtime.ts](../packages/codex-adapter/src/local-runtime.ts) starts Codex with only `-c cli_auth_credentials_store="file"`, so every personal runtime, local or VPS, runs this sync.
   - The [architecture](../design/architecture.md#official-foundation-and-compatibility-boundary) requires plugins to be assessed separately before they appear functional, and no plan has done that.
2. **Capability discovery starts a throwaway Codex process every minute.**
   - The supervisor's `discover()` in [main.ts](../apps/supervisor/src/main.ts) runs on every dispatch tick. Whenever its last probe is more than 60 seconds old, it starts a read-only Codex runtime, reads models and the account, and retires the runtime within seconds. That is about 1,440 short-lived Codex starts a day.
   - While no capability record exists, it probes again on every tick.
   - Together with mechanism 1, an instance with no conversation running and a stale catalog copy can abandon one partial clone a minute. Harbor retires a probe by killing the guardian's process group. In the reproduction, the partial clone left per stopped start ranged from 0.1 MB to 24 MB, and a later check during P035's review left 98,856 KiB after a 2-second kill; the size depends on how far the clone got. At the 24 MB measured for a start stopped by closing its input, that would be about 35 GB a day; the actual rate depends on bandwidth and on how long each probe runs. A probe that lets the clone finish installs `.tmp/plugins`, which stops the leak until the next upstream change.
3. **Every promotion copies all native state into a checkpoint that is never deleted.**
   - `checkpoint()` in [deploy-release](../infra/personal-vps/deploy-release) copies `home`, `codex-home` and `control` in full. That includes `codex-home/.tmp` with any abandoned clones, and the per-project package caches under `home/development`.
   - Nothing deletes old checkpoints. The repository's records name 13 checkpoints on the host by 21 September.
4. **Staged releases are never deleted.** The records name about a dozen releases. Each one carries its own Node binary (about 120 MB), Codex linux-x64 binaries (about 330 MB) and `node_modules`.
5. **Deploys have no disk-pressure guard.**
   - Neither `build` nor `promote` checks free space before it writes.
   - A checkpoint copy that fails partway leaves its partial directory. A staging copy that fails leaves `.staging-*`.
   - [Design 004](../design/systems/004-deployment-and-profiles.md#managed-installation-and-recovery) requires disk pressure to preserve the healthy installation, fail closed and clean only owned staging.

Smaller observations, bounded or slow:

- The supervisor sends a pg-boss wake-up job every 250 ms. The default `standard` queue policy of pg-boss 12.5.2 does not deduplicate `singletonKey`, so that is about 345,600 rows a day. Each row is kept for 7 days after completion, about 2.4 million rows in steady state, and every checkpoint's database dump includes them.
- PostgreSQL's container log uses Docker's `json-file` driver with no size limit; the compose file that `harbor-personal` renders sets no `logging` option.
- With plugins disabled, each probe start still adds about 28 KB to Codex's SQLite files in the Codex home. This was measured in a run of 30 consecutive starts, whose retained log covers starts 7 to 30, and whether Codex eventually bounds it was not established.
- The deploy build's pnpm cache (`CacheDirectory=harbor-deploy-cache`) persists across builds, and upload directories under `/var/lib/harbor-deploy/incoming` stay behind when a workflow run's cleanup step fails, which it tolerates. Neither is sized in the disk report or pruned. Both grow slowly.
- Streamed replies rewrite the whole message for every delta. [P028](../design/proposals/028-live-conversation-streaming.md) already replaces that with appends.
- The managed runner launcher in [launcher.ts](../infra/runner/launcher.ts) also starts Codex without disabling plugins. Its restricted egress probably blocks the download; this was not checked.
- The architecture's rule to refuse new work at disk thresholds has no personal-profile implementation. Turn admission does not check free space.

## Evidence

This is the local reproduction of 30 September 2026. It used Codex 0.153.4 in a cloud container with HTTPS egress and fresh private Codex homes with no credential. Each start sent `initialize`, `model/list` and `account/read`, as Harbor's probe does, and was stopped a few seconds later. Every start without `-c features.plugins=false` also left an empty `.tmp/plugins.sync.lock`. Sizes are allocated space as `du` reports it.

| Start | Left in `CODEX_HOME/.tmp` |
| --- | --- |
| Killed, twice | Partial clones of 0.1 MB and 9.2 MB |
| Standard input closed, twice | Two partial clones of 24 MB |
| Allowed to finish | The complete `.tmp/plugins`, 99,696 KiB, and `plugins.sha` |
| Stopped after a finished start | One 16 KB `git-*` directory |
| Killed at once, three times, with the proxy variables removed | Three 16 KB `git-*` directories. The container's egress gateway still reached github.com without those variables, so this is not a no-network result. |
| With `-c features.plugins=false`, or `[features] plugins = false` in `config.toml` | No `.tmp` directory; `model/list` still answered |
| Harbor's personal arguments with and without the flag, stopped after about 4 seconds, in a later check the same day | With the flag, no `.tmp`; without it, `.tmp/plugins`, `plugins.sha` and `plugins.sync.lock` |

The upstream `main` branch of the plugin repository changed on 8, 11 and 28 September 2026. The last read-only deploy preflight, on 25 September, reported about 19.5 GB free under `/opt`.

Impact: an instance can run out of disk within a day of an upstream catalog change if no conversation is running. After that, every deploy stores the waste again in its checkpoint and adds another release copy. A full disk stops PostgreSQL writes and every Harbor operation.

## Ownership

[P035](../design/proposals/035-bounded-disk-use.md) takes mechanisms 1 to 5 and the PostgreSQL container log limit; its acceptance IDs P035-01 to P035-10 map them.

The following remain in this inbox record:

- the pg-boss wake-up volume and retention;
- the per-start growth of Codex's SQLite files, which P035's slower discovery reduces but does not bound;
- the managed runner launcher;
- turn admission at disk thresholds;
- the deploy build's pnpm cache and leftover upload directories.

## Recheck

After P035, on a Linux host with systemd and delegated cgroups:

- Start and retire personal runtimes, including discovery probes. Confirm that the Codex home's `.tmp` gains no `plugins`, `plugins-clone-*` or `git-*` entries.
- Over one hour on a signed-in idle instance, confirm that discovery starts at most three Codex processes.
- Run the deploy workflow's `preflight`. Confirm that it reports disk use and what `prune` would remove, and that `prune` removes exactly that.
