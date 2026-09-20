# D004 — Bootstrap runtime capabilities and credentials through the supervisor

## Current ownership — 20 September 2026

The [current subsystem designs](../systems/) apply this decision alongside architecture; [D013](013-evidence-based-delivery-workflow.md) and the [workflow](../workflow.md) now govern execution and record lifecycle. Proposal references below identify historical plans, not active work owners. Unfinished evidence remains in the [issue inbox](../../issues/), and future work receives a newly selected proposal. The dated decision rationale and technical constraints below are preserved.

- Decision: Accepted
- Recorded: 2026-09-07
- Scope: [P001](../proposals/archive/001-secure-persistent-conversations.md)
- Supersedes: None; this defines the initial owner credential onboarding mechanism
- Delivery evidence: [Implemented and reviewed; fixture E2E/native cleanup passed](../../docs/reports/2026-09-07-p001-foundation.md), live-account verification pending

## Context

2026-09-13 amendment: [D010](010-personal-local-experience.md) defines native account login for the explicit personal local profile under P013. The supervisor API-key onboarding and Linux credential lifecycle in this decision remain the deployed-profile contract; the local profile does not store a subscription token in the API-key mechanism.

Capability discovery must not require a conversation that itself requires already discovered models. Native runtime state is private to each conversation, so authenticating one native home does not authenticate all future conversations. The browser must not receive unrestricted access to the runtime protocol or server credential files.

## Decision

Allow the authenticated owner to register an approved project before model discovery. The supervisor may start a confined discovery runtime in that project using the normal launcher, quota, egress, and generation rules. This runtime may initialize, discover supported capabilities, and inspect account status; it does not submit a model turn. Its lifetime and resources are bounded. Effective choices are the intersection of actual capabilities and administrator policy.

Expose a narrow owner-only credential status/set/replace/remove API with the normal Origin, CSRF, idempotency, and current-authority checks. Accept an API key over the authenticated HTTPS request. Send it to the supervisor over a private, mode-0600 Unix socket outside all project roots, using a fixed command protocol with bounded payloads and timeouts. The supervisor owns the stored credential and runtime login; the API cannot send arbitrary app-server methods through this socket.

Encrypt the credential at rest with AES-256-GCM, a fresh nonce, and an administrator-provisioned private key file outside source and project directories. Include instance/owner identity in authenticated metadata. Decrypt only in trusted supervisor memory to call the adapter's narrow account login operation over private stdio. Do not copy the key to command arguments, environment variables, application events, logs, audit payloads, or ordinary idempotency request records. Credential retries use a keyed fingerprint and redacted committed result, never the raw key. Return only account readiness and a safe credential identifier to the browser.

The ordinary API and supervisor recheck current authority for a credential mutation. Missing storage keys, inaccessible socket authority, unsupported runtime authentication, or unavailable isolation produce an explicit unavailable result. There is no fixture or environment fallback in production. Replacement/removal prevents future authentication with the old stored credential; active runtime consequences must be visible, and a key copied to a native home must be removed or its runtime retired before removal is reported complete. Harbor removal is distinct from revocation at the provider.

## Consequences and verification

The owner can complete onboarding without a prior model-backed conversation, and each new runtime can receive the current credential without sharing native conversation homes. Administrator key loss requires re-onboarding; backup and rotation procedures belong to the deployment feature. The trusted supervisor and native runtime necessarily handle model credentials, so neither may be exposed to project-controlled code as an unrestricted control service.

End-to-end tests use a dedicated fake credential at the external Codex fixture boundary. Exercise onboarding, replacement/removal, restart persistence, denied identities, expired/revoked browser authority, duplicate requests, and absence of credential values from returned events and retained diagnostics. A real-account smoke check remains mandatory and cannot be satisfied by fixture login. Implementation evidence stays in P001 until its full completion gate passes.
