# P036 — Rules for cloud agent sessions

## Metadata

- ID: P036
- Status: Accepted
- Priority: Not set by the owner. The owner asked for this on 30 September 2026, while P035 was executing.
- Created: 2026-09-30
- Owner: Main conversation. A fresh-context implementer does the implementation in a separate checkout.
- Outcome: The repository's rules match how agents work in cloud sessions. They say:
  - how an agent working branch is committed, pushed and reviewed;
  - what a cloud session can and cannot verify, and where the missing gates run;
  - how a session prepares its toolchain, now automated by a repository hook;
  - how work and evidence survive a disposable container.

  Claude Code loads the shared rules through a new `CLAUDE.md` that imports `AGENTS.md`.
- Authorization: On 30 September 2026 the owner did two things:
  - They chose "Allow branch commits" on this thread's decision card: "I commit and push checkpoints to the Claude branch without asking; merging to main still waits for you."
  - They then wrote: "You should update the rules AGENTS.md and CLAUE.md base on the work you can do in this cloud enviroment. You can update all to make it follow our best work practice."

  Together these authorize this plan, its execution alongside P035 on disjoint files, and branch commits. Merging into `main`, and every VPS workflow run other than `preflight`, still need the owner.
- Baseline: branch `claude/project-thread-ob9jjx` at `d35a225`. That commit is `main` at `9231078` plus P035's plan and a WIP checkpoint of P035. Neither touches this plan's files.
- Dependencies: None blocking.
  - The hook's real download and install are verified in this thread's cloud container.
  - Other environments may differ, so the guide dates its facts and says how to recheck them.
- Source issues: None. The owner requested this directly.
- Design references:
  - the workflow's [proposal completion](../workflow.md#proposal-completion-and-archive), [evidence](../workflow.md#evidence-and-provenance) and [gate](../workflow.md#implementation-and-verification-gate) sections;
  - [D013](../decisions/013-evidence-based-delivery-workflow.md) and [AGENTS.md](../../AGENTS.md);
  - the [developer guide's command availability](../../docs/developer/development.md#command-availability);
  - [P026](026-continuous-integration.md), which plans the hosted gates.
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P036-01 to P036-06.

## Problem, outcome and exclusions

The rules assume a developer machine: the owner confirms every commit, ignored directories keep evidence, and SSH, Docker and systemd are at hand. Agents now also work for the owner in cloud sessions, and those differ in four ways:

- **Disposable containers.**
  - Each session gets its own container, and uncommitted work and ignored evidence vanish when that container is reclaimed.
  - The environment's stop check asks, at the end of every turn, for work to be committed and pushed.
- **A different toolchain.** Node 22 is on PATH, the repository requires Node 24.11.1, and Codex is not installed.
- **Unavailable gates.** Several mandatory gates cannot run: the Docker daemon is not running, there is no systemd or delegated cgroup v2, and there is no SSH client.
- **Branch reviews.** The owner reviews agent work as pull requests from the agent's branch, as with pull request #4, and has now allowed branch commits.

After this change:

1. **Commits.**
   - On an assigned agent working branch, main commits coherent checkpoints with the configured identity and pushes them without asking. A checkpoint that has not passed its gate says `WIP`.
   - Implementers never commit.
   - Main never commits to or pushes `main`, and never merges.
   - The owner reviews the gated and reviewed result in a pull request and merges it.
   - Without an assigned working branch, the old rule stands: the owner confirms the commit.
   - D015 (`design/decisions/015-agent-working-branches.md`) records the change.
2. **Cloud sessions in AGENTS.md.** A short section covers:
   - the environment and its setup;
   - what can and cannot be verified there;
   - the owner's division of work;
   - how a Codex login is handled.

   It links to a new developer guide.
3. **CLAUDE.md.**
   - It imports `AGENTS.md` first. Claude Code reads `CLAUDE.md` instead of `AGENTS.md` whenever a `CLAUDE.md` exists, so the import is required. A `CLAUDE.md` that imports `AGENTS.md` never loads it twice ([Claude Code memory documentation](https://code.claude.com/docs/en/memory#agents-md)).
   - It then adds only Claude Code specifics: the hook, Git identity and attribution, the stop check, GitHub tools, subagent roles and parallel checkouts.
4. **Session setup hook.** `.claude/settings.json` runs `scripts/cloud-session-setup.sh` when a session starts or resumes. Outside cloud sessions the script does nothing. In a cloud session it does the following:
   - installs Node 24.11.1 after checking the tarball against a SHA-256 value pinned in the script;
   - puts that Node first on PATH for the session through `CLAUDE_ENV_FILE`;
   - runs `pnpm install --frozen-lockfile`;
   - prints one status line;
   - never fails the session.

   This follows the documented pattern for [cloud-session dependencies](https://code.claude.com/docs/en/cloud-environments#install-dependencies-with-a-sessionstart-hook) and [session environment variables](https://code.claude.com/docs/en/hooks).
5. **Cloud session guide.** `docs/developer/cloud-sessions.md` covers:
   - the environment facts checked on 30 September 2026;
   - how to prepare a session;
   - a table of gates;
   - commits and pull requests;
   - how to keep evidence;
   - the Codex account;
   - VPS work;
   - an optional environment setup script that the owner can add to cache Node and Codex.
6. **Aligned documents.** These documents agree with items 1 to 5:
   - the workflow;
   - D013's metadata;
   - the design index;
   - the developer guide;
   - the implementer role;
   - the proposal template;
   - the documentation index.

Excluded:

- hosted continuous integration, which is [P026](026-continuous-integration.md), and any change to the deploy workflow;
- the fresh-install deployment guide, which gets its own plan after P035;
- installing Codex from the hook, which stays a manual step because the install is about 320 MB;
- the environment's own settings, which only the owner can change;
- any application, runtime or deployment behavior.

## Dependencies and current design

The [workflow](../workflow.md#proposal-completion-and-archive) and [D013](../decisions/013-evidence-based-delivery-workflow.md) say that the owner confirms each commit. The owner's 30 September choice changes that for agent working branches. A focused decision records the change, D015 (`design/decisions/015-agent-working-branches.md`), with a reciprocal metadata link from D013. D013's other rules and its history stay unchanged.

The gate rules stay the same: a missing credential, runtime or infrastructure makes a gate unverified, never passed. The new text only says which gates a cloud session cannot run and where they run instead.

This thread's cloud container was inspected on 30 September 2026. The guide's facts come from that inspection:

- Ubuntu 24.04.4, running as root;
- cgroup v1, and PID 1 is not systemd;
- Node 22.22.2 on PATH, with Node 20, 21 and 22 under `/opt`;
- `CLAUDE_CODE_REMOTE=true`;
- a global `pnpm` that runs the pinned 12.3.4 through the repository's `packageManager` field;
- no `ssh` and no `gh` executable, with `GH_TOKEN` set to a proxy placeholder;
- `docker` and `dockerd` installed, with no daemon running;
- Chromium revision 1194 under `/opt/pw-browsers`, which is the revision Playwright 1.56.1 expects;
- HTTPS egress through a proxy, with `nodejs.org` reachable;
- commits made with the configured `Claude <noreply@anthropic.com>` identity signed over SSH.

The pinned SHA-256 of `node-v24.11.1-linux-x64.tar.xz` is `60e3b0a8500819514aca603487c254298cd776de0698d3cd08f11dba5b8289a8`. It matches the official `SHASUMS256.txt` for v24.11.1 and the tarball downloaded in this container.

On 30 September 2026, auto mode blocked an attempt to start `dockerd` with `--iptables=false --bridge=none`, classifying it as weakening security. The rules therefore forbid weakening isolation to make a check run. They do not claim that a default daemon can never run in a cloud session.

## Source issues

None.

## User and API flows

No browser page or public API changes.

- **Agents in cloud sessions** find the hook already run, a status line in context, and rules that say:
  - what to commit and when;
  - what they can verify;
  - how to record the gates they cannot run.
- **The owner** reviews each outcome as a pull request. The owner may add the optional setup script to the cloud environment to cache Node and Codex.

## Contracts, state and security

- **Hook scope.** The script exits at once, without output or writes, unless `CLAUDE_CODE_REMOTE` is `true`. It never changes files in the repository except through `pnpm install`, which writes only the ignored `node_modules`.
- **Node download.**
  - The tarball comes from `https://nodejs.org/dist`. A test may override that base URL through `HARBOR_NODE_DIST`, but the SHA-256 value stays pinned in the script, so any source must deliver the exact official tarball.
  - A download, checksum or extraction failure leaves any existing install untouched and removes its own temporary directory.
- **Session environment.** The script appends one `export PATH=...` line to `CLAUDE_ENV_FILE`, and only if that exact line is not already present. It never prints environment values, tokens or file contents.
- **Failure behavior.** Every path exits 0 and prints at most one line. A failure line names the reason and the guide section.
- **Commit identity.** Commits use the session's configured identity. The rules forbid using the owner's or another contributor's name or email.
- **Unchanged.** Authentication, permissions, sandbox and isolation rules do not change. The new text forbids weakening them to make a check run.

## Settled text

The implementer applies these texts verbatim. It may adjust only a link path, and only if a check requires it.

### AGENTS.md

Replace the Delivery and delegation bullet that begins "Implementers never commit." with:

```markdown
- Implementers never commit. On an assigned agent working branch, such as a cloud session's `claude/...` branch, main commits coherent checkpoints with the session's configured identity and pushes them without asking, marking unverified checkpoints `WIP`. Main never commits to or pushes `main` and never merges. The owner reviews the gated and reviewed result in a pull request and merges it ([D015](design/decisions/015-agent-working-branches.md)). Without an assigned working branch, main presents the reviewed result and the owner confirms the commit. Do not deploy without applicable authorization.
```

Replace the Implementation and safety bullet that begins "Keep enduring work and evidence" with:

```markdown
- Keep enduring work and evidence in persistent ignored storage; use OS temporary storage only for recreatable scratch. A cloud container is not persistent storage: there, push checkpoints and keep evidence that must survive in tracked records. Before interruption, record owners, coherent checkpoints within existing authorization, and recovery plans for unfinished edits and run resources.
```

Insert this section between Implementation and safety and VPS SSH handoff:

```markdown
## Cloud agent sessions

- A cloud agent session, such as a Claude Code cloud session, runs in its own disposable Linux container with a fresh clone, HTTPS-only egress through a proxy and no SSH client. Anything not pushed, including `.test-runs/` evidence and any Codex login made there, is lost when the container is reclaimed. The [cloud session guide](docs/developer/cloud-sessions.md) records the checked environment, setup and commands; recheck it when the environment changes.
- In Claude Code cloud sessions, the repository's session-start hook installs the pinned Node 24.11.1 and the locked dependencies. Install Codex 0.153.4 only when a real-runtime contract needs it. Never loosen a pinned version, checksum or lockfile to make setup pass.
- Cloud sessions can run `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:deployment:contract`, pinned-runtime contracts that do not launch a personal runtime, document checks and Playwright with the preinstalled Chromium. They cannot run real-stack `pnpm test:e2e` without a running Docker daemon, personal runtime launches or the personal VPS Linux lanes without systemd and delegated cgroup v2, the managed Linux isolation lanes, or anything over SSH. Never weaken container, network or sandbox isolation to make a check run. Record such gates as unverified with a linked issue; hosted CI or a supported Linux host supplies them.
- Owner direction, 30 September 2026: agents plan, implement, test and review, and may run the read-only deploy `preflight` through GitHub Actions. The owner does all SSH and host work, merges pull requests and gives the go-ahead for every other deploy workflow run.
- Use a Codex login made inside a container for tests only as the owner has authorized: copy only the credential into run-owned state, delete the copy afterwards, and never commit, print or share it.
```

Replace the VPS SSH handoff bullet that begins "The cloud coding environment checked on 25 September 2026" with:

```markdown
- Cloud sessions checked on 25 and 30 September 2026 had HTTPS egress only and no SSH client, so they could not reach `harbor-vps`; network access is an environment setting the owner can change. From such an environment, VPS work goes through the manual [GitHub Actions deployment](docs/developer/github-actions-deploy.md) workflow. Its read-only `preflight` follows the existing authorization for read-only checks; every other action needs the owner's go-ahead for that run.
```

Change nothing else in `AGENTS.md`.

### CLAUDE.md

Create `CLAUDE.md` with exactly this content:

```markdown
@AGENTS.md

## Claude Code

These notes add Claude Code specifics to the shared rules above. Where they seem to conflict with `AGENTS.md` or the [delivery workflow](design/workflow.md), those win; report the conflict.

- **Session setup.** In cloud sessions, the SessionStart hook in `.claude/settings.json` runs `scripts/cloud-session-setup.sh` and prints one status line. If that line reports a failure, follow [Prepare a session](docs/developer/cloud-sessions.md#prepare-a-session) before running checks.
- **Git.** Work only on the branch the session assigns. Commit with the configured Git identity, which signs commits in cloud sessions, and never with the owner's or another contributor's name or email. End commit messages and pull request descriptions with the attribution lines the session asks for. The environment's stop check reports uncommitted or unpushed work at the end of each turn: commit and push a checkpoint, marked `WIP` when unverified.
- **GitHub.** Use the built-in GitHub tools; the `gh` CLI may be missing. After the gate and reviews, open or update the pull request for the owner's review, and never merge it.
- **Roles.** Run the implementer and each reviewer as a fresh-context subagent whose self-contained brief names its role document. Subagents never commit. When a checkpoint commit includes a running implementer's files, tell the implementer which commit to diff against.
- **Parallel work.** Give concurrent implementers disjoint file fences. Put a second implementer in its own worktree outside the repository directory, so that document checks do not scan another worker's unfinished files.
```

### design/workflow.md

In Proposal completion and archive, replace the paragraph that begins "Main presents the coherent uncommitted result" with:

```markdown
Implementers never commit. When main works on an assigned agent working branch, such as a cloud session's branch, it commits coherent checkpoints there with the session's configured identity and pushes them without further confirmation; a checkpoint that has not passed its gate says `WIP` in its subject. Main never commits to or pushes the default branch and never merges. Once the gate and review rounds finish, main presents the result, validation, review rounds and remaining issues in a pull request from the working branch, and the owner reviews it and decides the merge. A draft pull request may exist earlier. Without an assigned working branch, main presents the coherent uncommitted result and commits only after the owner confirms, using the configured or owner-provided identity. Deployment follows its own applicable authorization. Reconcile staged, unstaged and untracked contents and owned stashes with each commit; identify deferred work and its owner. [D015](decisions/015-agent-working-branches.md) records this rule.
```

In Evidence and provenance, after the sentence "Keep evidence that must survive interruption in persistent ignored storage and record ownership/recovery for unfinished changes and test resources.", insert:

```markdown
An ephemeral environment, such as a cloud session container, loses ignored and temporary storage when it is reclaimed. There, commit checkpoints of unfinished work to the working branch, and keep the evidence that must survive, such as identities, commands, exit codes and results, in tracked records. Raw artifacts kept nowhere else are recorded as unavailable once the container is gone.
```

In Implementation and verification gate, append this sentence to the paragraph that begins "Reuse evidence for unchanged boundaries":

```markdown
The [cloud session guide](../docs/developer/cloud-sessions.md#what-runs-here) lists which gates a cloud session can run.
```

### Other alignments

- `design/decisions/013-evidence-based-delivery-workflow.md`: after the "Current contract" metadata bullet, add the bullet below. Leave the body unchanged.

  ```markdown
  - Amended by: [D015](015-agent-working-branches.md) on 30 September 2026, for commits on agent working branches and evidence in ephemeral environments.
  ```

- `design/README.md`: after the D014 line, add:

  ```markdown
  - [D015 — Agent working branches and cloud sessions](decisions/015-agent-working-branches.md).
  ```

- `docs/developer/development.md`, four edits:
  - In Run the deterministic application locally, after the sentence that begins "The tested macOS toolchain uses", add:

    ```markdown
    Cloud sessions prepare Node and dependencies through the [session hook](cloud-sessions.md#prepare-a-session).
    ```

  - In Command availability, append to the first paragraph:

    ```markdown
    The [cloud session guide](cloud-sessions.md#what-runs-here) says which of them run in a cloud session.
    ```

  - In Delivering a feature, replace "the three-round cap and owner confirmation before a commit." with "the three-round cap and the commit and pull request rules."
  - In the next paragraph, after "OS temporary storage is for recreatable scratch.", add:

    ```markdown
    In a cloud session both disappear with the container; see [Keep evidence](cloud-sessions.md#keep-evidence).
    ```

- `docs/developer/agents/implementer.md`: replace "main presents the reviewed result for owner commit confirmation." with:

  ```markdown
  main commits and presents the reviewed result under the [workflow's commit rules](../../../design/workflow.md#proposal-completion-and-archive).
  ```

- `design/proposal-template.md`: replace "- Owner-facing uncommitted result for review and commit confirmation." with "- How the result reaches the owner: a pull request from the agent working branch, or the uncommitted result for commit confirmation."
- `docs/README.md`: under Start here, after the Developer workflow line, add:

  ```markdown
  - [Cloud agent sessions](developer/cloud-sessions.md): setup, what a cloud session can verify, commits and pull requests, and where the other gates run.
  ```

### D015

Write `design/decisions/015-agent-working-branches.md`, titled "D015 — Agent working branches and cloud sessions", in the form of D013 and D014.

It has these metadata bullets:

- **Decision:** Accepted on 30 September 2026, quoting the owner's card choice and request above.
- **Changes:** collaboration rules only.
- **Amends:** D013's rule that the owner confirms each commit. The amendment covers assigned agent working branches only.
- **Retains:** the rest of D013; the owner's authority over merges, deployment and credentials; every gate.
- **Execution record:** this plan.
- **Current contract:** the workflow section, `AGENTS.md` and the cloud session guide.

It has these sections:

- **Context.** Disposable containers, the stop check, per-commit confirmation stalling every turn, and pull request review already being the owner's practice.
- **Options and decision.** Three options:
  - Keep per-commit confirmation. This loses work when a container is reclaimed and blocks every turn.
  - Commit on working branches and have the owner review at the pull request. This option is selected.
  - Let agents merge after a green gate. This is rejected because the owner reviews everything before it reaches `main`.

  The section also states the gate routing: unavailable gates stay unverified, hosted CI or a supported host supplies them, and isolation is never weakened.
- **Consequences:**
  - Working branches may contain `WIP` commits, which the owner may squash at merge.
  - Reviewers get commit identities.
  - Evidence that must survive goes into tracked records.
  - A checkout without an assigned working branch keeps the old rule.

### Cloud session guide

`docs/developer/cloud-sessions.md` uses these headings in this order, so that the anchors above resolve:

- `# Cloud agent sessions`
- `## Environment`
- `## Prepare a session`
- `## What runs here`
- `## Gates that need another host`
- `## Commits and pull requests`
- `## Keep evidence`
- `## Codex account`
- `## VPS work`
- `## Optional environment setup script`

Required content for each section:

- **Environment.** The facts listed under [Dependencies and current design](#dependencies-and-current-design), dated 30 September 2026. Add how to recheck them: `check-tools`, `node --version`, `command -v ssh gh`, and `docker info` failing while no daemon runs.
- **Prepare a session.**
  - What the hook does, and that it installs Node under `~/.cache/codex-harbor`.
  - The manual fallback commands, with the same pinned hash.
  - How to install Codex 0.153.4 with `npm install -g @openai/codex@0.153.4`, and the path of its Linux x64 binary for `HARBOR_LOCAL_CONTRACT_BINARY`: `$(npm root -g)/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`.
  - Playwright uses the preinstalled Chromium, so never run `playwright install` in a cloud session.
- **What runs here.** A table of the implemented commands from `package.json`, saying for each whether it runs in a cloud session, with notes. Record the results observed at `9231078`:
  - `pnpm test:deployment:contract` failed one managed-tooling test, `review_test.Review.test_actual_process_capture_limit_timeout_and_failure`.
  - `pnpm test:contract` with the pinned binary passed 23 of 28. The five that failed launch personal or Linux-native runtimes and need delegated cgroups or the Linux attachment lane.
- **Gates that need another host.** Name, for each gate, the host or check it needs:
  - real-stack E2E;
  - the personal VPS Linux lanes, `node --import tsx tests/personal-vps/e2e.ts` and its `--concurrency` form;
  - the Linux isolation and egress lanes;
  - `pnpm test:live`;
  - anything over SSH.

  Then say how to record them: unverified, with a linked issue. They run in hosted CI once [P026](../../design/proposals/026-continuous-integration.md) delivers it, or on a supported Linux host run by the owner.
- **Commits and pull requests.** D015 in practice:
  - use the configured identity, which signs commits;
  - include the attribution lines;
  - mark unverified checkpoints `WIP`;
  - push after each checkpoint;
  - implementers never commit, and a running implementer is told its diff base;
  - use a pull request for review; the owner merges; nothing is pushed to `main`.
- **Keep evidence.** Ignored and scratch storage disappear with the container. Commit evidence records, and mark raw logs unavailable once they are gone.
- **Codex account.**
  - A login made with `codex login --device-auth` exists only in that container.
  - Use it for tests only as the owner authorized: copy only the credential into a run-owned `CODEX_HOME` and delete the copy afterwards.
  - Never commit, print or share it.
- **VPS work.**
  - Use the GitHub Actions workflow.
  - `preflight` is read-only; every other action needs the owner's go-ahead for that run.
  - The owner does all SSH and host work.
  - Link the [GitHub Actions deployment guide](../../docs/developer/github-actions-deploy.md) and the [personal VPS guide](../../docs/developer/personal-vps.md).
- **Optional environment setup script.** Give an owner-pasteable Bash script for the cloud environment's Setup script field. The script does four things:
  - installs Node 24.11.1 into the same `~/.cache/codex-harbor/node-v24.11.1-linux-x64` directory, after checking the pinned hash;
  - installs Codex 0.153.4 with `npm install -g`;
  - ends with `exit 0`;
  - reports failures without failing session start.

  Explain that the environment caches what the script installs, and that the hook then finds Node already present.

### Hook and test

- `.claude/settings.json` contains only this configuration:

  ```json
  {
    "hooks": {
      "SessionStart": [
        {
          "matcher": "startup|resume",
          "hooks": [
            {
              "type": "command",
              "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/cloud-session-setup.sh\"",
              "timeout": 600
            }
          ]
        }
      ]
    }
  }
  ```

- `scripts/cloud-session-setup.sh` is executable Bash that follows [Contracts](#contracts-state-and-security).
  - **Constants:** version `24.11.1`, the pinned SHA-256, the install root `$HOME/.cache/codex-harbor`, and the directory name `node-v24.11.1-linux-x64`.
  - **Platform:** it requires Linux x86_64.
  - **Node install:** it downloads, verifies and extracts into a temporary directory under the install root, then renames the result into place.
  - **Project directory:** it runs `pnpm install --frozen-lockfile` in `$CLAUDE_PROJECT_DIR`, falling back to the script's parent directory, and logs to `$HOME/.cache/codex-harbor/pnpm-install.log`.
  - **pnpm lookup:** it uses `pnpm` when that is on PATH. Otherwise it runs `corepack pnpm` with `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.
  - **Output:** it prints exactly `Harbor cloud setup: Node v24.11.1 and locked dependencies ready.` on success. On failure it prints a line that begins `Harbor cloud setup failed:` and ends with `See docs/developer/cloud-sessions.md#prepare-a-session.`
- `tests/deployment/cloud_session_setup_test.py` runs the script with a temporary `HOME`, `CLAUDE_ENV_FILE`, `CLAUDE_PROJECT_DIR` and PATH. It covers four cases:
  1. **Not a cloud session.** It exits 0 with no output, writes nothing and never calls pnpm.
  2. **Checksum mismatch.** A `file://` distribution with a fake tarball produces one failure line and exit 0. It leaves no install directory and no temporary directory, and it neither writes to the environment file nor calls pnpm.
  3. **Fast path.** A preinstalled fake `node` that reports v24.11.1 and an unreachable distribution URL, run twice, never download. The environment file ends with exactly one PATH line. A fake `pnpm` receives `install --frozen-lockfile` in the project directory, and the output is exactly the ready line.
  4. **pnpm failure.** A failing fake `pnpm` produces a failure line that names the log, and exit 0.

## Implementation brief

Read these first:

- this plan;
- [AGENTS.md](../../AGENTS.md);
- the workflow's [execution brief](../workflow.md#mains-execution-brief), [gate](../workflow.md#implementation-and-verification-gate) and [completion](../workflow.md#proposal-completion-and-archive) sections;
- the [implementer role](../../docs/developer/agents/implementer.md);
- D013 and D014 as models for D015;
- the files in the fence.

Work only in the checkout that main assigns. Do not commit.

1. Apply the settled texts in [Settled text](#settled-text).
2. Write D015, the cloud session guide, the hook script and the test.
3. Run the gate described under [Verification and acceptance](#verification-and-acceptance).
4. Report the changed paths, deviations, command results and evidence paths.

Return any needed change to settled text, or any path outside the fence, to main before depending on it.

## Exact file fence

- `AGENTS.md`
- `CLAUDE.md` (new)
- `.claude/settings.json` (new)
- `scripts/cloud-session-setup.sh` (new)
- `tests/deployment/cloud_session_setup_test.py` (new)
- `docs/developer/cloud-sessions.md` (new)
- `design/workflow.md`
- `design/decisions/015-agent-working-branches.md` (new)
- `design/decisions/013-evidence-based-delivery-workflow.md`
- `design/README.md`
- `docs/developer/development.md`
- `docs/developer/agents/implementer.md`
- `design/proposal-template.md`
- `docs/README.md`
- `design/proposals/036-cloud-agent-sessions.md` (main only)

Run-owned scratch:

- the implementer works in a separate checkout that main creates with `git worktree add` under this session's scratch directory;
- the manual run's `HOME`, environment file and logs go in a sibling `p036-run` directory.

Main removes both after integration.

## Verification and acceptance

- **P036-01:** `AGENTS.md` contains the settled texts, and nothing else in it changed.
- **P036-02:** `CLAUDE.md` matches the settled content. Its first line is the `@AGENTS.md` import, and `AGENTS.md` and `CLAUDE.md` together stay under 200 lines.
- **P036-03:** These documents state the same commit rule:
  - the workflow;
  - D015;
  - D013's metadata;
  - the design index;
  - the developer guide;
  - the implementer role;
  - the proposal template;
  - the documentation index.

  A search of current documents, excluding archives and dated reports, finds no requirement for per-commit owner confirmation on an agent working branch.
- **P036-04:** The cloud session guide has the specified headings and content, and it dates its environment facts. Its commands match `package.json`, the pinned versions and the hook.
- **P036-05:** The hook is verified in two ways.
  - The automated test's four cases pass.
  - A manual real run in this thread's cloud container prepares the implementer's fresh checkout, which has no `node_modules`. It uses a run-owned `HOME` and environment file, with `CLAUDE_CODE_REMOTE=true`. The run must:
    - download Node 24.11.1 and verify it against the pinned hash;
    - write one PATH line;
    - install the dependencies;
    - print the ready line.

    Then, with the PATH line applied, `pnpm check` passes in that checkout. A second run takes the fast path and prints the ready line again.
- **P036-06:** The documentation gate passes in the implementer's checkout:
  - `node scripts/check-docs.mjs`, which includes the new Markdown files;
  - `git add --intent-to-add` for the new files, followed by `git diff --check`;
  - `pnpm check`.

  In addition:

  - `pnpm test:deployment:contract` runs the new test, and its only failure is the baseline failure recorded above.
  - The changed path list equals the fence.

No application behavior changes, so no application suite beyond these is claimed.

## Rollout and recovery

- The rules and the hook take effect in sessions that start from a branch containing them. After the owner merges, that means every new cloud session on `main`.
- Adding the optional setup script is the owner's choice.
- Reverting the commit restores the previous rules. The hook leaves only the Node copy under `~/.cache` in disposable containers.

## Review and findings

Pending. After the green gate, main starts the design and provenance reviewers, as the [review contract](../workflow.md#delegation-and-review) requires.

## Closing record

Pending until the [completion conditions](../workflow.md#proposal-completion-and-archive) pass.
