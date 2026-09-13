# D011 — Personal VPS access to existing projects

- Decision: Accepted within the owner's 2026-09-13 instruction to propose and implement the analyzed VPS workflow; implementation details remain subject to independent review.
- Owner: [P015](../proposals/015-personal-vps-workspace.md).
- Amends: [architecture](../architecture.md#local-first-development-and-portable-environments), [D009](009-common-use-release.md) delivery priority and [D010](010-personal-local-experience.md)'s native-only-local restriction, solely for the explicitly selected personal VPS profile. D001–D006 remain the managed deployment contract.

## Context and alternatives

The owner's required outcome uses a ChatGPT subscription and reads/edits an existing VPS folder in place, with authenticated browser access and persistence after SSH/browser disconnect. Current installed Harbor requires an API key and managed XFS project units. Current P013 supports native account state and ordinary folders but only local access. The observed VPS uses ext4 and an existing Traefik HTTPS proxy.

Extending the full managed storage/credential gateway to import arbitrary ext4 folders would require new isolation and quota mechanisms. Moving projects into XFS units changes the requested original-folder outcome. Simply exposing P013 would bypass its explicit local-only configuration contract. Select a separately named personal VPS profile with explicit authentication, native execution and deployment limits instead.

## Decision

P015 may use native Codex on Linux under a dedicated nonroot service account, independently persisted subscription state, root-owned immutable application files and administrator-approved existing project roots. The API remains loopback-only behind a trusted verified HTTPS proxy, with production OIDC owner authentication and ordinary session/CSRF/Origin protection. Fixture and local profiles cannot enable this behavior. No root/native unrestricted execution, Docker authority, sudo or arbitrary launcher flags are granted to coding processes.

Use the pinned adapter's native sandbox, deny permission/sandbox escalation, and constrain writes to the selected workspace under the administrator ceiling. Native filesystem reads can reach other files accessible to the service UID. The service and native runtime share a personal trust domain; this does not establish separate-user control-plane secrecy, cross-project read isolation, kernel project quotas, or managed egress confinement. Systemd and Unix ownership protect unrelated host services and bound available resources. The owner must not treat this profile as a sandbox for mutually untrusted projects. A failed native sandbox prerequisite blocks dispatch; it cannot trigger an unrestricted fallback.

The owner's later clarification explicitly authorizes the whole `/root` directory as an administrator-configured browse ceiling. Actual projects are selected in the browser after deployment: multiple disjoint descendants or `/root` itself, with existing overlap prohibitions retained. This is an explicit exception for `/root`, not permission to browse `/` or unrelated broad system directories. Configuration does not automatically register projects.

The owner's final access refinement preserves SSH access: `/root` is a read/traverse browse ceiling (`r-x` for the service account); `/root/.ssh` and unrelated root startup/account files remain unchanged. All current and future projects under `/root/Projects` are authorized for `rwX` access, with directory default ACLs for future descendants. Other root-home folders remain subject to existing Unix permissions and need an administrator grant before writes. Browser registration and workspace-write policy never grant Unix permissions. Selecting `/root` itself does not permit top-level writes under this policy.

This refinement supersedes broad root-home write access. Writing `/root` or SSH files can change ACL masks and violate SSH StrictModes; modifying startup/tool configuration could influence root authority. The nonroot UID does not protect files explicitly shared with it. Preserve ownership, record exact ACLs, and keep immutable Harbor assets, administrator configuration/candidate bundles and private instance/native state outside `/root`. Installer admission requires read/traverse access to the ceiling; actual project writes remain constrained by Unix access and the native sandbox.

Account onboarding uses official device authentication through trusted SSH into a stopped instance, with independent native credential storage. Do not expose the raw provider callback or automatically import ordinary account state; the explicit owner-requested import exception below is permitted. Native credentials must persist for subsequent work. Browser account settings report readiness and instructions without secrets.

Include only the six selected workflow requirements and their necessary controls. Disable unsupported managed capabilities in both UI/API. P009 recovery, deferred extensions/self-development and unrelated release gates retain their existing owners and status. This profile has its own installation and acceptance evidence, never a claim that P009 is Verified.

## Consequences and verification

This is an explicit personal deployment trust tradeoff, not an equivalent implementation of the managed isolation design. P015 must demonstrate HTTPS owner login, original-path editing, real subscription execution, browser/SSH independence, native write denials, installed service restrictions and reopening/continuation. Unknown runtime effects remain uncertain. Immutable candidate packaging and SSH recovery remain required; complete off-host backup/restore remains unverified until its separate gates pass.

Technical changes remain within the user's accepted deployment direction and undergo the repository implementation/review/fix/verification cycle. No new standing approval gate is created.

## Ubuntu native sandbox prerequisite

Observed nonroot acceptance on this Ubuntu 24.04 host failed with AppArmor `unprivileged_userns` capability denials while Codex constructed its sandbox. An exact root-owned immutable Codex executable may receive the per-application `userns` allowance documented in the [Ubuntu release notes](https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions). Do not disable the host-wide restriction, grant host administrative capabilities or fall back to unsandboxed execution. Verify the positive workspace write and outside/read-only denials under the complete service restrictions after the allowance; retain the failed prerequisite result as evidence.

## Trusted owner identity enrollment

When the owner supplies a Google email and OAuth web client but no verified subject, a separate temporary administrator-started enrollment helper may obtain that subject. It serves only a random private start URL and the configured HTTPS OAuth callback behind the loopback reverse proxy. Require verified TLS, PKCE, state, nonce and a secure browser-binding cookie, the exact Google issuer, and the owner's exact verified email. The random start capability and session expire within one hour. Persist only the verified issuer, subject and email in a private create-only result file; never persist tokens or issue a Harbor session. Native runtime and project access are unavailable to this helper.

Run the helper under a dedicated nonroot account with no project-directory grants. Keep its configuration, credentials and result outside editable roots, do not log URLs/codes/tokens, and stop it after successful enrollment or expiry. Replace its route with ordinary Harbor only after the administrator configures the resulting exact subject. Email is an enrollment check, not a replacement for Harbor's issuer/subject owner pin. Exercise the actual helper and OIDC library with an external provider fixture and independently review before public use.

## Owner-requested existing subscription login import

The owner subsequently requested reusing the VPS Codex login instead of authenticating again. A trusted administrator may perform a one-time copy of the existing ChatGPT-mode `auth.json` into the stopped Harbor instance's empty private Codex home, with service ownership and 0600 permissions. Verify the source is ChatGPT authentication and not an API key, preserve the source file, and never copy conversation history/configuration or share/symlink the entire home. Do not print token contents. Verify the imported account with the pinned runtime and actual bounded subscription acceptance; importing credentials alone does not establish working subscription access. Independent homes may refresh credentials separately; concurrent token-refresh compatibility is not guaranteed. If reuse fails, use the official device flow rather than falling back to API-key billing or weakening authentication.
