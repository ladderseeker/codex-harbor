# P034 — Timed stop for idle and background runtimes

## Metadata

- ID: P034
- Status: Draft
- Priority: High, recommended on 26 September 2026 after the owner chose this policy in the project thread; the owner confirms or changes it.
- Created: 2026-09-26
- Owner: Main conversation; future implementation owner unassigned
- Outcome: In the personal VPS profile, a retained Codex runtime with nothing else running stops 15 minutes after its conversation's last execution activity, and a runtime whose background processes are still running stops, with those processes, 2 hours after that activity. The owner can see when each stop will happen and can change both times or turn the background stop off.
- Authorization: On 26 September 2026 the owner chose this policy (15 minutes for idle runtimes, 2 hours for background processes, both adjustable) and asked for this plan. Proposal writing only. Implementation, commits to `main`, deployment and any live-host action need the owner's separate go-ahead.
- Baseline: Source inspection of `c7dd784f25b132b4e4fc4d3e08114905ff1389c7`; nothing was run for this plan.
- Dependencies: Delegated cgroup ownership, protected classification and targeted stop from [P018](archive/018-concurrent-conversations-and-runtime-capacity.md) are implemented and deployed. Acceptance needs an actual Linux host with systemd, cgroup v2 and delegation for the personal VPS lane; missing Linux evidence blocks completion. No dependency on other drafts. [P025](025-clean-supervisor-shutdown-and-restart.md) edits several of the same files, so the two run one after the other, in either order.
- Source issues: None; this is an owner request.
- Design references: [D014 idle classification and retirement](../decisions/014-personal-conversation-concurrency.md#idle-classification-and-retirement), [personal runtime capacity](../systems/001-conversations-and-access.md#personal-runtime-capacity), the "Personal conversation runtime states" section of the [token and interaction guide](../design-tokens.html), and the [personal VPS guide](../../docs/developer/personal-vps.md#development-policy-and-upgrade-compatibility).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P034-01–P034-09.

## Problem, outcome and exclusions

Each successful turn in a personal profile keeps its conversation's Codex runtime, so the next message can reuse it. [D014](../decisions/014-personal-conversation-concurrency.md#idle-classification-and-retirement) stops an ordinary idle runtime at most 30 minutes after its last execution activity, and the code fixes that time at exactly 30 minutes in [conversation-runtimes.ts](../../packages/storage/src/conversation-runtimes.ts). A runtime whose conversation left a background process running, such as a development server, is protected and has no automatic expiry: only **Stop processes**, archiving the conversation or stopping the supervisor ends it. On 26 September 2026 the owner said that they expected idle processes to stop after about 15 minutes and that processes seem to live forever. The read-only preflight at 19:21 UTC on 25 September reported four retained runtimes and none idle, so each was protected or unknown, as the [project review](../../docs/reports/2026-09-25-project-review.md#shutdown-and-deploy-safety) records. Every retained runtime holds one of the runtime slots, four by default, and the current promotion rule refuses every deploy while any runtime remains.

After this change:

1. An idle runtime stops 15 minutes after its conversation's last execution activity by default, or earlier when another conversation needs its slot, as today.
2. A protected runtime and its background processes stop 2 hours after that activity by default, through the same confirmed retirement as **Stop processes**. A new turn in the conversation before then moves both times.
3. The conversation's Status dialog shows when Harbor will stop its runtime, or that background processes run until **Stop processes** when the background stop is off.
4. The owner can set both times in the instance configuration and can turn the background stop off.
5. After either stop the conversation keeps its history, and the next message continues the same native thread, as after **Stop processes** today.
6. Once two hours have passed since the last turn in every conversation, a deploy no longer needs manual stops, unless a runtime is unknown.

Excluded: unknown runtimes, which keep no expiry because Harbor cannot confirm what it would stop ([P025](025-clean-supervisor-shutdown-and-restart.md) proposes their release); runtimes that are starting, active, waiting for approval or input, or retiring; capacity reclaim, which still takes only idle runtimes; the managed profile, which already retires a runtime after each turn; a transcript notice after a timed stop, because the preview's "Preview unavailable" message already asks the owner to start the server again; naming the processes that keep a runtime protected; counting preview viewing as activity, which D014 excludes along with polling and metadata; a settings page in the browser; and any change to `deploy-release`.

## Dependencies and current design

D014 says that ordinary idle expires after at most 30 minutes and that protected and unknown runtimes have no automatic expiry. The [personal runtime capacity](../systems/001-conversations-and-access.md#personal-runtime-capacity) section and the token guide repeat both rules. This plan keeps the 30-minute ceiling for idle runtimes, lowers the default to 15 minutes and adds a timed stop for protected runtimes. It is recorded as a dated D014 amendment and carried into design 001 and the token guide. Unknown runtimes keep today's rules.

D014 already lets targeted stop, archive, emergency stop, credential replacement and graceful shutdown request protected retirement with the same confirmation. The timed stop becomes one more such request. It sets the same stop request that **Stop processes** sets, and the supervisor's existing tick retires the runtime through `cgroup.kill`, `populated=0` and a committed release. A retirement that cannot be confirmed leaves the member unknown and counted, as it does for **Stop processes** today.

## Source issues

None. No inbox record changes.

## User and API flows

- **Status dialog.** For an idle runtime it states the stop time and that the runtime may stop earlier if another conversation needs its slot. For a protected runtime it states that background processes are still running and the time Harbor will stop them unless a new message arrives first, and **Stop processes** stays available to stop them now. With the background stop off, it states that they run until **Stop processes**.
- **Sidebar.** The dot and its tooltip keep today's state names.
- **After a stop.** The dot clears, and the next message starts a new runtime in the same native thread. A preview of a stopped development server shows its existing "Preview unavailable" message, which asks the owner to start the server again.
- **API.** The conversation's `runtime.idleUntil` also carries the stop time of a protected runtime, and is null when no automatic stop applies. A timed stop records the same `background.stop-requested` event as **Stop processes**, with `reason: "background_timeout"`. Token-authenticated reads of the snapshot and events carry both.

## Contracts, state and security

1. **Settings.** `HARBOR_RUNTIME_IDLE_MINUTES` is an integer from 1 to 30, default 15. `HARBOR_BACKGROUND_STOP_MINUTES` is an integer from 0 to 1440, default 120; 0 turns the background stop off, and any other value must be at least the idle time. Both are parsed in the shared configuration like the runtime limits, and an invalid value stops startup with a clear error. The installer accepts optional `runtimeIdleMinutes` and `backgroundStopMinutes` fields, validates them the same way, and renders them into both services' environment only when set. An instance without them therefore keeps byte-identical generated files, so the current promotion's drift check does not refuse the deploy that installs this change.
2. **Stop times.** When the supervisor records a runtime state, it stores the automatic stop time in the existing `idle_until` column. For `idle` this is the last execution activity plus the idle setting. For `protected`, while the background stop is on, it is the last execution activity plus the background setting. Every other state stores none. Execution activity keeps its current meaning, which is turn start and completion and approval or input changes; viewing, polling, status reads and preview access never move it. A changed setting applies to states recorded after the supervisor restarts with it. No schema change.
3. **Idle stop.** Only the time changes. The tick still retires an idle runtime whose stop time has passed after a fresh empty inspection, and capacity reclaim still takes idle runtimes oldest activity first.
4. **Background stop.** On each tick, for a protected runtime whose stop time has passed, the supervisor rechecks under the session lock that the member is still protected with the same generation, stop time and last activity, that no operation in that conversation is queued, dispatching, running or waiting for approval or input, and that no stop is already requested. It then sets the same stop request as **Stop processes** and records `background.stop-requested` with the generation and the timeout reason. The existing retirement path does the rest. A turn that arrives first wins, because its activity moves the stop time and a queued turn blocks the request.
5. **Background mark.** The background mark set when a turn completes, and the `expiresIn` of its `background.retained` event, follow the idle setting instead of a fixed 30 minutes.
6. **Interface.** `runtimeDescription` in the web client states the stop time for idle and protected runtimes, as described under User and API flows. The OpenAPI description of `idleUntil` says that it is the automatic stop time for idle and protected runtimes and null when none applies. This changes text only, in existing components; the token guide and the prototype's matching strings are updated in the same change, and no new token, component or state is added. If [P033](033-interface-clarity-and-phone-fit.md) has already reworded these strings, the new text follows its style.

Security: no permission, path, mount or network exposure changes. A timed stop targets only the exact generation-owned cgroup, through the same confirmation as **Stop processes**, and never signals a recovered process ID. Unknown runtimes are never stopped by time. Both settings are administrator configuration and cannot be set through the API.

## Implementation brief

Read D014, the personal runtime capacity section, the token guide's personal runtime section, [runtime-capacity.ts](../../apps/supervisor/src/runtime-capacity.ts), [conversation-runtimes.ts](../../packages/storage/src/conversation-runtimes.ts) and the personal branch of the supervisor tick in [main.ts](../../apps/supervisor/src/main.ts) first. Add a pure helper that computes a member's stop time and whether a protected member is due, and cover it with unit tests. Then add the settings and installer fields, pass the settings to `runtimeState`, add the background stop beside the existing idle stop in the tick, update the background mark, the client text and the OpenAPI description, and update the designs and guides. Tests set short values, such as 1 and 2 minutes, through the configuration; production code gains no clock hook. A deviation from D014's retirement confirmation returns to main.

## Exact file fence

- `design/proposals/034-timed-runtime-stop.md`
- `design/decisions/014-personal-conversation-concurrency.md`
- `design/systems/001-conversations-and-access.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/api/src/config.ts`
- `apps/supervisor/src/main.ts`
- `apps/supervisor/src/runtime-capacity.ts`
- `packages/storage/src/conversation-runtimes.ts`
- `packages/contracts/src/openapi.ts`
- `apps/web/src/api.ts`
- `infra/personal-vps/harbor-personal`
- `tests/integration/conversation-runtime-config.test.ts`
- `tests/integration/conversation-runtime-capacity.test.ts`
- `tests/deployment/personal_vps_test.py`
- `tests/personal-vps/e2e.ts`
- `tests/personal-vps/concurrency.ts`
- `docs/user/conversations.md`
- `docs/developer/personal-vps.md`
- `docs/developer/local-personal.md`
- `docs/developer/github-actions-deploy.md`

Main adds the delivery report path when execution starts. Scratch evidence uses run-owned paths under `.test-runs/p034/`.

## Verification and acceptance

P034-03 to P034-07 run in the personal VPS Linux lane on actual Linux with systemd, cgroup v2 and delegated units, fresh run-owned state and the Codex fixture, with the idle time set to 1 minute and the background time to 2 minutes unless stated.

- **P034-01:** Configuration defaults to 15 and 120 minutes; values outside the ranges, non-integers, and an enabled background time below the idle time stop startup. The installer accepts, validates and renders both optional fields, and an instance configuration without them renders byte-identical files to the baseline release.
- **P034-02:** The stop-time helper returns the idle and protected times from last execution activity, returns none for every other state and for protected with the background stop off, and reports a protected member due only after its time.
- **P034-03:** A conversation finishes a turn with nothing left running. Its runtime is released within the idle time plus one tick, its dot clears, and a new message continues the same native thread.
- **P034-04:** A conversation finishes a turn that leaves a background child running. Status shows the protected stop time. After it passes, the child and the runtime stop, the cgroup is confirmed empty, membership is released, a sibling conversation's runtime and processes are untouched, and a new message continues the same native thread.
- **P034-05:** A turn in the protected conversation before its stop time moves the time; a turn queued in that conversation when the time passes prevents the stop request; opening Status, polling and preview access do not move the time.
- **P034-06:** Runtimes that are active, waiting for approval or input, starting, retiring or unknown are never stopped by either timer. With the background time set to 0, a protected runtime stays until **Stop processes**, as today.
- **P034-07:** The Status dialog shows the idle and protected texts at desktop and phone widths, and the rendered prototype shows the same strings.
- **P034-08:** D014 carries a dated amendment, and design 001, the token guide, the user conversations guide, the personal VPS and local guides and the deploy guide state the new times, the off switch and the unchanged unknown rule.
- **P034-09:** `pnpm build`, `pnpm check`, `pnpm test`, the full critical `pnpm test:e2e`, the installer contracts in `python3 -m unittest discover -s tests/deployment -p '*_test.py'` the personal VPS Linux lane `node --import tsx tests/personal-vps/e2e.ts` and its concurrency lane `node --import tsx tests/personal-vps/e2e.ts --concurrency` pass.

Gate: behavioral, with the actual Linux lane for the changed retirement timing. The adapter, launch and sandbox are unchanged, so the pinned native contracts recorded in the [P018 report](../../docs/reports/2026-09-21-p018-concurrency.md) are reused for process inspection and retirement, with their tested revision and limits; no live Codex check is needed. A final bounded installed check on the owner's VPS needs the owner's go-ahead.

## Rollout and recovery

No migration. The deploy that installs this change follows the current promotion rule, so every retained runtime must be gone first, as `preflight` shows. After it, both default times apply without a configuration change. Setting other values later means adding the optional fields to the instance configuration and rendering it with the installer on the host, which needs SSH from the owner's machine, because the [GitHub Actions workflow](../../docs/developer/github-actions-deploy.md) has no configuration action. Before rolling back to a release that predates the fields, remove them, because that release's installer rejects unknown fields.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
