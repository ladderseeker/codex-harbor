# Deploy builds can leave their inputs, build state and state links

- Severity: Low. An interrupted build leaves directories that can hold a few GiB, and nothing reports or removes them. The link that every build probably leaves is tiny.
- Owner: Awaiting owner selection in this inbox.
- Status: Open. Found on 30 September 2026 by P037's design reviewer, in review round 2. The round 3 design reviewer added the state links.
- Recorded: 30 September 2026.
- Related: [P037](../design/proposals/037-fresh-vps-install-guide.md), whose `bootstrap` shares the build path, the [disk growth issue](2026-09-30-015210-personal-vps-disk-growth.md) and the [pnpm store issue](2026-09-30-103815-deploy-build-pnpm-store.md).

## Problem

`build_and_stage` in [deploy-release](../infra/personal-vps/deploy-release), which `build` and `bootstrap` both use, gives each run a new timestamped ID. It writes the run's pinned inputs to `/var/lib/harbor-deploy/inputs/<run>`, and the transient build unit writes its sources, dependencies and package to `/var/lib/private/harbor-deploy-build/<run>`. Only the function's `finally` block removes them. That block does not run when the host reboots during a build or when the `deploy-release` process is killed, for example with SIGKILL. The next run uses a new ID, so it neither reuses nor removes the old directories.

Every run, finished or not, probably also leaves a link. With `DynamicUser=yes`, systemd creates the unit's state directory, `harbor-deploy-build/<run>`, under `/var/lib/private` and a link to it at `/var/lib/harbor-deploy-build/<run>`, as the `systemd.exec` manual describes for dynamic users. `build_and_stage` removes the directory but not the link, so the link dangles.

## Evidence

- `build_and_stage` creates both paths from `run_id` and removes them only in `finally`, as read on 30 September 2026 at commit `9ab88c6`.
- `prune` plans only the direct children of `/opt/harbor-personal/releases` and `/var/lib/harbor-personal-backups`.
- Neither the personal VPS guide nor the GitHub Actions deployment guide mentions these directories.
- The state link comes from the `systemd.exec` manual's description of `StateDirectory=` with `DynamicUser=yes`, and from `build_and_stage` as read at commit `a7cc8df`.
- No run on a real host has produced these leftovers yet. This record comes from reading the code and the manual.

## Impact

A `build` from the GitHub Actions workflow, or the fresh install guide's `bootstrap`, that is interrupted by a reboot or a kill leaves the inputs and the build state on the host. Later runs do not count them, so a later refusal for lack of space can have no visible cause. The fresh VPS install guide lists these directories for the owner in step 5's Check and in step 16. The GitHub Actions workflow does not list them. Neither lists the links, which use almost no space.

## Recheck

List `/var/lib/harbor-deploy/inputs`, `/var/lib/private/harbor-deploy-build` and `/var/lib/harbor-deploy-build` on a host after a finished build and after an interrupted one. A fix could make `build_and_stage` or `prune` remove a run's directories and link once no build unit for that run exists, and add a test.
