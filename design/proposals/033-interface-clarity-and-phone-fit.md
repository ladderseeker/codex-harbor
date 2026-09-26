# P033 — Interface clarity and phone fit

## Metadata

- ID: P033
- Status: Draft
- Priority: High, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Every screen says in plain words what happened and what the owner can do next, controls the profile cannot use stay hidden, signing in starts from the bare site address and sign-in failures reach a page with a way forward, and the interface fits a phone.
- Authorization: Proposal writing only. Implementation, commits to `main` and deployment need the owner's separate go-ahead.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529` and the fixture walkthrough recorded in the [review](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough).
- Dependencies: None. One owner decision is needed at acceptance, on the like and dislike controls; see [below](#problem-outcome-and-exclusions).
- Source issues: None.
- Design references: [Interface](../systems/006-interface.md), [UI guide](../design-tokens.html), [prototype](../prototypes/harbor-redesign.html), [personal runtime capacity](../systems/001-conversations-and-access.md#personal-runtime-capacity), [deployment and profiles](../systems/004-deployment-and-profiles.md), [public access and identity](../architecture.md#public-access-and-identity).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P033-01–P033-10.

## Problem, outcome and exclusions

The review's [walkthrough](../../docs/reports/2026-09-25-project-review.md#user-experience-walkthrough) found that much of the friction is presentation rather than missing capability. This plan takes every walkthrough item marked P033:

- **Capacity waits.** When retained runtimes fill the budget, a new turn waits with "Waiting for capacity held by active or protected resources." without naming the conversations that hold it. The only hint is a green dot on those rows, explained by a tooltip.
- **Visible hidden controls.** The stylesheet's `button { display: inline-flex }` rule overrides the `hidden` attribute everywhere except the settings menu. The project details dialog therefore shows **Files and changes** when the files capability is off and, in the personal VPS profile, **Manage workspaces** and **Open terminals** too.
- **Jargon and dead ends.** The recovery panel reads "1 unresolved operation(s). Confirmed history cursor 6." and offers "Fence old runtime and inspect history", and runtime states use terms such as retirement and reservation. In the personal profiles an uncertain conversation says only that automatic recovery is unavailable, replaces its text box with settings labelled "Settings for the separate new operation", and never says that a new conversation is the way forward.
- **Raw sign-in errors.** A signed-out visit to `/` returns a JSON 401 error, and a denied identity ends on a JSON `OWNER_DENIED` response at the callback.
- **First run.** New chat is disabled without a reason before a project and account exist, a new project's empty list says "No matching conversations", "Draft saved for 24 hours." appears under an empty composer, the account dialog repeats its "key saved" message, and the setup prompt asks the personal VPS owner for an API key that the profile never uses.
- **Approval card.** It does not say when it expires, and its heading uses the muted secondary colour.
- **Phone.** Composer controls are 26 to 30 px tall and wrap to two rows, so the empty composer takes 182 of 844 px; a conversation menu opened in the navigation drawer is cut off; long dialogs put their actions below the fold; a streaming reply shows two status lines; and hidden copy-confirmation text makes the document taller than the window, so a scroll-into-view can move the whole interface up with no way back.
- **Smaller issues.** "New chat" is also called "New conversation", and "Edit project files" is also "Workspace write"; search results repeat the title, show two clear buttons and restore the previous query; archiving the open conversation leaves it open with a working composer; **Emergency stop** sits between **Codex account** and **Sign out**; the phone header drops the project name and pushes short titles to the right edge; and the workspace appears as "Local (Local)".

After this change:

1. **Named capacity waits.** A turn waiting for runtime capacity lists the conversations whose runtimes hold it, with each one's state in plain words and a link to it, where **Stop processes** is available.
2. **Hidden means hidden.** An element with the `hidden` attribute never renders, and each profile shows only the controls it supports.
3. **Plain language.** Every conversation, runtime and recovery state says what happened and the next available action, without internal terms such as fence, generation, cursor, operation or retirement. An uncertain conversation in a personal profile keeps its history readable, says that its last request may or may not have run, and offers **New conversation** in the same project instead of a settings-only composer.
4. **Sign-in pages.** A signed-out browser visit to an application page redirects to `/auth/login`. A sign-in failure, including a denied identity, shows a page that explains it and offers to sign in again. API clients keep today's JSON errors.
5. **First run and empty states.** A disabled control says why; an empty project says that it has no conversations yet; the draft notice appears only when a draft exists; the account dialog shows one status message; and the personal profiles never ask for an API key.
6. **Approval card.** The card states when the request expires, and its heading uses the primary text colour.
7. **Phone fit.** On a touch screen every control meets the guide's touch size, which this plan raises from 36 to 44 px. The composer shows one row of controls, with model, effort and permission behind one settings control on narrow screens. Menus stay on screen, dialog actions stay visible, a streaming reply shows one status line, and the page itself never scrolls out of place.
8. **Consistent names and smaller fixes.** Each control has one name everywhere. Search shows each result once, with one clear control and an empty query when reopened. Archiving the open conversation shows it as archived, with **Unarchive** and no composer. **Emergency stop** sits apart from ordinary settings with the guide's danger treatment. The phone header shows the project, and workspace names are not repeated.

**Owner decision at acceptance.** The interface design keeps like and dislike under replies as local-only reactions, and decorative thumbs under the owner's messages, as an [owner-requested exception](../systems/006-interface.md). Neither stores anything. The default is to keep both unchanged. If the owner chooses removal, P033-09 covers it and the interface design, guide and prototype change with it.

Excluded: queued follow-ups, remembered settings, attention marks and notifications, owned by [P030](030-composer-and-conversation-flow.md); how long approvals wait, owned by [P019](019-durable-approval-waiting-and-delivery.md); transcript records of decisions and cancellations, owned by [P029](029-complete-conversation-transcript.md); empty conversations from New chat, owned by [P020](020-new-conversation-drafts.md); continuing an uncertain conversation in a personal profile, which needs its own recovery design; a home-screen web app manifest, because the architecture lets no static file bypass the authentication gate and not every platform fetches a manifest and its icons with credentials; managed-profile-only dialogs, left to [P027](027-personal-first-product-scope.md)'s decision; and search scope, which is the current project by design.

## Dependencies and current design

None required. The interface design, the UI guide and the prototype own every visual change here, so each new state, the 44 px touch size and the phone composer are specified in the guide and demonstrated in the prototype before application use. The reviewed replacement strings are listed in the interface design, so later changes keep one vocabulary.

The identity design keeps `/auth/login` as the entry point and the authentication gate in front of every application page; the redirect changes only the response to a signed-out browser navigation. The capacity rules in the conversation design are unchanged; only their presentation changes.

[P030](030-composer-and-conversation-flow.md) and [P029](029-complete-conversation-transcript.md) edit some of the same files; whichever plan executes second starts from the other's result.

## Source issues

None.

## User and API flows

1. A turn waits for capacity. The queued message says that the runtime slots are in use and lists the conversations holding them, for example "Deploy script (background processes still running)", each linking to its conversation, where **Stop processes** frees the slot. The turn starts on its own once a slot frees.
2. A signed-out owner opens the site's address, is redirected to the identity provider's sign-in and returns to `/`.
3. The wrong account signs in. A page says that this account cannot use this Harbor and offers **Sign in with another account**.
4. A personal VPS conversation becomes uncertain. Its history stays readable; a notice says that Harbor lost track of the last request, which may or may not have run, and that this conversation cannot continue; **New conversation** opens a new conversation in the same project.
5. On a phone, the owner types with the composer on one row, opens settings from one control, and uses menus and dialogs without anything leaving the screen.

## Contracts, state and security

- **No new data.** No route, table or event is added. The capacity holder list uses the runtime state that the session listing already returns; a conversation still stopping after it was archived is not listed.
- **Redirect.** Only `GET` requests that accept `text/html` and target an application page, not `/api/`, `/auth/` or a built asset, receive `303 See Other` to the fixed `/auth/login`. The target never comes from the request, and the return address stays `/`. Every other signed-out request keeps its current status and JSON error.
- **Sign-in failure page.** For browser navigations, the callback's existing failures render a server-generated page with a fixed explanation per error code and a link to `/auth/login`. The page escapes all text, carries the existing security headers and shows no token, state or claim values. Other clients receive today's JSON error.
- **Hidden attribute.** The stylesheet enforces `hidden` globally, so a component cannot show a control that its profile removes.
- **Unchanged.** Authentication, sessions, CSRF, capacity limits, recovery availability and every API response outside the two sign-in paths stay as they are.

## Implementation brief

Specify in the UI guide and demonstrate in the prototype first: the 44 px touch size, the phone composer and its settings control, drawer menus, the dialog footer, the capacity holder list, the sign-in failure page and the archived-conversation state. Record the reviewed strings in the interface design. Then change the API's two sign-in paths and the browser together, and update existing tests that assert replaced strings.

## Exact file fence

- `design/proposals/033-interface-clarity-and-phone-fit.md`
- `design/architecture.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/api/src/server.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/Attachments.tsx`
- `apps/web/src/Credentials.tsx`
- `apps/web/src/History.tsx`
- `apps/web/src/MessageActions.tsx`
- `apps/web/src/Recovery.tsx`
- `apps/web/src/Workspaces.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/styles.css`
- `tests/integration/message-actions.test.ts`
- `tests/e2e/message-actions.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p014.ts`
- `tests/e2e/p023.ts`
- `tests/e2e/p033.ts`
- `tests/personal-vps/e2e.ts`
- `docs/user/conversations.md`

`MessageActions.tsx` and the two message-action tests change only if the owner chooses removal.

## Verification and acceptance

- **P033-01:** With the runtime budget at two and two fixture conversations holding protected runtimes, a turn in a third conversation lists both holders by title and state with working links; **Stop processes** on one lets the waiting turn start.
- **P033-02:** No element with the `hidden` attribute is visible on any tested screen. In the personal VPS lane, the project dialog shows no workspace, file or terminal tool.
- **P033-03:** Every string on the reviewed list replaces its predecessor, and no tested screen shows the listed internal terms. In the personal VPS lane, an uncertain conversation shows the reviewed notice and **New conversation**, which opens a new conversation in the same project, and shows no settings-only composer.
- **P033-04:** A signed-out `GET /` and `GET /?conversation=<id>` that accept HTML receive `303` to `/auth/login`, whatever the request's host, query or headers. A signed-out `GET /api/v1/me` still returns the JSON 401, and a built asset keeps its current response. After sign-in the browser returns to `/`.
- **P033-05:** With the identity fixture returning a different subject, the browser reaches a page that explains the denial and links to `/auth/login`; a request without `text/html` in `Accept` receives the existing JSON `OWNER_DENIED` error. A missing login state behaves the same way.
- **P033-06:** Before a project and account exist, the disabled New chat says why. A new project's list says that it has no conversations. An empty composer shows no draft notice. The account dialog shows one status message. In the personal profiles the setup prompt does not mention an API key.
- **P033-07:** At 390 × 844 with touch, every control on the tested screens is at least 44 × 44 px. The empty composer shows one row of controls and is at most 150 px tall. A conversation menu opened in the navigation drawer is fully visible. Add project, after browsing folders, shows its primary action without scrolling. A streaming reply shows one status line. The document is never taller or wider than the window, and scrolling any element into view leaves the page itself unscrolled. The phone header shows the project name.
- **P033-08:** The approval card shows its expiry time with a primary-colour heading. Each renamed control uses one name everywhere. Search shows each result title once, with one clear control, and opens with an empty query. Archiving the open conversation shows **Unarchive** and no composer. **Emergency stop** is grouped apart with the danger treatment. The workspace name appears once.
- **P033-09:** Like, dislike and the decorative thumbs match the owner's acceptance decision: unchanged, or removed with copy still working for both roles.
- **P033-10:** `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e --design` with P033's scenarios, the full critical `pnpm test:e2e` and the personal VPS Linux lane `tests/personal-vps/e2e.ts` with its new assertions pass. The changed prototype interactions are rendered and checked at desktop and phone sizes, with hover, keyboard focus and touch.

Gate: behavioral. No launch, sandbox or adapter change.

## Rollout and recovery

No migration or configuration change. The release rolls back like any other.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
