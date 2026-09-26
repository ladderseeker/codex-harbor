# P020 — New conversation drafts

## Metadata

- ID: P020
- Status: Draft
- Priority: Medium, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-20
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Opening a new conversation and sending nothing leaves no empty formal conversation, while meaningful unsent work is preserved.
- Authorization: On 27 September 2026 the owner authorized evaluation and revision of the open proposals, followed by commit and push of these document changes to `main`. Feature implementation, live experiments and deployment are outside this audit.
- Baseline: Source inspection of `bb85e1034e756d589d0d0c1c631616c5c9f2b7f7`; no new browser or persistence test.
- Dependencies: Existing authenticated creation, turn idempotency and profile-aware composer are implemented. Existing attachment drafts are session-bound and need an explicit draft-to-session design before acceptance. No hard dependency on P018/P019/P021/P022.
- Source issues: None transferred; owner-reported behavior initiates this draft.
- Design references: [Conversation identity and history](../systems/001-conversations-and-access.md), [attachments](../systems/002-workspaces-and-resources.md), [profile capabilities](../systems/004-deployment-and-profiles.md), [composer/navigation](../systems/006-interface.md), [state/API invariants](../architecture.md#api-events-and-state-transitions).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P020-01–P020-08.

## Review note — 27 September 2026

Read-only source review against `e6c2a138563139650af46fe51af44c6eb6c28743`; the original baseline in Metadata and dated evidence remain historical. The proposed design now uses transient untouched pages and lazy server drafts for meaningful input, including personal attachments. Draft/upload accounting, exact schema/backup paths and the total serialized/storage budget must be settled before acceptance. This audit runs documentation checks only and adopts no canonical feature contract, performs no application/runtime/Linux acceptance and closes no issue.

## Historical review note — 25 September 2026

The [project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities) recommends priority Medium. [P024](archive/024-attachments-and-chat-composer.md) added personal attachments on 21 September, so the original drafting statement that personal attachments were disabled was outdated; the revised body includes them. That review suggested considering browser-only drafts. The 27 September proposal revision selects transient untouched browser state plus lazy server drafts for meaningful input, because refresh-safe personal attachments need an upload owner before a session exists; this remains a proposed design.

## Problem, outcome and exclusions

[New chat](../../apps/web/src/App.tsx) immediately calls [session creation](../../apps/api/src/server.ts). The server inserts a session before a message exists, and listings include that unarchived row. Repeated abandoned clicks therefore leave empty conversations and spend the session-count quota. Runtime startup itself already waits for a submitted turn.

Introduce a pre-conversation draft. A completely untouched new page is transient; a meaningful unsent draft remains recoverable. The first accepted send creates the formal conversation and its initial operation together. Preserve model, effort, permission and project/workspace selection through that transition.

Excluded: deleting historical empty conversations automatically, changing archival into deletion, a general draft-management application, exposing attachments in currently unsupported profiles, altering existing conversation recovery, and enabling cross-device draft collaboration. Existing explicit API session creation may continue to create an empty session for clients that intentionally request one; the browser's automatic New chat flow uses the new draft contract.

## Dependencies and current design

The [attachment store](../../packages/attachments/src/store.ts) and [rich-draft hook](../../apps/web/src/Attachments.tsx) assume a session identity. Hiding empty rows alone would leave quota use and upload ownership unresolved. Before implementation, update current conversation/workspace/interface designs for draft identity, staged attachment ownership and atomic publication.

Proposed design: create no PG draft for an untouched page; lazily persist an owner/project/workspace-bound server draft after meaningful text, explicit settings or a supported upload. Keep drafts separate from formal `sessions`, history search, execution leases and session quota. They preserve text, attachments and explicitly chosen model/effort/permission through refresh. P030 supplies defaults once for an untouched new draft; changed project preferences never overwrite explicit or restored settings. Browser state carries draft identity and transient editing state, not authentication secrets. Cross-device collaborative editing is excluded; revision CAS still protects concurrent tabs/devices.

Proposed retention is 24 hours of inactivity, matching current drafts/staged files, with at most 20 unconsumed drafts per owner and the existing 32 KiB UTF-8 text ceiling per draft, including the schema's JavaScript string-length guard. Current turn and draft validators enforce both checks. Main must separately settle a finite total serialized/storage budget for text, settings and metadata before acceptance. Draft files share existing instance/upload budgets and per-draft equivalents of current per-session limits; session and draft ownership cannot double-allocate capacity. No accepted reference expires. Before acceptance, settle autosave/debounce, save-failure and expiry presentation, multiple-draft resume and unpublished-upload cleanup, plus exact schema/route/backup paths. These choices must preserve already-entered text and attachments or clearly explain expiration; they cannot be implemented as indiscriminate deletion of every session with zero messages. Draft limits and new endpoint/schema names below are proposed, not available APIs.

## Source issues

No existing issue is transferred or closed. [Attachment regression evidence](../../issues/2026-09-08-044009-p005-selection-regression.md) remains an existing regression obligation; this draft neither assigns its unexplained historical cause nor claims it fixed.

## User and API flows

1. New chat opens a blank composer for the chosen project without an API session-create call. Leaving an untouched page creates no history row or runtime.
2. Meaningful text/settings or a supported file upload creates/updates a draft with its own revision. Switching to another conversation and back preserves unsent content. Refresh restores the last acknowledged save; unsaved/save-failed state is visible rather than falsely marked saved.
3. Proposed owner-authenticated draft endpoints provide create/read/update/discard and `POST /api/v1/conversation-drafts/:id/send`. Final route/schema names require acceptance. These endpoints remain owner-browser-only; no token scope is implied. Every mutation keeps Origin/CSRF, current resource authorization and durable idempotency.
4. First send freezes the submitted intent with P024's synchronous reservation, then validates input, project/workspace identity, permissions, model/effort/modalities, draft revision, attachments and normal admission. Recheck current authority after ordered locks. An unavailable saved setting needs visible correction; never silently select stronger authority. In one PG transaction, allocate the session, admit its first turn, associate validated uploads and store the consumed draft-to-session mapping.
5. If acceptance fails, retain the draft and a retryable explanation; no orphan formal session or partial attachment move is published. If the response is lost after commit, retry the same intent and discover the same session/operation. A second tab cannot consume the draft twice. A delayed acknowledgement clears only the accepted revision and cannot erase newer local or saved edits.
6. After acceptance, display the formal conversation immediately, reconcile its title through the existing fallback rules and let the supervisor execute normally. A runtime startup failure after durable acceptance is a real failed/uncertain conversation, not a reason to hide or delete it.

Unpublished drafts need a lightweight return path distinct from normal conversation history; reuse the existing navigation/composer patterns. Final presentation must be demonstrated in the UI guide/prototype before application changes. No new visual language or extra confirmation is needed for abandoning an untouched draft.

## Contracts, state and security

Draft state is unconsumed, consumed with a durable session/operation mapping, explicitly discarded, or expired with an honest user-visible result where applicable. Revision conflicts and expiry preserve unsaved local text/settings for explicit recovery; a failed/offline save never claims durable success. The UI distinguishes saved, unsaved and expired data, including that expiry is a retention action. Consumed mapping/idempotency retention must cover the supported retry window; cleanup must not make a lost-response retry create a second conversation.

Associate each draft with the authenticated owner and exact selected project/workspace; changing target requires revalidation. Upload preparation keeps existing size, media, hash, ownership and expiration checks. Staged uploads can reference a draft before session publication; the consume transaction establishes their formal references without making files public. P024's delivered personal attachments are included. Only capabilities that the current profile actually lacks remain disabled.

Separate limits for draft count/bytes and staged files prevent using drafts to bypass existing storage protection. Garbage collection marks eligibility, rechecks revision/consumption and upload references, and removes only owned expired/discarded draft resources. It cannot delete an accepted operation, attachment reference or pre-existing empty conversation. Logout, revoked authority or project archival cannot publish a draft under stale rights.

## Implementation brief

Future main settles draft persistence, endpoint and retention decisions, then updates canonical designs and finalizes exact paths. A fresh-context implementer delivers UI state, API/PG atomic send and attachment lifecycle as one outcome. Preserve intentional API creation compatibility and existing-session autosave. New file requirements and unresolved behavior return to main before dependent edits.

## Exact file fence

The paths below are a prospective feature-implementation fence, not authorization to edit them during this audit. The current audit edits only the fourteen selected Draft proposals. Main must settle any missing new paths and check provisional decision/migration numbering before acceptance.

Exact new decision, migration, helper, probe and test paths needed by the selected design must be allocated before acceptance; generated protocol files are not hand-edited to claim support.

- `design/proposals/020-new-conversation-drafts.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/002-workspaces-and-resources.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/web/src/App.tsx`
- `apps/web/src/Attachments.tsx`
- `apps/web/src/History.tsx`
- `apps/web/src/api.ts`
- `apps/api/src/server.ts`
- `apps/api/src/history.ts`
- `apps/api/src/attachments.ts`
- `apps/api/src/config.ts`
- `packages/attachments/src/store.ts`
- `packages/storage/src/turns.ts`
- `packages/storage/src/index.ts`
- `packages/storage/src/maintenance.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p005.ts`
- `tests/e2e/p014.ts`
- `tests/e2e/navigation.ts`
- `tests/personal-vps/e2e.ts`
- `tests/integration/attachments.test.ts`
- `docs/user/conversations.md`
- `docs/user/attachments.md`
- `docs/developer/development.md`

Future evidence uses run-specific `.test-runs/p020/` paths and isolated fixtures. Migration registration/backup paths must be explicitly added after inspection if new persistent records require them; they cannot be silently omitted.

## Verification and acceptance

- **P020-01:** Click New chat repeatedly, switch projects, leave and reload without typing. Verify no new formal sessions/history rows, no session-quota consumption and no runtime startup through actual UI/API/PG/supervisor.
- **P020-02:** Enter text and change supported settings, switch away and return, then reload. Restore acknowledged content and selections; failed/pending save and expired-draft states are explicit. Existing conversation drafts are unaffected. Offline or failed saves block publication and retain local work; expired drafts and CAS conflicts preserve local text for deliberate recovery. P030 defaults before or after this plan never replace explicit/restored choices.
- **P020-03:** First valid send atomically creates one session, one first operation and correct message/settings. Validation/admission failure leaves the draft intact without an empty session. Intentional legacy API creation remains compatible.
- **P020-04:** Double-click, concurrent-tab consumption, API restart and dropped accepted response return the same published conversation/operation. Changed-payload reuse conflicts; cleanup cannot reopen a consumed identity. Delayed first-send acknowledgements preserve newer edits and P024 attachment/send reservations.
- **P020-05:** In every delivered attachment-capable profile, including personal VPS, stage files/images before first send, refresh, publish and verify exact associations. Test invalid media, expired uploads and failed send without data loss or leaked files. Unsupported profiles still deny upload capability.
- **P020-06:** Expire/discard and garbage-collect unconsumed draft resources with concurrent autosave/consume. Preserve accepted references and pre-existing empty sessions; enforce independent draft quotas and shared byte/upload budgets under contention with ordinary session uploads.
- **P020-07:** Revoke identity, archive the project or replace the workspace before publication. Recheck authority after locks and reject stale/cross-owner/project references and a switched target without publishing partial state. Unavailable saved model/effort/permission choices need explicit correction. Runtime failure after accepted publication remains visible as a formal conversation.
- **P020-08:** Inspect desktop/mobile, keyboard/touch and IME behavior, save/error indicators and returning to multiple drafts. Guide/prototype match the real flow. Validate the new schema's migration and module backup registration where applicable.

Future gate: `pnpm build`, `pnpm check`, `pnpm test`, selected real-stack E2E and critical regressions. Reuse identified unchanged runtime/isolation evidence; if implementation changes those boundaries, add the applicable pinned-runtime/live/Linux gates. No tests or endpoint implementations are introduced by this document.

## Rollout and recovery

Add draft records without reclassifying or deleting existing sessions. Keep old explicit API clients functional. Define how rollback preserves unpublished drafts and staged uploads before promotion; incompatible older code must not garbage-collect new ownership types. Use isolated migration/candidate data and retain recovery backups. Deployment is outside current authorization.

## Review and findings

Proposal-only review is separate from future behavioral acceptance. The complete implementation requires independent design and provenance reviews after a green gate, scoped fixes by the implementer and at most three rounds.

## Closing record

Pending. Only a Draft plan is produced; no session has been created, removed, migrated or cleaned up by this work.
