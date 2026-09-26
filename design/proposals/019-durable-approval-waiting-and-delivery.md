# P019 — Durable approval waiting and delivery status

## Metadata

- ID: P019
- Status: Draft
- Priority: Medium, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-20
- Owner: Main conversation; future implementation owner unassigned
- Outcome: An owner returning after an absence can answer a still-valid request and understand whether a decision was merely accepted, sent, confirmed, failed or left uncertain.
- Authorization: On 27 September 2026 the owner authorized evaluation and revision of the open proposals, followed by commit and push of these document changes to `main`. Feature implementation, live experiments and deployment are outside this audit.
- Baseline: Source inspection of `bb85e1034e756d589d0d0c1c631616c5c9f2b7f7`; no new timeout, crash or runtime acceptance run.
- Dependencies: Existing PG approval persistence and current-authority dispatch checks are implemented. Exact pinned-runtime acknowledgement/cleanup behavior needs verification. No hard dependency on P018, P020–P022 or automatic cross-process approval recovery.
- Source issues: None transferred; existing runtime/recovery evidence obligations remain with their current owners.
- Design references: [Approval/state contract](../architecture.md#api-events-and-state-transitions), [persistent execution](../architecture.md#projects-concurrency-and-persistent-work), [conversations and recovery](../systems/001-conversations-and-access.md), [profile limits](../systems/004-deployment-and-profiles.md), [interface](../systems/006-interface.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P019-01–P019-09.

## Review note — 27 September 2026

Read-only source review against `e6c2a138563139650af46fe51af44c6eb6c28743`; the original baseline in Metadata and dated evidence remain historical. The supported request kinds, immutable answer attempts and request-clearing correlation are now explicit. Pinned per-kind delivery evidence and exact schema/decision/test paths still block acceptance. This audit runs documentation checks only and adopts no canonical feature contract, performs no application/runtime/Linux acceptance and closes no issue.

## Historical review note — 25 September 2026

The [project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities) recommends priority Medium. [P018](archive/018-concurrent-conversations-and-runtime-capacity.md) had landed by that review; the current contract therefore requires: waiting turns stay non-idle and protected. [P030](030-composer-and-conversation-flow.md) adds attention marks, so the owner learns that a request is waiting; a waiting mark stays until the request is answered or no longer applies, and this plan's own attention records for decision outcomes stay separate. [P033](033-interface-clarity-and-phone-fit.md) shows the current expiry on the approval card. This plan still owns how long a request waits and how answers are delivered. Its live smoke can use the owner's standing authorization, recorded in AGENTS.md, for the VPS Codex credential copied into fresh run-owned state. The baseline revision above is older than the current source; re-inspect before acceptance.

## Problem, outcome and exclusions

The [supervisor](../../apps/supervisor/src/main.ts) already persists requests before publishing an event. It sets a five-minute deadline, sends `decline` for expired ordinary approvals, and interrupts expired input requests. The [API](../../apps/api/src/server.ts) rejects answers once that deadline passes. Missing runtime/generation and supervisor restart expire old requests. The [adapter](../../packages/codex-adapter/src/index.ts) writes an answer to the connection; current `resolved` persistence does not establish execution success.

Remove Harbor's fixed five-minute automatic denial for the three currently supported request kinds: command-execution approval, file-change approval and `item/tool/requestUserInput`. Other request kinds remain rejected; this does not add permission grants or elicitation support. Browser disconnection is not a user decision. Preserve requests, answers and their disposition so reconnect gives an accurate actionable result. The native operation may independently complete, fail, be cancelled or cease to need the request; indefinite request records do not imply an immortal native process.

Excluded: automatically recreating a dead process's pending approval, replaying its original turn, matching approvals solely by similar command text, reusing an old approval for changed execution scope, and guaranteeing exactly-once external effects. Worktree support and a general personal-profile recovery redesign are also excluded.

## Dependencies and current design

Current architecture and conversation designs explicitly allow deadline denial and generation-based expiry. Before implementation, replace those requirements with separate user-decision, request-validity and delivery contracts. A focused decision should capture the changed lifetime semantics and the deliberate boundary on automatic recovery. Preserve existing security ceilings and never turn a retained approval into durable permission to execute arbitrary future work.

The [official approval documentation](https://learn.chatgpt.com/docs/app-server#approvals), inspected on 27 September 2026, says `serverRequest/resolved` covers both answered and cleared requests, including input cleanup when a turn ends. It is supporting context, not proof of pinned-runtime delivery or execution. The pinned generated notification carries `threadId` and `requestId`; correlate it through the original connection, runtime generation and saved request mapping, never an assumed active turn. Before acceptance, document the tested 0.153.4 behavior for each supported request kind: normal answer, cleared request, turn termination and disconnect. If no authoritative confirmation is available, expose sent/unconfirmed or uncertain status; do not label it confirmed. A restored thread does not, by itself, demonstrate a restored unanswered request.

P018 is implemented: waiting turns remain non-idle and protected, with its capacity feedback. P034 explicitly excludes active and approval/input waits, including requests retained by this plan. Any separately selected interruption policy must preserve interruption as distinct from a user decline.

## Source issues

No existing issue is transferred or resolved. The [runtime compatibility](../../issues/2026-09-07-073831-codex-runtime-compatibility.md) and [live history acceptance](../../issues/2026-09-13-110315-common-use-live-acceptance.md) records remain evidence limitations, not proof that approval recovery exists.

## User and API flows

1. Persist request scope, native thread/turn/item identifiers when provided, original request ID, session and runtime generation before publishing it. Reload returns the retained request and its current validity.
2. An authenticated owner answers a valid request even after five minutes. Save the decision and actor with an idempotent command result. HTTP acceptance means Harbor recorded it; the UI initially says submitted.
3. Before sending, recheck current authority, session/generation ownership, native request validity and the exact approved scope. Send only on the original valid connection.
4. Distinguish local write, any verified native resolution and later operation/item outcome. A request-cleared notification must not be presented as proof that the user's answer caused execution.
5. On runtime exit, preserve the request and any saved decision, identify that the original request cannot currently be answered, and explain whether delivery/effects are known or uncertain. No automatic resend to a resumed thread.
6. Offer retry only when non-delivery is established and the original request remains valid. Otherwise offer inspection and an explicit new-execution route where that profile safely supports it. Personal profiles that lack safe in-place recovery must provide honest SSH/inspection guidance or a separate new conversation, not an enabled unsupported recovery control. Never silently copy and submit the previous prompt or its approval.

The browser must render submitted, sending, sent/unconfirmed, confirmed where supported, no-longer-applicable, failed and uncertain outcomes without collapsing them into success or rejection. No simulated "restoring" state is shown while automatic restoration is excluded. End/dismiss controls close decision-outcome attention records only; cancellation/termination is a separate explicit action with visible effects. These records follow request validity and delivery independently of P030's waiting marks. If P029 is present, it renders the same durable approval/attempt identities without introducing another state machine.

## Contracts, state and security

Persist independent dimensions rather than one overloaded status:

| Dimension | Required meaning |
| --- | --- |
| User decision | Unanswered, approved or declined, with actor/time and immutable submitted payload; explicit user-input answers retain their own shape. |
| Request validity | Pending in its original generation, cleared/no longer applicable, original runtime gone, or unresolved validity. |
| Delivery | Not attempted, queued/sending, proven not sent, sent but unconfirmed, confirmed if supported, or uncertain; retain attempt identity and bounded reason. |
| Execution | Relevant operation/item still waiting/running, completed, failed, interrupted or uncertain, independent of answer delivery. |

Scope/generation changes require a new request and a new user decision. Historical decisions remain audit facts, never a transferable capability. Reauthentication after a long absence is expected; browser-session expiry does not erase the approval. First valid answer wins across tabs; exact retries return the original command result, changed payloads conflict, and distinct retry keys cannot bypass the single immutable decision. If authority is rejected before any send, retain the original answer, actor and proven-not-sent attempt. Only an explicit newly authorized attempt may deliver that same payload to the still-valid original request; do not erase the decision, restore an unanswered state or automatically reuse expired authority. Alternative-answer semantics would require a separate settled decision before acceptance.

Persist delivery intent before sending and reconcile startup/in-flight records without blind retries. A transport or database failure after possible send yields uncertainty. Recheck runtime and item state before any deliberate retry; if the answer's effect cannot be proven, retain uncertainty. Do not report successful command execution from stdin-write success or request cleanup alone.

Keep finite scope/payload, pending-request and control-slot limits, but do not evict unresolved approvals by age or implement quota pressure as user denial. Full capacity rejects new admission with an explicit resource error while preserving existing answer/cancel/recovery controls. If the baseline's lifetime approval quota is later changed by P021, preserve the same unresolved-record guarantees. No new permission types, unsandboxed execution or public raw protocol endpoint are introduced.

For migration, retain old `expired` history without inventing whether the user declined, the timer fired or a process died. Annotate uncertain historical provenance. Future records use explicit reasons. Old persisted decisions must not be dispatched by a newly upgraded supervisor merely because their deadline was removed.

## Implementation brief

Future main settles per-kind acknowledgement evidence, state/API schema, migration, exact decision/probe/test paths and profile-specific restart actions before acceptance. These missing choices and pinned evidence block acceptance; this Draft is not an executable brief. Give the implementer fresh context and the exact file fence. Implement persistence, authorization, dispatcher reconciliation and UI together, then exercise response-loss and restart boundaries. New protocol uncertainty returns to main; it cannot be resolved by assuming that native request IDs survive restart.

## Exact file fence

The paths below are a prospective feature-implementation fence, not authorization to edit them during this audit. The current audit edits only the fourteen selected Draft proposals. Main must settle any missing new paths and check provisional decision/migration numbering before acceptance.

Exact new decision, migration, helper, probe and test paths needed by the selected design must be allocated before acceptance; generated protocol files are not hand-edited to claim support.

- `design/proposals/019-durable-approval-waiting-and-delivery.md`
- `design/architecture.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/supervisor/src/main.ts`
- `apps/supervisor/src/recovery.ts`
- `apps/supervisor/src/runtime-mailbox.ts`
- `apps/api/src/server.ts`
- `apps/api/src/recovery.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/Recovery.tsx`
- `apps/web/src/api.ts`
- `packages/storage/src/index.ts`
- `packages/storage/src/capacity.ts`
- `packages/storage/src/maintenance.ts`
- `packages/codex-adapter/src/index.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `tests/fixtures/codex/server.mjs`
- `tests/e2e/run.ts`
- `tests/e2e/p007.ts`
- `tests/contract/adapter.test.ts`
- `tests/contract/history.test.ts`
- `tests/personal-vps/e2e.ts`
- `docs/user/conversations.md`
- `docs/developer/development.md`
- `docs/developer/personal-vps.md`

Future scratch/evidence uses run-specific paths under `.test-runs/p019/`. Fixtures and native probes use isolated identities, state and processes.

## Verification and acceptance

- **P019-01:** Through actual UI/API/PG/supervisor, disconnect the viewer for more than five minutes, reconnect and answer a still-valid approval/input request. No Harbor timer sends decline or interrupts that turn. Include each of the three supported kinds and a real elapsed-time case rather than only changing a fixture timestamp; P034 timers leave every such wait intact.
- **P019-02:** Persist the request before event visibility, reload across API restart and preserve exact scope and native identity. Pending requests remain inspectable without a browser connection.
- **P019-03:** A live original runtime receives an authorized decision. UI/API distinguish durable submission, delivery evidence and later command success/failure; native clearing without an answer is not reported as user approval.
- **P019-04:** Runtime exit and supervisor restart retain historical request/decision facts and distinguish not-applicable from uncertain delivery. Unsupported personal recovery remains honestly unavailable; explicit new execution never automatically inherits the old approval.
- **P019-05:** Concurrent tab answers, exact duplicate submissions, changed-payload retries and disconnect/PG failure around send produce one decision and no blind duplicate effect. Reconciliation tests count actual boundary sends. Revoke the browser grant after durable answer submission but before send, then deliberately reauthorize: retain the immutable decision and failed attempt and allow one new attempt for the same payload only while the original request remains valid. Racing attempts cannot send twice.
- **P019-06:** Revoke authority, change permission ceiling, replace scope or advance generation before send. An old attempt cannot execute under new authority or scope. Stale connection/generation, wrong-thread and reused-request-ID cleanup events cannot resolve a newer request; correlate thread-only clearing through the saved original request mapping.
- **P019-07:** Capacity pressure preserves pending decisions and stop controls, and waiting approval/input remains non-idle with the implemented P018 scheduler and P034's exclusion of waiting work. Resource interruption is distinct from user refusal.
- **P019-08:** Migrate historical pending/answering/expired records without fabricating reasons or dispatching old answers. Reopen the UI on desktop/mobile and verify all actionable and uncertain states, keyboard focus and retry availability.
- **P019-09:** Verify pinned real-runtime request/cleanup/answer behavior with isolated credentials and record exactly what constitutes confirmation; cleared and answered notifications remain distinguishable from execution success, and absent confirmation stays visible. Include each supported request kind, termination and connection loss. Automatic cross-process approval restoration is not an acceptance claim.

Future gate: `pnpm build`, `pnpm check`, `pnpm test`, relevant real-stack E2E plus critical regressions, pinned `pnpm test:contract` and bounded dedicated live smoke. Actual supported Linux checks are additionally required for any changed launch/retirement boundary. Exact feature selectors and evidence ownership must be supplied before execution. No checks are performed by this draft.

## Rollout and recovery

Use a candidate and a compatible state backup. Drain or visibly interrupt old in-flight answer dispatch before switching incompatible state handling. Do not downgrade to code that reintroduces timer denial or misreads new delivery states without a proven compatibility path. Migration and restart never authorize old answers. Keep existing targeted cancellation and SSH recovery available.

## Review and findings

Drafting review establishes document quality only. Future implementation requires both fresh-context design and provenance reviews after its complete gate, fixes by the implementer and at most three rounds. Missing runtime evidence keeps the corresponding claims unverified.

## Closing record

Pending. This draft creates no new approval behavior, does not perform upstream recovery research, and closes no existing issue or feature gate.
