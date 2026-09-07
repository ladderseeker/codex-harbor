# P002 — Programmatic API access

- Decision: Accepted
- Delivery: In progress
- Dependencies: [P001](001-secure-persistent-conversations.md)
- Outcome: The owner can create a limited access token and use an external script to operate Harbor without a browser session.

## Scope and user/API flow

Add owner settings for token creation, scope/project selection, expiry, last-use metadata, and revocation. Display the raw token once. A script authenticates with `Authorization: Bearer`, discovers the versioned API, submits work with an idempotency key, follows events, reads the result, and cancels permitted work. Authentication errors return API errors rather than an HTML login redirect.

Publish an OpenAPI contract and streaming-event schema for the capabilities actually delivered. P001's cookie-authenticated UI API already exists; this feature adds machine credentials and a supported external contract. Later features extend that contract when delivered. Public registration, multi-user roles, raw Codex RPC forwarding, and unlimited administration tokens are excluded.

## Contracts and security

Store token identifier/prefix, verifier hash, owner binding, explicit capabilities, allowed project IDs, expiry, revocation, and audit metadata. Never persist or log raw tokens. The authority of a request is the intersection of token grants, resource ownership, and current server policy. Execution/approval scopes include a maximum execution profile; a token cannot gain a stronger profile indirectly through a prompt, configuration change, or approval answer.

Use the [shared operation/idempotency rules](../architecture.md#api-events-and-state-transitions). A revoked token cannot start queued work or retain a stream. Already-running work follows its recorded execution grant; revocation is distinct from emergency stop. Token management itself requires owner-browser authority with appropriate CSRF/session checks. No token is accepted from query strings or browser local storage.

## Independent acceptance

Seed P001 in a fresh instance with its allowed project and a synthetic resource ID outside the token's grants. Use a real browser for token management plus a separate HTTP/SSE client for API actions; no multi-project management interface from P003 is required.

1. **P002-01:** Create a project-scoped token, use it without cookies to submit text and receive a final streamed result, then read the operation. Assert actual runtime dispatch and durable state.
2. **P002-02:** Verify the raw secret appears only at creation and is absent from storage, later settings responses, operational logs, and URLs.
3. **P002-03:** Exercise missing, expired, revoked, malformed, wrong-project, and insufficient-scope credentials. Assert denial and zero unauthorized side effects.
4. **P002-04:** Try to exceed the token's execution/approval ceiling through direct requests and indirect configuration. Assert server policy remains the upper bound.
5. **P002-05:** Revoke a token while streaming and while its next operation is queued. Assert stream closure and no new dispatch; authorized work already running is reported accurately.
6. **P002-06:** Retry accepted input, provoke schema/version errors, and trigger rate limits. Assert stable operation identity, documented error envelopes, and safe retry guidance. Fetch API documentation anonymously and assert protection.

## Delivery and verification

Run the P002 browser/API cases through actual Harbor services using P001 external fixtures. Use planned `pnpm check`, `pnpm test`, and `pnpm test:e2e`; run real contract/live lanes if the adapter or account interaction changes. Follow the [shared evidence and cleanup contract](README.md#shared-verification-contract). No future workspace UI or scheduler is required to test tokens.

Add token tables/indexes with an additive migration; revocation must work across service restarts. Document token use and API versioning under `docs/` only after implementation. Rollback disables token authentication and preserves revocation records without falling back to unauthenticated access. Link actual acceptance and independent-review evidence before `Verified`.

## Implementation record

- 2026-09-07: Started isolated implementation on the committed P001 foundation under the owner's roadmap authorization. The first slice delivers scoped token management, current-authority enforcement, the supported external contract, and browser/API acceptance together. P001's remaining gates stay visible; this record is not implementation evidence.
