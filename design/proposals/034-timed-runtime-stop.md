# P034 — Timed stop for idle and background runtimes

## Metadata

- ID: P034
- Status: Draft
- Priority: Not set by the owner. Main suggests High, beside the review's High plans; the owner confirms or changes it.
- Created: 2026-09-26
- Owner: Main conversation; future implementation owner unassigned
- Outcome: In the personal VPS profile, a retained Codex runtime with nothing else running stops 15 minutes after its conversation's last execution activity, and a runtime whose background processes are still running stops, with those processes, 2 hours after that activity. The owner can see when each stop will happen. Both times are instance settings with those defaults, and the background stop can be turned off.
- Authorization: On 26 September 2026 the owner chose main's recommended option in the project thread: 15 minutes for idle runtimes and 2 hours for background processes, both adjustable. That choice authorized drafting this plan as Draft. Implementation, commits to `main`, deployment and any live-host action need the owner's separate go-ahead.
- Baseline: Source inspection of `c7dd784f25b132b4e4fc4d3e08114905ff1389c7`; nothing was run for this plan.
- Dependencies: Delegated cgroup ownership, protected classification and targeted stop from [P018](archive/018-concurrent-conversations-and-runtime-capacity.md) are implemented and deployed. Acceptance needs an actual Linux host with systemd, cgroup v2 and delegation for the personal VPS lanes; missing Linux evidence blocks completion. No dependency on other drafts. Most drafts edit some of the same files, notably [P025](025-clean-supervisor-shutdown-and-restart.md) and [P033](033-interface-clarity-and-phone-fit.md), so they run one at a time, as D013 requires. Changing the two settings on an existing instance depends on the [reconfiguration issue](../../issues/2026-09-26-074653-personal-vps-reconfiguration.md), which no plan covers yet; it does not block this plan, whose defaults are the owner's chosen values.
- Source issues: None; this is an owner request. The [reconfiguration issue](../../issues/2026-09-26-074653-personal-vps-reconfiguration.md) records a related gap that this plan does not fix.
- Design references: [D014 idle classification and retirement](../decisions/014-personal-conversation-concurrency.md#idle-classification-and-retirement), [personal runtime capacity](../systems/001-conversations-and-access.md#personal-runtime-capacity), [deployment and profiles](../systems/004-deployment-and-profiles.md), the "Personal conversation runtime states" section of the [token and interaction guide](../design-tokens.html), and the [personal VPS guide](../../docs/developer/personal-vps.md#development-policy-and-upgrade-compatibility).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P034-01–P034-12.

## Problem, outcome and exclusions

Each successful turn in a personal profile keeps its conversation's Codex runtime, so the next message can reuse it. [D014](../decisions/014-personal-conversation-concurrency.md#idle-classification-and-retirement) stops an ordinary idle runtime at most 30 minutes after its last execution activity, and the code fixes that time at exactly 30 minutes in [conversation-runtimes.ts](../../packages/storage/src/conversation-runtimes.ts). A runtime whose conversation left a background process running, such as a development server, is protected and has no automatic expiry. It stays until its background processes exit, after which it expires like an idle runtime, or until something stops it: **Stop processes**, archiving the conversation, an emergency stop, a credential change, a new turn with different permissions, or a supervisor stop. On 26 September 2026 the owner said that they expected idle processes to stop after about 15 minutes and that processes seem to live forever. The read-only preflight at 19:21 UTC on 25 September reported four retained runtimes and none idle, so each was protected or unknown, as the [project review](../../docs/reports/2026-09-25-project-review.md#shutdown-and-deploy-safety) records. Every retained runtime holds one of the runtime slots, four by default, and the current promotion rule refuses every deploy while any runtime remains.

After this change:

1. An idle runtime stops 15 minutes after its conversation's last execution activity by default, or earlier when another conversation needs its slot, as today.
2. A protected runtime and its background processes stop 2 hours after that activity by default, through the same confirmed retirement as **Stop processes**. A new turn in the conversation before then moves both times.
3. The conversation's Status dialog shows when Harbor will stop its runtime, or that background processes run until **Stop processes** when the background stop is off.
4. Both times are instance settings with these defaults, and the background stop can be turned off. A new installation can set them. Changing them on the owner's existing instance needs the supported reconfiguration path that the [reconfiguration issue](../../issues/2026-09-26-074653-personal-vps-reconfiguration.md) records, so until then the defaults apply there.
5. After either stop the conversation keeps its history, and the next message continues the same native thread, as after **Stop processes** today.
6. Once two hours have passed since the last turn in every conversation, a deploy no longer needs manual stops, unless a runtime is unknown.

Excluded: unknown runtimes, which keep no expiry because Harbor cannot confirm what it would stop ([P025](025-clean-supervisor-shutdown-and-restart.md) proposes their release); runtimes that are starting, active, waiting for approval or input, or retiring; capacity reclaim, which still takes only idle runtimes; the managed profile, which already retires a runtime after each turn; a way to change the configuration of an existing instance, which the reconfiguration issue records; a transcript notice after a timed stop, because the preview's "Preview unavailable" message already asks the owner to start the server again; naming the processes that keep a runtime protected; counting preview viewing as activity, which D014 excludes along with polling and metadata; a settings page in the browser; and any change to `deploy-release`.

## Dependencies and current design

D014 says that ordinary idle expires after at most 30 minutes and that protected and unknown runtimes have no automatic expiry. The [personal runtime capacity](../systems/001-conversations-and-access.md#personal-runtime-capacity) section and the token guide repeat both rules, and [design 004](../systems/004-deployment-and-profiles.md) states that background services do not expire merely because 30 minutes elapsed and that the administrator limits propagate through local startup and VPS rendering. This plan keeps the 30-minute ceiling for idle runtimes, lowers the default to 15 minutes and adds a timed stop for protected runtimes. It is recorded as a dated D014 amendment and carried into designs 001 and 004 and the token guide. Unknown runtimes keep today's rules.

D014 already lets targeted stop, archive, emergency stop, credential replacement and graceful shutdown request protected retirement with the same confirmation. The timed stop becomes one more such request. It sets the same stop request that **Stop processes** sets, and the supervisor's existing tick retires the runtime through `cgroup.kill`, `populated=0` and a committed release. A retirement that cannot be confirmed leaves the member unknown and counted, as it does for **Stop processes** today.

## Source issues

None. No inbox record transfers to this plan.

## User and API flows

- **Status dialog.** For an idle runtime it states the stop time and that the runtime may stop earlier if another conversation needs its slot. For a protected runtime it states that background processes are still running and the time Harbor will stop them unless a new message arrives first, and **Stop processes** stays available to stop them now. With the background stop off, it states that they run until **Stop processes**.
- **Sidebar.** The dot and its tooltip keep today's state names.
- **While a stop is under way.** From the timed stop request until the processes are confirmed stopped, the conversation shows the existing "Stopping background processes…" state, and a new message is refused with the existing "Wait for background development processes to stop before continuing" error, exactly as after **Stop processes**. The owner sends it again once the stop finishes.
- **After a stop.** The dot clears, and the next message starts a new runtime in the same native thread. A preview of a stopped development server shows its existing "Preview unavailable" message, which asks the owner to start the server again.
- **If a stop cannot be confirmed.** The runtime shows the existing "Runtime state unknown" state and stays counted until a later check proves its processes gone, exactly as after an unconfirmed **Stop processes**.
- **API.** The conversation's `runtime.idleUntil` in the browser snapshot and event stream also carries the stop time of a protected runtime, and is null when no automatic stop applies. A timed stop records the same `background.stop-requested` event as **Stop processes**, with `reason: "background_timeout"`. The personal VPS profile has no API tokens, so no token route changes.

## Contracts, state and security

1. **Settings.** `HARBOR_RUNTIME_IDLE_MINUTES` is an integer from 1 to 30, default 15. `HARBOR_BACKGROUND_STOP_MINUTES` is an integer from 0 to 1440, default 120; 0 turns the background stop off, and any other value must be at least the idle time. Both are parsed in the shared configuration like the runtime limits, and an invalid value stops startup with a clear error. Local development startup passes both through, as it passes the runtime limits. The installer accepts optional `runtimeIdleMinutes` and `backgroundStopMinutes` fields in a new installation's configuration, validates them the same way, and renders them into both services' environment only when set. An instance without them therefore keeps byte-identical generated files, so the current promotion's drift check does not refuse the deploy that installs this change.
2. **Stop times.** When the supervisor records a runtime state, it stores the automatic stop time in the existing `idle_until` column. For `idle` this is the last execution activity plus the idle setting; entering `idle` from any other state always recomputes it, so a runtime whose background processes exit never keeps its protected time. For `protected`, while the background stop is on, it is the last execution activity plus the background setting. Every other state stores none. Execution activity keeps its current meaning, which is turn start and completion and approval or input changes; viewing, polling, status reads and preview access never move it. A changed setting applies to states recorded after the supervisor restarts with it. No schema change.
3. **Idle stop.** Only the time changes. The tick still retires an idle runtime whose stop time has passed after a fresh empty inspection, and capacity reclaim still takes idle runtimes oldest activity first.
4. **Background stop.** On each tick, for a protected runtime whose stop time has passed, the supervisor rechecks under the session lock that the member is still protected with the same generation, stop time and last activity, that no operation in that conversation is queued, dispatching, running or waiting for approval or input, and that no stop is already requested. It then sets the same stop request as **Stop processes** and records `background.stop-requested` with the generation and the timeout reason. The existing retirement path, its refusal of new messages while stopping, and its unconfirmed outcome apply unchanged. A turn that arrives first wins, because its activity moves the stop time and a queued turn blocks the request.
5. **Background mark.** The background mark set when a turn completes, and the `expiresIn` of its `background.retained` event, follow the idle setting instead of a fixed 30 minutes.
6. **Interface.** `runtimeDescription` in the web client states the stop time for idle and protected runtimes and the off-switch text, as described under User and API flows, and its idle text no longer falls back to a fixed 30 minutes. The OpenAPI description of `idleUntil` says that it is the automatic stop time for idle and protected runtimes and null when none applies. This changes text only, in existing components; the token guide and the prototype's matching strings are updated in the same change, and no new token, component or state is added. If [P033](033-interface-clarity-and-phone-fit.md) has already reworded these strings, the new text follows its style, and any reviewed strings it recorded in [design 006](../systems/006-interface.md) change there too.

Security: no permission, path, mount or network exposure changes. A timed stop targets only the exact generation-owned cgroup, through the same confirmation as **Stop processes**, and never signals a recovered process ID. Unknown runtimes are never stopped by time. Both settings are administrator configuration and cannot be set through the API.

## Implementation brief

Read D014, the personal runtime capacity section, design 004's personal profile text, the token guide's personal runtime section, [runtime-capacity.ts](../../apps/supervisor/src/runtime-capacity.ts), [conversation-runtimes.ts](../../packages/storage/src/conversation-runtimes.ts) and the personal branch of the supervisor tick in [main.ts](../../apps/supervisor/src/main.ts) first. Add a pure helper that computes a member's stop time and whether a protected member is due, and cover it with unit tests. Then add the settings, their local startup pass-through and the installer fields, pass the settings to `runtimeState`, add the background stop beside the existing idle stop in the tick, update the background mark, the client text and the OpenAPI description, and update the designs and guides.

Add a `--timed-stop` mode to the personal VPS lane that runs this plan's scenarios in fresh run-owned instances: one with the idle time at 1 minute and the background time at 2 minutes, and one with the background stop off. The existing concurrency lane sets the idle time to 30 minutes, so its eviction and protected-capacity scenarios keep their current timing. Production code gains no clock hook. A deviation from D014's retirement confirmation returns to main.

## Exact file fence

- `design/proposals/034-timed-runtime-stop.md`
- `design/decisions/014-personal-conversation-concurrency.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/api/src/config.ts`
- `apps/supervisor/src/main.ts`
- `apps/supervisor/src/runtime-capacity.ts`
- `packages/storage/src/conversation-runtimes.ts`
- `packages/contracts/src/openapi.ts`
- `apps/web/src/api.ts`
- `infra/personal-vps/harbor-personal`
- `scripts/local-dev.ts`
- `tests/integration/conversation-runtime-config.test.ts`
- `tests/integration/conversation-runtime-capacity.test.ts`
- `tests/deployment/personal_vps_test.py`
- `tests/personal-vps/e2e.ts`
- `tests/personal-vps/timed-stop.ts`
- `docs/user/conversations.md`
- `docs/developer/personal-vps.md`
- `docs/developer/local-personal.md`
- `docs/developer/github-actions-deploy.md`

Main adds the delivery report path when execution starts. Scratch evidence uses run-owned paths under `.test-runs/p034/`.

## Verification and acceptance

P034-03 to P034-10 run in the new `--timed-stop` lane on actual Linux with systemd, cgroup v2 and delegated units, fresh run-owned state and the Codex fixture, with the idle time at 1 minute and the background time at 2 minutes unless stated. "Within its time" below allows 30 seconds for the kill, confirmation and release.

- **P034-01:** Configuration defaults to 15 and 120 minutes; values outside the ranges, non-integers, and an enabled background time below the idle time stop startup; local development startup passes both settings through. The installer accepts, validates and renders both optional fields, and a configuration without them renders files byte-identical to the baseline release's rendering of the same configuration.
- **P034-02:** The stop-time helper returns the idle and protected times from the last execution activity, recomputes the idle time on entering idle from protected, returns none for every other state and for protected with the background stop off, and reports a protected member due only after its time.
- **P034-03:** A conversation finishes a turn with nothing left running. Its runtime is released within its idle time, its dot clears, and a new message continues the same native thread.
- **P034-04:** A conversation finishes a turn that leaves a background child running, beside a sibling conversation that also keeps one. Status shows the protected stop time. Within its time after it passes, `background.stop-requested` is recorded with `reason: "background_timeout"`, the child and the runtime stop, the cgroup is confirmed empty, membership and the background mark are cleared, and the sibling's runtime and processes are untouched. Once the sibling is stopped too, the ownership counts that `deploy-release` checks are all zero, and a new message continues the same native thread.
- **P034-05:** A turn in the protected conversation before its stop time moves the time; a turn queued in that conversation when the time passes prevents the stop request; opening Status, polling and preview access do not move the time.
- **P034-06:** A background child that exits before the protected time leaves an idle runtime whose stop time is the last execution activity plus the idle time, and the runtime stops within that time rather than at the protected time.
- **P034-07:** Runtimes that are active, waiting for approval or input, starting, retiring or unknown are never stopped by either timer.
- **P034-08:** In a separate fresh instance with the background stop off, a protected runtime stays until **Stop processes**, as today, and Status shows the off-switch text.
- **P034-09:** A message sent while a timed stop is under way gets the existing refusal and succeeds after the release. A supervisor restart while a timed stop request is pending leaves the same durable state as a restart while a **Stop processes** request is pending. The timed stop reaches retirement only through that stop request, so the existing unconfirmed-retirement tests in `tests/integration/background-retirement.test.ts` cover its unconfirmed outcome.
- **P034-10:** The Status dialog shows the idle, protected and off-switch texts at desktop and phone widths, and the rendered prototype shows the same strings.
- **P034-11:** D014 carries a dated amendment, and designs 001 and 004, the token guide, the user conversations guide, the personal VPS and local guides and the deploy guide state the new times, the off switch, the unchanged unknown rule and the reconfiguration limit. If P025 is already implemented, the deploy guide's statement that background processes need **Stop processes** before a deploy also names the background stop.
- **P034-12:** `pnpm build`, `pnpm check`, `pnpm test`, the full critical `pnpm test:e2e`, the installer contracts in `python3 -m unittest discover -s tests/deployment -p '*_test.py'`, the personal VPS Linux lane `node --import tsx tests/personal-vps/e2e.ts`, its concurrency lane `node --import tsx tests/personal-vps/e2e.ts --concurrency` and the new `node --import tsx tests/personal-vps/e2e.ts --timed-stop` pass.

Gate: behavioral, with actual Linux lanes for the changed retirement timing. The adapter, launch, sandbox, cgroup and native contract files are unchanged between `817c3d0`, which delivered P018, and the baseline. The pinned native contracts recorded under [sixth-candidate verification](../../docs/reports/2026-09-21-p018-concurrency.md#sixth-candidate-verification-and-fixes) passed 28 of 28 checks on snapshot 04 (source digest `076b2b8538f3adfe2ea296292f564097f039268074f1eecc027151af714327b0`), in a delegated nonroot systemd unit with Codex 0.153.4, and mapped real idle, sleep and preview processes through their owned cgroup. That report limits the evidence to those boundaries and says that later supervisor integration changes do not inherit it, and its receipts under `.test-runs/p018/` are not in this checkout. This plan reuses it only for process inspection and cgroup retirement; its own supervisor timing needs the lanes above, and no live Codex check is needed. A final bounded installed check on the owner's VPS needs the owner's go-ahead.

## Rollout and recovery

No migration. The deploy that installs this change follows the current promotion rule, so every retained runtime must be gone first, as `preflight` shows. After it, both default times apply. The owner's existing instance does not set the two optional fields and has no supported way to add them, as the [reconfiguration issue](../../issues/2026-09-26-074653-personal-vps-reconfiguration.md) records, so it runs with the defaults until that issue is fixed. Rolling back to an earlier release is unaffected for an instance that does not set them, which includes the owner's.

## Review and findings

Draft plan review, 26 September 2026: fresh-context design and provenance reviewers checked the draft at `8a0fbca`. The design reviewer reported one blocker, that the plan promised a way to change the settings on the existing instance that the installer does not offer, and ten other findings; the provenance reviewer reported the same gap and seven smaller findings. Main applied every scoped finding: the gap is now stated as a limit and recorded in the reconfiguration issue, and the stop-time recomputation, the stopping and unconfirmed states, design 004, local startup, a separate test lane, the evidence reuse and the wording were corrected. An optional, unrelated note about the historical D012 was left as is.

Execution review is pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
