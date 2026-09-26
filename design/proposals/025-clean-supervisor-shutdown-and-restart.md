# P025 — Clean supervisor shutdown and restart

## Metadata

- ID: P025
- Status: Draft
- Priority: Urgent, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Stopping, restarting or redeploying the personal VPS supervisor leaves no unknown runtime membership, so a deploy soon after use succeeds and a crash restart recovers capacity without a host reboot. An uncertain turn no longer blocks every later deploy, and a release that changes the generated service files deploys through the workflow.
- Authorization: Proposal writing only. Implementation, commits to `main`, deployment and any live-host action need the owner's separate go-ahead.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529`; no reproduction has run.
- Dependencies: Delegated cgroup ownership from [P018](archive/018-concurrent-conversations-and-runtime-capacity.md) is implemented and deployed. Acceptance needs an actual Linux host with systemd, cgroup v2 and delegation, which a disposable VM or a GitHub-hosted runner may provide; missing Linux evidence blocks completion. No dependency on other drafts.
- Source issues: [Personal service stop retains runtimes](../../issues/2026-09-21-174500-personal-stop-retained-runtimes.md): all obligations if P025-02 reproduces the failure; otherwise all except determining the mechanism. [An uncertain turn blocks every deploy](../../issues/2026-09-26-034257-uncertain-turn-blocks-deploy.md): all obligations.
- Design references: [D014 idle classification and retirement](../decisions/014-personal-conversation-concurrency.md#idle-classification-and-retirement), [personal runtime capacity](../systems/001-conversations-and-access.md#personal-runtime-capacity), [deployment and profiles](../systems/004-deployment-and-profiles.md), [GitHub Actions deployment](../../docs/developer/github-actions-deploy.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P025-01–P025-09.

## Problem, outcome and exclusions

The owner's instance retains an idle Codex runtime for up to 30 minutes after each successful turn. The [source analysis](../../issues/2026-09-21-174500-personal-stop-retained-runtimes.md#source-analysis--25-september-2026) traces how a normal `systemctl stop` can leave those runtimes recorded as unknown: `KillMode=control-group` signals every process at once, the resulting mailbox failures start retirements that `stop()` never awaits, the database pool closes under them, and the next start cannot prove absence because the leaf cgroups are gone. `deploy-release promote` then refuses every later deploy, and the only verified recovery so far is a host reboot. Two more rules in `deploy-release` block deploys: it counts an uncertain turn as busy work, and an uncertain turn stays uncertain by design, as the [uncertain-turn issue](../../issues/2026-09-26-034257-uncertain-turn-blocks-deploy.md) records; and it renders the installed service files with the candidate's installer template, so a candidate that changes those files, as this plan does, is refused as drift.

After this change:

1. A normal stop retires every retained runtime in order and commits its release before the process exits.
2. A deploy after recent use succeeds without the owner first stopping processes by hand.
3. After an abrupt supervisor death, the next start releases membership whose processes are provably gone, without a reboot, while any interrupted turn stays visibly uncertain.
4. Each refusal names the actual blocker, so the owner can tell unknown membership apart from active work.
5. An uncertain turn stays uncertain, as the design requires, but neither it nor a turn queued behind it blocks every later deploy.
6. A release that changes the generated unit, environment or AppArmor files, as this plan does, deploys through the workflow instead of being refused as drift.

Excluded: explicit uncertain-work recovery for personal profiles, replaying interrupted turns, macOS lifecycle support, managed-profile shutdown and any change to the post-stop check other than the uncertain-operation rule in contract 4; that check still requires zero runtime ownership, background marks, active operations and leftover processes.

## Dependencies and current design

D014 requires that a retiring member holds capacity until `cgroup.kill`, `populated=0` and a committed release, and that restart release membership only for a verified empty generation cgroup or a changed boot. It explicitly rejects a missing path alone as proof. This plan keeps both rules and adds one proof, recorded as a dated D014 amendment:

- **Empty delegated subtree.** At startup, before the supervisor creates any conversation leaf, it reads its own delegated root. If the root and the supervisor's own manager leaf contain no process other than the supervisor, and every other descendant cgroup reports `populated 0`, then no process from any earlier invocation of this unit remains. A covered member, as defined below, is then absent, whether its leaf path is empty or missing. Processes cannot leave a delegated subtree without write access outside it, which the service account lacks, and the native sandbox already denies cgroup writes. Leftover processes that systemd failed to kill stay inside the subtree, so the proof fails closed. Escapes through host services such as cron are outside both the existing leaf proof and this one.

A member's delegated root is the parent of its recorded leaf path, which every existing ownership identity already stores. The proof covers a member only when that parent equals the supervisor's current delegated root, read from `/proc/self/cgroup`, and the member's recorded host and boot match the current ones. The same rule applies to members written by earlier releases, so no new identity field is needed.

A member recorded under a different delegated root, a different host or an unreadable tree keeps today's `unknown` handling.

## Source issues

The source issue transfers completely only if P025-02 reproduces the failure. Its normal-stop cause then maps to P025-01 and P025-02, its restart recovery to P025-03 to P025-05, its promotion blockage to P025-06, and its fail-closed constraints to P025-04 and P025-07. If the failure cannot be reproduced, the correction still needs every other acceptance ID, but the obligation to determine the mechanism stays in the issue as a partial transfer, with a dated note of the attempts. Its severity (High) and the requirement for real supported-Linux regression evidence are retained. Contract 4's uncertain-operation rule is a stated exception to that issue's instruction not to weaken the promotion gate: it changes only which records count as work, and every runtime, background-mark, active-operation and leftover-process check stays.

The [uncertain-turn issue](../../issues/2026-09-26-034257-uncertain-turn-blocks-deploy.md) transfers completely: its promotion rule and the queued-turn case map to contract 4 and its recheck to P025-06. Its severity (High) is retained. On completion it moves to the archive with a pointer to this plan.

## User and API flows

No API or browser flow changes. The owner-visible effects are:

- Once the installed supervisor unit uses the new stop behavior, a deploy through the [GitHub Actions workflow](../../docs/developer/github-actions-deploy.md) no longer waits for idle runtimes to expire. Conversations with background processes still need **Stop processes** first.
- After a supervisor crash, conversations without an active turn return to a usable state after restart. A turn that was running shows the existing uncertain state.
- `preflight` and `promote` report active and uncertain operations and unknown, protected and idle runtimes as separate counts.
- An uncertain conversation stays uncertain but no longer stops every later deploy.
- A release that changes the generated unit, environment or AppArmor files deploys through the workflow; hand edits to installed files are still refused.

## Contracts, state and security

1. **Unit.** The supervisor unit uses `KillMode=mixed`. As the [systemd.kill documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html) describes that mode, only the main process receives SIGTERM, and systemd sends SIGKILL to the rest of the control group after the main process exits or `TimeoutStopSec` expires. The implementation confirms this on the target host's systemd version. The stop budget must exceed the supervisor's own retirement deadline.
2. **Shutdown sequence.** On SIGTERM the supervisor stops new dispatch and discovery, waits for the running tick with a bound, then retires every retained runtime in parallel, including the discovery probe and any retirement already started by a mailbox failure. A single registry tracks all in-flight retirements, and shutdown awaits it before stopping pg-boss, releasing the fence and ending the pool. A retirement that is unconfirmed at the deadline is recorded as `unknown` while the pool is still open, so the durable state is honest.
3. **Startup proof.** Add the empty-subtree proof above to recovered-member inspection, for covered members only. Every other member keeps today's handling.
4. **Promotion.** `deploy-release` reports active operations, uncertain operations, and idle, protected, unknown and other runtimes separately, alongside background marks. Uncertain operations no longer block promotion: they are durable records that stay uncertain by design, whether or not acknowledged, and that a deploy does not change, and a runtime that might still run such a turn is counted, and blocks, as a runtime. In the personal profiles a turn queued behind an uncertain turn can never start, because dispatch waits while the conversation is uncertain or holds an unacknowledged uncertain operation, which those profiles cannot resolve; the supervisor settles it as never started, with a visible reason and its text kept, so it stops counting as active work. While the installed supervisor unit still reports `KillMode=control-group`, promotion otherwise keeps today's rule, refusing while any runtime or background mark remains, and names the counts; this protects the deploy that installs this change. With `KillMode=mixed`, only idle runtimes and their background marks stop blocking, because the stop retires them in order. Active operations and runtimes in every other state, including protected, unknown, starting and retiring ones, still block: stopping a background process such as a development server stays the owner's decision. The post-stop check still requires zero runtime ownership, background marks, active operations and leftover processes.
5. **Compatibility.** No schema change is expected. Unknown rows written by earlier releases follow the same covered-member rule as new ones.
6. **Generated files.** The workflow runs the candidate's `deploy-release`, which today renders the expected installed files with the candidate's own installer template, so a candidate that changes the generated unit, environment or AppArmor files, such as this plan's `KillMode`, is refused as drift before any count is checked. `deploy-release` instead renders the expected installed files with the installed release's own `infra/personal-vps/harbor-personal`, which release packages include, and the new files with the candidate's. Before loading that template, promotion verifies the installed release against its manifest, as `preflight` does, and it refuses, naming the missing template, if the file is absent. Hand edits to installed files are still refused, and a failed start restores exactly the files that the installed release generated.
7. **Linux lane workflow.** `.github/workflows/personal-vps-linux.yml` runs the personal VPS Linux lane and this plan's Linux contract case on a GitHub-hosted Ubuntu runner, on manual dispatch and on pull requests that change the supervisor, the adapter's local runtime or cgroup code, or `infra/personal-vps/`. It has `permissions: contents: read`, uses no secrets, and never receives the deploy key or any Codex credential.

## Implementation brief

Read D014, the personal runtime capacity section, the source issue and its analysis first. Reproduce the retained-membership failure on actual Linux with the existing unit properties before changing code, and record the timing. A disposable Linux VM or a GitHub-hosted runner through the new workflow below provides systemd, cgroup v2 and delegation. Then change the unit template, the shutdown sequence, the retirement registry, recovered-member inspection, the promotion counts and the promotion's template rendering together, and update the Linux lane that currently asserts `KillMode=control-group`. The new proof's containment argument is a security decision; any deviation returns to main.

## Exact file fence

- `design/proposals/025-clean-supervisor-shutdown-and-restart.md`
- `design/decisions/014-personal-conversation-concurrency.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/004-deployment-and-profiles.md`
- `apps/supervisor/src/main.ts`
- `apps/supervisor/src/retirement.ts`
- `packages/codex-adapter/src/personal-cgroup.ts`
- `packages/codex-adapter/src/local-runtime.ts`
- `infra/personal-vps/harbor-personal`
- `infra/personal-vps/deploy-release`
- `.github/workflows/personal-vps-linux.yml`
- `tests/deployment/personal_vps_test.py`
- `tests/integration/personal-cgroup.test.ts`
- `tests/integration/retirement.test.ts`
- `tests/contract/local-runtime.test.ts`
- `tests/personal-vps/e2e.ts`
- `tests/personal-vps/concurrency.ts`
- `docs/developer/personal-vps.md`
- `docs/developer/github-actions-deploy.md`
- `docs/user/conversations.md`
- `issues/2026-09-21-174500-personal-stop-retained-runtimes.md`
- `issues/archive/2026-09-21-174500-personal-stop-retained-runtimes.md`
- `issues/2026-09-26-034257-uncertain-turn-blocks-deploy.md`
- `issues/archive/2026-09-26-034257-uncertain-turn-blocks-deploy.md`

Main adds the delivery report path when execution starts. Scratch evidence uses run-owned paths under `.test-runs/p025/`.

## Verification and acceptance

All IDs run on actual Linux with systemd, cgroup v2 and delegated units using the installed unit properties, fresh run-owned state and the Codex fixture unless stated.

- **P025-01:** Two conversations finish turns and keep their runtimes, one idle and one protected by a background child. `systemctl stop` of the supervisor leaves zero `conversation_runtimes` rows, no process in the unit subtree and no uncertain session; restart shows no unknown member.
- **P025-02:** Before the fix, the same scenario reproduces unknown membership at least once in a bounded number of attempts, and the timing is recorded; if it cannot be reproduced, main records the attempts in the issue, the diagnosis obligation stays there, and the fix still needs P025-01.
- **P025-03:** SIGKILL of the supervisor main process with retained runtimes and one running turn. After restart, idle members are released through the empty-subtree proof, the running turn is uncertain and not replayed, and a new turn in an idle conversation succeeds.
- **P025-04:** A process deliberately left in an old leaf, or in the unit root, keeps affected members unknown and counted after restart.
- **P025-05:** Unknown rows written by the release installed before this change are released by the first start of the new release when their leaf's parent is the current delegated root and the subtree is empty, and kept when the subtree is not empty or the parent differs.
- **P025-06:** On a candidate instance under `KillMode=mixed`, `deploy-release promote` succeeds with idle runtimes and their background marks present, and with the uncertain turn that P025-03 leaves, which is still uncertain afterwards; a turn queued behind it before the crash is settled as never started and does not block either. It refuses while a protected, unknown or retiring runtime or an active operation exists. Under `KillMode=control-group` it refuses whenever any runtime or background mark remains, as today, but not for an uncertain turn alone. Every refusal names each count separately.
- **P025-07:** A retirement that cannot be confirmed before the shutdown deadline is recorded as `unknown` before the pool closes, and systemd's final SIGKILL still applies.
- **P025-08:** On a candidate instance whose installed release renders `KillMode=control-group`, promoting a release that renders `KillMode=mixed` with the candidate's `deploy-release` succeeds and installs the new unit. An installed file edited by hand is still refused as drift, and a failed start restores the installed release's own files.
- **P025-09:** `pnpm build`, `pnpm check`, `pnpm test`, the full critical `pnpm test:e2e`, the updated personal VPS Linux lane, the P018 concurrency lane and the P024 attachment lane pass. `pnpm test:contract` passes on Linux, including a retirement case that starts the pinned Codex binary with an empty private home and no account inside a delegated leaf and stops the supervisor. A bounded live smoke check of one turn followed by a supervisor stop runs on the VPS host in a separate run-owned candidate instance, never the installed supervisor, started over SSH from the owner's machine, under the owner's standing authorization for the VPS Codex credential copied into fresh run-owned state there; the credential never leaves the host or reaches GitHub. If it cannot run, P025 stays Accepted with the [live runtime credentials issue](../../issues/2026-09-07-171225-live-runtime-credentials.md) linked.

Gate: behavioral, with the actual Linux isolation lane for the changed launch and retirement boundary, plus pinned-runtime contracts and a bounded live smoke check because adapter launch code changes. Fixture or macOS evidence cannot substitute. A final bounded installed check on the owner's VPS needs the owner's go-ahead.

## Rollout and recovery

The workflow runs the candidate's `deploy-release`, so the deploy that installs this change already uses its template rendering and uncertain-operation rule. It still stops the old unit with `KillMode=control-group`, so promotion keeps today's rule for runtimes and background marks and needs every retained runtime gone first; `preflight` shows when that holds. Unknown members that already exist block that deploy, as they do today. Only the new release carries the proof, so clearing them first needs the existing reboot recovery with the owner's approval. No migration is expected, so a failed start restores the previous release automatically.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
