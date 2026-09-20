# D001 — Route model access through a fixed trusted gateway

## Current ownership — 20 September 2026

The [current subsystem designs](../systems/) apply this decision alongside architecture; [D013](013-evidence-based-delivery-workflow.md) and the [workflow](../workflow.md) now govern execution and record lifecycle. Proposal references below identify historical plans, not active work owners. Unfinished evidence remains in the [issue inbox](../../issues/), and future work receives a newly selected proposal. The dated decision rationale and technical constraints below are preserved.

- Decision: Accepted
- Recorded: 2026-09-07
- Scope: [P001](../proposals/archive/001-secure-persistent-conversations.md), extending the [execution boundary](../architecture.md#execution-and-filesystem-isolation)
- Supersedes: The initial CONNECT implementation of this decision, rejected during independent review on 2026-09-07
- Delivery evidence: [Implemented; actual Linux denials/connectivity passed](../../docs/reports/2026-09-07-p001-foundation.md), with intermittent availability tracked separately

## Context and options

Codex needs outbound model access, while project processes must not reach the host, other projects, database/control services, or cloud metadata. An unrestricted default Docker network does not meet that requirement. A runner with no networking fails closed but cannot deliver a real model-backed conversation.

Use an internal Docker network for each runtime generation and a separate trusted model gateway. The runner joins only that internal network. The gateway also joins an outbound network; only its listener on the runtime's internal network accepts runner traffic. No gateway or runner port is published on the host. Each resource has a run/instance owner and bounded lifetime.

Require Docker's `isolated` bridge gateway mode as well as `--internal`, including the corresponding IPv6 mode if IPv6 is enabled. An ordinary internal bridge still has a host address and can expose host listeners to its containers; isolated mode removes that address. Refuse engines that cannot provision the required mode. [Docker gateway modes](https://docs.docker.com/engine/network/port-publishing/#gateway-modes)

## Decision

The fixed launcher supplies the runtime's model base URL and a trusted gateway profile. The gateway constructs the upstream HTTPS connection to `api.openai.com` itself, including TLS hostname verification, SNI, and the HTTP Host header. An internal HTTP connection carries model credentials only between the runner and its trusted gateway; neither can join another runtime's internal network. Gateway code and configuration stay outside project-writable mounts. Request bodies, credentials, and provider error bodies must not enter operational logs.

Allow only the exact method/path pairs required by the pinned model transport. Reject CONNECT, generic Upgrade, absolute URLs, foreign Host headers, ambiguous path/query encodings, and redirects. Disable runtime WebSocket model transport until a fixed-upstream WebSocket implementation is explicitly supported and verified. Construct allowed upstream headers and strip hop-by-hop headers. Bound request bodies, concurrent requests, stream bytes, and total/idle time. Additional development destinations require a separate trusted profile; project scripts and API arguments cannot add destinations or container flags.

Resolve only the fixed upstream name, reject private, loopback, link-local, metadata, and otherwise disallowed addresses, then connect to a validated address without resolving it again. Apply the same policy to IPv4 and IPv6, including mapped forms. An upstream certificate failure remains a hard failure.

The system resolver is the default. Administrators may select the fixed `cloudflare-doh` profile when local DNS substitutes reserved proxy addresses, as observed in the development environment. This profile queries the fixed Cloudflare HTTPS resolver using public bootstrap addresses and normal TLS hostname/certificate verification. It accepts no project-supplied resolver URL, redirects, or trust override. Bound DNS request time and response size, validate response status and question/answer names and types, and apply the same all-address validation and pinned destination connection. Unexpected resolver responses fail closed. The provider's JSON format is an explicitly versioned integration contract, not a general DNS implementation. [Cloudflare DNS JSON API](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)

Retain the existing nonroot, read-only base filesystem, dropped capabilities, no-new-privileges, mount and resource limits. Coding runners receive no Docker socket, launcher authority, control-plane credentials, or host-network fallback. If trusted egress cannot be provisioned or checked, refuse model dispatch with a clear unavailable result.

## Consequences and verification

Model access can be allowed while direct network escape remains blocked. General internet access is unavailable through this model gateway. The gateway becomes trusted security code and needs independent review. Changing the pinned runtime's HTTP endpoints requires an explicit compatibility update.

Linux tests must use the same launcher profile as the application and probe direct IPv4/IPv6 access, host/metadata/control destinations, disallowed methods/paths, DNS validation and rebind handling, TLS and HTTP hostname fronting, cross-project isolation, and a permitted destination. A host process fixture or a network-none runner alone cannot establish this complete boundary. Missing real-account credentials remain a separate live-model verification blocker.

## Review history

The initial implementation allowed CONNECT to the validated public IP of `api.openai.com`. Independent review reproduced a connection to a different hostname on the same CDN address, with its own valid TLS certificate and successful HTTP response. IP pinning did not bind the tunnel to the approved hostname. SNI filtering alone also cannot enforce an encrypted HTTP Host header. The fixed gateway replaces that implementation; its earlier positive network tests are historical partial evidence and cannot establish the revised profile's safety.

This is an implementation decision under the owner's delegated authority. It does not claim that the controls have been built or verified; P001 retains their delivery and acceptance evidence.
