# P022 — Native conversation titles with a safe fallback

## Metadata

- ID: P022
- Status: Draft
- Priority: Low, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-20
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Harbor uses a reliable native conversation name when available, retains a useful fallback and never overwrites the owner's manual title.
- Authorization: Write the proposal only. Capability experiments, application implementation, commits, pushes and deployment are not authorized by this request.
- Baseline: Source/schema inspection of `bb85e1034e756d589d0d0c1c631616c5c9f2b7f7`, pinned Codex 0.153.4; no new real-model naming experiment.
- Dependencies: Existing fallback/manual-title provenance is implemented. Reliable native automatic naming and its timing/source are unverified; that evidence blocks accepting a synchronization implementation. No hard dependency on P018–P021.
- Source issues: None transferred; conditional improvement from the owner's discussion.
- Design references: [Conversation identity/history](../systems/001-conversations-and-access.md), [personal title behavior](../systems/004-deployment-and-profiles.md#conversation-driven-development-and-attached-previews), [interface](../systems/006-interface.md), [D012 history](../decisions/012-personal-vps-development.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P022-01–P022-06.

## Review note — 25 September 2026

The [project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities) recommends priority Low. The plan is unchanged and stays conditional on the native naming capability investigation. That investigation can use the owner's standing authorization, recorded in AGENTS.md, for the VPS Codex credential copied into fresh run-owned state, instead of a dedicated account.

## Problem, outcome and exclusions

Harbor currently derives an automatic title from the first substantive input, with whitespace normalization and an 80-character limit. [The migration](../../packages/storage/src/migrations/017_conversation_titles.sql) and [turn admission](../../packages/storage/src/turns.ts) preserve manual provenance. [Manual rename](../../apps/api/src/history.ts) takes precedence even if the owner chooses the default-looking title again.

The pinned generated schema contains [native name notifications](../../packages/codex-adapter/generated/v2/ThreadNameUpdatedNotification.ts) and a [thread name field](../../packages/codex-adapter/generated/v2/Thread.ts). Current dispatch persistence saves the native thread ID but does not integrate native names; thread-only notifications are not a complete turn-output path. Protocol support does not prove that app-server independently generates useful names in this deployment.

First determine whether native names actually provide the intended improvement. Only after that gate should Harbor prefer a valid native title for a non-manually-named conversation. Excluded: a separate model call for naming, reproducing Codex desktop's private client behavior, changing the pinned runtime merely to obtain names, native-name writeback, bulk resuming old threads for backfill, or degrading current fallback/manual naming.

## Dependencies and current design

The [official app-server reference](https://learn.chatgpt.com/docs/app-server) describes native title fields and update notifications. It is supporting protocol context, not proof of automatic generation in pinned 0.153.4 or of behavior exercised by this proposal.

Before acceptance, a separately authorized, bounded capability investigation must use isolated native state and dedicated credentials to establish whether a name is automatically produced, its timing, which response/event carries it, its persistence across resume, and whether the observed producer is app-server or a separate client. Record the exact version, account/model configuration, commands, source and artifact identity. Do not use the owner's ordinary Codex state or infer automation from manually calling a name-setting method.

If reliable automatic names are absent, retain the current fallback and leave this draft conditional or explicitly withdraw it with the evidence. Do not build a second naming service to make the proposal appear complete. If the capability is reliable only for certain supported configurations, define honest capability gating and fallback behavior before acceptance.

Current canonical designs must be updated with the selected name source and precedence before implementation. No canonical design is changed by writing this draft.

## Source issues

No existing issue is closed or transferred. Existing real-runtime credential or compatibility limitations remain visible with their owners. A failed naming experiment is a capability result, not permission to borrow personal credentials or silently expand scope.

## User and API flows

1. On first substantive input, provide the existing useful fallback promptly; naming never delays execution or blocks conversation creation.
2. When a validated native name is received through an established response or event, update the corresponding Harbor session only if it still has automatic/default provenance. Sidebar, header, search and reload agree.
3. Manual rename uses the existing metadata revision and authorization path. It always wins over concurrent or later automatic updates, including a manual rename back to "New conversation".
4. Empty, unsupported, unavailable or failed native naming keeps the fallback without an error that blocks chatting. A late native name may update an eligible completed conversation without requiring another active turn.
5. Resume/read can reconcile a name only through already-authorized, bounded native access. Do not start extra runtimes, resurrect archived work or send model turns just to update titles. Archived conversation visibility remains unchanged.

## Contracts, state and security

Keep explicit title provenance: default/pending, Harbor fallback, native automatic and manual, with source identity and freshness sufficient for compare-and-swap updates. Final schema names are an acceptance decision. Preserve legacy manual titles conservatively; historical `automatic` does not prove a native source.

Match incoming data to the exact native-thread/Harbor-session mapping and relevant runtime generation. A title notification need not carry an active turn ID; handle it through a separate bounded metadata path rather than weakening output event ownership checks. If a child thread is observed, never use its title for the parent conversation without an explicit validated mapping. Events from retired connections or a different thread cannot rename a session.

Native notifications do not necessarily supply a monotonic title revision. Before acceptance, specify deterministic event/read/resume reconciliation, including stale reads and racing manual updates; do not fabricate an upstream ordering guarantee. Persist the chosen update and metadata event transactionally. Native content remains untrusted plain text with a finite length, control-character handling and existing safe rendering. Invalid title data is ignored for naming without poisoning an otherwise healthy conversation.

No client gains permission to select another native thread or rename another session. Native-name ingestion does not authorize broader filesystem access, background model calls, new user-data export, or raw runtime APIs. Preserve the existing first-substantive-input rule when the native capability is missing.

## Implementation brief

Future main first commissions the narrowly scoped capability check if authorized. A positive result, settled reconciliation rules and exact path list precede an Accepted implementation plan. Then assign a fresh-context implementer the source evidence and title precedence contract. Integrate adapter metadata, supervisor persistence, migration and UI refresh as one outcome. Return new capability/ordering uncertainties to main instead of inferring them from schema names.

## Exact file fence

**Only this proposal file may be edited now.** Proposed future paths follow. Any new capability-test, migration or report path requires exact allocation in the plan before that future work; generated protocol files must not be hand-edited to claim support.

- `design/proposals/022-native-conversation-titles.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/systems/006-interface.md`
- `apps/supervisor/src/main.ts`
- `apps/api/src/history.ts`
- `apps/api/src/server.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/History.tsx`
- `apps/web/src/api.ts`
- `packages/codex-adapter/src/index.ts`
- `packages/storage/src/turns.ts`
- `packages/storage/src/index.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `tests/fixtures/codex/server.mjs`
- `tests/e2e/run.ts`
- `tests/e2e/navigation.ts`
- `tests/contract/adapter.test.ts`
- `tests/contract/history.test.ts`
- `docs/user/conversations.md`
- `docs/developer/development.md`

Use private, run-specific `.test-runs/p022/` evidence for an authorized future capability check. If a new visual pattern becomes necessary, main must add exact guide/prototype paths before implementation; simple text refresh should reuse current patterns.

## Verification and acceptance

- **P022-01:** Establish automatic native naming and timing in pinned 0.153.4 with a bounded real-runtime experiment, not a fixture or a manually set name. Identify the producer and supported configuration. An unavailable/negative result does not satisfy this gate or authorize implementation.
- **P022-02:** Through real Harbor UI/API/PG/supervisor with deterministic external events, obtain a fallback immediately and later reconcile a valid native title. Verify sidebar/header/search/reload and a late update after turn completion.
- **P022-03:** Race manual rename against native events/read responses, including manual default-looking names. Persist manual precedence and metadata revisions; no automatic path overwrites it.
- **P022-04:** Test null/empty/oversized/control-character titles, missing capability, stale generation, wrong thread and child-thread events. Preserve the fallback and active task; do not contaminate another session.
- **P022-05:** Reconcile duplicate/out-of-order events, resume and stale metadata reads according to the accepted ordering policy. Preserve archived visibility and require no extra turn or runtime solely for naming.
- **P022-06:** Migrate existing default/fallback/manual titles conservatively, verify authorization and idempotent metadata behavior, and check desktop/mobile text overflow and unchanged keyboard navigation.

Future gate: `pnpm build`, `pnpm check`, `pnpm test`, selected real-stack E2E and critical regressions, pinned adapter contracts and bounded dedicated-account live naming smoke. UI-only fixture evidence cannot satisfy P022-01. Main must settle exact probe/test commands before any authorized experiment; no new command or completed test is implied here.

## Rollout and recovery

Use a capability-gated candidate with the current fallback always available. Preserve manual provenance through migration and rollback; an older release must not reinterpret native provenance as a permission to rename manual titles. Disable unreliable automatic ingestion without changing thread identity or conversation execution. No production backfill or deployment is authorized.

## Review and findings

Drafting review can assess scope and evidence honesty while P022-01 is unavailable; it cannot constitute feature completion review. After a future complete gate, use independent fresh-context design and provenance reviewers, original-implementer fixes and the three-round cap.

## Closing record

Pending. This is the conditional fifth proposal. No automatic naming reliability, capability experiment, synchronization implementation or feature completion is claimed.
