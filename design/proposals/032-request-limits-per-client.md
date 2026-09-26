# P032 — Request limits per client

## Metadata

- ID: P032
- Status: Draft
- Priority: High, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Behind the personal VPS reverse proxy, validated browser sessions have independent ordinary/control budgets, and sign-in traffic is attributed to its client network address. Coarse network and global limits remain shared protections, with explicit saturation limits.
- Authorization: On 27 September 2026 the owner authorized evaluation and revision of the open proposals, followed by commit and push of these document changes to `main`. Feature implementation, live experiments and deployment are outside this audit.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529` and the documented personal VPS proxy route. The shared bucket was not observed on the live host.
- Dependencies: No other proposal. Numeric global limits/map capacities and the bounded address-parser policy must be settled before acceptance. Completion also requires observed client-address handling through the real proxy under applicable owner authorization; source inspection cannot satisfy that check.
- Source issues: None.
- Design references: [Public access and identity](../architecture.md#public-access-and-identity), [deployment and profiles](../systems/004-deployment-and-profiles.md), [personal VPS guide](../../docs/developer/personal-vps.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P032-01–P032-09.

## Review note — 27 September 2026

Read-only source review against `e6c2a138563139650af46fe51af44c6eb6c28743`; the original baseline in Metadata and dated evidence remain historical. The plan separates authenticated actor budgets while retaining explicit coarse network limits. Forwarded addresses affect only limiter identity; final global/map bounds and observed real-proxy evidence remain acceptance prerequisites. This audit runs documentation checks only and adopts no canonical feature contract, performs no application/runtime/Linux acceptance and closes no issue.

## Problem, outcome and exclusions

The API's request limiter in [server.ts](../../apps/api/src/server.ts) keys every bucket by `req.ip`, and Fastify runs with `trustProxy: false`. On the personal VPS the [documented route](../../docs/developer/personal-vps.md) is a host Traefik proxy in front of the loopback API, so every request, from the owner or from anyone on the internet, arrives from the same address. All clients therefore share one ordinary bucket of 200 requests per 10 seconds and one sign-in bucket of 30 per minute. The limiter runs before authentication, so an unauthenticated client, including a routine vulnerability scanner, can exhaust either bucket and lock the owner out with HTTP 429 until the window ends. The reserved control bucket, which keeps cancellation, background stop and emergency stop available when ordinary traffic is heavy, is keyed the same way, so such a client can use it up too. The owner's own tabs and phone also compete for the same budget; the review's walkthrough reached the limit from a single browser. Tabs in one browser share a session, so this plan separates devices and browsers, not tabs; [P028](028-live-conversation-streaming.md) removes most of the requests that tabs make.

The architecture already says to trust forwarded headers only from the configured proxy; the implementation trusts none, which is safe for identity but collapses every client into one bucket.

After this change:

1. The API accepts forwarding headers only from a configured list of proxy addresses, loopback by default in the personal VPS profile, and takes the client address from the nearest untrusted hop.
2. A cheap coarse limit per client network address runs before authentication. Validated sessions then have separate ordinary and control budgets; exhausting ordinary traffic does not spend reserved controls. Clients sharing a NAT address or IPv6 /64 still share the coarse limit, so a flood above it can delay even authenticated controls.
3. Unauthenticated requests and sign-in starts have per-address and global admitted-request ceilings. Rejected local attempts cannot spend the global allowance. Different addresses remain independent below global saturation; this is not a guarantee against distributed traffic or a shared-address flood.
4. Bucket storage stays bounded, and unauthenticated traffic cannot fill the space that session buckets use.

Excluded: a web application firewall, address allow lists, CAPTCHA, changes to authentication or sessions, a proxy connection that local processes cannot imitate, the terminal input limiter and managed gateway limits.

## Dependencies and current design

This plan implements the architecture's existing forwarded-header rule and changes how limit buckets are keyed and in which order they apply. The existing error code, retry guidance and ordinary/control/sign-in window lengths stay. Reserved controls are classified by matched HTTP method and canonical route rather than raw URL substrings or suffixes. The design gains a short statement of the bucket kinds and of the trusted-proxy setting for each profile.

## Source issues

None.

## User and API flows

No new route or screen. The owner sees fewer "Request rate limit reached" banners; a client that exceeds its own budget still receives the existing `429` response with retry guidance.

## Contracts, state and security

- **Trusted proxies.** A new configuration value lists proxy addresses. In the personal VPS profile it defaults to loopback, because that profile's API listens only on `127.0.0.1` behind the documented proxy, so the profile's generated service files do not change. In other profiles, unset means today's behavior: forwarding headers are ignored. Forwarding headers from any peer outside the list are ignored.
- **Address validation.** Derive only a limiter address from the nearest untrusted hop of a bounded forwarding chain. Validate IP literals and normalize IPv4-mapped IPv6 before grouping IPv6 by /64. Ignore forwarding headers from untrusted peers; reject malformed trusted chains rather than treating arbitrary strings as new identities. Set exact header-byte/hop bounds before acceptance. Keep the fixed `HARBOR_ORIGIN` authoritative: this change must not make forwarded host or protocol an authentication, Origin, callback or redirect authority. [Fastify's request reference](https://fastify.dev/docs/latest/Reference/Request/) and [proxy option](https://fastify.dev/docs/latest/Reference/Server/#trustproxy) describe the forwarded fields; test the pinned 5.6.1 behavior instead of assuming that enabling proxy trust validates them.
- **Order and keys.** Propose a coarse network ceiling of 1,000 requests per 10 seconds before database authentication. Only a validated session hash, or token identity in profiles that already support tokens, may allocate an authenticated bucket; never use the raw cookie/token. Each actor keeps separate ordinary and control allowances of 200 per 10 seconds. Sign-in starts keep 30 per minute per network address. Missing, malformed, unknown, expired and revoked cookies/tokens take the bounded unauthenticated path even when authentication throws; random credentials cannot create actor budgets. `/auth/callback` is unauthenticated traffic. Exact unauthenticated/global allowances and map capacities must be recorded before acceptance, with each local allowance lower than its global counterpart.
- **Charging and controls.** Check local admission before charging global admitted-request counters, atomically within the limiter; locally rejected retries do not consume global sign-in or unauthenticated allowance. A canonical method/route table assigns reserved controls, including cancellation, background stop and emergency stop, independently of query strings. A query containing `/security/` cannot acquire a control budget, and a legitimate control route with a query cannot lose it.
- **Bounds.** Authenticated and network buckets have separate finite storage, time-based expiry and a specified saturation policy. Before acceptance, settle numeric capacities and whether a full network map refuses a new address or evicts an expired/eligible entry; bound the extra allowance eviction could grant under the global ceiling. Never evict actor state merely because unauthenticated traffic fills the network map. A full-map response is an honest availability limit, not a promise every new address is admitted.
- **Local and shared peers.** Host processes can imitate the loopback proxy and spend coarse address/global allowances; an unforgeable proxy transport remains excluded. Remote clients sharing a NAT or IPv6 /64 likewise share the coarse limit. Reserved actor controls are protected from ordinary actor traffic, not from saturation before authentication.
- **Distributed clients.** Many addresses can exhaust global unauthenticated/sign-in ceilings and delay a signed-out owner. Global unauthenticated traffic does not spend authenticated actor budgets, but physical server capacity and each actor's coarse network limit still apply.

## Implementation brief

Do not enable personal-profile API tokens as part of this change. Extract the limiter from the request hook into its own module, add the trusted-proxy setting and its profile default to configuration, and key buckets as above. Update the programmatic API guide's paragraph on limits. Test forged forwarding headers from trusted and untrusted peers, authentication failures, canonical control-route classification and bounded-map saturation through the real API. Global/map numeric choices and address parsing bounds are acceptance blockers, not implementer discretion.

## Exact file fence

The paths below are a prospective feature-implementation fence, not authorization to edit them during this audit. The current audit edits only the fourteen selected Draft proposals. Main must settle any missing new paths and check provisional decision/migration numbering before acceptance.

- `design/proposals/032-request-limits-per-client.md`
- `design/architecture.md`
- `design/systems/004-deployment-and-profiles.md`
- `apps/api/src/config.ts`
- `apps/api/src/server.ts`
- `apps/api/src/request-limits.ts`
- `tests/integration/request-limits.test.ts`
- `tests/e2e/p005.ts`
- `tests/e2e/p032.ts`
- `tests/e2e/run.ts`
- `docs/developer/personal-vps.md`
- `docs/developer/programmatic-api.md`

## Verification and acceptance

- **P032-01:** With loopback trusted, valid multi-hop forwarding uses the nearest untrusted client hop; an untrusted peer cannot choose its limiter address. Cover malformed/oversized chains, mapped IPv4 and IPv6 normalization, and forged host/protocol headers without changing fixed-origin security decisions.
- **P032-02:** Below the coarse ceiling, an unauthenticated burst exhausts only its own admitted allowance and leaves a validated owner's actor budgets intact, at both another address and the same one. Above 1,000 requests per 10 seconds, demonstrate the documented shared-address denial, including controls; a different address remains usable below global saturation. Invalid/revoked cookies and tokens cannot manufacture buckets.
- **P032-03:** 40 sign-in starts in a minute from one address are limited for that address. Meanwhile a signed-out owner at another address completes sign-in, including the callback and the return to `/`, even while the first address continues sustained rejected retries: those retries do not spend global admitted counters. Separately saturate the global ceiling and observe the documented denial/recovery window.
- **P032-04:** Two owner sessions, such as desktop and phone, keep separate budgets; exceeding one returns the existing `429` error and retry guidance.
- **P032-05:** With one owner session's ordinary budget exhausted, cancellation, background stop and emergency stop from that session still succeed below the coarse limit. A valid control with a query retains its reserved class; `/api/v1/me?x=/security/` cannot spend that class, and a wrong method cannot claim a control route.
- **P032-06:** Filling and expiring network/actor maps keeps memory within the specified cap and does not evict valid actor budgets because of network-map pressure. New addresses follow the accepted saturation/eviction rule; observe its bounded allowance and recovery. Requests from many addresses within one IPv6 /64 share one bucket.
- **P032-07:** In the personal VPS profile with no explicit setting, loopback is trusted and the generated service files are unchanged. In other profiles, or with the setting explicitly empty, forwarded-address trust matches today's; the new actor budgets still apply. Test the distinction explicitly.
- **P032-08:** `pnpm build`, `pnpm check`, `pnpm test`, P005's retained rate-limit regressions and the new real-stack P032 scenarios registered in the E2E harness, the full critical `pnpm test:e2e` and the personal VPS Linux lane pass.
- **P032-09:** Under applicable owner authorization, bounded requests through the real proxy demonstrate the expected effective client address and configured trust path, without storing credentials or personal IP addresses in tracked evidence. No live request runs during this audit.

Gate: behavioral, with forged-header tests for the trust boundary. Fixture evidence cannot establish the live proxy's source address; P032-09 does.

## Rollout and recovery

No migration and no change to the generated service files, so the release deploys through today's workflow. P032-09 confirms the forwarded address through the real proxy; if it shows a problem, redeploying the previous release restores today's single bucket, which is no worse than now.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
