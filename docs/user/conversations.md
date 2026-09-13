# Conversations and account setup

The text-conversation foundation is implemented, with dedicated live-account acceptance [not yet available](../../issues/2026-09-07-171225-live-runtime-credentials.md) and recorded follow-ups still open. The [developer guide](../developer/development.md) explains how to try the isolated application with test identities and a deterministic Codex fixture.

## Start a conversation

1. Open Harbor's login URL and sign in with the configured owner identity. Other identities cannot open the application, API, assets, or event stream.
2. Choose **Add project** beside Projects, select a configured root, and register or create an allowed project folder. In local mode, browse nested folders inside that root and select the folder to register. Managed installations retain the relative-path form and show why browsing is unavailable. The managed Linux profile uses administrator-provisioned storage; incompatible folders and an exhausted storage pool are rejected explicitly.
3. Open **Codex account** when setup is needed. Credential entry requires the authenticated owner and a configured protected credential service. The application discovers available models after a project exists. The fixture instance accepts test data only.
4. Choose **New chat**, or the new-conversation action beside a project, select an available model, reasoning effort, and permission profile, then enter your request. **Send** or Enter submits it; Shift+Enter adds a line. Ctrl/Command+Enter also submits. The composer starts at one line, grows with text, and scrolls after its height limit. The server enforces the configured permission ceiling.

Drag the sidebar's right edge to widen or narrow it. Keyboard users can focus the divider and use arrow keys or Home/End. On small screens, **Open navigation** opens the project sidebar; Escape or the backdrop closes it. **Project tools** groups workspace and supporting tools. **Account & settings** contains account, API-token, sign-out and emergency controls.

The conversation shows streamed output and its current state. Closing the browser or restarting only the API does not cancel work owned by a healthy supervisor. Reopen Harbor and select the same conversation to see its persisted result. Reconnect may request a fresh snapshot when older replay events have expired; that does not restart the old request.

## Approvals, cancellation, and uncertainty

Review each approval or input request before answering. Another tab may already have answered it; only the current, authorized answer is accepted. Requests expire and do not receive unattended approval when the browser is absent.

**Stop turn** requests interruption. **Stopping** is not confirmation that execution has stopped; wait for the final state. After confirmed interruption, Harbor displays the observed process list when inspection succeeds. Some listed processes belong to the Codex runtime itself. An unavailable inspection is shown explicitly and must not be read as an empty process list.

An **Uncertain** state means Harbor cannot establish whether work was delivered or completed. Completed filesystem changes may remain. The conversation stays paused instead of automatically replaying that work. The recovery panel provides owner-directed fencing and a separate acknowledged new-operation path, described below.

If a submission loses its connection, use its retained retry action to submit the identical intent. Changing the payload or creating a new request expresses different work. Requests outside the supported retry window require a deliberate new intent; an expired key is not silently reused.

## Account and access controls

**Codex account** supports storing, replacing, and removing the server-held API credential. The key is not shown again after submission. Replacement/removal may return a conflict while work is active, and removal cannot be confirmed until the affected runtime and native credential copies have been handled. Removing Harbor's copy does not revoke a key at its provider.

**Sign out** revokes the browser session and closes its interactive access. Already-running authorized work continues; queued work cannot start using that revoked session's grant. **Emergency stop** separately requests interruption and prevents new dispatch. Neither action promises to undo changes already made by a tool.

## Storage visibility

Open **Storage and limits** for persisted conversation usage and managed project quota information. Project usage is marked unavailable when the trusted storage service cannot inspect it. **Conversation limits** explains the server's current replay and retry bounds. Reaching an admission limit prevents new work; it does not grant permission to delete project files automatically.

Existing supporting tools retain their capability and installation requirements. The [proposal index](../../design/proposals/README.md) distinguishes implemented behavior from unfinished live-account, deployment, restore and deferred-feature obligations.

## Search and organize history

Open **Search and filters** within a project's chat list to find a title or stored message text. **Show** switches between active, archived, and all conversations; **Load older conversations** fetches the next bounded page. Hover or focus a chat row to reveal its rename action; touch devices keep the action available. Edit **Conversation title** and choose **Save title**. Renaming checks the current revision so another tab's edit cannot be overwritten silently, and renaming an inactive chat preserves the active conversation and its draft.

**Archive conversation** changes list visibility only. It does not stop running work, delete messages, remove files, or change native history. Open a retained direct conversation link, or select archived history, then use **Restore conversation** to return it to the active list.

## Recover an uncertain conversation

Choose **Fence old runtime and inspect history**. Harbor first confirms that the old runtime and its processes have retired. It then attempts a bounded native-history read. The result distinguishes unavailable or truncated native content; already confirmed stored messages are preserved when the read conflicts. Old approval requests expire. An uncertain original operation remains visibly uncertain even when native text is recovered.

A ready recovery offers a separate text field and a risk acknowledgement. Review files and retained history, acknowledge that unknown effects may remain, then use **Start new operation after recovery**. This is a new operation with new instructions, not a replay or an exactly-once continuation. Normal new-work quotas can still reject it. You can leave the conversation stopped.

If the response is lost, **Retry same request** reconciles the same intent after reconnect or API restart. A failed fencing attempt requires **Retry fencing deliberately**, with at most three attempts. Exhausted or unconfirmed retirement remains blocked; use the administrator's SSH recovery path rather than trying to force another generation through the UI.

Replay keeps at most 2,000 events and seven days, including uncertain conversations. Messages and unresolved operations are stored separately. A replay gap requests a fresh snapshot and stream; it never resubmits a turn. Reserved controls remain separate from ordinary history-request limits, while a database outage denies new requests until persistence returns.
