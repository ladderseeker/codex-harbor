# Cloud agent sessions

This guide explains how agents work on Codex Harbor in a cloud session, such as a Claude Code cloud session. The rules are in [AGENTS.md](../../AGENTS.md#cloud-agent-sessions), and [D015](../../design/decisions/015-direct-delivery-and-cloud-sessions.md) records the commit and delivery decision. The [delivery workflow](../../design/workflow.md) still owns the lifecycle. This guide adds the checked facts and the commands.

## Environment

Each cloud session runs in its own disposable Linux container with a fresh clone. When the container is reclaimed, everything that was not pushed is lost.

A Claude Code cloud session container checked on 30 September 2026 had:

- Ubuntu 24.04.4, running as root;
- cgroup v1, and PID 1 is not systemd;
- Node 22.22.2 on PATH, with Node 20, 21 and 22 under `/opt`, while the repository requires Node 24.11.1;
- `CLAUDE_CODE_REMOTE=true`;
- a global `pnpm` that runs the pinned 12.3.4 through the repository's `packageManager` field;
- no Codex executable when the session started;
- no `ssh` and no `gh` executable, with `GH_TOKEN` set to a proxy placeholder;
- `docker` and `dockerd` installed, with no daemon running at session start;
- Chromium revision 1194 under `/opt/pw-browsers`, which is the revision Playwright 1.56.1 expects;
- HTTPS egress through a proxy, with `nodejs.org` reachable;
- commits made with the configured `Claude <noreply@anthropic.com>` identity and signed over SSH.

The Claude Code [cloud environment documentation](https://code.claude.com/docs/en/cloud-environments), read on 30 September 2026, adds three facts:

- `git push` works only against the session's current working branch;
- a session with several repositories, including a project thread, starts above the clones and does not run repository hooks;
- Docker is available for running services.

Two observations from the project thread that added this guide qualify the first two facts:

- At 06:09 UTC on 30 September 2026, that thread's session delivered [P035](../../design/proposals/035-bounded-disk-use.md) with `git push origin HEAD:main`, which moved `main` from `9231078` to `8cfa82f`.
- The thread had one repository. Its session started in the repository's directory and loaded `AGENTS.md`. Whether the session-start hook runs in such a thread is unverified until a project thread starts from a `main` that contains the hook.

These facts can change. Recheck them in a new session:

```sh
check-tools         # installed tools and their versions
node --version      # v24.11.1 after the hook; v22.22.2 means its PATH line is missing
command -v ssh gh   # prints nothing when neither exists
docker info         # fails while no daemon runs
```

`check-tools` also prints proxy settings, so do not paste its output into tracked records.

## Prepare a session

In a Claude Code cloud session that starts in this repository, `.claude/settings.json` runs `scripts/cloud-session-setup.sh` when the session starts, resumes or forks. A session with several repositories starts above the clones and does not run it, and `/clear` and compaction do not rerun it. Outside cloud sessions, where `CLAUDE_CODE_REMOTE` is not `true`, the script exits at once and changes nothing. In a cloud session it:

1. installs Node 24.11.1 in `~/.cache/codex-harbor/node-v24.11.1-linux-x64`, unless a Node there already reports v24.11.1. It downloads the tarball from `https://nodejs.org/dist`, checks it against the SHA-256 value pinned in the script, and extracts it in a temporary directory before moving it into place;
2. puts that Node first on PATH for the rest of the session, by adding one `export PATH=...` line to the file that `CLAUDE_ENV_FILE` names;
3. runs `pnpm install --frozen-lockfile` in the repository, with its output in `~/.cache/codex-harbor/pnpm-install.log`;
4. prints one status line and exits 0, even when a step fails, so the session always starts.

Each download attempt may take at most 90 seconds, with at most two retries within 180 seconds, and `pnpm install` runs under `timeout -k 10 240`, which kills the install 10 seconds after the stop signal if it is still running. A stall therefore ends with a failure line within the hook's 600-second limit.

On success it prints `Harbor cloud setup: Node v24.11.1 and locked dependencies ready.` On failure it prints `Harbor cloud setup failed:`, the reason, and a pointer to this section.

If no status line appears, or `node --version` prints anything other than `v24.11.1`, check the cached Node with `"$HOME/.cache/codex-harbor/node-v24.11.1-linux-x64/bin/node" --version`. If that prints `v24.11.1`, Node is installed: use the export line below, and run `pnpm install --frozen-lockfile` from the repository root before running checks, because the install may not have finished. Otherwise the hook did not run or did not finish; follow the manual steps below.

If the reason names `pnpm install`, Node is already installed and on PATH. Read `~/.cache/codex-harbor/pnpm-install.log` when the line names it, fix the cause, and run `pnpm install --frozen-lockfile` again from the repository root.

For any other reason, or when the hook did not run, fix the cause and install Node by hand, with the same pinned hash. Like the hook, this block downloads and extracts in a temporary directory under `~/.cache/codex-harbor`, then moves the result into place. Like the [optional setup script](#optional-environment-setup-script), it changes nothing while the cached Node reports `v24.11.1`, so it never removes a working Node or the Codex that the setup script installs inside it. Run it as one command:

```sh
root="$HOME/.cache/codex-harbor"
node_dir="$root/node-v24.11.1-linux-x64"
tarball=node-v24.11.1-linux-x64.tar.xz
if [ "$("$node_dir/bin/node" --version 2>/dev/null)" != v24.11.1 ]; then
  tmp="$(mkdir -p "$root" && mktemp -d "$root/.manual.XXXXXX")" &&
    curl -fsSL --connect-timeout 20 --max-time 90 --retry 2 --retry-max-time 180 \
      -o "$tmp/$tarball" "https://nodejs.org/dist/v24.11.1/$tarball" &&
    echo "60e3b0a8500819514aca603487c254298cd776de0698d3cd08f11dba5b8289a8  $tmp/$tarball" | sha256sum -c - &&
    tar -xJf "$tmp/$tarball" -C "$tmp" &&
    rm -rf "$node_dir" &&
    mv "$tmp/node-v24.11.1-linux-x64" "$node_dir"
  [ -z "$tmp" ] || rm -rf "$tmp"
fi
```

If `sha256sum` reports a mismatch, stop. Never change the pinned hash, the version or the download source to make setup pass.

Shell variables do not carry over between the agent's commands. Until the hook's PATH line is in place, start each command that needs Node 24 with the export line:

```sh
export PATH="$HOME/.cache/codex-harbor/node-v24.11.1-linux-x64/bin:$PATH"
node --version                   # v24.11.1
pnpm install --frozen-lockfile   # from the repository root
```

The hook does not install Codex, because the install is about 320 MB. Install Codex 0.153.4 only when a real-runtime contract needs it. Contract tests start `codex` from PATH with homes they own, and the tests that need the complete pinned native distribution read `HARBOR_LOCAL_CONTRACT_BINARY`, which names its Linux x64 binary:

```sh
npm install -g @openai/codex@0.153.4
export HARBOR_LOCAL_CONTRACT_BINARY="$(npm root -g)/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex"
pnpm test:contract
```

Run the last two lines in one command, because the variable does not carry over.

Run Codex only with a run-owned `HOME` and `CODEX_HOME`, even for a version check. A Codex start may write into its home, and the default home may hold a login:

```sh
codex_home="$(mktemp -d)"
HOME="$codex_home" CODEX_HOME="$codex_home" codex --version   # codex-cli 0.153.4
rm -rf "$codex_home"
```

With a home under `/tmp`, Codex also prints a warning that it will not create its helper binaries there; the version check still works.

Playwright uses the preinstalled Chromium, so never run `playwright install` in a cloud session. That includes the `pnpm exec playwright install chromium` step of the [local setup](development.md#run-the-deterministic-application-locally).

## What runs here

The table lists every script in `package.json`. Yes means that the command ran in a cloud session on 30 September 2026, not that it passed. Partly means that some of its tests need something the session lacks. Not checked means that it needs a running Docker daemon; none runs at session start, and none was started in the session that wrote this guide. No means that it needs credentials or a host that a cloud session lacks.

| Command | Runs here | Notes |
| --- | --- | --- |
| `pnpm build` | Yes | |
| `pnpm check` | Yes | Includes `node scripts/check-docs.mjs`. |
| `pnpm test` | Yes | |
| `pnpm test:deployment:contract` | Yes | At `9231078`, one managed-tooling test failed: `review_test.Review.test_actual_process_capture_limit_timeout_and_failure`. The [capture-limit issue](../../issues/2026-09-30-032022-deploy-run-capture-limit.md) records it. The script joins its Python and Node halves with `&&`, so that failure skips the Node half. Run the Node half separately: `node --import tsx --test tests/deployment/storage-transport.test.ts tests/deployment/probe.test.ts`. |
| `pnpm test:contract` | Partly | Needs Codex 0.153.4, as shown above. At `9231078`, with the pinned binary, 23 of 28 tests passed. Four of the five failures launch personal runtimes and need delegated cgroups. The fifth, the P024 attachment contract, needs a nonroot Linux user. Its history test rewrote `/opt/rbenv/shims` in the session that wrote this guide, apparently through the host's login profile; the [login-shell issue](../../issues/2026-09-30-033836-contract-test-login-shell.md) records it. |
| `pnpm test:egress` | Yes | Policy, transport and resolver unit tests. The Linux gateway test, `node tests/egress/linux.mjs`, is not checked here: it needs a running Docker daemon, and none runs at session start. It also needs its built images. |
| `pnpm test:e2e` | Not checked | Not checked here: needs a running Docker daemon, and none runs at session start. The real-stack harness starts Caddy and PostgreSQL with Docker Compose. |
| `pnpm dev` | Not checked | Not checked here: needs a running Docker daemon, and none runs at session start. `--fixture` runs the same harness as `pnpm test:e2e`, and `--local` starts PostgreSQL and Caddy with Docker Compose. Configured mode needs `DATABASE_URL`, `HARBOR_ORIGIN` and owner, OIDC and project configuration. |
| `pnpm test:workspaces` | Not checked | Not checked here: needs a running Docker daemon, and none runs at session start. Its tests run `docker`. |
| `pnpm test:schedules` | Not checked | Not checked here: needs a running Docker daemon, and none runs at session start. Its tests start PostgreSQL containers with `docker`. |
| `pnpm test:isolation` | Not checked | Not checked here: needs a running Docker daemon, and none runs at session start. It also needs built images and the dedicated XFS storage of the [Linux verification workflow](linux-verification.md). |
| `pnpm test:live` | No | Needs dedicated test credentials and the supported Linux execution profile. Without the credentials it reports its gate as unverified. |

Document checks, `node scripts/check-docs.mjs` and `git diff --check`, also run here. So does Playwright with the preinstalled Chromium, for example to render the [interface prototype](../../design/prototypes/harbor-redesign.html).

## Gates that need another host

These gates did not run in the cloud session that wrote this guide. Each needs the host or check below:

| Gate | Needs |
| --- | --- |
| Real-stack E2E: `pnpm test:e2e` and its lanes | A running Docker daemon with Compose; see [End-to-end verification](development.md#end-to-end-verification). |
| Personal VPS Linux lanes: `node --import tsx tests/personal-vps/e2e.ts` and `node --import tsx tests/personal-vps/e2e.ts --concurrency` | Root on a Linux host with systemd and delegated cgroup v2; see the [personal VPS guide](personal-vps.md#verification). |
| `pnpm test:isolation` | Docker, built images and the dedicated XFS storage of the [Linux verification workflow](linux-verification.md). |
| `node tests/egress/linux.mjs` | Docker and its built images. |
| `pnpm test:live` | Dedicated `HARBOR_TEST_OPENAI_API_KEY` credentials and the supported Linux execution profile. |
| Anything over SSH | An SSH client and key, which a cloud session lacks. The owner does this work. |

Never weaken container, network or sandbox isolation to make one of these run. On 30 September 2026, an attempt to start `dockerd` with `--iptables=false --bridge=none` was blocked as weakening security, and the session that wrote this guide started no daemon afterwards. It did not try a default Docker daemon.

Record each gate that did not run as unverified, with a linked issue, as the [workflow's gate](../../design/workflow.md#implementation-and-verification-gate) requires. The result may still reach `main` with a dated delivery entry, and the proposal stays Accepted until the gate passes. [P026](../../design/proposals/026-continuous-integration.md) plans hosted CI that runs build, check, test and the fixture design lane `pnpm test:e2e --design`. The other lanes run on a supported Linux host that the owner runs.

## Commits and delivery

[D015](../../design/decisions/015-direct-delivery-and-cloud-sessions.md) in practice; the [workflow's commit rules](../../design/workflow.md#proposal-completion-and-archive) have the details:

- Commit with the configured identity, which signs commits. Never use the owner's or another contributor's name or email.
- End commit messages, and any pull request description, with the attribution lines that the session asks for.
- Mark a checkpoint that has not passed its gate `WIP` in its subject.
- Push each checkpoint to the session's branch, such as `claude/...`.
- Implementers never commit. When a checkpoint includes a running implementer's files, tell the implementer which commit to diff against.
- An outcome is finished when every gate that can run passed, apart from baseline failures already recorded in issues; every gate that cannot run is recorded as unverified with a linked issue; both reviews are clear; and the plan records the result, as its closing record or as a dated delivery entry.
- Work with review blockers left after three rounds stays off `main` until the owner decides.
- Deliver an outcome only when every commit between `origin/main` and it belongs to a finished outcome or is a plan or issue record. Otherwise wait for the earlier outcome, or cut a branch from `origin/main` that holds only finished outcomes and records, and rerun the affected gate there.
- Deliver with `git push origin HEAD:main`. The [Claude Code documentation](https://code.claude.com/docs/en/cloud-environments), read on 30 September 2026, says a cloud session can push only to its own branch, but this project's session delivered P035 that way that day, as [Environment](#environment) records. If Git refuses the push, open a pull request from the session's branch and merge it at once with the GitHub tools, using a merge commit. The delivered commits and their signatures stay unchanged, and GitHub creates the merge commit under the account that the session's GitHub connection uses; it is the only commit that the configured identity does not make. That pull request is a delivery step, not a review request.
- If `main` moved, merge `origin/main` into the branch, rerun the affected checks and deliver again. Never force-push `main`.
- Until a plan that delivers CI/CD is Implemented and changes these rules, deploy workflow runs other than `preflight` need the owner's go-ahead, and adding an automatic deploy trigger is the owner's decision.

```sh
git status --short
git add -- <paths in the fence>
git commit                            # subject starts with WIP until the gate passes
git push -u origin HEAD               # a checkpoint, to the session's branch
git fetch origin main
git log --oneline origin/main..HEAD   # each must belong to a finished outcome or be a record
git push origin HEAD:main             # delivery; if Git refuses, use a pull request as above
```

Use the built-in GitHub tools for pull requests, because the `gh` CLI may be missing.

## Keep evidence

Ignored and scratch storage, such as `.test-runs/` and OS temporary directories, disappears with the container. Therefore:

- Commit checkpoints of unfinished work to the working branch, and push them.
- Keep the evidence that must survive in tracked records: source identity, commands, exit codes and results. The proposal's closing record or dated delivery entry, or a report under `docs/reports/`, can hold it.
- Never put secrets or credentials in those records.
- Once the container is gone, record raw logs and artifacts that were kept nowhere else as unavailable.

## Codex account

- A login made with `codex login --device-auth` exists only in that container and is lost with it.
- No standing authorization covers it. Use it only with the owner's explicit permission for that use, as [AGENTS.md](../../AGENTS.md#cloud-agent-sessions) requires; then copy only the credential into a run-owned `CODEX_HOME` and delete the copy afterwards.
- Never commit, print or share it.

## VPS work

- From a cloud session, VPS work goes through the manual **Deploy personal VPS** workflow in GitHub Actions. The [GitHub Actions deployment guide](github-actions-deploy.md) describes its actions and limits.
- `preflight` is read-only, and agents may run it under the existing authorization for read-only checks. Until a plan that delivers CI/CD is Implemented and changes these rules, every other action, such as `build` or `deploy`, needs the owner's go-ahead for that run.
- The owner does all SSH and host work, including recovery. The [personal VPS guide](personal-vps.md) describes the installation.

## Optional environment setup script

The owner may paste this script into the **Setup script** field of the cloud environment's settings. It installs Node 24.11.1 and Codex 0.153.4, so that sessions do not download them:

```bash
#!/bin/bash
# Codex Harbor: cache Node 24.11.1 and Codex 0.153.4 for cloud sessions.
root="$HOME/.cache/codex-harbor"
node_dir="$root/node-v24.11.1-linux-x64"
tarball=node-v24.11.1-linux-x64.tar.xz
if [ "$("$node_dir/bin/node" --version 2>/dev/null)" != v24.11.1 ]; then
  tmp=$(mkdir -p "$root" && mktemp -d "$root/.setup.XXXXXX") &&
    curl -fsSL --connect-timeout 20 --max-time 90 --retry 2 --retry-max-time 180 \
      -o "$tmp/$tarball" "https://nodejs.org/dist/v24.11.1/$tarball" &&
    echo "60e3b0a8500819514aca603487c254298cd776de0698d3cd08f11dba5b8289a8  $tmp/$tarball" |
    sha256sum -c --quiet - &&
    tar -xJf "$tmp/$tarball" -C "$tmp" &&
    rm -rf "$node_dir" &&
    mv "$tmp/node-v24.11.1-linux-x64" "$node_dir" ||
    echo "Harbor setup: Node 24.11.1 was not installed."
  [ -z "$tmp" ] || rm -rf "$tmp"
fi
if [ -x "$node_dir/bin/npm" ]; then
  PATH="$node_dir/bin:$PATH" npm install -g @openai/codex@0.153.4 ||
    echo "Harbor setup: Codex 0.153.4 was not installed."
else
  echo "Harbor setup: Codex 0.153.4 was not installed, because Node 24.11.1 is missing."
fi
exit 0
```

The script installs Node in the same directory as the hook, after checking the same pinned hash and with the same download time limits. It installs Codex with that Node's `npm`, so `codex` and `$(npm root -g)` resolve there once the hook's PATH line applies. A failure prints a line but never fails session start, because the script always exits 0.

The environment runs the setup script before Claude Code launches. When the script finishes within about five minutes, the environment keeps a filesystem snapshot and starts later sessions from it ([environment caching](https://code.claude.com/docs/en/cloud-environments#environment-caching)). Those sessions start with Node and Codex on disk, so the hook finds Node already present, skips the download and only installs the dependencies. The script runs again when it changes, when the allowed network hosts change, and when the cache expires after about seven days.

The setup script also prepares sessions with several repositories, which do not run the repository hook. There, Node and Codex are on disk, but nothing puts them on PATH or installs the dependencies: start each command that needs them with the export line from [Prepare a session](#prepare-a-session), and run `pnpm install --frozen-lockfile` in this repository's clone.
