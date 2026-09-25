# P025 — Clean supervisor shutdown and restart

## Metadata

- ID: P025
- Status: Draft
- Priority: P0, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Stopping, restarting or redeploying the personal VPS supervisor leaves no unknown runtime membership, so a deploy soon after use succeeds and a crash restart recovers capacity without a host reboot.
- Authorization: Proposal writing only. Implementation, commits to `main`, deployment and any live-host action need the owner's separate go-ahead.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529`; no reproduction has run.
- Dependencies: Delegated cgroup ownership from [P018](archive/018-concurrent-conversations-and-runtime-capacity.md) is implemented and deployed. Acceptance needs an actual Linux host with systemd, cgroup v2 and delegation, which a disposable VM or a GitHub-hosted runner may provide; missing Linux evidence blocks completion. No dependency on other drafts.
- Source issues: [Personal service stop retains runtimes](../../issues/2026-09-21-174500-personal-stop-retained-runtimes.md), all obligations.
- Design references: [D014 idle classification and retirement](../decisions/014-personal-conversation-concurrency.md#idle-classification-and-retirement), [personal runtime capacity](../systems/001-conversations-and-access.md#personal-runtime-capacity), [deployment and profiles](../systems/004-deployment-and-profiles.md), [GitHub Actions deployment](../../docs/developer/github-actions-deploy.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P025-01–P025-08.

## Problem, outcome and exclusions

The owner's instance retains an idle Codex runtime for up to 30 minutes after each successful turn. The [source analysis](../../issues/2026-09-21-174500-personal-stop-retained-runtimes.md#source-analysis--25-september-2026) traces how a normal `systemctl stop` can leave those runtimes recorded as unknown: `KillMode=control-group` signals every process at once, the resulting mailbox failures start retirements that `stop()` never awaits, the database pool closes under them, and the next start cannot prove absence because the leaf cgroups are gone. `deploy-release promote` then refuses every later deploy, and the only verified recovery so far is a host reboot.

After this change:

1. A normal stop retires every retained runtime in order and commits its release before the process exits.
2. A deploy after recent use succeeds without the owner first stopping processes by hand.
3. After an abrupt supervisor death, the next start releases membership whose processes are provably gone, without a reboot, while any interrupted turn stays visibly uncertain.
4. Each refusal names the actual blocker, so the owner can tell unknown membership apart from active work.

Excluded: explicit uncertain-work recovery for personal profiles, replaying interrupted turns, macOS lifecycle support, managed-profile shutdown and any weakening of the promotion gate's all-zero post-stop check.

## Dependencies and current design

D014 requires that a retiring member holds capacity until `cgroup.kill`, `populated=0` and a committed release, and that restart release membership only for a verified empty generation cgroup or a changed boot. It explicitly rejects a missing path alone as proof. This plan keeps both rules and adds one proof, recorded as a dated D014 amendment:

- **Empty delegated subtree.** At startup, before the supervisor creates any conversation leaf, it reads its own delegated root. If the root and the supervisor's own manager leaf contain no process other than the supervisor, and every other descendant cgroup reports `populated 0`, then no process from any earlier invocation of this unit remains. A recorded member whose identity names this same delegated root is then absent, whether its leaf path is empty or missing. Processes cannot leave a delegated subtree without write access outside it, which the service account lacks, and the native sandbox already denies cgroup writes. Leftover processes that systemd failed to kill stay inside the subtree, so the proof fails closed. Escapes through host services such as cron are outside both the existing leaf proof and this one.

A member recorded under a different delegated root, a different host or an unreadable tree keeps today's `unknown` handling.

## Source issues

The single source issue transfers completely on acceptance: its normal-stop cause maps to P025-01 and P025-02, its restart recovery to P025-03 to P025-05, its promotion blockage to P025-06, and its fail-closed constraints to P025-04 and P025-07. Its severity (High) and the requirement for real supported-Linux regression evidence are retained.

## User and API flows

No API or browser flow changes. The owner-visible effects are:

- A deploy through the [GitHub Actions workflow](../../docs/developer/github-actions-deploy.md) no longer needs the manual "Stop processes, then deploy" workaround once the installed supervisor unit uses the new stop behavior.
- After a supervisor crash, conversations without an active turn return to a usable state after restart. A turn that was running shows the existing uncertain state.
- `preflight` and `promote` report unknown members, idle members and active work as separate counts.

## Contracts, state and security

1. **Unit.** The supervisor unit uses `KillMode=mixed`. As the [systemd.kill documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html) describes that mode, only the main process receives SIGTERM, and systemd sends SIGKILL to the rest of the control group after the main process exits or `TimeoutStopSec` expires. The implementation confirms this on the target host's systemd version. The stop budget must exceed the supervisor's own retirement deadline.
2. **Shutdown sequence.** On SIGTERM the supervisor stops new dispatch and discovery, waits for the running tick with a bound, then retires every retained runtime in parallel, including the discovery probe and any retirement already started by a mailbox failure. A single registry tracks all in-flight retirements, and shutdown awaits it before stopping pg-boss, releasing the fence and ending the pool. A retirement that is unconfirmed at the deadline is recorded as `unknown` while the pool is still open, so the durable state is honest.
3. **Startup proof.** Add the empty-subtree proof above to recovered-member inspection. Record the delegated root path in new ownership identities; members without it use the existing rules.
4. **Promotion.** `deploy-release` reports `unknownRuntimes` separately. While the installed supervisor unit still reports `KillMode=control-group`, promotion refuses when idle runtimes exist and tells the owner to stop them first; this protects the deploy that installs this change. With `KillMode=mixed`, idle runtimes are allowed because the stop retires them. The post-stop all-zero check is unchanged.
5. **Compatibility.** No schema change is expected. Existing unknown rows are released on the first start after upgrade only when the proof holds.

## Implementation brief

Read D014, the personal runtime capacity section, the source issue and its analysis first. Reproduce the retained-membership failure on actual Linux with the existing unit properties before changing code, and record the timing. Then change the unit template, the shutdown sequence, the retirement registry, recovered-member inspection and the promotion counts together, and update the Linux lane that currently asserts `KillMode=control-group`. The new proof's containment argument is a security decision; any deviation returns to main.

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
- `tests/deployment/personal_vps_test.py`
- `tests/integration/personal-cgroup.test.ts`
- `tests/integration/retirement.test.ts`
- `tests/personal-vps/e2e.ts`
- `tests/personal-vps/concurrency.ts`
- `docs/developer/personal-vps.md`
- `docs/developer/github-actions-deploy.md`
- `docs/user/conversations.md`
- `issues/2026-09-21-174500-personal-stop-retained-runtimes.md`
- `issues/archive/2026-09-21-174500-personal-stop-retained-runtimes.md`

Main adds the delivery report path when execution starts. Scratch evidence uses run-owned paths under `.test-runs/p025/`.

## Verification and acceptance

All IDs run on actual Linux with systemd, cgroup v2 and delegated units using the installed unit properties, fresh run-owned state and the Codex fixture unless stated.

- **P025-01:** Two conversations finish turns and keep idle runtimes, one with a protected background child. `systemctl stop` of the supervisor leaves zero `conversation_runtimes` rows, no process in the unit subtree and no uncertain session; restart shows no unknown member.
- **P025-02:** Before the fix, the same scenario reproduces unknown membership at least once in a bounded number of attempts, and the timing is recorded; if it cannot be reproduced, main records the attempts and the fix still needs P025-01.
- **P025-03:** SIGKILL of the supervisor main process with retained runtimes and one running turn. After restart, idle members are released through the empty-subtree proof, the running turn is uncertain and not replayed, and a new turn in an idle conversation succeeds.
- **P025-04:** A process deliberately left in an old leaf, or in the unit root, keeps affected members unknown and counted after restart.
- **P025-05:** Pre-existing unknown rows, created with the old identity format, are released by the first start of the new release when the subtree is empty and kept when it is not.
- **P025-06:** On a candidate instance, `deploy-release promote` succeeds with idle runtimes present under `KillMode=mixed`, refuses with the new message under `KillMode=control-group`, and reports unknown members separately.
- **P025-07:** A retirement that cannot be confirmed before the shutdown deadline is recorded as `unknown` before the pool closes, and systemd's final SIGKILL still applies.
- **P025-08:** `pnpm build`, `pnpm check`, `pnpm test`, the updated personal VPS Linux lane, the P018 concurrency lane and the P024 attachment lane pass.

Gate: behavioral, with the actual Linux isolation lane for the changed launch and retirement boundary. Fixture or macOS evidence cannot substitute. A final bounded installed check on the owner's VPS needs the owner's go-ahead.

## Rollout and recovery

Before the deploy that installs this change, `preflight` must show zero idle and unknown runtimes, because the old supervisor still uses the old stop path; the new promotion check enforces this. No migration is expected, so a failed start restores the previous release automatically. If unknown membership already exists on the live instance, the first start of the new release may release it through the new proof; otherwise the reboot recovery remains available with the owner's approval.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
