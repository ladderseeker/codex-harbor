# P021 — Long conversation history and capacity

## Metadata

- ID: P021
- Status: Draft
- Priority: Low, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-20
- Owner: Main conversation; future implementation owner unassigned
- Outcome: A conversation can continue beyond the initial per-conversation history limits while preserving useful history, bounded resource use and reliable control operations.
- Authorization: On 27 September 2026 the owner authorized evaluation and revision of the open proposals, followed by commit and push of these document changes to `main`. Feature implementation, live experiments and deployment are outside this audit.
- Baseline: Source inspection of `bb85e1034e756d589d0d0c1c631616c5c9f2b7f7`; no new quota-boundary or performance run.
- Dependencies: P028 must be Implemented for its bounded snapshot/event/page contract and output counters; that dependency is currently missing. Existing native continuation and control reservations are implemented. Numerical capacity/retention/search/segmentation and migration/restore decisions and evidence must be settled before acceptance. P029 is optional; if delivered, its typed payloads enter the same accounting.
- Source issues: None transferred. Related historical bounds/recovery records remain references with their original scope.
- Design references: [Storage and retention](../architecture.md#release-retention-and-rollback-rules), [conversation/history/control bounds](../systems/001-conversations-and-access.md), [attachments/resources](../systems/002-workspaces-and-resources.md), [backup and profiles](../systems/004-deployment-and-profiles.md), [interface](../systems/006-interface.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P021-01–P021-09.

## Review note — 27 September 2026

Read-only source review against `e6c2a138563139650af46fe51af44c6eb6c28743`; the original baseline in Metadata and dated evidence remain historical. P028 is now a required implemented dependency for base streaming, counters and pagination. This plan retains capacity, retention, search and segmented large-item work; numerical budgets and restore evidence remain acceptance blockers. This audit runs documentation checks only and adopts no canonical feature contract, performs no application/runtime/Linux acceptance and closes no issue.

## Historical review note — 25 September 2026

The [project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities) recommends priority Low. [P028](028-live-conversation-streaming.md) proposes bounded snapshots, older-message pages and output counters, which are the retrieval part of flow 2 and the pagination part of P021-04 and P021-09 below, including their composition across an API restart and a stream resync. The 27 September revision resolves that overlap: P028 is a required implemented dependency. This plan extends lifetime limits, retention, search and segmented large-item retrieval, and regression-tests the inherited pagination contract.

Source inspection during the review also found that an assistant reply longer than 262,144 characters, or output that crosses the 2 MiB or 2,000-message limit during a turn, throws in output persistence and makes the turn uncertain; an [issue](../../issues/2026-09-25-120000-output-limit-uncertain-turn.md) now records it. P028 proposes truncating such output with a visible notice so that the turn completes. Flow 4 and P021-03 keep the further goal of preserving the complete reply beyond the old limits.

## Problem, outcome and exclusions

[Turn admission](../../packages/storage/src/turns.ts) rejects input above 2 MiB of message text or at 2,000 messages. [Control capacity](../../packages/storage/src/capacity.ts) also stops ordinary work at 400 retained operation/recovery records. The current design additionally specifies approval, intent and recovery bounds. [Assistant output persistence](../../apps/supervisor/src/conversation-output.ts) throws when its item/conversation bound is exceeded; a mailbox persistence failure can make the active operation uncertain. These are distinct constraints; increasing one constant does not deliver continued long conversations.

Separate durable history growth, bounded UI/API retrieval and execution/control admission. Keep native Codex state responsible for model context and continuation. Keep Harbor responsible for authorization, operation/approval state, deduplication, and durable displayed/searchable history. A display/history-size boundary alone must not poison an otherwise healthy running turn or force a new conversation.

Excluded: deleting the PG database/messages table, editing Codex's internal database schema, assuming every Harbor message can be regenerated from native history, promising unlimited disk/storage, automatic deletion of old conversations, changing the model's context-window behavior, and solving unrelated account/provider usage limits.

## Dependencies and current design

The current [conversation design](../systems/001-conversations-and-access.md) treats messages and unresolved operations as durable, replay events as disposable, and fixed limits as admission controls with reserved stop/recovery headroom. Native recovery repair is bounded and preserves conflicting complete Harbor items. Preserve those distinctions; do not relabel durable messages as a discardable cache to evade their requirements.

Proposed direction: retain PG history as a durable projection for display and search, reuse P028's bounded keyset pages/events/counters, and extend it with segmented large output under finite budgets. Replace lifetime per-conversation admission counts with explicit storage budgets and outstanding-work/control-reserve accounting. Completed records may retain compact durable representations only under a specified provenance and retry contract; no unresolved approval, unacknowledged uncertainty, required idempotency result or referenced attachment may be discarded to make room.

Before acceptance, main must specify numerical instance/project storage budgets, warning/admission thresholds, control reserves and overshoot bounds; the persistence/chunk schema; retention of completed operational payloads; exact full-text/search behavior; migration compatibility; and the extension to P028's item retrieval/copy contract. These unresolved choices and their required evidence block acceptance; the implementation worker cannot select them independently. These are substantive pending design decisions, not discretionary implementation details. A focused decision and canonical design updates are required before relying on new retention semantics.

Native long-history pagination or complete native-to-Harbor reconstruction is not assumed. If a proposed solution needs an upstream capability, prove it against the pinned runtime or choose a PG-owned path. Existing dedicated [live history acceptance](../../issues/2026-09-13-110315-common-use-live-acceptance.md) remains a separate missing-evidence record.

## Source issues

No obligations are transferred. The archived [replay/control bounds correction](../../issues/archive/2026-09-07-185228-p001-retention-control-bounds.md) and [P007 findings](../../issues/archive/2026-09-07-203000-p007-implementation-review.md) must not be used as evidence for new limits. Relevant current history regressions remain in the [active regression record](../../issues/2026-09-08-020429-p007-regression-evidence.md). Existing reports and their tested revisions remain historical.

## User and API flows

1. Continue the same native thread beyond the old message-byte, message-count and retained-operation thresholds, provided actual configured capacity admits the work. Do not re-send old Harbor messages as replacement model context.
2. Reuse P028's recent-history snapshot, stable authorized cursors and incremental events. Extend item retrieval for segmented replies and make complete-copy load the entire authorized turn within explicit bounds; never silently copy only visible pages/chunks. Preserve order and attachment references through the inherited contract.
3. Search retained history with explicit, bounded semantics. Never silently omit old content while presenting results as a complete search. If any storage tier limits search or retrieval, label its boundary and expose the specified retrieval path.
4. Receive a large assistant reply without converting a storage display limit into runtime failure. Preserve full authorized reply content through segmented persistence/retrieval, or show an explicitly designed finite-retention result if that policy is accepted; do not present clipped text as complete.
5. Show approaching real capacity in contextual storage information. At a genuine admission threshold, explain the limiting resource and supported remediation while preserving draft input, inspection and stop/recovery controls. Do not instruct the owner to delete unidentified native state.

## Contracts, state and security

Maintain a documented data-class contract: native model context; Harbor user/assistant/tool history; durable operations/approval decisions; command idempotency; replay events; attachments; and diagnostics. For each class, specify owner, retrieval method, budget, retention, cleanup eligibility and backup obligation. No blanket "cache" designation or retention timeout applies to unresolved work.

P028 owns base pagination and sequence/revision semantics. Its authorization, session-bound cursors and exact ordering remain; this plan adds bounded search/segmented-item retrieval with query-bound cursors where applicable. Initial snapshots, incremental events and earlier pages must compose consistently across concurrent writes, API restart and SSE resync. Set page/item/response byte limits independently of total conversation size. Bound PG queries and output buffering; browser pagination alone is not a bounded backend design.

Preserve exact assistant text and stable native item/turn mappings across chunks, deltas and authoritative completion. An oversized per-item update must not force an unbounded single response or throw merely because one display unit is too large. Keep existing tool-output/diagnostic truncation separate and explicitly labelled. Resource and control records must still be persisted before publication.

Audit all fixed lifetime constraints, including 2 MiB/2,000 messages, 400 ordinary/500 total operations, 100 approvals and actor intent retention. Distinguish outstanding-work safety limits from accumulated completed history. Preserve per-target cancellation/approval/recovery reservations and the supported idempotency retry window. Expired intent cleanup must continue rejecting stale replay rather than creating a fresh external effect. P019's unanswered approval records, if delivered, remain ineligible for age-based cleanup.

Global/project admission remains finite and transactional under concurrent sessions. Physical database/disk failure still requires truthful uncertainty and may stop execution; this proposal does not promise continuation without durable storage. Define safe low-water/high-water behavior and bounded output headroom so new work stops before administrative controls are starved. Do not weaken managed filesystem quotas or claim equivalent native-history hard limits in personal mode.

Migration preserves existing messages, references, manual titles, uncertain operations and historical effects. P028's already omitted bytes are unavailable: preserve truncation notices and never claim migration reconstructed them. Newly received replies may be preserved only within this plan's accepted finite budgets. If P029 typed items already exist, count and preserve them; otherwise use extensible bounded records without requiring P029. Update module registration and consistent backup/restore acceptance for new storage structures. Recovery reports must distinguish unavailable/truncated native reads from complete PG history; they cannot overwrite confirmed history or claim reconstructed completeness without evidence.

## Implementation brief

Future main settles the data-class and budget contract, profiles, exact schema/API changes and file fence before assigning implementation. After P028 is Implemented, a fresh-context implementer extends storage admission, segmented output/retrieval/copy, bounded search, lifecycle maintenance and visible capacity feedback together. Do not replace the inherited snapshot/pagination protocol with a competing contract. Do not implement this proposal as a constant increase or deletion job. Use synthetic long histories in run-owned PG/native fixtures, never the owner's production chats.

## Exact file fence

The paths below are a prospective feature-implementation fence, not authorization to edit them during this audit. The current audit edits only the fourteen selected Draft proposals. Main must settle any missing new paths and check provisional decision/migration numbering before acceptance.

Exact new decision, migration, helper, probe and test paths needed by the selected design must be allocated before acceptance; generated protocol files are not hand-edited to claim support.

- `design/proposals/021-long-conversation-history-and-capacity.md`
- `design/architecture.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/002-workspaces-and-resources.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `packages/storage/src/index.ts`
- `packages/storage/src/turns.ts`
- `packages/storage/src/capacity.ts`
- `packages/storage/src/maintenance.ts`
- `packages/storage/src/deployment-modules.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `apps/supervisor/src/conversation-output.ts`
- `apps/supervisor/src/main.ts`
- `apps/supervisor/src/recovery.ts`
- `apps/api/src/server.ts`
- `apps/api/src/history.ts`
- `apps/api/src/config.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/History.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/message-responses.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p007.ts`
- `tests/fixtures/codex/server.mjs`
- `tests/contract/history.test.ts`
- `tests/deployment/modules.ts`
- `docs/user/conversations.md`
- `docs/developer/development.md`
- `docs/developer/deployment.md`

Future evidence uses `.test-runs/p021/` with per-run resource manifests. The final fence must include every affected persistent-store registry/restore path after source inspection; the draft list does not waive that requirement.

## Verification and acceptance

- **P021-01:** Using actual Harbor UI/API/PG/supervisor and an external runtime fixture, cross the old 2 MiB, 2,000-message and 400-operation admission boundaries independently. Continue the same native thread with only new input; verify each response and durable operation.
- **P021-02:** Audit approval/intent/control counts separately. Saturate active work or real storage limits while preserving bounded cancellation, answering and recovery. Completed-history growth cannot consume reserved controls unexpectedly.
- **P021-03:** Stream an assistant item beyond the old per-item bound and cross the old aggregate output threshold during execution. Preserve newly received complete content/order/copy after reload within accepted finite budgets, without mailbox poisoning caused solely by those old logical limits. Older P028 truncations retain notices and are never presented as recovered content.
- **P021-04:** Regression-test P028's load/pagination and extend large-item/search retrieval under explicit serialized-response-byte/query/memory/time budgets. Cover concurrent new output, renamed sessions, SSE gaps and API restart without duplication, missing pages or false search completeness.
- **P021-05:** Cross configured warning/admission thresholds with simultaneous sessions. Refuse new work predictably, retain submitted drafts and preserve administrative headroom; record overshoot bounds and physical-storage failure behavior honestly.
- **P021-06:** Retention/compaction and retries cannot delete live approvals, uncertainty, required intent evidence or referenced attachments. Old replay keys cannot cause a second external effect after cleanup; historical audit identity stays usable.
- **P021-07:** Migrate representative old/large data and exercise the declared backup/restore and rollback compatibility in an isolated environment. Retain native/PG mappings and provenance; incompatible downgrades are rejected.
- **P021-08:** Actual pinned-runtime continuation and bounded recovery checks distinguish native context from PG history, including native-read truncation/unavailability. Never treat inaccessible native history as an empty conversation.
- **P021-09:** Inspect inherited older-history loading plus segmented large responses, complete-turn copy across unloaded chunks, storage pressure, error/retry and keyboard/touch states at desktop/mobile sizes. Guide/prototype and actual UI agree.

Future gate: `pnpm build`, `pnpm check`, `pnpm test`, relevant real-stack E2E and critical regressions, plus pinned-runtime contracts/live smoke for continuation/recovery integration. Changed storage/quota/restore boundaries require the applicable actual Linux and installed restore lanes; main must name exact commands and prerequisites after settling the design. Unavailable mandatory evidence blocks completion, not unrelated progress.

## Rollout and recovery

Measure candidate growth and query behavior before promotion. Back up compatible PG/native/attachment state and validate any new module registry. Prefer additive changes with explicit historical backfill bounds; do not irreversibly prune history merely to enable rollout. Define old-client pagination compatibility and rollback before switching. No production data operation is authorized by this draft.

## Review and findings

Proposal drafting checks are not capacity or performance evidence. Future fresh-context design/provenance reviewers must check data preservation, quota/control invariants and measured source-matched outcomes after the complete gate; fixes and review are capped at three rounds under the workflow.

## Closing record

Pending. This proposal retains the need to settle storage responsibilities and numerical limits; it neither deletes a store nor promises unlimited history.
