# P002 — Programmatic API access

- Decision: Accepted
- Delivery: Implemented
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

## Implementation decisions

P002 uses four explicit scopes: `read`, `execute`, `approve`, and `cancel`, with project UUID grants and a read-only or workspace-write ceiling. Tokens expire in 1–90 days. Token management remains browser-only. Up to 100 token records are retained per instance; revocation records remain durable. Creation retries return metadata with `secretUnavailable: true`; the raw secret is returned only on the first successful response and never enters the idempotency record. A lost first response requires revoke/recreate. Unknown routes remain browser-only until an explicit scope/resource policy is added.

P001's live-account and medium bounds obligations remain open; this implementation does not establish dependent verification.

## Current implementation evidence

On 7 September 2026, `pnpm check`, `pnpm build`, nine integration tests, 13 adapter contracts (including pinned-runtime non-model smoke), and the combined real P002/P001 browser/API suite passed on source digest `2a14f17585b36d28ef9883e4e4f4c879db7175b90c97f75fd0dbe4ac5665f84e` (807 source/config files). The stable E2E artifact is `harbor-e2e-e8ae73cdcc`, with matching start/end digest, Node 26.7.0, Chromium 1194, and Codex 0.153.4. Only the external OIDC and Codex boundaries used fixtures.

Independent review round 1 identified pre-send control revocation handling, conditional OpenAPI headers, and editable UI rejection handling. Those fixes passed focused contracts and the complete stable regression, including paused approval/cancel send guards. Round 2 independently checked the fixes and matching source/evidence and closed with no remaining actionable findings. Integration on Node 24.11.1 also passed check/build, nine integration tests, 13 contracts, and the full P002/P001 E2E run `harbor-e2e-f45757ee74`, with matching source digest at start and end. `pnpm test:live` returned exit 2 because dedicated credentials are unavailable; no model request was made. P002 remains unverified pending applicable upstream and live-account gates.

Available behavior is documented in the [token settings guide](../../docs/user/api-tokens.md) and [programmatic API guide](../../docs/developer/programmatic-api.md). The [implementation report](../../docs/reports/2026-09-07-p002-api-tokens.md) records the source identity, review closure, integration baseline, and remaining gates.

## Subsequent authority finding

On 7 September 2026, a separate real PostgreSQL probe found [expiry accepted after an authority row-lock wait](../../issues/archive/2026-09-07-202308-authority-expiry-after-lock-wait.md), High severity. P002 owns the shared policy correction and P002-03/05 regression evidence; P007 also owns its recovery integration. The earlier review/test results remain historical evidence, and this newly discovered blocker must be resolved before verification.
### Locked authority expiry correction — 7 September 2026

A real PostgreSQL row-lock probe showed that a volatile clock predicate can still be evaluated before `FOR SHARE` waits. Authority now acquires the owner-identity gate, locks the actor row by identity, and evaluates expiry, idle timeout, revocation and pin binding in a separate statement after acquiring that lock. Pool callers use one owned transaction; browser activity updates only after this fresh check. The final runtime send guard repeats authorization after session/generation waits. Proven pre-wire denial continues to reject only the pending control, preserving an already-authorized running turn. The owner rotation gate is shared by readers and exclusive during pin changes, and is acquired before meta/actor locks.

The corrective evidence uses actual PostgreSQL blocked-row expiration for tokens, browser absolute expiry and browser idle expiry, plus real-stack approval/cancellation expiry at the final wire boundary. These checks supplement the earlier P002 baseline and do not rewrite its historical report.

The last authority decision for P001 project registration occurs after its admission locks and immediately before filesystem/provisioning effects. That accepted browser metadata grant survives expiry during the external operation; a post-callback expiry rejection cannot undo already-created storage. Other database-only commands recheck after their callback and retained-result lookup waits. P003 adds the durable storage-intent lifecycle for crash-safe allocation; this correction does not claim to retrofit that lifecycle into P001. Runtime wire dispatch still requires fresh authority after every relevant lock.

Corrective checkpoint: Node 26.7.0 / pnpm 12.3.4 on macOS arm64, pinned Codex 0.153.4 and Chromium 1194. `pnpm check`, `pnpm build`, nine integration tests, thirteen contracts, and the complete real P001/P002 E2E passed. Run `harbor-e2e-cc7b466f60` recorded matching start/end source digest `9b01ead96025c7b47664911b76ed08496f245fa8b03d3640a6e52d6fa4e6672a` (808 files). Independent focused review closed the three authority call-site corrections with no remaining actionable critical finding in that scope. This checkpoint preserves the separate live-account gate and does not establish P007 or P003 integration behavior.

Main integration on Node 24.11.1 also passed check/build, nine integration tests, thirteen contracts and the complete E2E `harbor-e2e-402f47b9ab` at that same digest. The original expired-token reproduction now rejects after the blocked row is released. The [report addendum](../../docs/reports/2026-09-07-p002-api-tokens.md#authority-correction-and-integration--7-september-2026) records the third review round and evidence; the shared source issue remains active for P003/P007 integration.

### Combined authority closure — 7 September 2026

The shared authority finding is now Resolved after separate P003/P007 integration review and passing combined Node 24 acceptance. See the [history integration report](../../docs/reports/2026-09-07-p007-history-integration.md) for the tested source and E2E/contract results. Earlier pending-integration statements describe their historical checkpoints; the dedicated live-account and applicable upstream gates remain open.
