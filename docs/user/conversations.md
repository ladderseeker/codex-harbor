# Conversations and account setup

The text-conversation foundation is implemented, with dedicated live-account acceptance [not yet available](../../issues/2026-09-07-171225-live-runtime-credentials.md) and recorded follow-ups still open. The [developer guide](../developer/development.md) explains how to try the isolated application with test identities and a deterministic Codex fixture.

## Start a conversation

1. Open Harbor's login URL and sign in with the configured owner identity. Other identities cannot open the application, API, assets, or event stream.
2. Choose **Add project**, select a configured root, and register or create an allowed project folder. The managed Linux profile uses administrator-provisioned storage; incompatible folders and an exhausted storage pool are rejected explicitly.
3. Open **Codex account** when setup is needed. Credential entry requires the authenticated owner and a configured protected credential service. The application discovers available models after a project exists. The fixture instance accepts test data only.
4. Choose **New conversation**, select an available model, reasoning effort, and permission profile, then enter your request. **Send** or Ctrl/Command+Enter submits it. The server enforces the configured permission ceiling.

The conversation shows streamed output and its current state. Closing the browser or restarting only the API does not cancel work owned by a healthy supervisor. Reopen Harbor and select the same conversation to see its persisted result. Reconnect may request a fresh snapshot when older replay events have expired; that does not restart the old request.

## Approvals, cancellation, and uncertainty

Review each approval or input request before answering. Another tab may already have answered it; only the current, authorized answer is accepted. Requests expire and do not receive unattended approval when the browser is absent.

**Stop turn** requests interruption. **Stopping** is not confirmation that execution has stopped; wait for the final state. After confirmed interruption, Harbor displays the observed process list when inspection succeeds. Some listed processes belong to the Codex runtime itself. An unavailable inspection is shown explicitly and must not be read as an empty process list.

An **Uncertain** state means Harbor cannot establish whether work was delivered or completed. Completed filesystem changes may remain. The conversation stays paused instead of automatically replaying that work. Rich owner-directed reconciliation belongs to the still-planned history/recovery feature.

If a submission loses its connection, use its retained retry action to submit the identical intent. Changing the payload or creating a new request expresses different work. Requests outside the supported retry window require a deliberate new intent; an expired key is not silently reused.

## Account and access controls

**Codex account** supports storing, replacing, and removing the server-held API credential. The key is not shown again after submission. Replacement/removal may return a conflict while work is active, and removal cannot be confirmed until the affected runtime and native credential copies have been handled. Removing Harbor's copy does not revoke a key at its provider.

**Sign out** revokes the browser session and closes its interactive access. Already-running authorized work continues; queued work cannot start using that revoked session's grant. **Emergency stop** separately requests interruption and prevents new dispatch. Neither action promises to undo changes already made by a tool.

## Storage visibility

Open **Storage and limits** for persisted conversation usage and managed project quota information. Project usage is marked unavailable when the trusted storage service cannot inspect it. **Conversation limits** explains the server's current replay and retry bounds. Reaching an admission limit prevents new work; it does not grant permission to delete project files automatically.

The application currently focuses on text conversations. Programmatic tokens, multiple workspace modes, file editing, attachments, terminals, richer history, schedules, deployment management, previews, and extension management remain tracked in the [active proposals](../../design/proposals/README.md).
