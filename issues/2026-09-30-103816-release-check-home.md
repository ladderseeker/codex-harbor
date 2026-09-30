# Release checks write under /nonexistent

- Severity: Low. The checks leave small root-owned directories under `/nonexistent` on every host that runs them. No secret is involved.
- Owner: Awaiting owner selection in this inbox.
- Status: Open. Observed on 30 September 2026 in a cloud container during P037's review.
- Recorded: 30 September 2026.
- Related: [P037](../design/proposals/037-fresh-vps-install-guide.md), whose guide names this exception to its rule about homes.

## Problem

`verify_release` in [deploy-release](../infra/personal-vps/deploy-release) runs the release's `bin/node`, `bin/codex` and `bin/pnpm` with `--version`, in an environment with `PATH=/usr/bin:/bin` and `HOME=/nonexistent`, as if nothing would be written. Codex 0.153.4 creates `$HOME/.codex/tmp/arg0/codex-arg0XXXXXX/`, with a lock file and helper links to the release's binary, and creates any missing parents. pnpm creates `$HOME/.local/share/pnpm`. `build`, `bootstrap`, `promote` and `preflight` all call `verify_release`, so running any of them as root creates a root-owned `/nonexistent` tree.

## Evidence

- In the cloud container used for P035, P036 and P037, `/nonexistent` was created at 03:37 UTC on 30 September 2026, before P037 started. It gained `.local/share/pnpm` and a new `.codex/tmp/arg0` entry during P037's scratch builds at 08:25 and 09:21 UTC.
- P037's design reviewer reproduced Codex's behavior with `HOME` set to a missing scratch path.
- On Ubuntu 24.04, `/nonexistent` is the home directory of the `nobody`, `_apt` and `messagebus` accounts, and it does not normally exist.
- After several runs in that container, only the newest `arg0` entry remained, so Codex appears to remove stale entries and the tree stays small.

## Impact

Every host that installs or deploys Harbor keeps a small root-owned `/nonexistent` tree. The fresh VPS install guide's rule about homes cannot prevent it, because `verify_release` sets `HOME` itself; the guide names the exception.

## Recheck

Run `deploy-release preflight` on an installed instance, or `verify_release` on a release, and then list `/nonexistent`. A fix gives `verify_release` a private temporary `HOME` and `CODEX_HOME` that it removes afterwards, as [package-release.py](../infra/personal-vps/package-release.py) already does for its version checks, and adds a test.
