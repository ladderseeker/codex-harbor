# P023 — Sidebar and transcript refinement

## Metadata

- ID: P023
- Status: Implemented
- Archive disposition: Completed
- Completed: 2026-09-20, including owner-review corrections
- Reopened: 2026-09-20 after owner acceptance review
- Created: 2026-09-20
- Owner: Main conversation, with a fresh-context implementer and independent design/provenance reviewers.
- Outcome: Navigate recent conversations and read replies with compact, aligned controls and progressively disclosed detail.
- Authorization: The owner requested this UI improvement, proposal, implementation, commit, push and VPS deployment, with final owner review after deployment. This explicit authorization supersedes the usual request for another commit confirmation for this outcome.
- Baseline: Initial delivery used `58c8accfea66ef2852b86bbea7e9b614674aad55`; this owner-review correction starts from clean `4b438a954c0db071b9e2ccd8cb9839da02dcfe15`.
- Dependencies: Existing authenticated history cursor API, Markdown renderer, message records and dialog focus handling are implemented at baseline. Node 24.11.1 and pnpm 12.3.4 are available; Docker and SSH require scoped sandbox access. All required gates must pass before completion.
- Source issues: Owner screenshots/request; no existing issue transferred.
- Design references: [Architecture](../../architecture.md), [interface](../../systems/006-interface.md), [conversations](../../systems/001-conversations-and-access.md), [profiles](../../systems/004-deployment-and-profiles.md), [visual guide](../../design-tokens.html), [prototype](../../prototypes/harbor-redesign.html).
- Exact file fence: [Current correction fence](#correction-file-fence-and-ownership); the initial delivery fence is retained as history.
- Acceptance IDs: Initial delivery P023-01–P023-07; current owner-review correction P023-R1–P023-R5.

The initial plan and closing record below preserve the first completed delivery. The [owner-review correction cycle](#owner-review-correction-cycle--20-september-2026) governs the reopened scope, fence and current gate; it supersedes initial-scope statements only where explicitly extended.

## Problem, outcome and exclusions

Long sidebar histories, inline search filters, faint ellipsis controls and centered action text make navigation cumbersome. User copy occupies the bubble, code copy sits below the block without syntax coloring, and each command contributes a full message heading and vertical spacing even while collapsed.

Deliver one cohesive navigation and reading improvement. Report downloads/browser previews are a separate resource-delivery outcome retained in [the follow-up issue](../../../issues/2026-09-20-120000-conversation-report-downloads.md): personal VPS currently excludes the managed file API. Do not expose arbitrary model paths as download links. New conversation drafts, capacity, approval delivery and native naming remain with P018–P022 and are excluded. No runtime protocol, execution policy, API authority, schema or migration changes.

## Dependencies and current design

`apps/web/src/History.tsx` already calls the authenticated, filter-bound `/history` cursor API. Change the requested page size from 20 to 5; retain the API's ordering and exact cursor. `/sessions` metadata refresh is not a replacement for paged history. Use existing React dialog focus/inert behavior for modal search.

The current interface requires bottom-right code copy and inline current-project search. This proposal explicitly replaces those presentation contracts in the canonical interface and visual guide before application implementation. Search remains explicitly scoped to the selected project, with active/archived/all conversation filters and archived-project visibility; results live in the dialog and sidebar history remains active-only. Do not imply global search.

Add pinned `highlight.js@11.11.1`, using its core and an explicit grammar registry. The [official release](https://github.com/highlightjs/highlight.js/releases/tag/11.11.1) and [core API](https://highlightjs.readthedocs.io/en/latest/api.html) were inspected on 20 September. Use explicit language selection, safe fallback and no automatic detection, remote loading or language services. Register common JavaScript/TypeScript, Python, shell, JSON, YAML, HTML/XML, CSS, SQL, Go, Rust, Java, C/C++ and Markdown aliases. Highlight at most 32 KiB per code block; larger/unknown/unlabelled/Mermaid source remains escaped readable text. Memoize by text/language; copy always uses the untouched source. Use only trusted grammar output for markup, never raw model HTML.

## Source issues

No existing obligation is closed or transferred. The report-download issue owns the separately excluded owner request, including safe Markdown/HTML preview assessment. Existing live/restore/profile obligations remain unchanged.

## User and API flows

1. Each expanded project shows the latest five active conversations. **Show more** requests five more, disables while pending, retains loaded rows on failure and exposes retry. Refresh preserves the loaded depth, deduplicates IDs and rejects stale query/project responses. Collapse/reopen may reset to five. Opening an older conversation never navigates away merely because it is outside the first page.
2. The magnifier opens a centered compact search dialog with initial input focus, explicit project scope and filters, paged results, loading/empty/error states, Escape/backdrop dismissal and focus restoration. The prominent top row holds a magnifier, search input and close control; avoid repeated visible title/field labels while retaining accessible names. Put scope and active/archived/all filter on one compact secondary row, with archived-project visibility nearby. Results are borderless rows with a leading icon and left-aligned text, using neutral hover/selection states. Selecting a result closes the dialog and opens that conversation. Search does not filter or expand the sidebar behind it. Preserve archive/restore and keyboard/touch usability.
3. Project/session ellipses use visible round dots and discoverable neutral contrast, with hover, focus and persistent touch access. Menus/settings use a fixed leading icon column and left-aligned labels. Preserve existing targeted actions, revisions and drafts.
4. User copy sits beneath and outside its bubble, hidden at rest on hover-capable pointers, visible on message hover or keyboard focus and on touch. Copy failures remain readable. Assistant full-response copy/reactions remain unchanged.
5. Each code block has a single neutral header with language at top left (Text when absent), copy at top right and an internally scrollable body. Syntax color is a documented content-only exception to the neutral shell. Preserve exact clipboard bytes and safe streaming/rendering.
6. Consecutive tool messages in the same operation form one compact activity disclosure, closed initially, including during streaming. Its summary reports command count/running state; clicking reveals literal individual command details. Expansion survives message updates. No repeated Harbor headings/timestamps when collapsed. Approvals, input requests and actionable failure/uncertainty controls remain visible.
7. Shell surfaces use equal-channel white/gray values and existing system typography, spacing and compact composer. Preserve the documented green resource-status exception; syntax colors never tint shell surfaces.

## Contracts, state and security

All durable messages, history, metadata revision/idempotency and server authority remain unchanged. Pagination, search, disclosure and hover state are browser presentation state. Read failures never imply mutation success. No new runtime methods, filesystem access or downloads. Preserve raw-HTML rejection, unsafe URL filtering, remote-image link behavior, GFM and exact source copy. Frontend dependency assets are locally bundled under the existing CSP.

## Implementation brief

Main owns proposal, follow-up issue, combined evidence and deployment. The implementer reads the named designs, workflow, developer guide and implementer role first, then updates visual guide/prototype and current interface contract before application use. One implementer owns all implementation paths to avoid shared App/prototype edits. New decisions/fence changes return to main. No implementer commits, pushes or deploys. Private checkpoint/evidence root: `.test-runs/p023-ui-refinement/`; fresh harness resources retain their own identities. Main freezes code/dist during final gates.

## Exact file fence

- `design/proposals/023-sidebar-and-transcript-refinement.md`
- `design/proposals/archive/023-sidebar-and-transcript-refinement.md` (completion move)
- `issues/2026-09-20-120000-conversation-report-downloads.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/web/src/App.tsx`
- `apps/web/src/History.tsx`
- `apps/web/src/Icons.tsx`
- `apps/web/src/MarkdownMessage.tsx`
- `apps/web/src/MessageActions.tsx`
- `apps/web/src/ConversationActivity.tsx`
- `apps/web/src/code-highlighting.ts`
- `apps/web/src/styles.css`
- `package.json`
- `pnpm-lock.yaml`
- `tests/integration/markdown.test.ts`
- `tests/integration/message-actions.test.ts`
- `tests/integration/conversation-activity.test.ts`
- `tests/e2e/p014.ts`
- `tests/e2e/p007.ts`
- `tests/e2e/message-actions.ts`
- `tests/e2e/p023.ts`
- `tests/e2e/run.ts`
- `tests/fixtures/codex/markdown.mjs`
- `tests/fixtures/codex/server.mjs`
- `docs/user/conversations.md`
- `docs/developer/development.md`
- `docs/reports/2026-09-20-sidebar-and-transcript.md`

## Verification and acceptance

- **P023-01:** Real-stack history with more than ten conversations shows five, fetches five per Show more, retains depth across metadata refresh and does not duplicate, jump selection or erase drafts; loading/error/retry and stale-result protection checked.
- **P023-02:** Real browser modal search, filters, older result selection, archive/restore, no-result and error handling; keyboard focus trap/Escape/restoration and mobile overlay interaction. Existing history authority and persistence regressions retained.
- **P023-03:** Inspect project/session/settings action alignment, ellipsis legibility and hover/focus/touch behavior on desktop/mobile. Existing rename/status/settings actions remain functional.
- **P023-04:** User copy is outside the bubble, hover/focus/touch accessible with exact text and visible failure; code headers/copy and common syntax coloring work through streaming/reload; unknown/large/malicious content safely falls back. Raw Markdown/source and assistant toolbar regressions retained.
- **P023-05:** Multiple real persisted tool records render as one initially closed disclosure per consecutive operation group, preserve expansion during updates and expose exact diagnostics on demand; approvals/errors remain actionable.
- **P023-06:** Render and inspect guide/prototype and actual application at desktop 1440×1000 and mobile 390×844 including overflow/focus/touch; assert neutral shell backgrounds and documented semantic exceptions.
- **P023-07:** `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e --design`, full critical `pnpm test:e2e`, docs/whitespace and both reviews pass; preserve source digests, raw command exits and screenshots. Build and test the immutable Linux candidate, verify inventory, drain/checkpoint/promote, inspect installed version/assets/auth denial and changed browser flows. No new runtime/live/isolation gate is applicable because those boundaries are unchanged; historical evidence is not recast as a fresh certification.

## Rollout and recovery

Follow [personal VPS deployment](../../../docs/developer/personal-vps.md) and inspect installed configuration/identity first. Reuse the reviewed fixed candidate packaging/staging/promotion approach only after reading its scripts. Build outside live/source projects under a disposable nonroot builder. Preserve complete runtime layout, site writable-path drop-ins, proxy, credentials and state. No migration expected; compare migration inventories before switching. Drain active operations, retain a root-private matched database/native/config/unit checkpoint and exact predecessor. Promotion must identify tested source/artifact and successful services/assets. A failed readiness check leaves the candidate unpromoted or uses the documented compatible predecessor recovery; never restore over new work silently. SSH remains the recovery route. The owner already authorized commit, push and deployment.

## Review and findings

Three independent review rounds completed. Round one cleared design and required complete candidate source/package linkage evidence; the same implementer added the reviewed verifier and actual Linux receipts passed. Installed acceptance exposed first-Escape dismissal, corrected and rechecked in round two; that design review also found nested-menu Escape propagation, fixed by the same implementer and verified before deployment. Round three cleared final candidate, installed evidence and closing claims. No scoped findings remain. Reviewer messages are review evidence, not complete exported session transcripts.

Before the independent review gate, main inspected the first rendered prototype and required a compact search layout instead of stacked form fields and individually outlined results. The owner reference and existing P023 interaction scope support this presentation correction; it adds no API or product scope. The implementer updates guide/prototype/application together and reruns affected visual/application checks.

## Initial closing record — 20 September 2026

Completed on 20 September 2026. P023-01–P023-07 passed: five-item history and load-more, current-project modal search, aligned discoverable actions, outside-bubble copy, labeled highlighted code, compact folded commands and neutral surfaces. Current interface design, guide/prototype and user/developer docs are aligned.

Implementation was committed and pushed as `814ad3d83ffe1291fd7ffb3e003923db2ffa7ee3`, followed by reviewed Escape corrections in `606d6cc75baa3a3713269472d5784f1d9ee522e6`. Final source digest: `e970832b7281cb3241bc2a3202c2cbca0a6ae7bb0f0454e7048790f954abdc57`. Local build/check, all 39 unit tests, real design and full critical E2E passed; the fresh Linux locked build/unit/design gate and complete before/after package verification passed. Final deployed release is `/opt/harbor-personal/releases/p023-606d6cc75baa`, manifest SHA256 `1af0c3fd1d8f5433c56ad9262fdb1e1b6cf4c3267fa094d9155eda7cb4ae251f`, with a matched private backup and predecessor retained.

Installed service/executable identity, HTTPS/auth denial, signed-in browser Escape and presentation checks passed. After explicit owner approval, a disposable project conversation read and edited only its canary file; its retained runtime was stopped. Three independent review rounds are clear. The [delivery report](../../../docs/reports/2026-09-20-sidebar-and-transcript.md) records commands, identities, failed attempts, review dispositions and evidence limits. The proposal was drafted and accepted under the owner's implementation authorization on this same date.

[Report downloads and safe browser previews](../../../issues/2026-09-20-120000-conversation-report-downloads.md) remain a separate capability. This completion does not close historical runtime-isolation or protected restore obligations. The documentation closing commit follows the installed application commit; it does not change the deployed artifact.

## Owner review correction cycle — 20 September 2026

The owner reviewed the deployed result and requested correction of history alignment, project action order, redundant settings text and user-message action symmetry. P023 is reopened under the workflow, preserving the initial completion and its three review rounds above as historical evidence. This newly authorized correction cycle has its own fresh-context implementer and independent review gate, capped at three rounds. Current baseline is clean `4b438a954c0db071b9e2ccd8cb9839da02dcfe15`; the installed application is `606d6cc75baa3a3713269472d5784f1d9ee522e6`. The owner again explicitly authorized commit, push and VPS deployment without another permission gate.

### Settled correction scope

- **P023-R1:** Align sidebar Show more and loading text with the session title text, preserving five-item pagination and its states. Use the same inset for empty/error/retry history states where applicable. Keep modal search layout separate. Verify actual text coordinates on desktop and mobile, not only CSS declarations.
- **P023-R2:** Order project controls as project label, New chat, ellipsis. Align project/session ellipsis centers at the same trailing column in both hover and resting layouts, including touch. The Projects heading Add project (+) button shares this same trailing center column, as additionally requested by the owner during implementation. Verify all three target centers and the actual glyph centers together across sidebar widths and mobile/touch. Session and project ellipses use centered 16px SVGs; a correctly positioned control box alone does not establish visual alignment. Normalize the existing one-pixel row-end padding difference if necessary; preserve target sizes, discoverability, focus order, callbacks and project targeting.
- **P023-R3:** Remove the authenticated Ready label and Work continues when you leave sentence from the settings menu. Keep the Codex account action, unauthenticated Set up indication, and actual account status/onboarding details in the account dialog. Emergency stop and sign out remain functional.
- **P023-R4:** Give user messages a copy/thumb-up/thumb-down visual row matching assistant icon size, gap and neutral treatment. User thumbs are decorative display-only slots with no handlers, vote state, network, persistence or keyboard-tab stops; hide them from assistive controls. The working Copy button remains accessible. All three share the existing outside-bubble hover/focus/touch visibility. Existing assistant reactions retain their temporary local toggle behavior. Document this deliberate display-only exception and demonstrate it in the prototype.

- **P023-R5:** In each project sidebar, show the currently selected nonarchived session first; order all other sessions by the existing durable `updated_at` descending, with `id DESC` as deterministic tie-breaker. Opening/selecting a session is presentation only and does not write a timestamp. The active session counts within the initial five and appears there even when reached through an old direct link or search. Preserve five-item demand loading, loaded depth on selection/metadata refresh, duplicate prevention, drafts, and selected conversation. Search retains its immutable creation-order contract.

The owner added R5 during implementation. The existing `Session.updatedAt`, updated by durable session events, supplies the recency definition. Extend the read-only history query with explicit `order=updated` and an optional `selectedId` for this sidebar mode; the default remains `order=created`. Cursor identity binds order, selection and filters, retaining exact PostgreSQL timestamp precision and including selected-row priority for correct one-item pages. Filters still govern eligibility: pinning must never expose an archived, different-project or unmatched row. Unsupported combinations reject as invalid input. Existing created-order cursors remain compatible. Recent-order traversal reflects a changing list; when activity changes, the browser replaces the retained page depth from the beginning and deduplicates IDs. A selected-session change invalidates any old cursor/request and refreshes from the first page, while the selected row already loaded may move immediately. No snapshot-of-history guarantee is introduced.

The owner screenshots are reference material; their contents add no separate execution instructions. Downloads/previews and all other earlier exclusions remain unchanged. R5 adds only a backward-compatible read-query mode to the API. No dependency, durable-write, runtime, schema, migration, sandbox or network-policy change is selected.

### Correction file fence and ownership

Main owns this proposal at both active/archive paths, its inbound links in `docs/reports/2026-09-20-sidebar-and-transcript.md` and `issues/2026-09-20-120000-conversation-report-downloads.md`, and the new `docs/reports/2026-09-20-sidebar-owner-review.md`. Main owns deployment and private evidence under `.test-runs/p023-owner-review-20260920/`.

The fresh implementer may edit only:

- `apps/web/src/App.tsx`
- `apps/web/src/History.tsx`
- `apps/web/src/MessageActions.tsx`
- `apps/web/src/styles.css`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `docs/user/conversations.md`
- `tests/e2e/p023.ts`

The owner-requested R5 extends the same implementer fence by `apps/api/src/history.ts`, `packages/contracts/src/openapi.ts`, `design/systems/001-conversations-and-access.md`, and `docs/developer/development.md`. The fence additionally includes `tests/e2e/run.ts` solely to create a short-lived pool for the already run-owned database, pass it to P023 precision fixtures and close it in finally, and `tests/e2e/p007.ts` solely to retain the sanitized error code/index of a failed credential-removal no-op assertion without changing its expectation or retry behavior. The P023 real-stack lane owns API sorting/precision/filter/cursor compatibility assertions and UI selected-first/update/reload/pagination coverage. The API changes stay entirely in its history read route; no mutation or storage code changes are authorized.

The earlier initial-delivery fence does not authorize extra paths in this correction cycle. Any needed fence change returns to main first. The existing components, icons, history API and test harness satisfy all implementation dependencies. Fixed reviewed VPS scripts may be reused only after identity verification, in fresh revision-specific candidate directories.

### Correction acceptance and deployment

Update current interface/guide/prototype contracts before application use. Render the changed prototype and real application desktop/mobile/touch states, including history loading/empty/retry and user-action hover/focus. Extend the existing real P023 lane with observable coordinate/order/text/decorative-slot assertions while preserving prior pagination, modal, clipboard, command and critical assertions. Run `pnpm build`, `pnpm check`, all unit tests, `pnpm test:e2e --design` and the full critical suite on identified frozen source. Under the canonical unchanged-boundary rule, a subsequent purely visual CSS/test correction may reuse the green critical lane when an exact file delta proves its covered runtime/behavior inputs unchanged; rerun the affected visual/design/build/check gates and have both reviewers assess that evidence scope. Retain exact source identities, raw logs/exits and screenshots; no unrelated new unit tests are required for these presentation corrections.

After green local gates, start fresh-context design and provenance reviewers. Main adjudicates and the same implementer fixes within this cycle's three-round cap. Build and test a fresh immutable Linux package from the reviewed committed source, verify full source/package equality before and after acceptance, stage it, drain and checkpoint the installed predecessor, and promote with service/executable/HTTPS/auth checks. Use the already owner-approved disposable P023 UI acceptance conversation for read-only installed presentation checks; no new project registration or model turn is required. The promotion verifier must explicitly allow the reviewed `apps/api/src/history.ts` byte change by exact predecessor/candidate hashes while retaining equality checks for every other backend/runtime/migration input. Earlier live canary/native evidence at `606d6cc` is reused for unchanged execution boundaries, with its limits explicit.

The [owner-review report](../../../docs/reports/2026-09-20-sidebar-owner-review.md) will record this correction cycle separately. Keep the original report and initial closing record historical; restore Implemented/Completed only after all five correction acceptance IDs, mandatory gates, reviews and deployment pass, then archive the same proposal filename and repair links.

### Correction reviews

Round one is clear: fresh independent design and provenance reviewers verified final source `8afe1f6e2eb260a4cd71d121c0f4f7b75e87c9a064c680dbc46d99896f7eaa79`, local build/check/unit/design, final glyph alignment and the exact visual-only delta supporting critical02 reuse. No actionable findings remain in the reviewed local candidate. Round two cleared the completed Linux candidate, promotion, installed evidence and closing claims in both roles. Neither round found an actionable issue. Main accepts both assessments; R1–R5 and every scoped gate are complete.

Round three cleared the final documentation-only archive, metadata and link changes in both roles. All four closing document hashes and 161-file documentation validation passed, with explicit new-file whitespace/newline checks. Main accepts both clear assessments; no scoped findings remain and this correction cycle closes within its three-round cap.

### Correction closing record — 20 September 2026

All R1–R5 implementation and local/Linux gates are complete. Application commit `a94f4c1f8bed550efe010caf346a66db5c45b123` is pushed and deployed as `/opt/harbor-personal/releases/p023-a94f4c1f8bed`, manifest `e153ca89e91d4abc203e161d56fd6cddf9a0fbe1c07cf81c2976d1292a9cbc7d`. Final source is `8afe1f6e2eb260a4cd71d121c0f4f7b75e87c9a064c680dbc46d99896f7eaa79`; all 39 unit tests, build/check and final design pass locally, and the Linux locked build/unit/design and full unchanged-input verification pass. The green critical02 source and exact visual-only reuse delta remain explicitly recorded. Main verified installed service/binary/auth identity and read-only UI on the previously approved disposable conversation. The matched private backup and exact prior release are retained.

The [owner-review report](../../../docs/reports/2026-09-20-sidebar-owner-review.md) records evidence, failed attempts, review dispositions and limits. Both independent review roles cleared completion in round two. Main restored Implemented/Completed and archived this proposal under the same ID/filename, preserving the initial delivery history and repairing inbound links. The documentation closing commit follows the deployed application commit and changes no application or built assets. Downloads/previews and the earlier unexplained credential-test 409 remain separate open obligations.
