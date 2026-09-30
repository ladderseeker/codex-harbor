# P036 — Rules for cloud agent sessions

## Metadata

- ID: P036
- Status: Accepted
- Priority: Not set by the owner. The owner asked for this on 30 September 2026, while P035 was executing.
- Created: 2026-09-30
- Owner: Main conversation. A fresh-context implementer does the implementation in a separate checkout.
- Outcome: The repository's rules match how agents work for the owner, including in cloud sessions. They say:
  - how agent work is committed, pushed and delivered straight to `main`;
  - what a cloud session has and has not verified, and where the missing gates run;
  - how a session prepares its toolchain, now automated by a repository hook;
  - how work and evidence survive a disposable container.

  Claude Code loads the shared rules through a new `CLAUDE.md` that imports `AGENTS.md`.
- Authorization: On 30 September 2026 the owner did three things:
  - They chose "Allow branch commits" on this thread's decision card. That let main commit and push checkpoints to its working branch without asking, while merging to `main` still waited for them.
  - They asked for `AGENTS.md` and `CLAUDE.md` to be updated for the work agents can do in this cloud environment, following the project's best practice.
  - At 02:54 UTC they wrote that this is their private work and needs no review: finished work goes straight to `main`, and the rules should say so. Once CI/CD exists, finishing something should also finish its deployment.

  Together these authorize this plan, its execution alongside P035 on disjoint files, branch commits and pushing finished work to `main`. The last message replaces the first choice's reservation about merging. Keeping the automatic design and provenance reviews is main's own default, not the owner's direction: main told the owner at 03:00 UTC that it kept them and that the owner could ask to skip them, and the owner has not asked. Tracked records paraphrase these messages, because the [workflow](../workflow.md#evidence-and-provenance) keeps conversation contents out of them. Every VPS workflow run other than `preflight` still needs the owner's go-ahead until a plan that delivers CI/CD is Implemented.
- Baseline: the implementer started at `aa03191`, which is `main` at `9231078` plus P035's plan. After P035 reached `main` at `8cfa82f`, main moved the checkout to the commit that adds this plan's revision to `8cfa82f`, carrying the implementer's uncommitted changes. P035's commits change none of this plan's files except the two named under Dependencies.
- Dependencies: None blocking.
  - The hook's real download and install are verified in this thread's cloud container.
  - Other environments may differ, so the guide dates its facts and says how to recheck them.
  - The edits to `docs/developer/github-actions-deploy.md` and `.github/workflows/deploy-vps.yml` wait until P035, which also changes both files, is on `main`. P035 reached `main` at `8cfa82f` on 30 September 2026.
- Source issues: None. The owner requested this directly.
- Design references:
  - the workflow's [proposal completion](../workflow.md#proposal-completion-and-archive), [evidence](../workflow.md#evidence-and-provenance), [gate](../workflow.md#implementation-and-verification-gate) and [review](../workflow.md#delegation-and-review) sections;
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
- **Gates that did not run.** No Docker daemon runs at session start, there is no systemd or delegated cgroup v2, and there is no SSH client, so several mandatory gates did not run.
- **Delivery.** Agent work used to reach `main` through pull requests from the agent's branch, such as pull request #4, which GitHub records as merged under the owner's account. On 30 September the owner allowed branch commits, then directed that finished work go straight to `main` without review, and that deployment become part of finishing once CI/CD exists.

After this change:

1. **Commits and delivery.**
   - Implementers never commit.
   - Main commits with the configured identity. When an outcome is finished, main delivers it directly to `main`, without owner review.
   - Finished means four things:
     - every gate that can run passed, apart from baseline failures already recorded in issues;
     - every gate that cannot run is recorded as unverified, with a linked issue;
     - both reviews are clear, with every finding dispositioned and accepted fixes verified;
     - the plan records the result.
   - When every mandatory gate passed, that record is the closing record and the proposal becomes Implemented. Otherwise it is a dated delivery entry, and the proposal stays Accepted, with its code on `main`, until the missing gates pass.
   - Work that still has blockers after the three review rounds stays off `main` until the owner decides.
   - An outcome is delivered only when every commit between `origin/main` and it belongs to a finished outcome or is a plan or issue record.
   - Where Git refuses the push to `main`, a pull request merged at once with a merge commit is the delivery step. It is not a review request.
   - Before delivery, main may commit coherent checkpoints to an assigned agent working branch and push them without asking. A checkpoint that has not passed its gate says `WIP`.
   - Until a plan that delivers CI/CD is Implemented and changes these rules, every deploy workflow run other than `preflight` needs the owner's go-ahead, and adding an automatic deploy trigger is the owner's decision. After that, finishing an outcome includes deploying it and checking the deployment.
   - The automatic design and provenance reviews stay, and they are now the only review before `main`. They start once every gate that can run is green.
   - D015 (`design/decisions/015-direct-delivery-and-cloud-sessions.md`) records the change.
2. **Cloud sessions in AGENTS.md.** A short section covers:
   - the environment and its setup;
   - what has and has not been verified there;
   - the owner's division of work;
   - how a Codex login is handled.

   It links to a new developer guide.
3. **CLAUDE.md.**
   - It imports `AGENTS.md` first. Claude Code reads `CLAUDE.md` instead of `AGENTS.md` whenever a `CLAUDE.md` exists, so the import is required. A `CLAUDE.md` that imports `AGENTS.md` never loads it twice ([Claude Code memory documentation](https://code.claude.com/docs/en/memory#agents-md)).
   - It then adds only Claude Code specifics: the hook, Git identity and attribution, the stop check, GitHub tools, subagent roles and parallel checkouts.
4. **Session setup hook.** `.claude/settings.json` runs `scripts/cloud-session-setup.sh` when a session starts, resumes or forks. Outside cloud sessions the script does nothing. In a cloud session it does the following:
   - installs Node 24.11.1 after checking the tarball against a SHA-256 value pinned in the script;
   - puts that Node first on PATH for the session through `CLAUDE_ENV_FILE`;
   - runs `pnpm install --frozen-lockfile`;
   - bounds the download and the install in time, so that a stall still ends with a status line;
   - prints one status line;
   - never fails the session.

   This follows the documented pattern for [cloud-session dependencies](https://code.claude.com/docs/en/cloud-environments#install-dependencies-with-a-sessionstart-hook) and [session environment variables](https://code.claude.com/docs/en/hooks). A session with several repositories does not run repository hooks, so the guide also says how to prepare a session by hand.
5. **Cloud session guide.** `docs/developer/cloud-sessions.md` covers:
   - the environment facts checked on 30 September 2026;
   - how to prepare a session, with or without the hook;
   - a table of gates;
   - commits and delivery to `main`;
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
   - the documentation index;
   - the repository README;
   - once P035 is on `main`, the GitHub Actions deployment guide and the deploy workflow's comment.

Excluded:

- hosted continuous integration, which is [P026](026-continuous-integration.md), and any change to the deploy workflow's behavior; only its comment about adding a trigger changes;
- the fresh-install deployment guide, which gets its own plan after P035;
- installing Codex from the hook, which stays a manual step because the install is about 320 MB;
- starting a Docker daemon, which this plan does not attempt;
- the environment's own settings, which only the owner can change;
- any application, runtime or deployment behavior.

## Dependencies and current design

The [workflow](../workflow.md#proposal-completion-and-archive) and [D013](../decisions/013-evidence-based-delivery-workflow.md) say that the owner confirms each commit. The workflow also starts the automatic reviews only after the combined gate is green, with only an advisory review when a gate is unavailable. The owner's 30 September directions replace the first rule: agents commit checkpoints on working branches and push finished work straight to `main`, with no owner confirmation or review. With owner review gone, the automatic reviews must cover every delivery, so they now start once every gate that can run is green. A focused decision records both changes, D015 (`design/decisions/015-direct-delivery-and-cloud-sessions.md`), with a reciprocal metadata link from D013. D013's other rules and its history stay unchanged.

[P026](026-continuous-integration.md) plans hosted CI. The owner's direction that deployment follow each finished outcome applies once a plan that delivers CI and deployment automation is Implemented; that plan updates the deploy rules then. P026, still a Draft, assumes pull requests and required checks, which direct pushes to `main` would bypass, so it needs revising for direct delivery when it is selected. The deploy guide and the deploy workflow's comment currently suggest adding a `push` trigger after the first manual deploy. This plan changes both to leave that trigger to the plan that delivers CI/CD and to the owner.

P035 also changes `docs/developer/github-actions-deploy.md` and `.github/workflows/deploy-vps.yml`. This plan's edits to those two files wait until P035 is on `main`, and they are made on top of it. P035 reached `main` at `8cfa82f` on 30 September 2026.

The gate rules stay the same: a missing credential, runtime or infrastructure makes a gate unverified, never passed. The new text only says which gates a cloud session did not run and where they run instead.

This thread's cloud container was inspected on 30 September 2026. The guide's facts come from that inspection:

- Ubuntu 24.04.4, running as root;
- cgroup v1, and PID 1 is not systemd;
- Node 22.22.2 on PATH, with Node 20, 21 and 22 under `/opt`;
- `CLAUDE_CODE_REMOTE=true`;
- a global `pnpm` that runs the pinned 12.3.4 through the repository's `packageManager` field;
- no `ssh` and no `gh` executable, with `GH_TOKEN` set to a proxy placeholder;
- `docker` and `dockerd` installed, with no daemon running at session start;
- Chromium revision 1194 under `/opt/pw-browsers`, which is the revision Playwright 1.56.1 expects;
- HTTPS egress through a proxy, with `nodejs.org` reachable;
- commits made with the configured `Claude <noreply@anthropic.com>` identity signed over SSH.

The Claude Code [cloud environment documentation](https://code.claude.com/docs/en/cloud-environments), read on 30 September 2026, adds three facts:

- `git push` works only against the session's current working branch;
- a session with several repositories, including a project thread, starts above the clones and does not run repository hooks;
- Docker is available for running services.

Two observations from this thread qualify the first two facts. At 06:09 UTC on 30 September 2026, this session delivered P035 with `git push origin HEAD:main`, which moved `main` from `9231078` to `8cfa82f`. This thread is a project thread with one repository; it started in the repository's directory and loaded `AGENTS.md`. Whether the hook runs in such a thread stays unverified until a thread starts after this plan reaches `main`.

The pinned SHA-256 of `node-v24.11.1-linux-x64.tar.xz` is `60e3b0a8500819514aca603487c254298cd776de0698d3cd08f11dba5b8289a8`. It matches the official `SHASUMS256.txt` for v24.11.1 and the tarball downloaded in this container.

On 30 September 2026, auto mode blocked an attempt to start `dockerd` with `--iptables=false --bridge=none`, classifying it as weakening security, and this thread started no daemon afterwards. The rules therefore forbid weakening isolation to make a check run, and they record the Docker lanes as not checked rather than impossible.

## Source issues

None.

## User and API flows

No browser page or public API changes.

- **Agents in cloud sessions that start in this repository** find the hook already run, a status line in context, and rules that say:
  - what to commit and when;
  - what they can verify;
  - how to record the gates they cannot run.
- **Agents in other cloud sessions** prepare the toolchain as the guide describes.
- **The owner** finds each finished outcome on `main`, with a summary in the thread that produced it. The owner may add the optional setup script to the cloud environment to cache Node and Codex.

## Contracts, state and security

- **Hook scope.** The script exits at once, without output or writes, unless `CLAUDE_CODE_REMOTE` is `true`. It never changes files in the repository except through `pnpm install`, which writes only the ignored `node_modules`.
- **Node download.**
  - The tarball comes from `https://nodejs.org/dist`. A test may override that base URL through `HARBOR_NODE_DIST`, but the SHA-256 value stays pinned in the script, so any source must deliver the exact official tarball.
  - A download, checksum or extraction failure leaves any existing install untouched and removes its own temporary directory.
- **Bounded time.** Each download attempt may take at most 90 seconds, with at most two retries within 180 seconds, and `pnpm install` runs under `timeout -k 10 240`, which kills the install 10 seconds after the stop signal if it is still running. A stall therefore ends with a failure line within the hook's 600-second limit.
- **Session environment.** The script appends one `export PATH=...` line to `CLAUDE_ENV_FILE`, and only if that exact line is not already present. It never prints environment values, tokens or file contents.
- **Failure behavior.** Every path exits 0 and prints at most one line. A failure line names the reason and the guide section.
- **Commit identity.** Commits use the session's configured identity. The rules forbid using the owner's or another contributor's name or email.
- **Codex state.** The guide tells agents to run Codex only with a run-owned `HOME` and `CODEX_HOME`, even for a version check, because every Codex start writes into its home and the default home may hold a login.
- **Unchanged.** Authentication, permissions, sandbox and isolation rules do not change. The new text forbids weakening them to make a check run.

## Settled text

The implementer applies these texts verbatim. It may adjust only a link path, and only if a check requires it.

### AGENTS.md

Replace the Delivery and delegation bullet that begins "After a green gate" with:

```markdown
- Once every gate that can run is green, automatically start separate fresh-context [design](docs/developer/agents/design-reviewer.md) and [provenance](docs/developer/agents/provenance-reviewer.md) reviewers, naming any gate that could not run. Reviewers only report and run read-only checks; they do not author fixes.
```

Replace the Delivery and delegation bullet that begins "Implementers never commit." with:

```markdown
- Implementers never commit. Main commits with the configured identity and delivers finished work directly to `main`, without owner review ([D015](design/decisions/015-direct-delivery-and-cloud-sessions.md)). Finished means every gate that can run passed, gates that cannot run are recorded as unverified with linked issues, both reviews are clear and the plan records the result; work with review blockers left after three rounds stays off `main` until the owner decides. Deliver only when every commit between `origin/main` and the outcome belongs to a finished outcome or is a plan or issue record. Before that, main may push checkpoints to an assigned agent working branch, such as a cloud session's `claude/...` branch, without asking, marking any that has not passed its gate `WIP`. The [workflow](design/workflow.md#proposal-completion-and-archive) has the details. Until a plan that delivers CI/CD is Implemented and changes these rules, deploy only with the owner's go-ahead for that run and add no automatic deploy trigger; after that, finishing an outcome includes deploying it and checking the deployment.
```

Replace the Implementation and safety bullet that begins "Keep enduring work and evidence" with:

```markdown
- Keep enduring work and evidence in persistent ignored storage; use OS temporary storage only for recreatable scratch. A cloud container is not persistent storage: there, push checkpoints and keep evidence that must survive in tracked records. Before interruption, record owners, coherent checkpoints within existing authorization, and recovery plans for unfinished edits and run resources.
```

Insert this section between Implementation and safety and VPS SSH handoff:

```markdown
## Cloud agent sessions

- A cloud agent session, such as a Claude Code cloud session, runs in its own disposable Linux container with a fresh clone, HTTPS-only egress through a proxy and no SSH client. Anything not pushed, including `.test-runs/` evidence and any Codex login made there, is lost when the container is reclaimed. The [cloud session guide](docs/developer/cloud-sessions.md) records the checked environment, setup and commands; recheck it when the environment changes.
- A Claude Code cloud session that starts in this repository runs its session-start hook, which installs the pinned Node 24.11.1 and the locked dependencies. A session with several repositories does not run it; prepare that session as the guide describes. Install Codex 0.153.4 only when a real-runtime contract needs it. Never loosen a pinned version, checksum or lockfile to make setup pass.
- In the cloud sessions checked on 30 September 2026, `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:deployment:contract`, pinned-runtime contracts that do not launch a personal runtime, document checks and Playwright with the preinstalled Chromium all ran. No Docker daemon runs at session start, so lanes that need Docker, including real-stack `pnpm test:e2e`, have not run there. Personal runtime launches and the personal VPS Linux lanes need systemd and delegated cgroup v2, which those sessions lack, and nothing there can use SSH. Never weaken container, network or sandbox isolation to make a check run. Record a gate that cannot run as unverified with a linked issue; hosted CI or a supported Linux host supplies it.
- Owner direction, 30 September 2026: agents plan, implement, test, review and deliver finished work to `main`, and may run the read-only deploy `preflight` through GitHub Actions. The owner does all SSH and host work and, until a plan that delivers CI/CD is Implemented, gives the go-ahead for every other deploy workflow run.
- No standing authorization covers a Codex login made inside a container. Use one only with the owner's explicit permission for that use; then copy only the credential into run-owned state, delete the copy afterwards, and never commit, print or share it.
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

- **Session setup.** In cloud sessions, the SessionStart hook in `.claude/settings.json` runs `scripts/cloud-session-setup.sh` and prints one status line. If that line reports a failure, or no status line appears, follow [Prepare a session](docs/developer/cloud-sessions.md#prepare-a-session) before running checks.
- **Git.** Commit with the configured Git identity, which signs commits in cloud sessions, and never with the owner's or another contributor's name or email. End commit messages and pull request descriptions with the attribution lines the session asks for. Push checkpoints to the branch the session assigns. The environment's stop check reports uncommitted or unpushed work at the end of each turn: commit and push a checkpoint, marked `WIP` until it passes its gate. Deliver finished work to `main` as [Commits and delivery](docs/developer/cloud-sessions.md#commits-and-delivery) describes.
- **GitHub.** Use the built-in GitHub tools; the `gh` CLI may be missing. Never open a pull request to ask the owner for review. When Git cannot push to `main`, deliver finished work through a pull request that you merge at once with a merge commit, which keeps the reviewed commits' identities.
- **Roles.** Run the implementer and each reviewer as a fresh-context subagent whose self-contained brief names its role document. Subagents never commit. When a checkpoint commit includes a running implementer's files, tell the implementer which commit to diff against.
- **Parallel work.** Give concurrent implementers disjoint file fences. Put a second implementer in its own worktree outside the repository directory, so that document checks do not scan another worker's unfinished files.
```

### design/workflow.md

In Proposal completion and archive, replace the paragraph that begins "Main presents the coherent uncommitted result" with:

```markdown
Implementers never commit. Main commits with the configured or owner-provided identity and delivers finished work directly to the default branch, `main`, without owner review. Work is finished when every gate that can run has passed, apart from baseline failures already recorded in issues; every gate that cannot run is recorded as unverified with a linked issue; both reviews are clear, with every finding dispositioned and accepted fixes verified; and the plan records the result. When every mandatory gate passed, that record is the closing record and the proposal becomes Implemented. Otherwise it is a dated delivery entry under Review and findings that names the delivered commit, the results, the dispositions and each unverified gate with its issue; the proposal stays Accepted, and its closing record stays pending until those gates pass. Deliver an outcome only when every commit between `origin/main` and it belongs to a finished outcome or is a coherent plan or issue record. Otherwise wait for the earlier outcome, or cut a branch from `origin/main` that holds only finished outcomes and records, and rerun the affected gate there. Push with `git push origin HEAD:main` where the environment allows it. Where a pull request is the only route to `main`, open one and merge it at once with a merge commit, which keeps the reviewed commits' identities; it is a delivery step, not a review request. Before delivery, main may commit coherent checkpoints to an assigned agent working branch, such as a cloud session's branch, and push them there without further confirmation; a checkpoint that has not passed its gate says `WIP` in its subject. Main then reports the outcome, validation, review rounds and remaining issues to the owner. Until a plan that delivers continuous integration and deployment is Implemented and changes these rules, every deploy workflow run other than the read-only `preflight` needs the owner's go-ahead, and adding an automatic deploy trigger is the owner's decision. After that, finishing an outcome includes deploying it and checking the deployment, as the owner directed. Reconcile staged, unstaged and untracked contents and owned stashes with each commit; identify deferred work and its owner. [D015](decisions/015-direct-delivery-and-cloud-sessions.md) records this rule.
```

In Evidence and provenance, after the sentence "Keep evidence that must survive interruption in persistent ignored storage and record ownership/recovery for unfinished changes and test resources.", insert:

```markdown
An ephemeral environment, such as a cloud session container, loses ignored and temporary storage when it is reclaimed. There, commit checkpoints of unfinished work to the working branch, and keep the evidence that must survive, such as identities, commands, exit codes and results, in tracked records. Raw artifacts kept nowhere else are recorded as unavailable once the container is gone.
```

In Implementation and verification gate, in the paragraph that begins "Reuse evidence for unchanged boundaries", replace "Record the blocker in an issue, continue unaffected work, and deliver a reviewable candidate with the missing gate stated. It cannot reach Implemented while that mandatory gate remains missing." with the following, which ends with the sentence this plan adds:

```markdown
Record the blocker in an issue, continue unaffected work, and name the missing gate wherever the result is reported. The result may still reach `main` under the [commit rules](#proposal-completion-and-archive), but it cannot reach Implemented while that mandatory gate remains missing. The [cloud session guide](../docs/developer/cloud-sessions.md#what-runs-here) lists which gates a cloud session can run.
```

In Delegation and review, three replacements:

- Replace "Once the applicable combined gate is green, main automatically starts two independent review roles, without another permission request:" with:

  ```markdown
  Once every gate that can run is green, main automatically starts two independent review roles, without another permission request, and names any gate that could not run in their briefs:
  ```

- Replace "If a required gate is unavailable, a bounded advisory review may help the candidate, but must be labelled advisory and cannot satisfy the normal completion review gate." with:

  ```markdown
  When a required gate could not run, the reviews cover the result as it stands and say what they could not assess. Clear reviews then allow delivery to `main`, not completion. When the missing gate later runs, main records its result, and a failure becomes new work with its own gate and reviews.
  ```

- Replace "The proposal stays Accepted. Do not silently waive findings" with:

  ```markdown
  The proposal stays Accepted, and its result stays off `main` until the owner decides. Do not silently waive findings
  ```

### Other alignments

- `README.md`: in the paragraph that begins "The [delivery workflow]", replace "and owner confirmation before committing." with "and direct delivery of finished work to `main`."
- `design/decisions/013-evidence-based-delivery-workflow.md`: after the "Current contract" metadata bullet, add the bullet below. Leave the body unchanged.

  ```markdown
  - Amended by: [D015](015-direct-delivery-and-cloud-sessions.md) on 30 September 2026, for agent commits, direct delivery to `main`, reviews when a gate cannot run and evidence in ephemeral environments.
  ```

- `design/README.md`: after the D014 line, add:

  ```markdown
  - [D015 — Direct delivery and cloud sessions](decisions/015-direct-delivery-and-cloud-sessions.md).
  ```

- `docs/developer/development.md`, six edits:
  - In Run the deterministic application locally, after the sentence that begins "The tested macOS toolchain uses", add:

    ```markdown
    Cloud sessions prepare Node and dependencies through the [session hook](cloud-sessions.md#prepare-a-session).
    ```

  - In Command availability, replace the first two sentences of the first paragraph, which begin "The implemented entry points are" and "Their results and unavailable gates", with:

    ```markdown
    The implemented entry points are `pnpm dev`, `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live`, `pnpm test:isolation`, `pnpm test:egress`, `pnpm test:workspaces`, `pnpm test:schedules` and `pnpm test:deployment:contract`. The foundation report records the results and unavailable gates of the first nine; the reports of the features that added the other three, such as the [scheduling report](../reports/2026-09-08-p008-development.md), record theirs.
    ```

  - Append to the same paragraph:

    ```markdown
    The [cloud session guide](cloud-sessions.md#what-runs-here) says which of them run in a cloud session.
    ```

  - In Delivering a feature, replace "the three-round cap and owner confirmation before a commit." with "the three-round cap and the commit and delivery rules."
  - In the same sentence, replace "automatic review after the green gate" with "automatic review once every gate that can run is green".
  - In the next paragraph, after "OS temporary storage is for recreatable scratch.", add:

    ```markdown
    In a cloud session both disappear with the container; see [Keep evidence](cloud-sessions.md#keep-evidence).
    ```

- `docs/developer/agents/implementer.md`: replace "main presents the reviewed result for owner commit confirmation." with:

  ```markdown
  main commits the reviewed result and delivers it to `main` under the [workflow's commit rules](../../../design/workflow.md#proposal-completion-and-archive).
  ```

- `design/proposal-template.md`, two edits:
  - In Review and findings, replace the paragraph that begins "After the green gate, main automatically invokes" with:

    ```markdown
    Once every gate that can run is green, main automatically invokes separate fresh-context design and provenance reviewers using the [review contract](workflow.md#delegation-and-review), naming any gate that could not run. Record each round's findings, main's dispositions, original-implementer fixes, verified results and evidence limits. Stop at most after three rounds. Link unrelated findings and any remaining blocker to issues; do not silently expand scope or waive a missing gate. When the result reaches `main` while a mandatory gate is still unverified, add a dated delivery entry here that names the delivered commit, the results, the dispositions and each unverified gate with its issue.
    ```

  - Replace "- Owner-facing uncommitted result for review and commit confirmation." with:

    ```markdown
    - Delivery: the finished result is committed and pushed to `main` together with this record, under the [commit rules](workflow.md#proposal-completion-and-archive).
    ```

- `docs/README.md`: under Start here, after the Developer workflow line, add:

  ```markdown
  - [Cloud agent sessions](developer/cloud-sessions.md): setup, what a cloud session can verify, commits and delivery to `main`, and where the other gates run.
  ```

- `docs/developer/github-actions-deploy.md`, once P035 is on `main`: under Switching to automatic deployment, replace the paragraph that begins "After a manual `deploy` succeeds" with:

  ```markdown
  Automatic deployment belongs to the plan that delivers continuous integration and deployment. Until that plan is Implemented, the workflow stays manual: every run other than `preflight` needs the owner's go-ahead, and adding a `push` trigger is the owner's decision. Runs without inputs default to `deploy` without new migrations, so even with a trigger, a change that adds migrations needs a manual run.
  ```

- `.github/workflows/deploy-vps.yml`, once P035 is on `main`: replace the three comment lines that begin "# Manual only for now." with the lines below. Change nothing else in the file.

  ```yaml
  # Manual only. See docs/developer/github-actions-deploy.md before the first
  # run. An automatic trigger belongs to the plan that delivers CI/CD and needs
  # the owner's decision; runs without inputs default to `deploy` with no new migrations.
  ```

### D015

Write `design/decisions/015-direct-delivery-and-cloud-sessions.md`, titled "D015 — Direct delivery and cloud sessions", in the form of D013 and D014. It paraphrases the owner's messages with their date and time, as this plan's Authorization does, and quotes none of them.

It has these metadata bullets:

- **Decision:** Accepted on 30 September 2026, on the owner's three messages summarized in this plan's Authorization. It names the decision card as one in this project's thread, posted during P035. It also says that keeping the automatic reviews is main's own default, which main told the owner at 03:00 UTC, and that the owner had not asked to skip them when the decision was recorded.
- **Changes:** collaboration rules only.
- **Amends:** two D013 rules.
  - The owner no longer confirms each commit. Agents deliver finished work straight to `main`, with no owner confirmation or review.
  - When a mandatory gate cannot run, the reviews are no longer advisory. A result may reach `main` once every other gate passed and both reviews are clear, and it stays Accepted until that gate passes.
- **Retains:**
  - the rest of D013, including the automatic design and provenance reviews, the three-round cap and the owner's decision on remaining blockers;
  - the owner's authority over deployment until a plan that delivers CI/CD is Implemented and changes these rules, and over credentials and host work;
  - every gate, which still decides Implemented.
- **Execution record:** this plan.
- **Current contract:** the workflow section, `AGENTS.md` and the cloud session guide.

It has these sections:

- **Context.** Harbor is the owner's private work. Cloud containers are disposable, the stop check asks for pushed work every turn, and per-commit confirmation stalled every turn. Agent work used to reach `main` through pull requests from the agent's branch, such as pull request #4, which GitHub records as merged under the owner's account. Then the owner found review unnecessary.
- **Options and decision.** Three options:
  - Keep per-commit confirmation. This loses work when a container is reclaimed and blocks every turn.
  - Commit on working branches and have the owner review each pull request. The owner chose this first, then rejected it at 02:54 UTC on 30 September, writing that this private work needs no review.
  - Commit checkpoints on working branches and push finished work straight to `main`. This option is selected.

  The section also states these rules:
  - Finished means what the workflow says: every gate that can run passed, every other gate is recorded as unverified with an issue, both reviews are clear and the plan records the result. Work with review blockers left after three rounds stays off `main` until the owner decides.
  - An outcome is delivered only when every commit between `origin/main` and it belongs to a finished outcome or is a plan or issue record.
  - Where Git cannot push to `main`, a pull request merged at once with a merge commit delivers the reviewed commits unchanged. It is not a review request.
  - Unavailable gates stay unverified, hosted CI or a supported host supplies them, and isolation is never weakened.
  - Deployment stays manual, with the owner's go-ahead for every run other than `preflight`, until a plan that delivers CI/CD is Implemented and changes these rules. Adding an automatic deploy trigger is the owner's decision. After that, finishing an outcome includes deploying it and checking the deployment, as the owner directed.
- **Consequences:**
  - `main` history includes the `WIP` checkpoints of each delivered outcome, but `main`'s tip only ever holds finished work.
  - The automatic reviews are the only review before `main`, so they are never skipped. They start once every gate that can run is green.
  - A proposal can be on `main` while still Accepted, with a dated delivery entry, because a mandatory gate that could not run keeps it from Implemented.
  - Outcomes that share a working branch reach `main` in their order on the branch, because each waits for the outcomes below it, or from a branch cut from `origin/main` that holds only finished outcomes and records.
  - Reviewers get commit identities.
  - Evidence that must survive goes into tracked records.

### Cloud session guide

`docs/developer/cloud-sessions.md` uses these headings in this order, so that the anchors above resolve:

- `# Cloud agent sessions`
- `## Environment`
- `## Prepare a session`
- `## What runs here`
- `## Gates that need another host`
- `## Commits and delivery`
- `## Keep evidence`
- `## Codex account`
- `## VPS work`
- `## Optional environment setup script`

Required content for each section:

- **Environment.**
  - The container facts listed under [Dependencies and current design](#dependencies-and-current-design), dated 30 September 2026.
  - The three facts from the Claude Code cloud environment documentation, dated and linked, followed by the two observations that qualify them: the push to `main` and this project thread's start in the repository.
  - How to recheck them: `check-tools`, `node --version`, `command -v ssh gh`, and `docker info` failing while no daemon runs.
- **Prepare a session.**
  - What the hook does, and that it installs Node under `~/.cache/codex-harbor`.
  - When it runs: in a session that starts in this repository, when the session starts, resumes or forks. A session with several repositories starts above the clones and does not run it, and `/clear` and compaction do not rerun it.
  - If no status line appears, or `node --version` prints anything other than `v24.11.1`, check the cached Node with `"$HOME/.cache/codex-harbor/node-v24.11.1-linux-x64/bin/node" --version`. If that prints `v24.11.1`, Node is installed: use the export line and run `pnpm install --frozen-lockfile` before checks. Otherwise the hook did not run or did not finish; follow the manual steps.
  - The manual fallback commands, with the same pinned hash. Like the setup script, they change nothing while the cached Node reports `v24.11.1`, so they never remove a working Node or the Codex that the setup script installs inside it. They download and extract in a temporary directory under `~/.cache/codex-harbor`, then move the result into place, as the hook does.
  - How to install Codex 0.153.4 with `npm install -g @openai/codex@0.153.4`, and the path of its Linux x64 binary for `HARBOR_LOCAL_CONTRACT_BINARY`: `$(npm root -g)/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`.
  - Run Codex only with a run-owned `HOME` and `CODEX_HOME`, even for a version check such as `CODEX_HOME="$(mktemp -d)" codex --version`. A Codex start may write into its home, and the default home may hold a login.
  - Playwright uses the preinstalled Chromium, so never run `playwright install` in a cloud session.
- **What runs here.**
  - A table of the implemented commands from `package.json`, saying for each whether it runs in a cloud session: Yes, Partly, Not checked or No, with notes.
  - The rows that need Docker say "Not checked here: needs a running Docker daemon, and none runs at session start", followed by their other needs. Those rows are `pnpm test:e2e`, `pnpm dev`, `pnpm test:workspaces`, `pnpm test:schedules` and `pnpm test:isolation`, plus the Linux gateway part of `pnpm test:egress`.
  - Record the results observed at `9231078`:
    - `pnpm test:deployment:contract` failed one managed-tooling test, `review_test.Review.test_actual_process_capture_limit_timeout_and_failure`. The [capture-limit issue](../../issues/2026-09-30-032022-deploy-run-capture-limit.md) records it. The script joins its Python and Node halves with `&&`, so that failure skips the Node half. Run the Node half separately: `node --import tsx --test tests/deployment/storage-transport.test.ts tests/deployment/probe.test.ts`.
    - `pnpm test:contract` with the pinned binary passed 23 of 28. Four of the five failures launch personal runtimes and need delegated cgroups. The fifth, the P024 attachment contract, needs a nonroot Linux user.
  - The `pnpm test:contract` row also says that its history test runs the host's login profile, which rewrote `/opt/rbenv/shims` in the session that wrote this guide, and links the [login-shell issue](../../issues/2026-09-30-033836-contract-test-login-shell.md).
  - The legend says that no Docker daemon was started in the session that wrote this guide, not in any cloud session.
- **Gates that need another host.**
  - Open with "These gates did not run in the cloud session that wrote this guide." Then name, for each gate, the host or check it needs:
    - real-stack E2E: a running Docker daemon with Compose;
    - the personal VPS Linux lanes, `node --import tsx tests/personal-vps/e2e.ts` and its `--concurrency` form: root on a Linux host with systemd and delegated cgroup v2;
    - `pnpm test:isolation`: Docker, built images and the dedicated XFS storage of the Linux verification workflow;
    - `node tests/egress/linux.mjs`: Docker and its built images;
    - `pnpm test:live`: dedicated credentials and the supported Linux execution profile;
    - anything over SSH.
  - Keep the dated note about the blocked `dockerd` attempt, and say that the session that wrote this guide did not try a default daemon.
  - Then say how to record them: unverified, with a linked issue. The result may still reach `main` with a dated delivery entry, and the proposal stays Accepted until the gate passes. They run in hosted CI once [P026](../../design/proposals/026-continuous-integration.md) delivers it, or on a supported Linux host run by the owner.
- **Commits and delivery.** D015 in practice:
  - use the configured identity, which signs commits, and never the owner's or another contributor's name or email;
  - include the attribution lines;
  - mark checkpoints that have not passed their gate `WIP`;
  - push each checkpoint to the session's branch;
  - implementers never commit, and a running implementer is told its diff base;
  - finished means what the workflow says: every gate that can run passed, apart from recorded baseline failures; every gate that cannot run is recorded as unverified with a linked issue; both reviews are clear; and the plan records the result, as a closing record or a dated delivery entry;
  - work that still has blockers after three review rounds stays off `main` until the owner decides;
  - deliver an outcome only when every commit between `origin/main` and it belongs to a finished outcome or is a plan or issue record; otherwise wait for the earlier outcome, or cut a branch from `origin/main` that holds only finished outcomes and records, and rerun the affected gate there;
  - deliver with `git push origin HEAD:main`. The Claude Code documentation, read on 30 September 2026, says a cloud session can push only to its own branch, but this project's session delivered P035 that way that day. If Git refuses the push, open a pull request from the session's branch and merge it at once with the GitHub tools, using a merge commit. The delivered commits and their signatures stay unchanged, and GitHub creates the merge commit under the account that the session's GitHub connection uses; it is the only commit that the configured identity does not make. That pull request is a delivery step, not a review request;
  - if `main` moved, merge `origin/main` into the branch, rerun the affected checks and deliver again, and never force-push `main`;
  - until a plan that delivers CI/CD is Implemented and changes these rules, deploy workflow runs other than `preflight` need the owner's go-ahead, and adding an automatic deploy trigger is the owner's decision.
- **Keep evidence.** Ignored and scratch storage disappear with the container. Commit evidence records, and mark raw logs unavailable once they are gone.
- **Codex account.**
  - A login made with `codex login --device-auth` exists only in that container and is lost with it.
  - No standing authorization covers it. Use it only with the owner's explicit permission for that use, as `AGENTS.md` requires; then copy only the credential into a run-owned `CODEX_HOME` and delete the copy afterwards.
  - Never commit, print or share it.
- **VPS work.**
  - Use the GitHub Actions workflow.
  - `preflight` is read-only. Until a plan that delivers CI/CD is Implemented and changes these rules, every other action needs the owner's go-ahead for that run.
  - The owner does all SSH and host work.
  - Link the [GitHub Actions deployment guide](../../docs/developer/github-actions-deploy.md) and the [personal VPS guide](../../docs/developer/personal-vps.md).
- **Optional environment setup script.** Give an owner-pasteable Bash script for the cloud environment's Setup script field. The script does four things:
  - installs Node 24.11.1 into the same `~/.cache/codex-harbor/node-v24.11.1-linux-x64` directory, after checking the pinned hash;
  - installs Codex 0.153.4 with `npm install -g`;
  - ends with `exit 0`;
  - reports failures without failing session start.

  Explain that the environment caches what the script installs, and that the hook then finds Node already present. Also say that the script prepares sessions with several repositories, which do not run the repository hook.

### Hook and test

- `.claude/settings.json` contains only this configuration:

  ```json
  {
    "hooks": {
      "SessionStart": [
        {
          "matcher": "startup|resume|fork",
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
  - **Node install:** it downloads, verifies and extracts into a temporary directory under the install root, then renames the result into place. `curl` runs with `--connect-timeout 20 --max-time 90 --retry 2 --retry-max-time 180`.
  - **Project directory:** it runs `pnpm install --frozen-lockfile` in `$CLAUDE_PROJECT_DIR`, falling back to the script's parent directory, and logs to `$HOME/.cache/codex-harbor/pnpm-install.log`.
  - **pnpm lookup:** it uses `pnpm` when that is on PATH. Otherwise it runs `corepack pnpm` with `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`. Either runs under `timeout -k 10 240`; when the `timeout` command is missing, the script prints a failure line that says so.
  - **Output:** it prints exactly `Harbor cloud setup: Node v24.11.1 and locked dependencies ready.` on success. On failure it prints a line that begins `Harbor cloud setup failed:` and ends with `See docs/developer/cloud-sessions.md#prepare-a-session.` A separate line says that the install did not finish within 240 seconds when `timeout` returns 124, after the install stops at the stop signal. Status 137, which `timeout` returns when it must kill the install and which an out-of-memory kill also produces, keeps the generic failure line.
- `tests/deployment/cloud_session_setup_test.py` runs the script with a temporary `HOME`, `CLAUDE_ENV_FILE`, `CLAUDE_PROJECT_DIR` and PATH. Every failure case also asserts that the output contains none of the temporary `HOME`, environment file or project paths. It covers four cases:
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

1. Apply the settled texts in [Settled text](#settled-text), except the two edits marked "once P035 is on `main`".
2. Write D015, the cloud session guide, the hook script and the test.
3. Run the gate described under [Verification and acceptance](#verification-and-acceptance).
4. Report the changed paths, deviations, command results and evidence paths.
5. When main says that P035 is on `main`, apply the two remaining edits in the checkout main names, and rerun the documentation gate there.

Return any needed change to settled text, or any path outside the fence, to main before depending on it.

## Exact file fence

- `AGENTS.md`
- `README.md`
- `CLAUDE.md` (new)
- `.claude/settings.json` (new)
- `scripts/cloud-session-setup.sh` (new)
- `tests/deployment/cloud_session_setup_test.py` (new)
- `docs/developer/cloud-sessions.md` (new)
- `design/workflow.md`
- `design/decisions/015-direct-delivery-and-cloud-sessions.md` (new)
- `design/decisions/013-evidence-based-delivery-workflow.md`
- `design/README.md`
- `docs/developer/development.md`
- `docs/developer/agents/implementer.md`
- `design/proposal-template.md`
- `docs/README.md`
- `docs/developer/github-actions-deploy.md` (once P035 is on `main`)
- `.github/workflows/deploy-vps.yml` (its comment only, once P035 is on `main`)
- `design/proposals/036-cloud-agent-sessions.md` (main only)

Run-owned scratch:

- the implementer works in a separate checkout that main creates with `git worktree add` under this session's scratch directory;
- the manual run's `HOME`, environment file and logs go in a sibling `p036-run` directory.

Main removes both after integration.

## Verification and acceptance

- **P036-01:** `AGENTS.md` contains the settled texts, and nothing else in it changed.
- **P036-02:** `CLAUDE.md` matches the settled content. Its first line is the `@AGENTS.md` import, and `AGENTS.md` and `CLAUDE.md` together stay under 200 lines.
- **P036-03:** These documents state the same rules for commits, delivery, unverified gates and deployment:
  - the workflow;
  - D015;
  - D013's metadata;
  - the design index;
  - the developer guide;
  - the implementer role;
  - the proposal template;
  - the documentation index;
  - the repository README;
  - the cloud session guide;
  - once P035 is on `main`, the GitHub Actions deployment guide and the deploy workflow's comment.

  A search of current documents, excluding archives, dated reports and the body of D013, finds no requirement for per-commit owner confirmation or for the owner to review a pull request, and no instruction to add an automatic deploy trigger. D013's body keeps its original wording as decision history; its metadata says D015 amends it. D015 and this plan paraphrase the owner's messages and quote none of them.
- **P036-04:** The cloud session guide has the specified headings and content, and it dates its environment facts. Its commands match `package.json`, the pinned versions and the hook, and it marks the Docker lanes as not checked rather than impossible.
- **P036-05:** The hook is verified in two ways, after its last change.
  - The automated test's four cases pass.
  - A manual real run in this thread's cloud container prepares the implementer's checkout, with its `node_modules` removed first. It uses a run-owned `HOME` and environment file, with `CLAUDE_CODE_REMOTE=true`. The run must:
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

  - `pnpm test:deployment:contract` runs the new test, and its only failure is the baseline failure recorded above. Its Node half, run separately, passes.
  - The changed path list equals the fence. The deploy guide and the workflow comment are checked in the checkout where they are changed, after P035 is on `main`.

No application behavior changes, so no application suite beyond these is claimed.

## Rollout and recovery

- The rules and the hook take effect in sessions that start from a branch containing them. Once they are on `main`, that means every new cloud session that starts in this repository.
- Adding the optional setup script is the owner's choice.
- Reverting the commit restores the previous rules. The hook leaves only the Node copy under `~/.cache` in disposable containers.

## Review and findings

### Round 1, 30 September 2026

Both reviewers read the implementer's checkout at `aa03191`, whose tracked diff has SHA-256 `a4c6b8be…d7f`, with the six new files and this plan as committed at `cbf00ee`. They verified the fence, the verbatim settled texts, the headings, the pinned hash, the four test cases and `check-docs`. The provenance reviewer also reproduced the gate and a real hook run, including the fast path and `pnpm check`. The design reviewer reported one blocker, four major findings, two minor findings, three nits and two unrelated observations. The provenance reviewer reported four minor findings and three nits.

Main's dispositions:

- **Accepted, and fixed in this plan's settled texts and specs:**
  - "Finished" allowed gate-failing or blocked work to reach `main`. It now requires passed gates, recorded unverified gates, clear reviews and a record, and blocked work stays off `main`.
  - When a gate cannot run, the review trigger, the advisory rule, the gate paragraph and the template's closing record contradicted delivery. The reviews now start once every runnable gate is green, and a dated delivery entry records a result that reaches `main` while Accepted.
  - The switch to deploying on every finished outcome had no defined event. It now waits for a plan that delivers CI/CD to be Implemented. The deploy guide and the workflow comment join the fence, so that they no longer suggest adding a `push` trigger.
  - Delivery from a shared branch could carry another outcome's unfinished commits. An outcome now goes to `main` only when every commit below it is finished work or a record.
  - The guide claimed an authorization for container Codex logins that does not exist. Such a login now needs the owner's explicit permission for each use.
  - "Without a pull request" conflicted with the documented push limit. Delivery now uses a pull request merged at once with a merge commit where Git cannot push to `main`.
  - Nothing covered a missing status line. The rules now say what to do then, the hook bounds its download and install, and the matcher adds `fork`.
  - Docker lanes were stated as impossible. They are now recorded as not checked.
  - The owner's words were quoted with typos silently corrected. Tracked records now paraphrase them, as the workflow requires.
  - The fifth contract failure's description, the XFS attribution and the hook's coverage limits were inexact; the guide spec now states them exactly.
  - Nits: the capture-limit issue link and the `&&` note, the failure-output assertion, the manual fallback's temporary directory and the developer guide's entry-point list.
- **Outside scope:** P026 assumes pull requests and required checks. Dependencies records that it needs revising when selected.
- **Not authorized:** a check of a default Docker daemon, which this plan excludes.

Evidence limits: auto mode blocked the implementer's own script for comparing the settled texts. The reviewers compared those texts by reading and with their own read-only checks. The provenance reviewer found that `/root/.codex/tmp/arg0`, in the container's default Codex home, changed at 03:37:36 UTC. P035's provenance review traced it to main's own identity command for a credential-free probe, which ran `codex --version` once with the default home. Codex created a helper directory there, may have removed stale ones, and read no credential. The guide now tells agents to use a run-owned home even for version checks.

### Fix round 1 and the move to `main`, 30 September 2026

The implementer applied the round 1 fixes at `aa03191`. Its gate passed, apart from the recorded capture-limit baseline and `check-docs`, which also stopped `pnpm check`: the guide and this plan link the capture-limit issue, which was added after `aa03191`. With that issue copied into a mirror of the checkout, `check-docs` passed. P035 then reached `main` at `8cfa82f`, and main moved the checkout to the commit that adds this revision to it. No file that the implementer changed differs between `aa03191` and `8cfa82f`, so its uncommitted changes carried over unchanged.

Main's dispositions of the implementer's report:

- **Accepted additions beyond the spec:**
  - the documentation's phrase "including a project thread" in the guide's facts;
  - a separate failure line when `pnpm install` times out, with a test for it;
  - running `pnpm install --frozen-lockfile` when `node --version` is right but no status line appeared;
  - a version-check example that sets both homes and removes them afterwards, and mentions the warning Codex prints for a home under `/tmp`;
  - the hook's curl limits in the manual fallback and the setup script, the extra Git commands, the configured-mode needs of `pnpm dev` and the table's legend;
  - D015's statement that no application, runtime, deployment or security behavior changes, and its mention of pull request #4, an agent branch that the owner reviewed and merged.
- **Changed in this plan after the report:**
  - `AGENTS.md` still started the reviews after a green gate. A new settled text replaces that bullet to match the workflow.
  - The delivery texts assumed, following the documentation, that a cloud session cannot push to `main`. This session pushed P035 to `main` at 06:09 UTC. The guide now records that, D015 no longer names cloud sessions as unable to push, and a pull request remains the fallback when Git refuses the push.
  - `timeout 240` could not stop an install that ignores the stop signal, so the hook would end at its 600-second limit without a failure line. The install now runs under `timeout -k 10 240`.

### Round 2, 30 September 2026

Both reviewers read the checkout at `f921f1f`, whose tracked diff has SHA-256 `c2ff1763…d799d10`, with the six new files, and found every round 1 finding fixed. The design reviewer reported two minor findings and four nits. The provenance reviewer reproduced the documentation gate, the hook's unit tests, a real hook run from an empty cache, its fast path, `pnpm check`, the deployment contract, the manual fallback and the optional setup script, and reported two minor findings and seven nits. Neither reported a blocker or a major finding.

Main's dispositions:

- **Accepted, and fixed in this plan's settled texts and specs:**
  - The developer guide still started the reviews after the green gate. A sixth `development.md` edit now uses the new trigger.
  - The guide's manual Node block deleted the cached Node, and with it any Codex that the optional setup script installed there, even when that Node worked. The guide now checks the cached Node first, and the block changes nothing while that Node reports v24.11.1.
  - Two words carried two meanings in the delivery texts. `WIP` now marks checkpoints that have not passed their gate, the blockers that keep work off `main` are review blockers left after three rounds, and each commit before an outcome must belong to a finished outcome or be a plan or issue record.
  - D015 said that outcomes on a shared branch reach `main` in the order they finish. They reach it in their order on the branch.
  - The guide now says that the fallback's merge commit is the only commit that the configured identity does not make.
  - The records presented keeping the automatic reviews as the owner's direction. It is main's default, which main told the owner at 03:00 UTC. The Authorization and D015 now say so.
  - The guide recommended `pnpm test:contract` without saying that its history test runs the host's login profile. The table now says so and links the [login-shell issue](../../issues/2026-09-30-033836-contract-test-login-shell.md).
  - The guide said that every Codex start writes into its home. With a home under `/tmp`, Codex wrote nothing, so the guide now says that a start may write there.
  - The guide said that no Docker daemon had been started or tried in any cloud session. The evidence covers only the session that wrote it, and the guide now says so.
  - D015 said that the owner reviewed pull request #4. GitHub records no review, only a merge under the owner's account, which the agents' GitHub connection also uses. D015 and this plan now state only what GitHub records. The round 1 record above keeps its earlier wording.
  - D015 placed the decision card in a P036 planning thread. The card was posted in this project's thread during P035.
- **Accepted in part:** a killed install gets the generic failure line, not the timeout line. `timeout` returns 137 when it must kill the install, and an out-of-memory kill returns the same status, so the hook keeps the generic line for 137. The hook's contract and the test's comment now say that the timeout line covers status 124 only.
- **Declined:** calling the environment a virtual machine instead of a container. Claude Code's own description of the session calls it a container, and every claim about its lifetime holds either way.
- **Recorded limit:** earlier versions of this plan, at `02da7cf`, `7101c7c` and `cbf00ee`, quoted the owner verbatim. Those commits are in `main`'s history since 06:09 UTC. Removing them would need a force-push to `main`, which the rules forbid. The current texts paraphrase.

Evidence limits: neither reviewer saw Claude Code run the hook at session start, environment caching, a Codex command, `pnpm test:contract` or the delivery block. The provenance reviewer's settled-text checks passed against `f921f1f`'s plan. Against this revision, the checkout fails three of them until the fix round, and round 3 reruns them. That reviewer's `npm root -g`, run with the container's default home, wrote a 614-byte npm debug log, and its `node --import tsx` runs used the shared `/tmp/tsx-0` cache. Both are harmless and disappear with the container.

## Closing record

Pending until the [completion conditions](../workflow.md#proposal-completion-and-archive) pass.
