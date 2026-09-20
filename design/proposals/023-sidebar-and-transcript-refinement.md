# P023 — Sidebar and transcript refinement

## Metadata

- ID: P023
- Status: Accepted
- Created: 2026-09-20
- Owner: Main conversation, with a fresh-context implementer and independent design/provenance reviewers.
- Outcome: Navigate recent conversations and read replies with compact, aligned controls and progressively disclosed detail.
- Authorization: The owner requested this UI improvement, proposal, implementation, commit, push and VPS deployment, with final owner review after deployment. This explicit authorization supersedes the usual request for another commit confirmation for this outcome.
- Baseline: `58c8accfea66ef2852b86bbea7e9b614674aad55`; clean main checkout inspected before edits.
- Dependencies: Existing authenticated history cursor API, Markdown renderer, message records and dialog focus handling are implemented at baseline. Node 24.11.1 and pnpm 12.3.4 are available; Docker and SSH require scoped sandbox access. All required gates must pass before completion.
- Source issues: Owner screenshots/request; no existing issue transferred.
- Design references: [Architecture](../architecture.md), [interface](../systems/006-interface.md), [conversations](../systems/001-conversations-and-access.md), [profiles](../systems/004-deployment-and-profiles.md), [visual guide](../design-tokens.html), [prototype](../prototypes/harbor-redesign.html).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P023-01–P023-07.

## Problem, outcome and exclusions

Long sidebar histories, inline search filters, faint ellipsis controls and centered action text make navigation cumbersome. User copy occupies the bubble, code copy sits below the block without syntax coloring, and each command contributes a full message heading and vertical spacing even while collapsed.

Deliver one cohesive navigation and reading improvement. Report downloads/browser previews are a separate resource-delivery outcome retained in [the follow-up issue](../../issues/2026-09-20-120000-conversation-report-downloads.md): personal VPS currently excludes the managed file API. Do not expose arbitrary model paths as download links. New conversation drafts, capacity, approval delivery and native naming remain with P018–P022 and are excluded. No runtime protocol, execution policy, API authority, schema or migration changes.

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

Follow [personal VPS deployment](../../docs/developer/personal-vps.md) and inspect installed configuration/identity first. Reuse the reviewed fixed candidate packaging/staging/promotion approach only after reading its scripts. Build outside live/source projects under a disposable nonroot builder. Preserve complete runtime layout, site writable-path drop-ins, proxy, credentials and state. No migration expected; compare migration inventories before switching. Drain active operations, retain a root-private matched database/native/config/unit checkpoint and exact predecessor. Promotion must identify tested source/artifact and successful services/assets. A failed readiness check leaves the candidate unpromoted or uses the documented compatible predecessor recovery; never restore over new work silently. SSH remains the recovery route. The owner already authorized commit, push and deployment.

## Review and findings

Pending green combined gate. Fresh-context design and provenance reviews are required, at most three rounds; main adjudicates and sends fixes to the original implementer. Record review messages as review evidence, not a complete exported session transcript.

Before the independent review gate, main inspected the first rendered prototype and required a compact search layout instead of stacked form fields and individually outlined results. The owner reference and existing P023 interaction scope support this presentation correction; it adds no API or product scope. The implementer updates guide/prototype/application together and reruns affected visual/application checks.

## Closing record

Pending implementation, gates, review, identified commit/push and installed verification. The proposal was drafted and settled as Accepted within the owner's implementation authorization on 20 September 2026. Do not mark Implemented until every scoped acceptance passes.
