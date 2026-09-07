# P011 — Private project previews

- Decision: Draft
- Delivery: Planned
- Dependencies: [P003](003-parallel-project-workspaces.md)
- Outcome: The owner starts a project's application and views it through an authenticated preview without exposing an arbitrary VPS port.

## Scope and user/API flow

Provide create/start/stop preview, readiness/failure state, private opening/embedding where safe, bounded process logs, and cleanup. A preview refers to a registered workspace, fixed execution profile, and an allowed application port inside its runner. The browser shows which workspace/process is being viewed.

The initial feature supports ordinary project HTTP applications and explicitly tested upgrade/stream behavior. It excludes full browser automation, unrestricted remote URL fetching, public sharing, arbitrary host port forwarding, and desktop browser-account synchronization. P010 has its own narrowly scoped candidate inspection path and does not depend on this general preview feature.

## Contracts and security

Store preview ID, workspace/runtime generation, permitted internal destination, lifecycle, process ownership, access grant, and expiry. Creation is an authenticated durable operation; stopping a preview confirms process/proxy termination and does not cancel an unrelated conversation implicitly.

Serve active project content on a separate origin from Harbor with no Harbor session cookie, broad credentials, or control-plane API authority. Bind preview grants narrowly and expire/revoke them with ownership/session policy. Test the preview authentication bootstrap without placing reusable bearer secrets in URLs. An embedding channel, if supported, validates exact origins and message schemas; the preview cannot command the parent application.

The trusted proxy resolves only registered runner destinations. Block metadata/control/database/private-host destinations, redirects or DNS changes that escape the allowed destination, and arbitrary browser-supplied upstreams. Enforce protocol, size, connection, lifetime, and egress limits. Preview processes retain appropriate workspace/resource reservations. Treat all preview JavaScript as project code, not trusted UI.

## Independent acceptance

Use delivered P003 with a small real HTTP fixture application, hostile-script variant, unavailable service, streaming route, and disallowed destination canaries. No terminal UI or self-development feature is required.

1. **P011-01:** Start a registered preview, observe readiness, open it, and stop it. Assert actual application output and confirmed destination/process cleanup.
2. **P011-02:** Access anonymously, after grant expiry/revocation, and with a wrong-project identity/reference. Assert denial before preview traffic is forwarded.
3. **P011-03:** Have hostile preview code attempt to read Harbor cookies or call its privileged API/parent window. Assert origin/authorization isolation and no leaked reusable credentials.
4. **P011-04:** Try arbitrary upstream URLs/ports, redirect/DNS changes, and metadata/control-plane destinations. Assert proxy/egress denial using actual Linux network tests.
5. **P011-05:** Restart the preview process/API, reconnect a supported stream, and exceed output/connection/lifetime quotas. Assert accurate state, bounded resources, and no stale-generation routing.
6. **P011-06:** Verify HTTPS and credential isolation for multiple previews and stable Harbor through the real gateway. Assert one preview cannot reuse another's grant or destination.

## Delivery and verification

Use planned `pnpm check`, `pnpm test`, `pnpm test:e2e`, and `pnpm test:isolation`; add live/contract lanes only if Codex integration changes. Follow [shared setup/evidence rules](README.md#shared-verification-contract). Configure separate test origins explicitly; a screenshot of a local page is not authentication/isolation evidence.

Add preview lifecycle migrations and expiry/cleanup registration. Restore metadata as inactive until a process is deliberately restarted; backup never implies a live process survives. Document supported protocols, private access, and limitations once implemented. Review proxy and cookie boundaries independently before verified delivery.
