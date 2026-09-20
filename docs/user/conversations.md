# Conversations and account setup

## Design and evidence ownership — 20 September 2026

[Current subsystem designs](../../design/systems/) own behavior and limits; the [issue inbox](../../issues/) owns unfinished acceptance. Historical proposal IDs below identify feature lineage and evidence, not active execution. Future changes follow a newly selected proposal under the [workflow](../../design/workflow.md); baseline reconciliation did not rerun application gates.

The text-conversation foundation is implemented, with dedicated live-account acceptance [not yet available](../../issues/2026-09-07-171225-live-runtime-credentials.md) and recorded follow-ups still open. The [developer guide](../developer/development.md) explains how to try the isolated application with test identities and a deterministic Codex fixture.

## Start a conversation

1. Open Harbor's login URL and sign in with the configured owner identity. Other identities cannot open the application, API, assets, or event stream.
2. Choose **Add project** beside Projects, select a configured root, and register or create an allowed project folder. In local mode, browse nested folders inside that root and select the folder to register. Managed installations retain the relative-path form and show why browsing is unavailable. The managed Linux profile uses administrator-provisioned storage; incompatible folders and an exhausted storage pool are rejected explicitly.
3. Open **Codex account** when setup is needed. Credential entry requires the authenticated owner and a configured protected credential service. The application discovers available models after a project exists. The fixture instance accepts test data only.
4. Choose **New chat**, or the new-conversation action beside a project, select an available model, reasoning effort, and permission profile, then enter your request. **Send** or Enter submits it; Shift+Enter adds a line. Ctrl/Command+Enter also submits. The composer starts at one line, grows with text, and scrolls after its height limit. The server enforces the configured permission ceiling.

Drag the sidebar's right edge to widen or narrow it. Keyboard users can focus the divider and use arrow keys or Home/End. On small screens, **Open navigation** opens the project sidebar; Escape or the backdrop closes it. The ellipsis beside a project opens **Project details**, including workspace selection and supported tools. The bottom-right **Settings** gear contains account, available API-token, sign-out and emergency controls. Unsupported feature placeholders are omitted.

The conversation shows streamed output and actionable errors or requests. Open its ellipsis menu and choose **View status** for detailed state, connection and resource information. Closing the browser or restarting only the API does not cancel work owned by a healthy supervisor. Reopen Harbor and select the same conversation to see its persisted result. Reconnect may request a fresh snapshot when older replay events have expired; that does not restart the old request.

## Formatted replies

Assistant replies display Markdown headings, emphasis, links, lists, quotes, tables and code blocks while streaming and after reopening. Wide tables and code scroll within the reply. To show Markdown containing triple-backtick code fences, use a longer outer fence (four backticks) or a tilde fence. Incomplete formatting settles as more text arrives.

Common labelled code blocks use syntax coloring. Unknown or unlabelled languages and blocks larger than 32 KiB remain readable plain text. Mermaid blocks display labeled source code in this version. Raw HTML is not executed, and image references display text instead of automatically loading remote images. User messages and tool output remain literal.

## Copy and response actions

Each user message has a copy button and two decorative thumb icons beneath its bubble. The user thumb icons do not accept feedback. Hover over the message or focus its controls to reveal it; touch devices keep it visible. A completed assistant turn has one toolbar beneath its final body: copy, like and dislike. Copy preserves the original Markdown for the complete response, excluding tool events, timestamps and interface labels. Code and literal Markdown source blocks have their own copy button at the top right of the language header, outside the scroll area; code copy preserves whitespace without the outer fence or language label. A check appears after successful copying; failures show a short notice.

Assistant like and dislike only change the current page’s selection. They are mutually exclusive, clicking again clears the choice, and refreshing clears it. No feedback request, database record or analytics event is created.

Reasoning options follow each model’s discovered runtime capabilities. GPT-6 Astra uses Low (`low`), Medium (`medium`), High (`high`), Extra High (`xhigh`) and Max (`max`) when available. Changing models updates the options; unavailable levels cannot be submitted.

## Approvals, cancellation, and uncertainty

Review each approval or input request before answering. Another tab may already have answered it; only the current, authorized answer is accepted. Requests expire and do not receive unattended approval when the browser is absent.

**Stop turn** requests interruption. **Stopping** is not confirmation that execution has stopped; wait for the final state. After confirmed interruption, Harbor displays the observed process list when inspection succeeds. Some listed processes belong to the Codex runtime itself. An unavailable inspection is shown explicitly and must not be read as an empty process list.

An **Uncertain** state means Harbor cannot establish whether work was delivered or completed. Completed filesystem changes may remain. The conversation stays paused instead of automatically replaying that work. The recovery panel provides owner-directed fencing and a separate acknowledged new-operation path, described below.

If a submission loses its connection, use its retained retry action to submit the identical intent. Changing the payload or creating a new request expresses different work. Requests outside the supported retry window require a deliberate new intent; an expired key is not silently reused.

## Account and access controls

**Codex account** supports storing, replacing, and removing the server-held API credential. The key is not shown again after submission. Replacement/removal may return a conflict while work is active, and removal cannot be confirmed until the affected runtime and native credential copies have been handled. Removing Harbor's copy does not revoke a key at its provider.

**Sign out** revokes the browser session and closes its interactive access. Already-running authorized work continues; queued work cannot start using that revoked session's grant. **Emergency stop** separately requests interruption and prevents new dispatch. Neither action promises to undo changes already made by a tool.

## Storage visibility

Open **View status** from the conversation ellipsis menu, then **Storage and limits**, for persisted conversation usage and managed project quota information. Project usage is marked unavailable when the trusted storage service cannot inspect it. **Conversation limits** explains the server's current replay and retry bounds. Reaching an admission limit prevents new work; it does not grant permission to delete project files automatically.

Existing supporting tools retain their capability and installation requirements. The [current designs](../../design/systems/) distinguish available behavior from the unfinished live-account, deployment, restore and deferred-feature obligations in the [issue inbox](../../issues/).

## Search and organize history

Harbor names an untitled conversation from the first substantive request, using a short excerpt. Greetings such as “Hello” leave naming pending. Existing untouched default titles are populated when upgraded. A manual rename always wins, including a deliberate title of “New conversation”.

Choose the magnifier **Search and filters** at the top of the sidebar to find a title or stored message text within the selected project. **Show** switches between active, archived, and all conversations inside the search dialog. Select a result to open it; Escape or the backdrop closes search. Search results stay separate from the sidebar. Each expanded project shows five nonarchived conversations ordered by the most recently accepted query. A conversation with no submitted query uses its creation time. Selecting or opening a conversation only changes its highlight and preserves row order and loaded depth; sending accepted input moves it to its durable position. Typing a draft, renaming, and receiving output or status changes do not reorder it. **Show more** adds the next five, and refresh keeps the loaded depth. A failed request retains the rows and offers **Retry history**. History controls and status text align with chat titles. Project rows place New chat before the ellipsis, whose position aligns with chat ellipses and the Projects heading plus. Chat ellipsis menus remain discoverable with pointer, keyboard and touch. Choose **Rename**, edit **Conversation title** and choose **Save title**. Renaming checks the current revision so another tab's edit cannot be overwritten silently, and renaming an inactive chat preserves the active conversation and its draft.

**Archive conversation** changes list visibility without deleting messages, removing files, or changing native history. It does not interrupt an active turn. In the personal VPS profile, archiving also retires idle retained development processes and releases their workspace only after retirement is confirmed. Open a retained direct conversation link, or select archived history, then use **Restore conversation** to return it to the active list.

## Recover an uncertain conversation

Choose **Fence old runtime and inspect history**. Harbor first confirms that the old runtime and its processes have retired. It then attempts a bounded native-history read. The result distinguishes unavailable or truncated native content; already confirmed stored messages are preserved when the read conflicts. Old approval requests expire. An uncertain original operation remains visibly uncertain even when native text is recovered.

A ready recovery offers a separate text field and a risk acknowledgement. Review files and retained history, acknowledge that unknown effects may remain, then use **Start new operation after recovery**. This is a new operation with new instructions, not a replay or an exactly-once continuation. Normal new-work quotas can still reject it. You can leave the conversation stopped.

If the response is lost, **Retry same request** reconciles the same intent after reconnect or API restart. A failed fencing attempt requires **Retry fencing deliberately**, with at most three attempts. Exhausted or unconfirmed retirement remains blocked; use the administrator's SSH recovery path rather than trying to force another generation through the UI.

Replay keeps at most 2,000 events and seven days, including uncertain conversations. Messages and unresolved operations are stored separately. A replay gap requests a fresh snapshot and stream; it never resubmits a turn. Reserved controls remain separate from ordinary history-request limits, while a database outage denies new requests until persistence returns.

## Personal VPS development

With **Edit project files**, the personal VPS profile permits the selected existing repository's files and Git metadata, private temporary/cache storage and development networking. Node and pinned pnpm are supplied. Git identity is project configuration; Harbor does not invent the owner's commit identity. Linked/external Git metadata and initializing a new repository inside a turn are unsupported. Select an existing ordinary repository for Git work.

Consecutive commands in the same operation share one collapsed activity row showing their count and running state. Open it to see each command, directory, output and final exit status; it stays expanded while updates arrive. Approval/input requests and actionable errors remain visible. Output is bounded at 32 KiB per command and 256 KiB per conversation, with explicit truncation/omission notices. Assistant messages reconcile the final native response with streamed text. The permission selector is restored from the conversation when reopened.

After a successful turn, a green dot indicates retained runtime resources or a confirmed workspace reservation. It does not mean connected or generating. Open **View status** for the retention deadline and resource details; an uncolored dot makes no claim that resources are free. **Development processes are available** in this dialog shows a 30-minute retention period. Continuing the same conversation renews it; its workspace stays reserved, so other conversations cannot write there concurrently. Use **Stop background processes** in the ellipsis menu or status dialog when finished to end the owned runtime and release that reservation. Closing the browser does not stop it. At most four personal runtime contexts are retained or active simultaneously.

Use [personal development previews](previews.md#personal-vps-development-preview) to view a server after the task completes. A graceful supervisor shutdown retires retained work. An abrupt crash or unconfirmed stop shows uncertainty and preserves the workspace fence; use SSH recovery rather than assuming the processes are absent or replaying work. Standalone terminal UI and managed uncertain-work recovery remain unavailable in the personal profile.
