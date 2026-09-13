# D010 — Personal local Codex experience

- Decision: Accepted, 2026-09-13, for the owner's request to start Harbor locally, sign in to their Codex account, and try a real conversation.
- Scope: [P013](../proposals/013-personal-local-experience.md). Technical details remain subject to implementation and independent review.
- Amends: [architecture](../architecture.md#local-first-development-and-portable-environments), [D004](004-protected-runtime-credentials.md), and the selected delivery priority in [D009](009-common-use-release.md), only for the explicit personal local profile. Existing Linux deployment and acceptance obligations remain unchanged.

## Context and options

Harbor's existing fixture profile uses a simulated Codex process. Its real profile requires Linux/XFS services and currently accepts an API key rather than implementing interactive subscription-account login. The owner wants a real local conversation now. Requiring a VPS deployment does not satisfy that selected outcome; putting real credentials into the fixture profile would erase a meaningful boundary.

## Decision

Add an explicit personal local development profile. It runs the real Harbor UI, API, database and supervisor, and starts a local official Codex process through the existing adapter. Official CLI login uses a new private persistent Codex home belonging to this instance; never import the user's ordinary account state or log authentication output containing credentials. The user completes authentication with the official provider. Credentials stay under native Codex ownership, not in a Harbor API-key field.

The profile binds to loopback, retains authenticated Harbor sessions and mutation protections, and uses a private owner entry mechanism. It must not be selectable by a browser request or enabled for installed/public production. Real credentials require verified transport; no certificate-verification bypass for account onboarding. Resource state persists across normal shutdown and is distinct from automated test data.

Host execution uses Codex's native sandbox with an explicit workspace and permission ceiling. Never use external-sandbox, unrestricted host execution, container administrative privileges or a production-launcher fallback to make local operation succeed. This is a personal machine trust model; it does not claim the separate-user, mount, network or hard-quota isolation of the Linux profile. Unsupported capabilities must fail explicitly in both API and UI. Scope the initial experience to a local conversation and its necessary lifecycle; retain all deployed functionality in its existing profiles.

Pinned runtime inspection during implementation showed granular approval policy requires `experimentalApi`. Enable that capability only in the local native adapter so sandbox and additional-permission escalation can be explicitly denied while ordinary rule approvals remain possible. Keep it disabled for unchanged deployed/fixture adapters. Verify actual native acceptance and denial; generated types alone do not establish usable protocol behavior.

## Consequences and recovery

Account replacement/logout occurs through the stopped instance's native login lifecycle. Local account readiness is reported accurately. Shutdown retires only the instance's runtimes and services while keeping its data for reopening. Uncertain operations are never silently replayed.

Local native contracts, real Harbor acceptance, and one user-authenticated conversation are required evidence for P013. Linux gates remain mandatory for changes that affect the deployed launcher or isolation boundary. A successful personal conversation is not evidence for unrelated dedicated live-test or deployment acceptance.

## 2026-09-13 personal VPS addendum

The owner subsequently selected [P015](../proposals/015-personal-vps-workspace.md). [D011](011-personal-vps-workspace.md) authorizes a separately configured personal VPS profile with authenticated HTTPS, subscription login and approved existing folders. It supersedes the native-only-local restriction only for that explicit profile; P013 remains loopback-only, managed isolation requirements and outstanding proposal gates remain unchanged.
