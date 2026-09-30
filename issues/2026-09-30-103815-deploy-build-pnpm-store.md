# The deploy build's pnpm store setting has no effect

- Severity: Low. Every build downloads all its packages again, which costs time and network traffic but no lasting disk space, because each build's state directory is removed when the build ends.
- Owner: Awaiting owner selection in this inbox.
- Status: Open. Observed on 30 September 2026 in a cloud container during P037.
- Recorded: 30 September 2026.
- Related: [P037](../design/proposals/037-fresh-vps-install-guide.md), whose `bootstrap` shares the build path, and the [disk growth issue](2026-09-30-015210-personal-vps-disk-growth.md).

## Problem

`build_and_stage` in [deploy-release](../infra/personal-vps/deploy-release), which `build` and `bootstrap` both use, runs the build in a transient unit with `CacheDirectory=harbor-deploy-cache`. It sets `npm_config_store_dir=/var/cache/harbor-deploy-cache/pnpm-store`, so that builds share one package store. The pinned pnpm 12.3.4 ignores that variable. It keeps its store under `HOME`, which is the unit's state directory, and the build removes that directory when it ends. A reboot or a killed process leaves it, as the [interrupted build issue](2026-09-30-125456-interrupted-build-leftovers.md) records.

## Evidence

Observed on 30 September 2026 in a cloud container, with the pinned pnpm 12.3.4 from a release that P037 built, a scratch `HOME` and a scratch working directory:

| Environment | `pnpm store path` prints |
| --- | --- |
| Neither variable set | `$HOME/.local/share/pnpm/store/v11` |
| `npm_config_store_dir=DIR` | `$HOME/.local/share/pnpm/store/v11` |
| `pnpm_config_store_dir=DIR` | `DIR/v11` |

P037's scratch builds, run with `build`'s environment, printed a store path under the state directory.

## Impact

Each `build` or `bootstrap` downloads every package from the registry again. That lengthens deploys and makes each one depend on the registry. The cache directory stays empty. Making the setting work would keep a store in `/var/cache/private/harbor-deploy-cache` that grows over time, so the fix also needs a bound or pruning.

## Recheck

Run `pnpm store path` with the pinned pnpm and the build unit's environment, or read the store path that `pnpm install` prints in a build log. A fix sets the store through a setting that pnpm 12 reads, such as `pnpm_config_store_dir`, bounds the shared store and adds a test.
