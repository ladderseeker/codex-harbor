# P012 — Managed skills and MCP

- Decision: Draft
- Delivery: Planned
- Dependencies: [P003](003-parallel-project-workspaces.md)
- Outcome: The owner configures a trusted skill or MCP service for a project, invokes it in a conversation, and can disable its future use.

## Scope and user/API flow

Add project-scoped discovery, enable/disable, effective configuration, invocation affordances, and errors for approved local skills and supported MCP connections. The owner sees which project, tools, permissions, and credential references a configuration affects. Use runtime capability discovery and a narrow authenticated configuration API.

Support only explicitly tested local or remote MCP connection profiles. Hosted marketplace parity, arbitrary desktop plugin installation, every connector OAuth flow, full browser/computer access, and event-triggered schedules are excluded. Unsupported configurations must remain visibly unsupported. The feature reuses P001's approval/input UI instead of inventing an unreviewed auto-approval path.

## Contracts and trust

Persist project-scoped extension IDs, type/source/version or digest where available, enabled state, validated connection profile, credential references, and effective policy. Configuration changes increment a revision and apply at a documented thread/runtime boundary; never imply a running turn changed configuration unless the runtime confirms it.

Skills, MCP launch commands, dependency installation, and setup scripts are executable project code. Execute them inside the assigned runner with restricted mounts/network and minimal credentials. Server policy and fixed launcher templates remain outside writable projects. A prompt or extension cannot enable itself globally, install host services, change mount roots, or retrieve a control-plane secret.

Protect credential entry, transport endpoints, and tool descriptions from logs or untrusted rendering. Remote service access follows egress/SSRF policy. Revocation blocks future dispatch/connection; active calls complete or interrupt according to their recorded grant and visible cancellation policy. It does not undo an already-completed external effect. Protect connection probes as carefully as normal invocation.

## Independent acceptance

Use P003 with a synthetic local skill, a real disposable MCP fixture service with a harmless observable tool, a denied service/command, and fake test secrets. Codex/OIDC may be deterministic external fixtures for UI flow; actual runtime extension use has its own lane.

1. **P012-01:** Discover/configure a skill and MCP connection, enable them for one project, and invoke through a conversation. Assert visible effective configuration and the harmless recorded tool outcome.
2. **P012-02:** Switch projects and inspect tools. Assert no accidental global enablement, cross-project credential exposure, or inherited authority.
3. **P012-03:** Submit unsupported capability, invalid executable/profile, forbidden destination, or excess permission configuration. Assert denial before installation, connection, or dispatch.
4. **P012-04:** Disable/revoke during a pending and active call. Assert no new dispatch, accurate active-call state, and no blind replay of uncertain external effects after restart.
5. **P012-05:** Use hostile descriptions/results and a fixture that requests unrelated credentials or host access. Assert safe rendering, protected secret references, and actual Linux execution/network confinement.
6. **P012-06:** With the pinned real Codex runtime, load/invoke the supported skill/MCP profiles and handle an approval/input request. Assert actual compatibility; synthetic picker entries alone cannot satisfy this criterion.

## Delivery and verification

Use planned `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live`, and `pnpm test:isolation` as the criteria require. Keep external effects restricted to disposable fixture services under the [shared verification contract](README.md#shared-verification-contract).

Add configuration/secret-reference migrations, backup registration, and post-restore disabled/revalidation behavior where credentials cannot be restored safely. Rollback disables incompatible new profiles without deleting source files or leaking secrets. Publish only the tested capability matrix and usage instructions. Record relevant upstream limitations, acceptance evidence, and independent review before `Verified`.
