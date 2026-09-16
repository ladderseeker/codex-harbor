# API tokens

Open the **Settings** gear at the bottom right of the sidebar, then open **API tokens**. Choose an existing project, capabilities, maximum execution permissions, and an expiry of 1–90 days. Copy the secret when it appears; closing or hiding it removes it from the interface. Harbor stores a verifier, not the secret, and never saves it in browser storage. Keep the secret in your script's secret manager.

The capabilities are `read` (projects, conversations, results, events and API documentation), `execute` (create conversations and submit turns), `approve` (answer approval/input requests), and `cancel` (request interruption). Project grants and the execution ceiling apply on the server. Token management, Codex credentials, root registration, and emergency administration require a signed-in owner browser.

Revoke a token from the same dialog. Streams close and queued turns lose permission to start. Already-running authorized work continues; use the browser's emergency stop if you need to stop execution. Expiry and owner identity changes also invalidate access.

Creation uses an idempotency key. If a response is lost, retry the same request. Harbor returns the original token metadata with `secretUnavailable: true`, without disclosing the secret again or creating another token. Revoke that record and create a replacement. The server retains at most 100 token records, including revoked records.

See the [programmatic API guide](../developer/programmatic-api.md) for authentication, errors, and retry behavior.
