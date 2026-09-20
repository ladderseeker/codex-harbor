# P021 — Long conversation history and capacity

## Metadata

- ID: P021
- Status: Draft
- Created: 2026-09-20
- Owner: Main conversation; future implementation owner unassigned
- Outcome: A conversation can continue beyond the initial per-conversation history limits while preserving useful history, bounded resource use and reliable control operations.
- Authorization: Proposal documents only; no implementation, data deletion, quota change, migration, commit, push or deployment.
- Baseline: Source inspection of `bb85e1034e756d589d0d0c1c631616c5c9f2b7f7`; no new quota-boundary or performance run.
- Dependencies: Existing PG history, native thread continuation and idempotent control reservations are implemented. Storage budgeting, bounded long-history queries and migration behavior must be settled and measured before acceptance. No hard dependency on P018–P020 or P022.
- Source issues: None transferred. Related historical bounds/recovery records remain references with their original scope.
- Design references: [Storage and retention](../architecture.md#release-retention-and-rollback-rules), [conversation/history/control bounds](../systems/001-conversations-and-access.md), [attachments/resources](../systems/002-workspaces-and-resources.md), [backup and profiles](../systems/004-deployment-and-profiles.md), [interface](../systems/006-interface.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P021-01–P021-09.

## Problem, outcome and exclusions

[Turn admission](../../packages/storage/src/turns.ts) rejects input above 2 MiB of message text or at 2,000 messages. [Control capacity](../../packages/storage/src/capacity.ts) also stops ordinary work at 400 retained operation/recovery records. The current design additionally specifies approval, intent and recovery bounds. [Assistant output persistence](../../apps/supervisor/src/conversation-output.ts) throws when its item/conversation bound is exceeded; a mailbox persistence failure can make the active operation uncertain. These are distinct constraints; increasing one constant does not deliver continued long conversations.

Separate durable history growth, bounded UI/API retrieval and execution/control admission. Keep native Codex state responsible for model context and continuation. Keep Harbor responsible for authorization, operation/approval state, deduplication, and durable displayed/searchable history. A display/history-size boundary alone must not poison an otherwise healthy running turn or force a new conversation.

Excluded: deleting the PG database/messages table, editing Codex's internal database schema, assuming every Harbor message can be regenerated from native history, promising unlimited disk/storage, automatic deletion of old conversations, changing the model's context-window behavior, and solving unrelated account/provider usage limits.

## Dependencies and current design

The current [conversation design](../systems/001-conversations-and-access.md) treats messages and unresolved operations as durable, replay events as disposable, and fixed limits as admission controls with reserved stop/recovery headroom. Native recovery repair is bounded and preserves conflicting complete Harbor items. Preserve those distinctions; do not relabel durable messages as a discardable cache to evade their requirements.

Proposed direction: retain PG conversation history as a durable projection for display and search, with bounded keyset pages and segmented large output. Replace lifetime per-conversation admission counts with explicit storage budgets and outstanding-work/control-reserve accounting. Completed records may retain compact durable representations only under a specified provenance and retry contract; no unresolved approval, unacknowledged uncertainty, required idempotency result or referenced attachment may be discarded to make room.

Before acceptance, main must specify numerical instance/project storage budgets, warning/admission thresholds, control reserves and overshoot bounds; the persistence/chunk schema; retention of completed operational payloads; exact full-text/search behavior; migration compatibility; and the supported API pagination contract. These are substantive pending design decisions, not discretionary implementation details. A focused decision and canonical design updates are required before relying on new retention semantics.

Native long-history pagination or complete native-to-Harbor reconstruction is not assumed. If a proposed solution needs an upstream capability, prove it against the pinned runtime or choose a PG-owned path. Existing dedicated [live history acceptance](../../issues/2026-09-13-110315-common-use-live-acceptance.md) remains a separate missing-evidence record.

## Source issues

No obligations are transferred. The archived [replay/control bounds correction](../../issues/archive/2026-09-07-185228-p001-retention-control-bounds.md) and [P007 findings](../../issues/archive/2026-09-07-203000-p007-implementation-review.md) must not be used as evidence for new limits. Relevant current history regressions remain in the [active regression record](../../issues/2026-09-08-020429-p007-regression-evidence.md). Existing reports and their tested revisions remain historical.

## User and API flows

1. Continue the same native thread beyond the old message-byte, message-count and retained-operation thresholds, provided actual configured capacity admits the work. Do not re-send old Harbor messages as replacement model context.
2. Open/reload a long conversation quickly through a bounded recent-history snapshot; load earlier messages using stable authorized cursors. Streaming and pagination deduplicate by stable identity and preserve order, complete-copy behavior and attachment references.
3. Search retained history with explicit, bounded semantics. Never silently omit old content while presenting results as a complete search. If any storage tier limits search or retrieval, label its boundary and expose the specified retrieval path.
4. Receive a large assistant reply without converting a storage display limit into runtime failure. Preserve full authorized reply content through segmented persistence/retrieval, or show an explicitly designed finite-retention result if that policy is accepted; do not present clipped text as complete.
5. Show approaching real capacity in contextual storage information. At a genuine admission threshold, explain the limiting resource and supported remediation while preserving draft input, inspection and stop/recovery controls. Do not instruct the owner to delete unidentified native state.

## Contracts, state and security

Maintain a documented data-class contract: native model context; Harbor user/assistant/tool history; durable operations/approval decisions; command idempotency; replay events; attachments; and diagnostics. For each class, specify owner, retrieval method, budget, retention, cleanup eligibility and backup obligation. No blanket "cache" designation or retention timeout applies to unresolved work.

Pagination cursors bind owner/project/session, query and ordering. Initial snapshots, incremental events and earlier pages must compose consistently across concurrent writes, API restart and SSE resync. Set page/item/response byte limits independently of total conversation size. Bound PG queries and output buffering; browser pagination alone is not a bounded backend design.

Preserve exact assistant text and stable native item/turn mappings across chunks, deltas and authoritative completion. An oversized per-item update must not force an unbounded single response or throw merely because one display unit is too large. Keep existing tool-output/diagnostic truncation separate and explicitly labelled. Resource and control records must still be persisted before publication.

Audit all fixed lifetime constraints, including 2 MiB/2,000 messages, 400 ordinary/500 total operations, 100 approvals and actor intent retention. Distinguish outstanding-work safety limits from accumulated completed history. Preserve per-target cancellation/approval/recovery reservations and the supported idempotency retry window. Expired intent cleanup must continue rejecting stale replay rather than creating a fresh external effect. P019's unanswered approval records, if delivered, remain ineligible for age-based cleanup.

Global/project admission remains finite and transactional under concurrent sessions. Physical database/disk failure still requires truthful uncertainty and may stop execution; this proposal does not promise continuation without durable storage. Define safe low-water/high-water behavior and bounded output headroom so new work stops before administrative controls are starved. Do not weaken managed filesystem quotas or claim equivalent native-history hard limits in personal mode.

Migration preserves existing messages, references, manual titles, uncertain operations and historical effects. Update module registration and consistent backup/restore acceptance for new storage structures. Recovery reports must distinguish unavailable/truncated native reads from complete PG history; they cannot overwrite confirmed history or claim reconstructed completeness without evidence.

## Implementation brief

Future main settles the data-class and budget contract, profiles, exact schema/API changes and file fence before assigning implementation. A fresh-context implementer delivers storage admission, output persistence, bounded snapshots/search/pagination, lifecycle maintenance and visible capacity feedback together. Do not implement this proposal as a constant increase or deletion job. Use synthetic long histories in run-owned PG/native fixtures, never the owner's production chats.

## Exact file fence

**Only this Draft proposal is writable for the current request.** Proposed future paths follow; exact new schema, decision, helper and test paths require a main-authored amendment before acceptance.

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
- **P021-03:** Stream an assistant item beyond the old per-item bound and cross the old aggregate output threshold during execution. Preserve complete content/order/copy after reload without mailbox poisoning caused solely by those old logical limits.
- **P021-04:** Load, paginate and search a large history under explicit response-byte/query/memory/time budgets. Cover concurrent new output, renamed sessions, SSE gaps and API restart without duplication, missing pages or false search completeness.
- **P021-05:** Cross configured warning/admission thresholds with simultaneous sessions. Refuse new work predictably, retain submitted drafts and preserve administrative headroom; record overshoot bounds and physical-storage failure behavior honestly.
- **P021-06:** Retention/compaction and retries cannot delete live approvals, uncertainty, required intent evidence or referenced attachments. Old replay keys cannot cause a second external effect after cleanup; historical audit identity stays usable.
- **P021-07:** Migrate representative old/large data and exercise the declared backup/restore and rollback compatibility in an isolated environment. Retain native/PG mappings and provenance; incompatible downgrades are rejected.
- **P021-08:** Actual pinned-runtime continuation and bounded recovery checks distinguish native context from PG history, including native-read truncation/unavailability. Never treat inaccessible native history as an empty conversation.
- **P021-09:** Inspect desktop/mobile older-history loading, large responses, copy, storage pressure, error/retry and keyboard/touch states. Guide/prototype and actual UI agree.

Future gate: `pnpm build`, `pnpm check`, `pnpm test`, relevant real-stack E2E and critical regressions, plus pinned-runtime contracts/live smoke for continuation/recovery integration. Changed storage/quota/restore boundaries require the applicable actual Linux and installed restore lanes; main must name exact commands and prerequisites after settling the design. Unavailable mandatory evidence blocks completion, not unrelated progress.

## Rollout and recovery

Measure candidate growth and query behavior before promotion. Back up compatible PG/native/attachment state and validate any new module registry. Prefer additive changes with explicit historical backfill bounds; do not irreversibly prune history merely to enable rollout. Define old-client pagination compatibility and rollback before switching. No production data operation is authorized by this draft.

## Review and findings

Proposal drafting checks are not capacity or performance evidence. Future fresh-context design/provenance reviewers must check data preservation, quota/control invariants and measured source-matched outcomes after the complete gate; fixes and review are capped at three rounds under the workflow.

## Closing record

Pending. This proposal retains the need to settle storage responsibilities and numerical limits; it neither deletes a store nor promises unlimited history.
