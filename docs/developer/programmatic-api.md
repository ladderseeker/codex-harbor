# Programmatic API

## Design and evidence ownership — 20 September 2026

[Current subsystem designs](../../design/systems/) own behavior and limits; the [issue inbox](../../issues/) owns unfinished acceptance. Historical proposal IDs below identify feature lineage and evidence, not active execution. Future changes follow a newly selected proposal under the [workflow](../../design/workflow.md); baseline reconciliation did not rerun application gates.

Use HTTPS and `Authorization: Bearer <token>` with a token created through [owner settings](../user/api-tokens.md). Do not send cookies or put tokens in URLs. Anonymous API requests return JSON authentication errors. The protected `/api/v1/openapi.json` documents actual operations, JSON schemas, bearer scopes, and streaming events; unsupported API versions and unknown bearer routes fail closed.

A client with `read` and `execute` grants can list `/api/v1/projects`, create `/api/v1/sessions` using an allowed `projectId` and discovered model settings, then submit `{text, model, effort, permissionProfile}` to `/api/v1/sessions/<id>/turns`. Mutations require `Content-Type: application/json` and `Idempotency-Key: <Unix milliseconds>:<UUID>`. Use the exact same key and body after an uncertain network result. Reusing a key with changed input returns 409. Keys expire after 24 hours; a client must not replay an old uncertain side effect with a new key.

Follow `/api/v1/sessions/<id>/events` using an SSE client that sends the Authorization header. Persist its numeric event ID and reconnect with `Last-Event-ID`. A `resync` event means fetch `/snapshot` and reopen at its returned cursor. Browser EventSource cannot attach arbitrary authorization headers; tokens are intended for a separate HTTP client, not browser storage. Read durable operation status through `/api/v1/operations/<id>`.

The response error envelope is `{error:{code,message,requestId,retryable}}`. Handle 400 as invalid schema/input, 401 as invalid/expired/revoked credentials, 403 as denied route/scope/project/profile, 404 as missing resource, 409 as an intent or state conflict, and 429 as admission/rate exhaustion. For request-rate 429, wait at least ten seconds before retrying the identical request; login rate windows are sixty seconds. Limits are shared per source IP and control/ordinary request class (200 per ten seconds; login30 per minute). Do not automatically retry operations reported `uncertain`.

Cookie mutations still require exact Origin and CSRF. Bearer requests use explicit authorization without CSRF. Authority is rechecked when queued work is dispatched and when approved commands are sent. Revocation closes streams and rejects new dispatch; already-running work keeps its recorded grant. An `approve` token cannot answer a request from a session above its execution ceiling. Prompt text cannot enlarge the runner's server-selected sandbox.

Token verifiers use SHA-256 of a 256-bit random secret. Records bind to the pinned OIDC issuer/subject and instance identifier. Migration005 adds token records; rolling back token support disables bearer access while retaining the records and revocation flags. It does not grant anonymous fallback access.

The P001 live-account and medium retention/control bounds remain tracked in the [issue index](../../issues/README.md); token support does not resolve those inherited gates.

Each token may retain 1,000 ordinary mutation intents plus 100 reserved cancellation/approval intents. Existing intent retries still reconcile after this limit. The existing 24-hour terminal-intent retention applies; unresolved intents remain durable. Scoped cancellation records also stop at 550 operations per conversation. Owner browser administration remains available. These token-specific limits do not close P001's broader retention/control issue.
