# P014 — Work through a consistent Harbor interface

## Status and outcome

- Proposal ID: P014
- Decision: Accepted within the owner's 13 September 2026 instruction to implement the approved design and decide missing details.
- Delivery: Verified
- Archive disposition: Completed
- Archive date: 2026-09-13
- User outcome: Navigate projects, start and resume conversations, and use Harbor's existing supporting tools through one coherent, responsive monochrome interface.
- Dependencies: Implemented P001–P008, P011 and P013 UI/API boundaries. Their unrelated live-account, installed-release and restore gates remain with those proposals.
- Evidence/status updated: 2026-09-13. Approved design baseline committed as `0431814`.
- Closing outcome: P014-01–06 passed; the interface, supporting workflows and bounded local folder selection are delivered.

The existing interface exposes large forms and administrative controls alongside every conversation. Replace this presentation with the approved [HTML design guide](../../design-tokens.html) and [prototype](../../prototypes/harbor-redesign.html). This selected outcome follows the owner's later instruction under [D009](../../decisions/009-common-use-release.md); it does not resume deferred P010/P012 or waive their obligations.

## Scope and prerequisites

Deliver the responsive application shell, grouped project/chat navigation, targeted chat rename, bounded sidebar resizing, compact growing composer, readable messages, and coherent supporting surfaces. Preserve accessible entry points for account setup, API tokens, history/archive/recovery, workspace management, attachments, files/change review, terminals, schedules, previews and emergency stop where existing capabilities permit them. Preserve actual lifecycle and failure information; visual simplification must not hide a required decision or remove working behavior.

For adding a project, provide a real folder browser under configured roots in the local/private-fixture profile. In managed installations, retain the approved-root relative-path form and explain that browsing is unavailable; do not add direct API host filesystem authority to the managed storage boundary. The directory picker selects a server/local-instance folder, not a browser upload. Registration and optional creation continue through the existing project API and its overlap/quota/admission checks.

Use the existing isolated deterministic application fixture with disposable database, roots, Codex state and identity provider. No migration, deployment, runtime upgrade, new integration service, Markdown rendering library, or deferred feature integration is included.

## Source issues

No issue is transferred. The [P013 critical regression gate](../../../issues/archive/2026-09-13-143001-local-critical-regression-gate.md) is relevant to verification of the shared conversation UI. Diagnose its missing-composer failure with bounded diagnostics and correct an established shared defect if necessary; retain the source issue's ownership and evidence until resolved.

## User and API flows

The owner opens the authenticated app, selects a project, starts a chat from New chat or the project's hover/focus action, and sends text using Enter (Shift+Enter for a newline; IME composition must not submit). The input starts at one line and grows to its 160px text-height cap, then scrolls. Attachments, settings, cancel/steer, approvals, queued work, failed/expired/uncertain states and reconnect remain functional.

Each sidebar chat exposes rename on hover or keyboard focus and on touch. Rename targets that chat without changing the active conversation or its draft; the existing metadata revision/idempotency API remains authoritative. Search, pagination and archived history remain discoverable without permanently occupying the simple default rail.

The desktop rail starts at 260px and resizes from 220 to 400px, further capped to reserve 440px of main content. Support pointer drag and a keyboard separator with arrow/Home/End controls. At 700px and below, use the prototype's dismissible overlay and focus/inert behavior. Resizing and viewport changes must reflow the composer and content without horizontal page overflow at tested widths.

Add `GET /api/v1/project-roots/:id/directories?path=<relative>` as a browser-owner-only, read-only listing in local/private-fixture mode. Return relative directory names/paths and a bounded/truncated indicator, never file contents or absolute host paths. The empty path lists the configured root; exclude symlinks and reject traversal, invalid roots and inaccessible directories. Advertise availability through capabilities. Loading, empty, truncated, denied and retry states appear in the project dialog. Managed profiles reject browsing and keep the typed-path flow available.

## Contracts, data, and ownership

Existing APIs, SSE snapshots, durable drafts, session metadata revisions and intent replay own application state. UI organization must not change dispatch/approval/cancellation/recovery semantics. The new listing endpoint has no writes, durable records or idempotency requirement. Revalidate the chosen folder through existing project registration; a listing is not admission authority. Bound listing work/output and use descriptor-relative no-follow traversal so path races cannot redirect reads through symlinks.

Sidebar presentation state is local UI state; it grants no permissions. Token values should be centralized in application CSS and correspond to the guide. Any added component or state must first be represented in the guide and standalone prototype in the same delivery change. Documentation distinguishes prototype specimens from implemented application behavior.

## Security and resource limits

Retain owner authentication, browser Origin/CSRF rules, bearer route allowlists, server permission ceilings, escaped untrusted text and the CSP. Do not read personal account data in automated tests. Directory listing is explicitly restricted to local/fixture profiles and configured roots, denies bearer access and unauthenticated requests, skips non-directories/symlinks, caps entries and response size, and fails with non-sensitive errors. No runner launch, mount, sandbox, network-policy or trusted managed-storage changes are authorized by this design.

## Implementation approach

Refactor shell/navigation and presentation without replacing Harbor domain services. Introduce shared monochrome tokens and controls; restyle all existing panels consistently, including terminal/editor themes. Extend the project dialog with bounded local browsing. Keep existing accessible names where possible; update acceptance selectors deliberately where the new navigation requires opening contextual controls.

Run a focused redesign lane through real Harbor and the critical suite, then applicable existing supporting-panel checks. Reuse existing evidence for unchanged runtime/isolation boundaries, explicitly retaining its tested scope. Record unavoidable missing gates instead of declaring a pass.

## Verification and acceptance criteria

- **P014-01 — Shell and navigation:** Real authenticated UI shows projects and their chats; starts a conversation through both entry points; opens a saved chat; search/archive/pagination remain usable. Rename active and inactive chats and verify durable metadata after reload, unchanged active selection and draft, and safe rendering of hostile/long titles.
- **P014-02 — Composer and lifecycle:** One-line initial input grows/shrinks, caps/scrolls, sends on Enter, preserves Shift+Enter/IME behavior, and supports real fixture replies and persisted reopening. Existing critical approval, failure, retry, cancellation, reconnect, permission and rich-draft outcomes pass.
- **P014-03 — Responsive interaction:** Pointer and keyboard resizing enforce bounds; mobile overlay closes with keyboard/backdrop and restores focus. Desktop/mobile screenshots and checks cover populated/empty conversations and representative secondary dialogs with no page overflow. Hover actions remain keyboard/touch accessible.
- **P014-04 — Project folders:** Through UI and authenticated API, browse nested run-owned directories, select/register one and start a conversation. Deny unauthenticated/bearer requests, unknown roots, traversal and symlink escape; demonstrate empty/truncated/error states. Verify managed-profile refusal without weakening its registration path.
- **P014-05 — Supporting workflows:** Existing account/API-token/workspace/history/attachment/file/terminal/schedule/preview surfaces retain discoverable working controls and capability-disabled reasons with the new token system. Execute the relevant deterministic supporting lanes and inspect representative desktop/mobile surfaces; do not claim untested capabilities.
- **P014-06 — Delivery quality:** `pnpm check`, `pnpm build`, appropriate integration/security checks, the changed-feature E2E and critical regressions pass on a recorded revision/digest. Independent review has no unresolved critical findings, actual docs are updated, and guide/prototype cover the added patterns.

Fixtures replace only external Codex/OIDC boundaries; real browser/API/PostgreSQL/supervisor behavior supplies application evidence. No changed real-runtime or Linux isolation claim is introduced. Existing live/restore blockers remain explicit in their owners and do not become redesign completion evidence. If the redesign changes those boundaries during implementation, update this proposal and execute their mandatory lanes before closure.

## Rollout and recovery

Commit the verified source; this request does not require changing the running stable instance. No data migration is needed. Rollback restores the prior frontend/API artifact with the same durable schema. Keep owned fixture processes and directories separate, remove only run-owned resources, and retain redacted evidence in ignored test storage.

## Review record and remaining issues

Three implementation review rounds and one bounded test-correction review passed with no unresolved critical findings. The [delivery report](../../../docs/reports/2026-09-13-frontend-redesign.md) records bounded design decisions, review rounds, findings/fixes and executable evidence before archival.

## Closing record

13 September 2026: Implemented and Verified after real-stack design, full critical, workspace, terminal, preview, scheduling, local-profile and file-render acceptance, 16 integration checks, production build and repository checks. Matching critical source: `9edea343237543c013862ce86f6f9f55ce5d327b39f1cfaef5e18f126bb84904`; final test-only navigation source: `0e4750995ddbea078e3d6d06286126b6ec71993bf07d90aef0f3bcb61d31ebb6`. The linked delivery report maps all acceptance IDs, source digests, commands, macOS fixture environment, artifacts, review rounds, failed attempts and unchanged-boundary evidence limits. No deployment or database migration occurred. Broader live-account/installed/Linux/restore gates remain with their existing owners; no unresolved P014 critical finding remains.
