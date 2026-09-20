# Interface and interaction

Current design reconciled on 20 September 2026 against source `008227355bd05cb27dc13f4fbb585ef709b474b0`. This document owns feature requirements; [architecture](../architecture.md) owns shared trust/state invariants and [workflow](../workflow.md) owns delivery. Archived proposals preserve historical acceptance IDs and evidence, not competing current specifications. No application checks were rerun for this reconciliation.

## Baseline and ownership

P014/P016 provide the implemented monochrome responsive interface, contextual tools, raw content copy, temporary reactions and runtime-supported reasoning choices. Their archived Verified/Completed records retain original evidence. Current visual tokens and specimens belong exclusively to the [HTML guide](../design-tokens.html) and [standalone prototype](../prototypes/harbor-redesign.html); this document owns behavior and design integration, not another token list.

Source ownership: [apps/web/src/App.tsx](../../apps/web/src/App.tsx), [apps/web/src/styles.css](../../apps/web/src/styles.css), [apps/web/src/SidebarResize.tsx](../../apps/web/src/SidebarResize.tsx), [apps/web/src/MessageActions.tsx](../../apps/web/src/MessageActions.tsx), [apps/web/src/MarkdownMessage.tsx](../../apps/web/src/MarkdownMessage.tsx), [apps/web/src/message-responses.ts](../../apps/web/src/message-responses.ts), [apps/api/src/project-directories.ts](../../apps/api/src/project-directories.ts), [packages/policy/src/models.ts](../../packages/policy/src/models.ts).

## Navigation and supporting controls

Keep conversation work primary with grouped projects/chats and contextual supporting tools. One top-sidebar search/filter surface searches the current project with explicit active/archived/all scope. Project details expose supported workspace/files/terminal/schedule/preview access; settings open through the bottom-right gear, not toast actions. Unavailable profile features have no functional-looking placeholders. Actionable errors, approval/input and uncertainty remain visible; connection/storage/retention details belong in their contextual dialog.

Conversation menus appear on hover, keyboard focus and touch, preserve revision/idempotency behavior, and rename the targeted inactive or active chat without switching selection or clearing drafts. Archive is visibility-only and never deletes source/history or interrupts active work; the personal profile may retire idle retained resources. Stop background processes retires retained execution/reservation and is distinct from active-answer cancellation. The guide's sole semantic green dot means confirmed retained resources/reservation, never connection health or generation progress. Unknown state cannot be called confirmed idle.

The composer starts at one line, grows to the guide's cap, then scrolls; Enter sends, Shift+Enter adds a line and IME composition never submits. Preserve attachments/settings/steer/cancel and approval/queued/failed/uncertain state. Sidebar resize obeys the guide's desktop bounds and main-content reserve with pointer and keyboard separator controls. Mobile uses a dismissible overlay with inert regions and restored focus; breakpoint changes cannot strand focus. All secondary controls use existing visual roles, keyboard labels and touch access.

## Folder selection

The bounded owner-only `GET /api/v1/project-roots/:id/directories?path=<relative>` is available only in admitted local/private-fixture/personal profiles. It returns relative directory names/paths and explicit truncation, never file content or arbitrary host paths. Configured roots bound descriptor-relative no-follow traversal; reject unknown roots, traversal, inaccessible paths and symlinks. Deny bearer/anonymous access. Registration revalidates identity and overlap; listing grants no filesystem authority. Managed installations retain their relative-path registration form without granting the API host filesystem access. Show loading/empty/truncated/error/retry states. This selects server folders, not browser uploads.

## Content and reasoning controls

Assistant messages use CommonMark/GFM and preserve source through streaming/reload; raw HTML never executes, remote images are explicit links, unsafe schemes are rejected and Mermaid remains labelled source. User input/tool diagnostics stay literal. Wide code/tables scroll internally and remain keyboard focusable. Use the guide's typography and component styles.

User copy uses raw message text. Completed assistant turns have one copy/like/dislike toolbar after their last body segment; full-turn copy joins source body fragments without tools/UI labels. Code/source blocks have a separate bottom-right toolbar outside the scroll area. Preserve code whitespace without fences/language labels and raw Markdown syntax. No per-paragraph buttons. Report success only after clipboard completion and show explicit failure. Reactions are mutually exclusive, toggleable, refresh-reset local state with no request, analytics, counts or stored feedback.

Runtime discovery owns model-specific effort options and the server revalidates them at dispatch. Preserve distinct `low`, `medium`, `high`, `xhigh`, `max` values when supported; labels are Low, Medium, High, Extra High, Max. Never submit `light`, fabricate a missing mode or narrow another model to Astra's options. The historical P016 runtime discovery evidence establishes that tested pin/account, not a permanent guarantee about future model capabilities.

## Maintaining the visual contract

Reuse the canonical neutral palette, spacing hierarchy, compact composer, typography and sidebar patterns. A required new token/state/component must be added to the HTML guide and demonstrated in the standalone prototype in the same change before application use. Follow existing authorization without an extra visual approval gate. Inspect affected desktop/mobile rendering and hover, focus, keyboard, touch and relevant loading/empty/error/disabled states. Prototype review establishes visual/interaction evidence, not application/API/persistence or isolation behavior.

The HTML guide's historical references to proposals mean the bounded plan selected under the current workflow; durable product requirements now live in architecture and these subsystem documents. No HTML, token or prototype file changed during this documentation migration.

## Evidence and open obligations

The [P014 report](../../docs/reports/2026-09-13-frontend-redesign.md) records P014-01–06, critical source `9edea343…84904`, final navigation test delta and three implementation reviews plus a bounded fourth test review. The [P016 report](../../docs/reports/2026-09-15-conversation-interface.md) records P016-01–06 and deployed `180bdab`, including browser/runtime and presentation evidence. Their distinct environments and historical failed attempts remain preserved.

P015's [required rendered-prototype gap](../../issues/2026-09-13-130622-personal-vps-acceptance.md) remains separate; later P016 presentation evidence must not silently substitute for a differently scoped gate. Broader runtime/live/restore issues remain in the [inbox](../../issues). Future interface changes use real Harbor E2E for supported flows plus critical regressions; unchanged runtime/isolation evidence may be reused with its exact source limits.
