# P032 — Request limits per client

## Metadata

- ID: P032
- Status: Draft
- Priority: High, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Behind the personal VPS reverse proxy, no other internet client can use up the owner's request or sign-in budget, and the owner's devices and browsers no longer share one budget.
- Authorization: Proposal writing only. Implementation, commits to `main`, deployment and any check against the live proxy need the owner's separate go-ahead.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529` and the documented personal VPS proxy route. The shared bucket was not observed on the live host.
- Dependencies: None. Confirming the client address through the owner's real proxy route needs the owner's go-ahead and blocks completion only for that check.
- Source issues: None.
- Design references: [Public access and identity](../architecture.md#public-access-and-identity), [deployment and profiles](../systems/004-deployment-and-profiles.md), [personal VPS guide](../../docs/developer/personal-vps.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P032-01–P032-09.

## Problem, outcome and exclusions

The API's request limiter in [server.ts](../../apps/api/src/server.ts) keys every bucket by `req.ip`, and Fastify runs with `trustProxy: false`. On the personal VPS the [documented route](../../docs/developer/personal-vps.md) is a host Traefik proxy in front of the loopback API, so every request, from the owner or from anyone on the internet, arrives from the same address. All clients therefore share one ordinary bucket of 200 requests per 10 seconds and one sign-in bucket of 30 per minute. The limiter runs before authentication, so an unauthenticated client, including a routine vulnerability scanner, can exhaust either bucket and lock the owner out with HTTP 429 until the window ends. The reserved control bucket, which keeps cancellation, background stop and emergency stop available when ordinary traffic is heavy, is keyed the same way, so such a client can use it up too. The owner's own tabs and phone also compete for the same budget; the review's walkthrough reached the limit from a single browser. Tabs in one browser share a session, so this plan separates devices and browsers, not tabs; [P028](028-live-conversation-streaming.md) removes most of the requests that tabs make.

The architecture already says to trust forwarded headers only from the configured proxy; the implementation trusts none, which is safe for identity but collapses every client into one bucket.

After this change:

1. The API accepts forwarding headers only from a configured list of proxy addresses, loopback by default in the personal VPS profile, and takes the client address from the nearest untrusted hop.
2. A cheap limit per client address runs before authentication, high enough never to affect one owner's normal use. After authentication, signed-in owner requests are limited per server session, with separate ordinary and control budgets, so cancellation, background stop and emergency stop stay available. Unauthenticated requests are limited per client address, well below a separate global ceiling that never consumes a session's budget.
3. Sign-in starts are limited per client address, with a global ceiling high enough that one client cannot block sign-in from another address.
4. Bucket storage stays bounded, and unauthenticated traffic cannot fill the space that session buckets use.

Excluded: a web application firewall, address allow lists, CAPTCHA, changes to authentication or sessions, a proxy connection that local processes cannot imitate, the terminal input limiter and managed gateway limits.

## Dependencies and current design

This plan implements the architecture's existing forwarded-header rule and changes how limit buckets are keyed and in which order they apply. The existing error code, retry guidance, window lengths and route classification stay. The design gains a short statement of the bucket kinds and of the trusted-proxy setting for each profile.

## Source issues

None.

## User and API flows

No new route or screen. The owner sees fewer "Request rate limit reached" banners; a client that exceeds its own budget still receives the existing `429` response with retry guidance.

## Contracts, state and security

- **Trusted proxies.** A new configuration value lists proxy addresses. In the personal VPS profile it defaults to loopback, because that profile's API listens only on `127.0.0.1` behind the documented proxy, so the profile's generated service files do not change. In other profiles, unset means today's behavior: forwarding headers are ignored. Forwarding headers from any peer outside the list are ignored.
- **Order and keys.** The per-address limit runs first, in memory and before any database work, with a ceiling well above normal use, for example 1,000 requests per 10 seconds, so a flood from one address never reaches session lookup. A request counts as signed in only after its session is validated; it then also counts against that session's ordinary or control bucket, keyed by the session hash, never the raw cookie, with today's limits and route classification. Every other request, including one with an unknown or expired cookie, counts against its address's unauthenticated bucket and the global unauthenticated ceiling, so random cookies cannot create new budgets. One address's unauthenticated limit is well below the global unauthenticated ceiling, so a single address cannot use the ceiling up. `/auth/callback` counts as an unauthenticated request. Sign-in starts use the client address plus a global counter. A bearer-token request counts against its token's buckets the way a session's requests do.
- **Bounds.** Session buckets and address buckets live in separately bounded maps. When the address map is full, new unauthenticated clients share an overflow bucket instead of receiving 429 for every request; session buckets are unaffected.
- **Local peers.** Processes on the host, including native runtimes and project code with development networking, can reach the loopback API and set any forwarding header, including the owner's own address. They can therefore still spend the owner's per-address limit before authentication and the global unauthenticated ceiling, as any client can spend the single shared budget today. Closing that needs a proxy connection that local processes cannot imitate and is excluded here.

## Implementation brief

Extract the limiter from the request hook into its own module, add the trusted-proxy setting and its profile default to configuration, and key buckets as above. Update the programmatic API guide's paragraph on limits. Test forged forwarding headers from trusted and untrusted peers.

## Exact file fence

- `design/proposals/032-request-limits-per-client.md`
- `design/architecture.md`
- `design/systems/004-deployment-and-profiles.md`
- `apps/api/src/config.ts`
- `apps/api/src/server.ts`
- `apps/api/src/request-limits.ts`
- `tests/integration/request-limits.test.ts`
- `tests/e2e/p005.ts`
- `docs/developer/personal-vps.md`
- `docs/developer/programmatic-api.md`

## Verification and acceptance

- **P032-01:** With loopback trusted, a request from the proxy carrying `X-Forwarded-For` is limited under the forwarded client address; the same header from an untrusted peer is ignored.
- **P032-02:** 300 unauthenticated requests in 10 seconds from one client address, including requests to control routes, cause no `429` for the signed-in owner, whether the owner uses another address or the same one.
- **P032-03:** 40 sign-in starts in a minute from one address are limited for that address. Meanwhile a signed-out owner at another address completes sign-in, including the callback and the return to `/`, even while the first address also floods other unauthenticated requests.
- **P032-04:** Two owner sessions, such as desktop and phone, keep separate budgets; exceeding one returns the existing `429` error and retry guidance.
- **P032-05:** With one owner session's ordinary budget exhausted, cancellation, background stop and emergency stop from that session still succeed.
- **P032-06:** Filling the address map with distinct addresses leaves session buckets and the overflow bucket working, and memory stays bounded.
- **P032-07:** In the personal VPS profile with no explicit setting, loopback is trusted and the generated service files are unchanged. In other profiles, or with the setting explicitly empty, behavior matches today's.
- **P032-08:** `pnpm build`, `pnpm check`, `pnpm test`, P005's rate-limit browser scenarios, the full critical `pnpm test:e2e` and the personal VPS Linux lane pass.
- **P032-09:** With the owner's go-ahead, one bounded request through the real proxy route shows the forwarded client address used for limiting.

Gate: behavioral, with forged-header tests for the trust boundary. Fixture evidence cannot establish the live proxy's source address; P032-09 does.

## Rollout and recovery

No migration and no change to the generated service files, so the release deploys through today's workflow. P032-09 confirms the forwarded address through the real proxy; if it shows a problem, redeploying the previous release restores today's single bucket, which is no worse than now.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
