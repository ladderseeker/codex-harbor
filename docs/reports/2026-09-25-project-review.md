# Project review — 25 September 2026

The owner asked for a full review of the project and its documents: whether the architecture is reasonable or needs a rebuild, which documents are wrong, what to do next given that the user experience is not good enough, and a prioritized set of proposals. This report is the result. It changes no application behavior.

## Summary

- **Keep the architecture; do not rebuild.** The core design is sound and matches how the official Codex clients integrate the runtime. The problems are concentrated in a few hot paths, one systemd setting and the project's scope, and each can be fixed inside the existing module boundaries.
- **Fix deploy safety first.** A supervisor stop or crash restart can leave runtime membership unknown, which then blocks every later deploy and holds runtime capacity until a host reboot; the likely mechanism is identified below. The live instance also needs a look now: its read-only preflight on 25 September reported four retained runtimes, which fill the default budget, so a deploy at that moment would have refused and new turns in other conversations would have waited.
- **The user experience gaps have three main causes.** Besides the owner's own messages, the conversation keeps only 2 of the 18 kinds of item Codex reports, every streamed chunk triggers a full reload of the conversation, and several everyday actions, such as sending a follow-up while Codex works, are blocked or need workarounds. The walkthrough also lists many smaller rough edges, especially on a phone.
- **One availability risk needs a small fix.** From source, every client of the personal VPS shares one request budget behind the proxy, so any internet client can lock the owner out for as long as it keeps sending, and the owner's own tabs compete with each other.
- **The project carries more scope and process than the product uses.** Four runtime profiles, a managed profile the owner does not run, 23 open issues about managed, self-development and extension work, and a delivery process that adds a fresh implementer and two reviews to every change, including copy fixes.
- **Nothing needs deploying now.** The installed release `311f750` matches the current application source; only deployment tooling changed on `main` since then.

The [recommended priorities](#recommended-priorities) are Urgent: [P025](../../design/proposals/025-clean-supervisor-shutdown-and-restart.md) and [P026](../../design/proposals/026-continuous-integration.md); High: decide [P027](../../design/proposals/027-personal-first-product-scope.md), then [P032](../../design/proposals/032-request-limits-per-client.md), [P033](../../design/proposals/033-interface-clarity-and-phone-fit.md), [P028](../../design/proposals/028-live-conversation-streaming.md) and [P029](../../design/proposals/029-complete-conversation-transcript.md); Medium: [P030](../../design/proposals/030-composer-and-conversation-flow.md), [P031](../../design/proposals/031-project-file-downloads.md), [P019](../../design/proposals/019-durable-approval-waiting-and-delivery.md) and [P020](../../design/proposals/020-new-conversation-drafts.md); Low: [P021](../../design/proposals/021-long-conversation-history-and-capacity.md) and [P022](../../design/proposals/022-native-conversation-titles.md).

## Scope and method

- **Source.** `main` at `d0c505b8b58b6ba8d9597d867f14b36f832b0529`. Application code is unchanged since `311f750a18bb`, the release installed on the owner's VPS according to the [personal VPS guide](../developer/personal-vps.md#current-owner-installation).
- **Documents read.** Architecture, all six subsystem designs, decisions D001 to D014, the workflow, the proposal template, the four draft proposals, archived proposal metadata, all 29 open issues, the user and developer guides and the recent delivery reports.
- **Code read.** The supervisor's main loop, output persistence and retirement paths; the API server's session, snapshot, event and approval routes and its request limits; the web client's conversation view; the Codex adapter and the pinned 0.153.4 generated protocol; the personal cgroup ownership code; the personal VPS systemd templates; the deploy script and workflow.
- **Run.** A local Harbor stack from this source in a cloud container, with the deterministic Codex and identity-provider fixtures and real API, PostgreSQL and supervisor, driven by Playwright and Chromium at desktop and phone sizes. See [the walkthrough](#user-experience-walkthrough).
- **Checked on GitHub.** The two runs of the deploy workflow on 25 September.
- **Baseline gates.** With Node 24.11.1 at `d0c505b`, the commands behind `pnpm build`, `pnpm check` and `pnpm test` passed: TypeScript, the Vite build, documentation links, 2 OpenAPI tests, Prettier and 51 integration tests. They ran directly rather than through `pnpm`, because the container's pnpm is not the pinned 12.3.4, and the Vite output went to scratch storage.
- **Not run.** Anything on the live VPS, which this cloud session cannot reach over SSH; a real Codex model; the systemd-based Linux lanes; and the contract, live and isolation lanes. [Evidence limits](#evidence-limits) lists the consequences.

## Architecture verdict

Harbor has a React web client, a Fastify API that owns authentication and authorization, a separate supervisor that owns Codex app-server processes over stdio, and PostgreSQL for durable state, with pg-boss for wakeups. The personal VPS profile runs each conversation's Codex runtime natively under a dedicated service account, inside its own delegated cgroup.

What is sound and worth keeping:

- **The official runtime behind one adapter.** Harbor speaks the app-server protocol through a single stdio adapter with generated types pinned to 0.153.4, as the official clients do. No raw protocol proxy is exposed.
- **API and supervisor separation.** Work survives browser disconnects and API restarts, and the API never holds runtime processes.
- **Durable intents.** Idempotency keys, request hashes, event cursors and an explicit `uncertain` state instead of blind replay are the right model for work with external effects.
- **Process ownership.** Delegated cgroup-v2 leaves per conversation generation give exact retirement, which D014 shows plain process groups cannot.
- **A working deployment.** The personal VPS profile is live, with Google sign-in, attachments, concurrency and previews, and the deploy path now runs from GitHub Actions.

A rebuild would recreate the same four components and lose verified security and recovery behavior. The weak parts are local:

| Area | Problem | Where it is fixed |
| --- | --- | --- |
| Supervisor shutdown | Retirements race the database pool on stop | P025 |
| Output persistence | One transaction per chunk that re-reads the whole conversation | P028 |
| Event delivery | 250 ms database polling per stream; the browser refetches everything per event | P028 |
| Supervisor loop | Serial; awaits runtime starts and a model-discovery probe | P028 |
| Request limits | One budget shared by every client behind the proxy | P032 |
| Transcript | Keeps 2 of the 18 item types that are not the owner's own messages | P029 |
| Large files | `App.tsx` 2,772 lines with about 60 state hooks; supervisor `main.ts` 1,974 lines as one top-level script; `server.ts` 1,290 lines | Extract the conversation view and event handling while doing P028, P030 and P033, not as a separate rewrite |

## Findings

### Shutdown and deploy safety

The [retained-runtime issue](../../issues/2026-09-21-174500-personal-stop-retained-runtimes.md) recorded unknown runtime membership after a normal stop on 21 September, with the cause unproven; recovery needed a host reboot, which the owner authorized. Source analysis, added to that issue as a [dated section](../../issues/2026-09-21-174500-personal-stop-retained-runtimes.md#source-analysis--25-september-2026), finds a likely mechanism: the supervisor unit's `KillMode=control-group` signals every process at once, guardians kill their runtimes, mailbox failures start retirements that `stop()` in [main.ts](../../apps/supervisor/src/main.ts) never awaits, and `pool.end()` then prevents their release. On the next start, [personal-cgroup.ts](../../packages/codex-adapter/src/personal-cgroup.ts) treats the missing leaf path as unknown. Unknown members count as busy runtimes and hold capacity, so every later promotion refuses until a reboot.

Today's [deploy-release](../../infra/personal-vps/deploy-release) fails closed before it stops anything: promotion refuses while any operation, non-idle runtime or background mark exists, and every successful turn sets a background mark that stays until its runtime is released. A deploy therefore needs every retained runtime gone first. Idle runtimes retire after 30 minutes; protected ones, which keep a background process such as a development server, stay until the owner uses **Stop processes**. The deploy path itself thus stops only an empty supervisor; the exposure to unknown membership is any other stop or crash restart while runtimes are retained, such as the stop made by the earlier promotion helper on 21 September.

The live instance shows the practical effect. The workflow's read-only preflight at 19:21 UTC on 25 September ([run 2](https://github.com/ladderseeker/codex-harbor/actions/runs/36179135848)) reported no busy operation, four non-idle runtimes, no idle runtime and four background marks. A deploy at that moment would have refused. Four retained runtimes also fill the default budget of four, so a turn in any other conversation would have waited with "Waiting for capacity held by active or protected resources." The counts do not say whether those runtimes were protected, which **Stop processes** releases, or unknown, which only a reboot releases today. The [deploy guide](../developer/github-actions-deploy.md#retained-runtimes-block-deploys) now documents this and how to tell the two apart. P025 fixes the stop, reports the counts separately and adds a startup proof that avoids the reboot.

Separately, the only deployed instance has no off-host backup: the checkpoints that promotion writes are same-host copies. No proposal covers this yet.

### Verification automation

The repository has no CI. The only workflow is the deploy workflow, and its build step runs `pnpm install` and `pnpm build` on the VPS without `pnpm check`, `pnpm test` or any browser lane. Gate results live only in prose reports. P026 adds CI for the gates that need no secrets and makes deploys depend on it.

A related quick win: the [personal VPS acceptance issue](../../issues/2026-09-13-130622-personal-vps-acceptance.md) remains blocked only by a rendered-prototype check that was unavailable in an earlier environment. Cloud sessions now have Chromium preinstalled, so that check can likely run.

### Request limits

The API limits requests per client address before authentication, in [server.ts](../../apps/api/src/server.ts): 200 ordinary requests per 10 seconds and 30 sign-in starts per minute. Fastify runs with `trustProxy: false`, and on the personal VPS the [documented route](../developer/personal-vps.md) is a host Traefik proxy in front of the loopback API, so every client arrives from the same address. From source, the owner's tabs and devices and anyone on the internet therefore share one budget, and an unauthenticated client, including a routine vulnerability scanner, can lock the owner out with HTTP 429 for as long as it keeps sending. The walkthrough reached the ordinary limit from a single browser. The architecture already requires trusting forwarded headers from the configured proxy; [P032](../../design/proposals/032-request-limits-per-client.md) does that and keys signed-in requests by session.

### Streaming and responsiveness

Each native text delta costs, in the notification handler in [main.ts](../../apps/supervisor/src/main.ts) and [conversation-output.ts](../../apps/supervisor/src/conversation-output.ts): locks on the project, workspace and conversation rows, a locked read of the message, a sum over every message in the conversation, a rewrite of the message's full text, an update of the session's sequence, an event insert and a replay prune. The write volume for one reply therefore grows with the square of its length, and every delta's cost grows with the conversation's size. Because the project row is locked, conversations in the same project also wait for each other's writes, which works against the concurrency that D014 allows in one folder.

Delivery then multiplies it. The [event route](../../apps/api/src/server.ts) polls PostgreSQL every 250 ms per open stream, and each poll checks authority again and runs a replay prune that takes those same locks and updates the conversation row, even when nothing changed. The [web client](../../apps/web/src/App.tsx) ignores event payloads, even though text deltas carry their text, and fetches the complete snapshot again after events, merging events that arrive during a fetch into one more fetch. The snapshot returns every message, operation and approval, and takes the same project, workspace and conversation locks that the supervisor needs to persist the next delta. The client also polls the snapshot every 15 seconds, without checking whether the tab is visible, capabilities and the project's workspace list every 4 seconds, and the session list every 10 seconds. The [walkthrough](#user-experience-walkthrough) measured the cost.

The supervisor's single loop awaits a model-discovery probe, which starts a Codex process, whenever the last discovery attempt is more than 60 seconds old, so, reading the source, an idle instance starts about 60 Codex processes an hour. The same loop awaits each runtime start before it handles other conversations' approvals and cancellations.

P028 replaces this with coalesced append-only persistence that locks only the conversation, incremental events applied by the browser, `LISTEN/NOTIFY` wakeups, bounded snapshots with older pages, and discovery outside the loop.

### Transcript fidelity

The pinned protocol reports 19 item types, including reasoning, plans, file changes, web searches, MCP and dynamic tool calls, context compaction and review mode, plus turn-level plan, diff and token-usage notifications. Apart from the user's own messages, which Harbor stores itself, Harbor persists and renders two: assistant text and command execution. During a long turn the owner sees a working indicator and raw command output; afterwards the conversation does not say which files changed. This is the largest gap between Harbor and the official Codex clients, and P029 closes it.

A related failure: a single assistant reply longer than 262,144 characters, or conversation text beyond 2 MiB, throws in output persistence and turns the running turn uncertain instead of truncating it. In the personal VPS an uncertain conversation cannot continue, so one long reply ends the conversation. This change records it as a [new issue](../../issues/2026-09-25-120000-output-limit-uncertain-turn.md), and P028, which rewrites that code, adopts truncation with a visible notice.

## User experience walkthrough

A local stack from this source ran in a cloud container with the deterministic Codex and identity-provider fixtures and the real API, PostgreSQL and supervisor. Playwright with Chromium drove it at 1440 × 900 and at a 390 × 844 phone size and took about 90 screenshots, which are not committed. The stack used the fixture profile, which shows some managed controls, such as API tokens, schedules, terminals and previews, that the personal VPS hides, and it cannot show the personal VPS sign-in, ChatGPT account or preview screens. Findings that depend on the profile say so, and findings about the personal VPS that come from source rather than observation say that too.

**What works.** With the fixture, sending feels immediate: the composer clears in about 60 ms, the owner's message appears in about 100 ms and the first reply text in 0.3 to 0.7 seconds. No browser task over 50 ms was recorded, even in the long conversation below. Markdown, code blocks and tables render correctly, hostile Markdown stays inert text, and wide content scrolls sideways on a phone without moving the page. The phone navigation drawer moves focus correctly and closes on an outside tap, Escape or a selection. Background refreshes keep the reading position and text selection.

**Frictions, most costly first:**

1. **Long conversations get expensive to keep open.** Each event makes the browser download the whole conversation again, often twice, in pairs of identical size about 10 to 30 ms apart. In a conversation of 36 messages and about 220,000 characters, a plain reply cost four snapshot downloads totalling 0.95 MB, a Markdown reply six totalling 1.4 MB, and a reply with command activity ten totalling 2.35 MB, against 13 to 38 KB for the same replies in a new conversation. Over 18 consecutive turns, the traffic per reply grew by about 50 KB with every turn. While idle, the open long conversation still downloaded about 1 MB a minute: the snapshot refreshes every 15 seconds, which from source continues in background tabs; capabilities and the project's workspace list are each fetched every 4 seconds; and the event stream sends a heartbeat every 250 ms. On a phone connection this is the main reason the interface will feel slow. P028.
2. **Normal use hits the request limit.** Creating and messaging eight conversations in quick succession produced seven HTTP 429 responses, a lasting "Request rate limit reached" banner and "Reconnecting…" in the header. The eighth reply appeared after 15 seconds instead of about one second, which is consistent with its refetches being refused and the view waiting for the 15-second refresh. The limit, 200 ordinary requests per 10 seconds, is keyed by client address; from source and the documented proxy route, every client of the personal VPS shares one address, as the [request limit finding](#request-limits) explains. P028 removes most of the requests and P032 separates the budgets.
3. **Capacity waits do not say who holds the capacity.** From source, when retained runtimes fill the budget, a new turn waits with "Waiting for capacity held by active or protected resources." without naming the conversations that hold it or offering to stop them. The only hint is the dot on those rows and its tooltip. The live preflight in [Shutdown and deploy safety](#shutdown-and-deploy-safety) suggests the owner may already meet this. P033.
4. **Follow-ups cannot be sent.** While a turn runs, Send becomes Cancel turn and the help line says "Wait for this turn to finish before sending another message.", so a follow-up can be typed but not sent, although the API would queue it. P030.
5. **Settings reset for every conversation.** Each new conversation starts with the Read only permission and the default model and effort. P030.
6. **New chat leaves empty conversations.** Pressing New chat twice left two "New conversation" rows in the sidebar, which stay until archived. P020.
7. **Unavailable controls appear.** The project details dialog showed **Files and changes** although the files capability was off, and the dialog it opened showed three contradictory messages above search controls that looked usable. The stylesheet's `button { display: inline-flex }` rule overrides the `hidden` attribute everywhere except the settings menu, which rendering the stylesheet in Chromium confirmed. By the same source, the personal VPS project dialog shows **Manage workspaces**, **Files and changes** and **Open terminals**, which that profile cannot use. P033.
8. **Failures end in jargon or a dead end.** The fixture profile's recovery panel reads "1 unresolved operation(s). Confirmed history cursor 6." and offers "Fence old runtime and inspect history"; after fencing, the page shows two input areas. The personal VPS has no such recovery by design: from source, an uncertain conversation there only says that automatic recovery is unavailable, the composer is replaced by settings labelled "Settings for the separate new operation" with no text box, and the API refuses every new turn, so the conversation stays blocked and nothing says that a new conversation is the way forward. P033 makes the next step explicit; continuing the same conversation would need a separate personal recovery design.
9. **Decisions leave no trace.** Approval and input cards disappear once answered, so the transcript does not show what was approved, declined or answered. After a cancellation, the "Stop requested" notice renders at the top of the transcript, out of view, and the cancelled request later has no marker. P029.
10. **Sign-in problems show raw errors.** A signed-out visit to `/` shows a JSON 401 response instead of the sign-in page, and a denied identity ends on a JSON `OWNER_DENIED` response at the callback with no way back. P033.
11. **First run is confusing.** New chat is disabled without a reason before a project and account exist; a new project's empty list says "No matching conversations", which reads like a failed search; and "Draft saved for 24 hours." appears under an empty composer. In the fixture profile's API-key setup, the account dialog shows the same "key saved" message twice and keeps it next to "Account ready"; from source, the personal VPS setup step also asks for an API key, which that profile never uses. P033.
12. **Some controls do nothing.** Like and dislike under replies store nothing, and the owner's own messages carry decorative thumbs. The interface design keeps both as an owner-requested exception, so P033 asks the owner whether to keep them.
13. **Approvals give no warning.** The approval card does not say that it expires after five minutes, its heading uses the muted secondary colour, and nothing outside the open conversation shows that one is waiting. P019, P030 and P033.
14. **The phone layout needs care.** Composer controls are 26 to 30 px tall, below the commonly recommended 44 px touch target, and the composer takes 182 of 844 px of height because its controls wrap to two rows; a conversation's menu opened in the navigation drawer is cut off at the drawer's edge; long dialogs, such as Add project after browsing folders, put Cancel and the primary button below the fold without a fixed footer; and a streaming reply shows two status lines, "Writing…" and "Codex is working. You can leave and return later.". P033.
15. **The whole page can shift.** Hidden copy-confirmation text makes the document taller than the window. Page scrolling is turned off, but a scroll-into-view can still move the entire interface up, hiding the sidebar header and leaving a blank band with no way to scroll back. The walkthrough triggered this from a script, not through a normal click. P033.

**Smaller issues**, all P033 unless noted:

- Names differ for the same thing: the sidebar says "New chat" while its accessible name and the empty state say "New conversation", and the composer's "Edit project files" is "Workspace write" in other dialogs.
- Each search result repeats the title, the browser's clear button sits beside the dialog's close button, and the previous query reappears when search reopens. Search covering only the selected project is by design.
- Archiving the open conversation removes it from the sidebar but leaves it open with a working composer and no archived indicator.
- **Emergency stop** sits between **Codex account** and **Sign out** without danger styling, although a confirmation follows.
- The phone header drops the project name, and short titles sit at the far right edge.
- The workspace appears as "Local (Local)" in project details and "Local Local ready" in the status dialog.
- Managed-profile dialogs say "Your administrator can enable this profile" and show a workspace reservation as a raw conversation ID. These do not affect the personal VPS and are left to [P027](../../design/proposals/027-personal-first-product-scope.md)'s decision.

## Scope and process weight

Harbor defines four runtime profiles: managed, fixture, personal local and personal VPS. Only the personal VPS runs for the owner, and the owner's 21 September direction made Linux VPS the only required target. Measured at this revision:

| Part | Size |
| --- | --- |
| Managed-only application modules: files, previews, schedules, terminals, tokens and workspaces | about 14,200 lines |
| Managed infrastructure: deploy, egress, files, Git, previews, runner and storage | about 13,200 lines |
| Managed-only test lanes: egress, files, isolation, previews, schedules, terminals, workspaces and deployment | about 21,600 of 42,900 test lines |
| Personal VPS infrastructure | about 1,200 lines |
| Profile flag checks in application source | about 200 |
| Open issues about managed, self-development or extension work | 23 of 29 |

Documentation is heavy for a single-owner project: the Markdown files in design, docs and issues hold about 236,000 words, against about 34,500 lines of application source. Across the 49 non-merge commits after the initial import on 13 September, Markdown documents gained about 7,800 lines and the HTML design guide and prototype about 4,300, against about 11,300 lines of application, infrastructure and script code and about 16,200 lines of tests. Every change, including copy and styling fixes, goes through a fresh implementer and two independent reviewers, and most add a dated report.

None of this is wrong in itself: the managed profile's isolation design is careful, and the evidence discipline caught real defects. The cost is that every feature must be designed around four profiles and every small fix carries the full process, which slows exactly the user-experience work the owner wants. [P027](../../design/proposals/027-personal-first-product-scope.md) asks the owner for two decisions: freeze the managed profile and treat the personal VPS as the product, and allow a lighter path for small changes.

## Documentation corrections in this change

| File | Correction |
| --- | --- |
| [README](../../README.md) | States that the personal VPS profile is the deployed product and which features it excludes; links this review and the deploy guide. |
| [Documentation index](../README.md) | Groups guides by audience, adds the deploy guide and this report as a dated report, and links nine reports that were missing from the index. |
| [Design index](../../design/README.md) | Adds the missing D014 entry. |
| [Architecture](../../design/architecture.md) | Command table no longer calls every command planned and says which ones do less than intended; records that `/turns/{id}/steer` does not exist and that the browser does not offer queued follow-ups. |
| [Workflow](../../design/workflow.md) and [proposal template](../../design/proposal-template.md) | Allow an optional per-proposal priority of Urgent, High, Medium or Low, which is not a queue position. |
| [GitHub Actions deployment](../developer/github-actions-deploy.md) | Replaces "has not yet run" with the 25 September run history; explains how retained runtimes block a deploy, how to clear them and what run 2 reported; notes the absence of CI. |
| [User guide index](../user/README.md) | Says which guides apply to the personal VPS profile. |
| [Conversations guide](../user/conversations.md) | States the five-minute approval expiry and its effect, separates managed and personal account setup, corrects the claim that a graceful stop always retires retained work, and warns that one oversized reply blocks a personal conversation. |
| [AGENTS.md](../../AGENTS.md) | Notes that the checked cloud environment cannot use SSH, so VPS work goes through the deploy workflow, and that `build` and `deploy` need the owner's go-ahead. |
| [Retained-runtime issue](../../issues/2026-09-21-174500-personal-stop-retained-runtimes.md) | Adds the dated source analysis and the proposed receiving plan. |
| [Report-download issue](../../issues/2026-09-20-120000-conversation-report-downloads.md) | Notes that personal attachments now exist but downloads do not, and names the proposed plans. |
| [Output-limit issue](../../issues/2026-09-25-120000-output-limit-uncertain-turn.md) | New: one oversized reply makes a turn uncertain, which blocks a personal conversation for good. |
| [P019](../../design/proposals/019-durable-approval-waiting-and-delivery.md) to [P022](../../design/proposals/022-native-conversation-titles.md) | Add priorities and dated review notes about what changed since they were written. |

## Recommended priorities

Priorities are recommendations for the owner's selection, written as words so that they are not confused with proposal numbers; the workflow still executes one proposal at a time.

| Priority | Proposal | Outcome | Why this position |
| --- | --- | --- | --- |
| Urgent | [P025](../../design/proposals/025-clean-supervisor-shutdown-and-restart.md) | Stops, restarts and deploys leave no unknown runtime membership | Every later change is deployed through this path; one bad stop blocks all deploys and holds capacity |
| Urgent | [P026](../../design/proposals/026-continuous-integration.md) | Every pull request runs build, check, test and the browser lanes | Cheap, and protects every later change |
| High | [P027](../../design/proposals/027-personal-first-product-scope.md) | Owner decides product scope and small-change weight | A decision, not code; it shrinks the scope of every plan below |
| High | [P032](../../design/proposals/032-request-limits-per-client.md) | Other clients cannot use up the owner's request or sign-in budget | Small, and removes an easy lockout of the owner |
| High | [P033](../../design/proposals/033-interface-clarity-and-phone-fit.md) | Plain states, working controls, sign-in pages and phone fit | The cheapest broad improvement to everyday use; mostly presentation |
| High | [P028](../../design/proposals/028-live-conversation-streaming.md) | Smooth streaming, fast long conversations, no stalls | Foundation for P029, and the main cost behind a slow-feeling UI |
| High | [P029](../../design/proposals/029-complete-conversation-transcript.md) | Reasoning, plans, file changes, tools and the owner's decisions in the transcript | The largest visible gap to the official clients |
| Medium | [P030](../../design/proposals/030-composer-and-conversation-flow.md) | Queued follow-ups, remembered settings and attention signals | Daily workflow gains; adds server state |
| Medium | [P031](../../design/proposals/031-project-file-downloads.md) | Preview and download project files | The owner's open request from 20 September |
| Medium | [P019](../../design/proposals/019-durable-approval-waiting-and-delivery.md) | Approvals wait for the owner | Prevents lost work when away; larger state change |
| Medium | [P020](../../design/proposals/020-new-conversation-drafts.md) | New chat leaves no empty conversations | Visible clutter, with a lighter design available |
| Low | [P021](../../design/proposals/021-long-conversation-history-and-capacity.md) | Conversations beyond 2 MiB or 2,000 messages | Rarely hit today; P028 takes its retrieval part |
| Low | [P022](../../design/proposals/022-native-conversation-titles.md) | Native conversation titles | Conditional on runtime capability |

Not recommended now: the managed-profile acceptance work, self-development (P010 lineage) and managed extensions (P012 lineage), which account for most of the 23 open issues in that group and do not affect the owner's instance.

Not yet planned: an off-host backup of the deployed instance, and a way to continue an uncertain conversation in the personal VPS profile. Each would need its own proposal when the owner selects it.

## Evidence limits

- The stop-retention mechanism comes from source analysis only. P025 attempts to reproduce it on actual Linux before the fix; if it cannot, the diagnosis stays open in the issue.
- The walkthrough used deterministic fixtures in a cloud container. Real model latency, real reasoning and plan items and the personal VPS account screens were not exercised, and absolute timings differ from the VPS.
- The shared request budget comes from source and the documented proxy route; the live proxy and its source address were not inspected.
- The live runtime counts come from one read-only preflight at 19:21 UTC on 25 September; the state may have changed since, and the counts cannot distinguish protected from unknown runtimes.
- The fixture stack's Git helper image could not be built as pinned, because the container's network policy blocked its package downloads. Screens after the first recovery attempt used a substitute image with the same Git version. Only managed workspace inspection depends on it.
- Line counts come from `wc -l` over tracked files at `d0c505b`, the word count from `wc -w` over its Markdown files, change volumes from `git log --numstat` lines added, and the profile check count from a search for the profile flags in application source. Managed-only classification is by module and directory and is approximate.
- No application gate was rerun for this documentation change. Its gate is `node scripts/check-docs.mjs` and `git diff --check`; both passed on the final revision, and the pull request records the results.
