# P030 — Composer and conversation flow

## Metadata

- ID: P030
- Status: Draft
- Priority: Medium, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: The owner can queue a follow-up while Codex works, new conversations start with the settings last used in that project, and conversations that finished, failed or wait for an answer show it in the sidebar and tab title and, with opt-in, through a browser notification.
- Authorization: On 27 September 2026 the owner authorized evaluation and revision of the open proposals, followed by commit and push of these document changes to `main`. Feature implementation, live experiments and deployment are outside this audit.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529` and the fixture walkthrough recorded in the [review](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough).
- Dependencies: [P025](025-clean-supervisor-shutdown-and-restart.md) must be Implemented for never-started queue settlement; that dependency is currently missing. [P028](028-live-conversation-streaming.md) is recommended first but is not required for attention. P019/P020 integrations use their delivered contracts when present, without making this plan their implementation owner.
- Source issues: None.
- Design references: [Conversations and access](../systems/001-conversations-and-access.md), [interface](../systems/006-interface.md), [UI guide](../design-tokens.html), [prototype](../prototypes/harbor-redesign.html).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P030-01–P030-06.

## Review note — 27 September 2026

Read-only source review against `e6c2a138563139650af46fe51af44c6eb6c28743`; the original baseline in Metadata and dated evidence remain historical. P025 owns never-started queued-turn settlement. Attention now has durable identities and bounded retrieval, observed-sequence acknowledgements and best-effort browser notifications; project defaults preserve explicit draft settings. This audit runs documentation checks only and adopts no canonical feature contract, performs no application/runtime/Linux acceptance and closes no issue.

## Problem, outcome and exclusions

The review's [walkthrough](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough) lists three everyday workflow gaps, marked P030; the settings gap comes from source inspection:

- While a turn runs, Send becomes Cancel turn and the help line says "Wait for this turn to finish before sending another message.", so a follow-up can be typed but not sent. The API already accepts such a turn and queues it with the `session_busy` reason; only the browser refuses.
- New chat copies the model, effort and permission selected for the open conversation, even when the new conversation is in another project, and after a fresh page load with no conversation open it starts from the first permission profile, `read-only`, and the default model and effort. A project's usual settings are therefore lost on reload and can carry over into other projects.
- Nothing outside the open conversation shows that a turn finished, failed or needs an answer, while unanswered approvals expire after five minutes.

After this change:

1. **Queue follow-ups.** Sending while a turn runs creates a queued turn, shown as a queued message with a Cancel action that uses the existing cancellation route. Queued turns start in order.
2. **Remembered settings.** A fresh untouched conversation draft starts with the project's last successfully admitted interactive browser turn settings, whichever conversation is open. Defaults resolve the supported model first, its supported effort next and the least-permission allowed profile; existing explicit/restored draft choices need visible correction if unavailable.
3. **Attention marks.** The sidebar marks a conversation whose latest turn finished or failed since the owner last viewed it, and one that waits for an approval or an answer. A waiting mark stays until the request is answered or no longer applies, even after the owner views the conversation. The tab title shows the number of marked conversations.
4. **Notifications.** After explicit opt-in, an available browser may notify when a request needs an answer or a turn finishes. Delivery is best effort while the browser/OS schedules the tab; the healthy-browser target is about a minute, not a guarantee for suspended tabs. Selecting it opens the conversation.

Excluded: steering a running turn, which needs adapter contract and live evidence and may follow as its own plan; push notifications with a service worker; how long approvals wait and how answers are delivered, owned by [P019](019-durable-approval-waiting-and-delivery.md); transcript records of approvals, answers and cancellations, owned by [P029](029-complete-conversation-transcript.md); the empty-conversation behavior of New chat, owned by [P020](020-new-conversation-drafts.md); and wording, hidden controls, sign-in pages, the approval card's expiry notice and phone layout, owned by [P033](033-interface-clarity-and-phone-fit.md).

## Dependencies and current design

The conversation design already serializes one active turn per conversation and queues later input with a `session_busy` reason; this plan exposes that in the browser using P025's completed never-started settlement contract. Attention state is new: the design gains a per-conversation "viewed through" event sequence stored on the server, so marks agree across the owner's devices.

P019's own attention records, which the owner closes after reading a decision's outcome, stay separate from these marks. When P019 lets requests wait longer, the waiting mark follows the same rule: it stays while a request can still be answered.

## Source issues

None.

## User and API flows

1. The owner sends a follow-up during a turn. It appears as queued with Cancel. It starts when the current turn ends. Cancel prevents native dispatch only if its transaction wins that race; otherwise show requested/confirmed interruption separately. Accepted message text, attachments and operation history remain available.
2. The owner opens an untouched New chat draft and sees that project's accepted interactive defaults. Explicit or restored draft settings are never overwritten.
3. A turn finishes in another conversation. Its sidebar row shows a mark and the tab title shows "(1)". Rendering its completion and acknowledging that observed sequence clears the mark on every device; a racing unseen completion stays marked.
4. An approval request arrives in another conversation. Its row shows a waiting mark, which stays after the owner opens the conversation and clears once the owner answers.
5. The owner opts in from a Settings user gesture. Available notifications use generic text; denied, revoked or unavailable permission has honest UI. A click authenticates first if needed, then opens the authorized conversation.

The queued message, attention marks and the notification setting are new states and must be specified in the UI guide and demonstrated in the prototype before application use.

## Contracts, state and security

- **Queue.** Use existing turn/cancel routes with distinct exact operation IDs for running and queued controls. P025 owns `interrupted` settlement with `blocked_by_uncertain_turn` for a proved-never-started follow-up; this plan cannot execute until that behavior is delivered. Retain accepted text/attachments/intent and show the reason for reuse. A cancel that races dispatch must report whether it prevented start or requested interruption, never infer non-execution from a click. Preserve P024's synchronous send reservation, upload readiness, draft-revision CAS, frozen exact-intent retry and clearing only acknowledged input; delayed acknowledgements cannot erase newer edits.
- **Preferences.** The most recently committed successful interactive browser admission stores the coupled model/effort/permission tuple atomically under the project lock. Failed admission, idempotent retries, scheduled/token turns and draft edits do not change it; use commit order, not client clocks. For a new untouched draft, resolve a supported model first, then an effort valid for that model, and the least-permission allowed fallback. P020, when present, consumes these defaults once; restored/explicit choices remain and final send revalidates current policy.
- **Attention.** Store viewed-through and relevant completion/request identities durably, independently of disposable replay rows. Proposed `POST /api/v1/sessions/{id}/viewed` accepts a session-bound observed/rendered sequence, rejects future sequence values and advances only monotonically under the resource fence. Send at open/leave and once per terminal transition actually rendered while visible, never per delta; an unseen concurrent completion remains unread. Keep Origin/CSRF and ordinary command idempotency/10,000-intent accounting. Waiting takes precedence while a request is actionable. Submitted/uncertain delivery follows P019 if present and cannot masquerade as an answerable request or successful delivery.
- **Delivery.** Proposed owner-only `GET /api/v1/attention` provides bounded summary counts and cursor pages with stable completion/request identities, including archived running/waiting/finished conversations. It does not change sidebar ordering or require fetching the entire session list. Set numerical page/serialized-byte limits, cursor and acknowledgement schemas before acceptance. Enabled notifications allow a hidden scheduled tab to poll this bounded feed about once a minute, the sole exception to P028's hidden-tab polling rule; disabled tabs do not poll it. Reconcile immediately when visible. Keep the open conversation stream unchanged.
- **Notifications.** Request permission only from explicit user-gesture opt-in; feature/permission denial or revocation stays visible. Deduplicate by stable event identity across polling, reload and same-browser tabs, with bounded retained dedup state; define that mechanism before acceptance. Text names only the event kind, never title or message content. Browser/OS suspension can delay delivery, as [browser timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) explains; no service-worker/push guarantee is added. Authenticate notification navigation and preserve current resource checks.

## Implementation brief

After P025 is Implemented, settle the bounded attention/acknowledgement/dedup schemas and preference storage with the UI guide/prototype before acceptance, then implement API, storage and browser changes together. Keep proposed route handlers/contracts/tests within the listed server/contracts/test fence; add any new helper paths before dependent edits.

## Exact file fence

The paths below are a prospective feature-implementation fence, not authorization to edit them during this audit. The current audit edits only the fourteen selected Draft proposals. Main must settle any missing new paths and check provisional decision/migration numbering before acceptance.

- `design/proposals/030-composer-and-conversation-flow.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/api/src/server.ts`
- `apps/api/src/history.ts`
- `apps/supervisor/src/main.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/History.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/styles.css`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `packages/storage/src/turns.ts`
- `packages/storage/src/migrations/023_conversation_flow.sql`
- `tests/integration/conversation-flow.test.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p014.ts`
- `tests/e2e/p030.ts`
- `tests/personal-vps/e2e.ts`
- `docs/user/conversations.md`

The migration number is provisional: main gives it the next unused number when execution starts, so migrations always land in numeric order.

## Verification and acceptance

- **P030-01:** A follow-up sent during a running turn is queued, shown with Cancel and starts after the turn; a cancellation that wins admission never starts, while a dispatch-first race shows requested/confirmed interruption accurately. Running and queued controls target different operation IDs and preserve accepted text/attachments. In the personal VPS lane, a follow-up queued behind a turn that becomes uncertain is shown as not sent with its text, never starts and no longer counts as active work through P025. Include attachment batches, repeated Send, lost accepted response and delayed acknowledgement preserving a newer draft.
- **P030-02:** New chat pre-selects the project's last accepted settings whichever conversation is open, including after reload. Test model removal and model-specific effort fallback, least-permission fallback and concurrent commit-order preference updates; failed/replayed/scheduled/token turns do not change preferences. P020-before/after integration preserves explicit/restored draft choices.
- **P030-03:** A finished or failed conversation shows a mark and a title count, cleared only through rendered evidence, and the cleared state appears in a second browser context. Archived active/finished work remains reachable through the bounded attention feed, including after replay expiry, without reordering history. A conversation waiting for an actionable approval keeps its mark after viewing, including across migration, and loses that waiting mark once no longer answerable; uncertain delivery remains truthful under the applicable P019 contract.
- **P030-04:** In a controlled healthy browser with permission and a hidden scheduled tab, approval/completion events notify within about a minute using neither title nor content. Repeated polls, reload and sibling tabs do not repeatedly notify the same event. Suspension permits delayed delivery with immediate reconciliation on visibility; denied/revoked/unavailable permission is explicit. Without opt-in, no notification or hidden attention-feed request occurs. An expired session must sign in before notification navigation.
- **P030-05:** The attention route rejects a request without a valid CSRF token, repeating a request changes nothing, and a stale viewed-through sequence from another tab or device never moves the mark backwards. Reject future/wrong-session sequences. A completion between render and acknowledgement remains unread; a completion rendered in the visible conversation receives one terminal acknowledgement. Open/leave updates occur once each, never once per delta.
- **P030-06:** `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e --design` with P030's scenarios, the full critical `pnpm test:e2e`, the personal VPS Linux lane, and the P018 concurrency and P024 attachment lanes pass.

Gate: behavioral. No launch, sandbox or adapter change; the personal VPS Linux lane runs because supervisor dispatch changes.

## Rollout and recovery

The migration is additive and needs `allow_new_migrations` and a checkpoint. Existing completed history starts acknowledged without retroactive completion marks; still-actionable approval/input requests remain marked after migration. Projects without a stored preference keep today's defaults. Validate attention/dedup state and downgrade behavior against the checkpoint before promotion.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
