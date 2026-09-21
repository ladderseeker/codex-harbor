# P018 — Concurrent conversations and runtime capacity

## Metadata

- ID: P018
- Status: Implemented
- Archive disposition: Completed
- Archived: 2026-09-21
- Created: 2026-09-20
- Owner: Main conversation; delegated core and interface implementers
- Outcome: While one conversation runs a long task, the owner can use other conversations in the same directory without unnecessary workspace or idle-runtime blocking.
- Authorization: On 21 September 2026 the owner selected implementation, verification, commit, push and deployment of P018, preserving the upgraded sidebar and its last-accepted-query ordering. This supersedes the earlier proposal-only authorization. The owner accepts responsibility for coordinating shared-file edits. The owner also authorized separate P024 attachment/composer work; independent implementation may proceed alongside the remaining P018 lifecycle work with disjoint file ownership.
- Baseline: Clean `1cc41d7` on `main`, inspected 21 September 2026. Existing P023 sidebar refinements are part of this baseline.
- Dependencies: Authenticated dispatch and personal profiles exist at the baseline. The initial empty-home probe only covered startup/group cleanup. Subsequent pinned non-PTY command probes proved that ordinary commands start a separate PGID and SID and survive native SIGTERM/group retirement; `.test-runs/p018/tests/native-probe-evidence.json` records this blocker and its raw-log limits. The baseline group inspector cannot authorize eviction or release. Linux implementation therefore requires generation-owned delegated cgroup-v2 membership and confirmed empty cgroup retirement. Native macOS lacks an established equivalent and is excluded from the owner-selected VPS-only release. Clean-idle/background/preview lifecycle acceptance remains mandatory. The owner authorized standing reuse of the VPS login through a credential-only isolated copy. The bounded live gate and all selected Linux lifecycle dependencies passed; the closing record links their exact evidence. No dependency on P019–P022 or new worktrees.
- Source issues: None transferred; this is an owner-requested change. Existing live/isolation and deployment obligations keep their current owners.
- Design references: [Concurrency and execution](../../architecture.md#projects-concurrency-and-persistent-work), [conversations](../../systems/001-conversations-and-access.md), [workspace coordination](../../systems/002-workspaces-and-resources.md), [personal profiles](../../systems/004-deployment-and-profiles.md), [interface](../../systems/006-interface.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P018-01–P018-09.

## Problem, outcome and exclusions

The [dispatcher](../../../apps/supervisor/src/main.ts) caps active conversation operations at four and, in personal VPS mode, caps live conversation runtimes at four. A successful personal VPS turn retains its runtime for 30 minutes. The [workspace admission service](../../../apps/supervisor/src/workspace-admission.ts) continues to reserve that workspace for its conversation. Another conversation can therefore wait even when the retained runtime is doing no useful work. The cap check has no capacity-driven idle eviction.

The selected release outcome is same-directory concurrency in the personal VPS profile. Shared personal-local scheduling retains its read-only ceiling, but native macOS lifecycle support is excluded by the owner’s 21 September VPS-only decision. Two writable personal VPS conversations may overlap; the owner coordinates edits. Do not require a worktree, a read-only second conversation, a conflict-confirmation dialog, or cancellation of the long task. Keep one active turn per conversation.

Excluded: new worktree creation or linked Git metadata grants, automated merging, file conflict prevention, collaboration between multiple owners, runtime multiplexing across conversations, new execution permissions, and managed file/terminal/preview writer-policy redesign. Managed-profile writers retain their existing coordination and isolation guarantees. Shared scheduler changes require managed regressions, not an implicit weakening of managed policy.

## Dependencies and current design

Current designs require cooperative workspace exclusion and generation-fenced recovery. Personal profiles share parts of that implementation. Before implementation, update the canonical designs to describe the personal-profile exception: per-conversation runtime ownership and shared directory membership, while retaining destructive workspace/project lifecycle checks against all members. A focused decision must record this significant concurrency change and its profile boundary; do not silently reinterpret the managed D005 contract.

The baseline provides per-session runtime maps, durable dispatch intents, process inspection, retirement confirmation and retained-runtime stop controls. These are reusable mechanisms, not proof of the proposed combined outcome. The [live-runtime issue](../../../issues/2026-09-07-171225-live-runtime-credentials.md) records an existing credential gate; a future run must check current dedicated prerequisites rather than infer availability from historical reports.

[D014](../../decisions/014-personal-conversation-concurrency.md) settles classification, capacity, membership, restart and expiry. A successful inspection excludes only the live guardian and directly launched runtime identities; every additional owned process protects the runtime. Unknown inspection never authorizes eviction. A wrapper may conservatively stay protected because its native child is an additional process. Actual pinned native idle/background/preview verification is required before closure.

## Source issues

No issue is closed or transferred by writing this proposal. This proposal changes the selected personal concurrency outcome, not the unresolved acceptance of archived P003/P015 or the managed release.

## User and API flows

1. Start a long task, then open another conversation on the same registered workspace and send a question or task. Both may execute when capacity permits. Show the shared working directory without adding an approval step.
2. Reuse the requesting conversation's healthy retained runtime when its generation, permissions and credentials remain valid. An active turn in that conversation still queues or uses supported steering.
3. When a new runtime is needed and capacity is full, select the oldest eligible idle runtime by last meaningful execution activity, recheck its eligibility, retire it, confirm exit, then admit the new runtime. Viewing or polling a conversation does not make it recently active.
4. If every runtime is busy, protected or uncertain, retain the new operation in the durable queue with an accurate reason. Cancellation works while queued. Process queued work fairly; a blocked head entry must not hide an eligible same-conversation reuse behind it.
5. Retiring an idle runtime preserves the conversation and native thread. A later turn resumes that thread. Stopping or recovering one conversation must not stop a sibling conversation sharing the directory.

The shared authenticated command path owns these rules for the browser and any already-supported API callers. No new PAT capability is introduced in personal profiles.

## Contracts, state and security

Proposed administrator configuration separates `HARBOR_MAX_ACTIVE_TURNS` from `HARBOR_MAX_CONVERSATION_RUNTIMES`, defaulting to four each, with operational ceilings of 16 active turns and 32 runtimes. These are admission ceilings, not measured host capacity. The second limit counts all live conversation runtimes, including busy, idle, protected and retiring instances; the first includes executing turns and turns waiting for approval/input. Validate positive integers and require the runtime limit to be at least the active-turn limit. Lowering limits converges without killing protected or active work. No settings UI is required initially. Configuration must reach local startup and personal VPS rendering, not only API schema parsing.

Do not advertise this conversation budget as a limit on every host process. Capability discovery and separately managed terminals/previews retain their explicit existing budgets; their authority and cleanup cannot be borrowed for conversation eviction. Lowering limits never forcibly kills accepted work; stop admitting excess work and converge through completion or eligible retirement.

Use explicit states for active, waiting approval/input, ordinary idle, background-service retained, retiring and unknown. Last activity, retention expiry and generation ownership must survive the relevant restart reconciliation. The existing 30-minute idle retention becomes a maximum ordinary-idle retention target, not a guaranteed minimum stay. Waiting for approval/input is never an idle eviction candidate. P019 may later remove approval deadlines; P018 must remain correct with either approval policy.

Automatically detected generation-owned background commands or attached preview services are protected from capacity-driven eviction. Unknown inspection is protected and visibly unresolved. Protected background services and unknown inspection have no automatic expiry. Targeted stop, idle-session archive, emergency stop, credential retirement and graceful shutdown remain explicit retirement causes; each requires confirmed absence. Recheck exact state/generation/activity and process inspection under the retirement fence before automatic retirement. The UI must explain protected capacity and offer existing targeted stop controls. An open browser tab alone is not proof of a live service.

Serialize admission and retirement by exact session/runtime generation. Recheck activity before retirement, reserve capacity during startup/retirement, and release it only after confirmed absence. Failed retirement cannot create a replacement slot on an assumption. Restart must reconcile run-owned identities before counting or retiring them; no broad process-name or directory-based termination. An uncertain conversation remains fenced from its own sends, while unrelated conversations may proceed within the remaining confirmed capacity.

Workspace identity continues to use registered canonical paths and filesystem identity; shared membership grants no additional paths. Revalidate current authorization after waits and before dispatch. Keep administrator maintenance, permission ceilings, root validation and one-supervisor fencing. Project/workspace removal must account for every participating runtime, including uncertain or retained instances. Managed exclusive clients and their recovery remain unchanged.

## Implementation brief

Main has settled the contracts in D014 and the current subsystem designs. Fresh-context core and interface implementers receive self-contained briefs in `.test-runs/p018/`, with disjoint ownership and the baseline above. Implement admission accounting and shared membership together with retirement/recovery and observable queue reasons; do not ship a cap-only change as this outcome. Add lifecycle coverage before claiming useful same-directory concurrency. Record new decisions or missing paths with main before dependent edits.

## Exact file fence

The following exact paths are authorized for this outcome. Main owns canonical design/proposal/report updates and deployment evidence; worker briefs assign disjoint implementation paths. Additional paths require a recorded fence amendment before editing.

- `design/proposals/018-concurrent-conversations-and-runtime-capacity.md`
- `design/architecture.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/002-workspaces-and-resources.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/supervisor/src/main.ts`
- `apps/supervisor/src/workspace-admission.ts`
- `apps/supervisor/src/workspace-recovery.ts`
- `apps/supervisor/src/background-retirement.ts`
- `apps/supervisor/src/retirement.ts`
- `apps/supervisor/src/recovery.ts`
- `apps/api/src/config.ts`
- `apps/api/src/server.ts`
- `apps/api/src/personal-previews.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `packages/storage/src/index.ts`
- `packages/storage/src/turns.ts`
- `packages/workspaces/src/service.ts`
- `packages/workspaces/src/types.ts`
- `packages/codex-adapter/src/index.ts`
- `packages/codex-adapter/src/local-runtime.ts`
- `packages/codex-adapter/src/personal-cgroup.ts`
- `tests/integration/personal-cgroup.test.ts`
- `packages/contracts/src/openapi.ts`
- `packages/contracts/src/index.ts`
- `scripts/local-dev.ts`
- `infra/personal-vps/harbor-personal`
- `tests/fixtures/codex/server.mjs`
- `tests/e2e/run.ts`
- `tests/personal-vps/e2e.ts`
- `tests/integration/background-retirement.test.ts`
- `tests/contract/local-runtime.test.ts`
- `tests/deployment/personal_vps_test.py`
- `docs/user/conversations.md`
- `docs/developer/local-personal.md`
- `docs/developer/personal-vps.md`
- `docs/developer/development.md`

- `design/proposals/archive/018-concurrent-conversations-and-runtime-capacity.md`
- `design/decisions/014-personal-conversation-concurrency.md`
- `design/decisions/005-managed-project-workspaces.md`
- `packages/storage/src/migrations/019_conversation_runtime_membership.sql`
- `packages/storage/src/conversation-runtimes.ts`
- `apps/supervisor/src/runtime-capacity.ts`
- `apps/api/src/workspace-routes.ts`
- `apps/api/src/history.ts`
- `apps/web/src/History.tsx`
- `apps/web/src/Workspaces.tsx`
- `apps/web/src/styles.css`
- `packages/codex-adapter/src/runtime.ts`
- `packages/storage/src/deployment-modules.ts`
- `infra/deploy/database.ts`
- `infra/deploy/control.py`
- `tests/integration/conversation-runtime-capacity.test.ts`
- `tests/integration/conversation-runtime-config.test.ts`
- `tests/e2e/p018.ts`
- `tests/personal-vps/concurrency.ts`
- `tests/personal-vps/concurrency-live.ts`
- `tests/contract/concurrency.test.ts`
- `docs/reports/2026-09-21-p018-concurrency.md`
- `issues/2026-09-21-121000-native-macos-runtime-ownership.md`
- `issues/2026-09-07-171225-live-runtime-credentials.md`
- `issues/archive/2026-09-21-121000-native-macos-runtime-ownership.md`
- `AGENTS.md`

Private evidence belongs under `.test-runs/p018/`, with run-specific child paths and resource manifests. No test may use the owner's normal Codex state or projects.

The 21 September dependency-tracking amendment permits main to record the new native macOS ownership blocker and the selected P018/P024 live prerequisites in those exact issue paths. The older live issue retains its unrelated managed-profile obligations; this amendment does not transfer or close them.

The owner's subsequent 21 September decision settles release support as Linux/VPS only and authorizes standing use of the existing VPS Codex login for isolated verification. Main may persist these preferences in `AGENTS.md` and archive the native macOS scope issue as Not planned, repairing all references. Native macOS lifecycle completion is excluded from P018 acceptance, not claimed passed. Shared code and managed regressions retain their existing obligations. Tests copy only the credential into fresh private state, keep the installed source unchanged and remove the copied credential after owned retirement.

## Verification and acceptance

- **P018-01:** Through real Harbor UI/API/PG/supervisor, overlap a delayed turn and two new conversations on one actual directory. Verify distinct native threads and outputs; exercise two writable personal VPS sessions on disjoint fixture files without forced read-only/worktree mode. Same-session turns remain serialized.
- **P018-02:** Exercise default and nondefault valid limits, invalid combinations, local/VPS configuration propagation and limit reduction. Assert active and total conversation runtime counts independently, including startup and retirement races.
- **P018-03:** Fill capacity with ordinary idle runtimes of known activity order. A new conversation evicts the oldest eligible one, waits for confirmed exit and starts; an eligible same-session continuation reuses its runtime. Completed history survives eviction and resume.
- **P018-04:** All-busy capacity queues durably. Approval/input waits are not reclaimed. Cancel, reconnect and a blocked queue-head followed by an eligible reuse preserve fairness and idempotency.
- **P018-05:** A running preview, a background command and unknown inspection follow the explicit protection policy; ordinary idle retention can end before 30 minutes. Verify the selected expiry/stop behavior and real background-process detection rather than fixture flags alone.
- **P018-06:** Test failed retirement, supervisor restart and stale-generation completion. Retire/stop/recover only the selected conversation; a same-directory sibling continues. No slot is invented while process existence is uncertain.
- **P018-07:** Permission revocation, replaced workspace identity, archive/removal and maintenance cannot bypass admission or affect the wrong member. Managed file/terminal/preview coordination and isolation regressions remain green.
- **P018-08:** Inspect desktop/mobile queue, shared-directory, protected/unknown and stopped states; keyboard/touch controls and retained-resource indicators remain accurate. Demonstrate any new pattern in the canonical guide/prototype.
- **P018-09:** Run pinned-runtime parallel conversation/reuse smoke and actual supported Linux retirement/sandbox checks in isolated candidates, with source/artifact identity, exact commands, exits and cleanup evidence.

Behavioral gate: `pnpm build`, `pnpm check`, `pnpm test`, relevant real-stack E2E and critical regressions, `pnpm test:contract`, bounded owner-authorized isolated-account live smoke, and actual Linux checks for changed lifecycle boundaries. Core implementation adds `node --import tsx tests/personal-vps/e2e.ts --concurrency` on a trusted disposable Linux lane and `tests/personal-vps/concurrency-live.ts` for explicitly configured dedicated live state. The interface worker adds P018 observations to the design lane. Until those entry points are implemented, these are planned commands, not available or passing checks. Unavailable mandatory gates keep the proposal Accepted, not Implemented.

## Rollout and recovery

Deliver through an isolated candidate. Reconcile or drain old exclusive reservations before enabling shared membership; do not reinterpret live legacy ownership in place. Migrate durable membership without deleting history. Record downgrade compatibility and restore limits before promotion. Preserve targeted stop and SSH recovery; the owner has authorized deployment of the reviewed, verified candidate. Migration 019 requires a matched database/native/config backup; older binaries must not open the upgraded database. Drain and confirm every legacy exclusive conversation reservation before promotion. Register the new table in the existing backup inventory and revoke any restored process identity; do not claim the unrelated full managed restore gate passed.

## Review and findings

Earlier drafting checks remain historical. After the behavioral gate, main must request fresh-context design and provenance reviews, adjudicate findings and return fixes to the implementer, within the workflow's three-round cap.

## Closing record

Completed on 21 September 2026. P018-01–09 passed for the owner-selected Linux/VPS release: same-directory concurrency, independent limits and idle eviction, protected/unknown lifecycle, fairness, exact retirement, regression and interface gates, and actual pinned/live runtime checks. Three paired review rounds concluded with no remaining findings (two advisory, one normal completion review).

Implementation commit `817c3d0971665871b64aa29c0fb25e8c8b132f02` was pushed to `main` and deployed as `/opt/harbor-personal/releases/p018-p024-817c3d097166`. Application source digest is `19b7886b0f218cf6b29223023e034528a22365d5b6c9a5ff591e2d9fa810b862`; artifact manifest SHA256 is `f009fb788dc60ee2bc56f7be2b1fa42ce0bfb2d8df9d72ec085e17a7cfc3a8bc`. The [delivery record](../../../docs/reports/2026-09-21-p018-concurrency.md#committed-release-and-vps-delivery) identifies exact commands, tested boundaries, package/backup identities, installed checks and recovery limits. Existing sidebar order and multiple green resource dots are preserved. The owner’s standing VPS credential authorization is in `AGENTS.md`; native macOS support is [Not planned](../../../issues/archive/2026-09-21-121000-native-macos-runtime-ownership.md) for this release. Older managed live/restore obligations remain separate and open.
