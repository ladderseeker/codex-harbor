# P015 — Use a subscription account on an existing VPS project

- Proposal ID: P015
- Decision: Accepted within the owner's 2026-09-13 request to propose and implement the analyzed VPS workflow; technical details remain subject to review.
- Delivery: In progress
- Dependencies: Implemented P001 authentication/conversation/persistence, P003 Local workspace records, P007 history, P013 native adapter. Their outstanding evidence is not waived. P009 managed installation is a separate profile, not a prerequisite for this outcome.
- User outcome: Sign into Harbor through HTTPS, register an approved existing VPS folder, authenticate official Codex with a ChatGPT subscription, have it read/edit that folder, leave work running after browser/SSH disconnect, and return to its results and conversation.
- Evidence/status updated: 2026-09-13; [candidate report](../../docs/reports/2026-09-13-personal-vps-candidate.md) records passing native/systemd, personal browser, critical and supporting checks plus three independent reviews. Public installed/account acceptance remains unverified.
- Next action: Owner instance is live at `https://harbor.seekworld.tech/auth/login`; complete main-application Google login, original-folder conversation/edit and reconnect acceptance. Real subscription reuse, installed services and native write boundaries have passed; keep delivery In progress until the remaining UI gate passes.

## Scope and prerequisites

[D011](../decisions/011-personal-vps-workspace.md) owns the explicit change from the managed container/XFS contract for this personal profile. Include owner OIDC login, protected browser/API/SSE, native account onboarding, administrator-approved existing roots, original Local folder writes, durable conversations, model discovery, stop/reconnect and systemd startup. Native account login is a trusted SSH administrator operation with a stopped supervisor; the owner completes the official provider's device flow. The UI reports readiness and explains how to finish login.

Require the complete pinned native distribution, including code-mode host and package-declared sandbox/shell/PATH resources; copying only the Codex entrypoint is not a valid release. Require Linux/systemd, a dedicated nonroot service user without sudo or Docker authority, pinned Node/Codex/dependencies, PostgreSQL, canonical verified HTTPS and an allowlisted real OIDC issuer/client/subject. A trusted existing reverse proxy may terminate HTTPS and forward to the loopback backend. The current host's Traefik must be preserved. State and immutable application assets live outside editable roots. No folder migration or copying is implicit.

Exclude managed worktree/copy creation, attachments, interactive file editor, terminals, schedules, previews, PATs, extensions and self-development brokers in this profile. Codex conversation tools may edit the original project within the configured native permission policy. Unsupported capabilities are denied in the API and accurately represented in the UI. Existing profiles retain their behavior. Full P009 backup/restore/promotion remains separate and unverified; this proposal does not relabel it complete.

## Source issues

None transferred. Related [live-account](../../issues/2026-09-07-171225-live-runtime-credentials.md), [history](../../issues/2026-09-13-110315-common-use-live-acceptance.md), and [P009 backup transfer](../../issues/2026-09-07-231526-p009-backup-transfer-approval.md) obligations remain with their existing owners. P015 needs its own explicit owner-authorized account acceptance on disposable files; that cannot close unrelated dedicated-account gates.

## User and API flows

1. The owner opens the canonical HTTPS URL and signs in through the configured OIDC provider. Existing issuer/subject checks, PKCE/state/nonce, secure opaque cookies, Origin/CSRF checks and bounded command idempotency apply.
2. After deployment, the owner adds an existing folder within administrator-configured browse roots; configuring a root does not pre-register a project. The owner's later explicit authorization permits `/root` as the ceiling, with read/traverse access at `/root` and owner-authorized read/write access to all current and future projects under `/root/Projects`; other descendants remain subject to Unix permissions. The browser may register a descendant or `/root` itself (`.`), but cannot explore unapproved host locations. Multiple disjoint descendants are supported; `/root` and a descendant cannot both be registered because overlapping projects remain forbidden. Registration preserves the original canonical path and filesystem identity; absent, replaced, overlapping or escaped folders fail explicitly.
3. Account settings show native subscription readiness. The administrator uses the separate private Codex home and official login command, or D011's explicitly owner-requested existing-login import, while the supervisor is stopped. No auth.json, access token or API key enters a prompt, ordinary log or browser storage.
4. The owner creates a conversation, chooses an allowed model and read-only or workspace-write policy, and submits a turn. The supervisor persists intent and streams results. Browser closure or SSH disconnect does not stop a systemd service or cancel accepted work. Approvals may pause progress until answered.
5. Reopening fetches retained messages and reconnects without resubmitting work. Successful native threads can continue. Supervisor/runtime loss preserves uncertainty rather than automatically replaying effects. Unsupported recovery controls remain denied; SSH stop/inspection remains available.

## Contracts, data, and ownership

Introduce an explicit personal VPS configuration discriminator, separate from local, fixture and managed installed modes. Native-home and binary paths are explicit. Capabilities identify the profile and its supported surfaces without advertising the local-only login command. Existing project/session/operation tables and migration history remain canonical; no new migration is expected.

The API owns authentication and durable commands; one persistent supervisor owns native runtime generations through the adapter. Codex 0.153.4 owns subscription credentials and native history in private persistent state. Adapter initialization, model discovery and granular sandbox policy must pass actual pinned-runtime contracts. Unsupported native capabilities fail closed.

Official Codex supports subscription sign-in and a headless device flow; availability depends on account settings. See [official authentication guidance](https://learn.chatgpt.com/docs/auth). Missing/expired credentials produce unavailable account status and bounded errors, not an API-key fallback or silent use of normal host Codex state.

## Security and resource limits

Apply D011's personal trust model: only the authenticated owner, a dedicated nonroot Unix account, no sudo/Docker socket, immutable root-owned release, private credentials, explicit project roots, native workspace-write sandbox and denied sandbox escalation. Native read access is broader than the selected workspace; this profile is not suitable for mutually untrusted projects. Same-UID services/native state do not provide the managed profile's control-plane secrecy boundary. Protect other service data with Unix ownership and systemd restrictions, sanitize child environments, and make this limitation visible in operational docs.

The final owner-authorized access plan grants the service account `r-x` on `/root` and `rwX` on existing `/root/Projects` content with directory default ACLs for future descendants. Preserve `/root/.ssh`, unrelated root startup/account files and ownership. Broad root-home writes are superseded to retain SSH StrictModes compatibility and avoid changing root-session startup behavior. Browser selection never grants Unix access; other root-home folders require administrator write grants, and registering `/root` itself does not enable top-level writes. A nonroot UID does not protect files explicitly shared with it. Keep the immutable release, administrator configuration/candidate bundles and all private instance/native state outside `/root`. `/` and other broad system directories remain denied.

Use systemd memory/PID/CPU bounds, a read-only service filesystem except approved project/state paths, and private temporary space. These do not establish XFS hard quotas or confined model egress. Account/provider traffic requires verified TLS. Deny fixture/local mode combinations, root execution, arbitrary roots, state/root overlap, raw runtime access and unsupported feature requests. Existing HTTP/input/history limits remain effective. Test actual native write denials and service restrictions on Linux; do not infer them from configuration text.

## Implementation approach

Implement runtime/config/root admission and capability gating; add a separate portable personal VPS deployment renderer and operational workflow; adapt existing account and folder UI; then test the complete candidate. The renderer must validate bounded administrator inputs, prepare reviewable systemd/database/proxy configuration and avoid overwriting unrelated installations. Account setup remains an explicit provider interaction. No successful no-op command is added.

## Verification and acceptance criteria

- **P015-01 — Admission:** Invalid profile combinations, root service execution, insecure OIDC, nonloopback backend, unapproved roots and state/root overlaps fail. Only the allowlisted owner can access app/API/SSE; CSRF and Origin denial pass.
- **P015-02 — Original folder:** Administrator configuration allows the explicitly approved `/root` browse ceiling while preserving system-directory and private-state/config/release exclusions. Verify post-deployment selection of either disjoint descendants or the root itself, with overlap denial. Through real Harbor UI/API/database/supervisor, register a fresh existing folder without relocation, write a canary through a Codex conversation, and inspect the same host path. Deny traversal, symlink escape/replacement and overlapping projects. Test separate folders with distinct identities.
- **P015-03 — Account and sandbox:** Pinned native contracts and a bounded real subscription conversation pass with independent account state. The model must invoke its actual tools to read a disposable canary and edit a file at the original host path; version/model discovery, standalone command/exec and text-only responses are insufficient. Confirm native write restrictions and denied escalation on Linux. Missing credentials are accurately reported. Secrets do not appear in responses or retained diagnostics.
- **P015-04 — Persistence:** Close the browser during an accepted bounded turn and disconnect its initiating SSH session; systemd work continues. Reopen the same conversation and verify persisted result and a new continuation. Service restart retains history and marks ambiguous work uncertain without replay.
- **P015-05 — Installation:** Fresh run-owned systemd/database/proxy instance serves verified HTTPS, has correct process ownership and listener confinement, survives service-manager restart/startup checks, preserves source/production separation and supports exact-instance stop/status. Existing Traefik and unrelated resources remain healthy.
- **P015-06 — Regression and review:** Relevant real-stack E2E and critical regression, pinned contracts, actual Linux native/service checks, build/check, documentation consistency and independent review pass. Unsupported surfaces fail through both UI and API. Desktop/mobile account/project states use approved tokens and rendered interaction evidence.

Tests use fresh databases, ports, roots, credentials, CODEX_HOME and instance manifests. Only external identity/Codex boundaries may be deterministic fixtures; fixture evidence does not establish native or account operation. Record source/artifact digest, versions, commands, results, redacted screenshots/logs and exact cleanup. Missing account/domain/infrastructure gates remain explicit issues and block Verified status.

## Rollout and recovery

First build and test an immutable candidate, then install separate persistent services under the existing deployment authorization. Configure the exact owner domain and identity without inventing values. `/root` access is already explicitly authorized; configure it as the administrator browse ceiling and let the owner select projects in Harbor after deployment. Apply the chosen read/traverse ceiling and project-subtree ACLs only for the selected service account, record them, and preserve existing content/ownership and SSH configuration. No host ACL changes have been applied as part of the root-admission source update. Subscription login requires the owner's provider interaction.

First installation uses an empty private database. Future changes must stop admission and drain or explicitly interrupt work, back up state before migrations and respect schema/native compatibility; never run concurrent unfenced supervisors or silently roll back data. Keep root-owned configuration and exact release identity plus SSH status/stop instructions. P009's unverified off-host restore is not claimed here. Account changes require stopped work. No commit/push is authorized merely by deployment.

## Review record and remaining issues

Three independent source and harness review rounds completed. Round 1 found environment incompatibility, exact-root registration, resource limits and empty-model configuration; round 2 verified fixes and the exact-binary AppArmor test scope. Candidate native and deterministic application checks passed; actual public installed/account acceptance remains blocked in the [P015 acceptance issue](../../issues/2026-09-13-130622-personal-vps-acceptance.md). Keep this proposal active until every mandatory gate passes.

## Later owner clarification

The owner explicitly authorized access to all of `/root` and requested project selection in the browser after deployment. This bounded change extends the renderer's administrator admission and documentation; existing exact-root browsing/registration and overlap behavior remain applicable. Renderer/admission contracts cover the new allowance and private-output exclusions. Prior candidate evidence retains its tested artifact identity; actual `/root` ACL provisioning and installed acceptance remain open.

## Final owner access refinement

The owner selected preserving SSH access and authorized read/write access for all current and future `/root/Projects` projects. Installer browse-root preflight now checks read/traverse access without requiring top-level write permission. Directory default ACLs support future project descendants; application selection does not grant Unix permissions. This installer-only change retains the existing application release and needs its own reviewed administrator-tool digest. Actual installed access checks remain required.

## Closing record

Pending complete acceptance, documentation and independent review.

## Google owner enrollment prerequisite

[D011's trusted enrollment contract](../decisions/011-personal-vps-workspace.md#trusted-owner-identity-enrollment) covers obtaining the exact owner subject when only the intended Google email is known. This is a deployment prerequisite under P015-01 and P015-05, not a public registration feature. Verify successful identity capture, rejected wrong/unverified email, state/nonce/PKCE/cookie binding, expiry and create-only result behavior using the actual helper with only the external provider replaced. Public TLS and the owner's real Google interaction remain installed acceptance gates.

The owner's later request to reuse the existing VPS subscription login is covered by [D011's import exception](../decisions/011-personal-vps-workspace.md#owner-requested-existing-subscription-login-import). It does not waive P015-03 real-account verification or allow sharing ordinary runtime state.

## Native package completeness correction

The live owner reported that Codex could not execute tools because `codex-code-mode-host` was missing. Prior packages copied only `bin/codex`; the pinned npm vendor target also owns the sibling helper, package manifest, sandbox/shell resources and PATH utilities. P015 now requires complete-layout packaging and installer rejection of incomplete distributions. Preserve earlier smoke results within their limited scopes; actual installed model-tool read/write acceptance remains a blocker in the [P015 issue](../../issues/2026-09-13-130622-personal-vps-acceptance.md). Do not repair immutable live binaries in place: assemble, review and test a separate complete candidate before promotion.
