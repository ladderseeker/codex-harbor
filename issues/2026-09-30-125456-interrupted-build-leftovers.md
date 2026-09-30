# Interrupted builds leave their inputs and build state

- Severity: Low. An interrupted build leaves directories that can hold a few GiB, and nothing reports or removes them.
- Owner: Awaiting owner selection in this inbox.
- Status: Open. Found on 30 September 2026 by P037's design reviewer, in review round 2.
- Recorded: 30 September 2026.
- Related: [P037](../design/proposals/037-fresh-vps-install-guide.md), whose `bootstrap` shares the build path, the [disk growth issue](2026-09-30-015210-personal-vps-disk-growth.md) and the [pnpm store issue](2026-09-30-103815-deploy-build-pnpm-store.md).

## Problem

`build_and_stage` in [deploy-release](../infra/personal-vps/deploy-release), which `build` and `bootstrap` both use, gives each run a new timestamped ID. It writes the run's pinned inputs to `/var/lib/harbor-deploy/inputs/<run>`, and the transient build unit writes its sources, dependencies and package to `/var/lib/private/harbor-deploy-build/<run>`. Only the function's `finally` block removes them. That block does not run when the host reboots during a build or when the `deploy-release` process is killed, for example with SIGKILL. The next run uses a new ID, so it neither reuses nor removes the old directories.

## Evidence

- `build_and_stage` creates both paths from `run_id` and removes them only in `finally`, as read on 30 September 2026 at commit `9ab88c6`.
- `prune` plans only the direct children of `/opt/harbor-personal/releases` and `/var/lib/harbor-personal-backups`.
- Neither the personal VPS guide nor the GitHub Actions deployment guide mentions these directories.
- No run on a real host has produced the leftovers yet. This record comes from reading the code.

## Impact

A `build` from the GitHub Actions workflow, or the fresh install guide's `bootstrap`, that is interrupted by a reboot or a kill leaves the inputs and the build state on the host. Later runs do not count them, so a later refusal for lack of space can have no visible cause. The fresh VPS install guide lists these directories for the owner in step 5's Check and in step 16. The GitHub Actions workflow does not list them.

## Recheck

List `/var/lib/harbor-deploy/inputs` and `/var/lib/private/harbor-deploy-build` on a host after an interrupted build. A fix could make `build_and_stage` or `prune` remove a run's directories once no build unit for that run exists, and add a test.
