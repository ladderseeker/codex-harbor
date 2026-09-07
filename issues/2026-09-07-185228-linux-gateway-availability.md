# Diagnose intermittent approved-gateway availability in Linux verification

- Severity: Medium
- Status: Open
- Owner: [P001](../design/proposals/001-secure-persistent-conversations.md#delivery-and-verification); [P009](../design/proposals/009-portable-deployment-and-restore.md) carries target-host verification
- Recorded: 2026-09-07
- Affected: infra/egress/; tests/isolation/probes.ts; disposable Linux VM outbound network

## Evidence

Several full XFS verification runs returned HTTP 502 for an unauthenticated POST to the fixed model gateway, after the preceding hostile Host/path requests were denied. Other unchanged runs passed, including the final source-consistent run on 2026-09-07 at 10:51:36 UTC with digest 05971cd8dfcba617b16dd68eaf33f17dadcc0fbfbc1aad99c4c1e65d118183e0.

The standalone Linux gateway lane passed all denials and received the expected upstream 401. A separate owned diagnostic container checked both public IPv4 answers, 162.159.140.245 and 172.66.0.243, three times each; all six certificate-verified upstream requests returned 401. Three pairs of authenticated A/AAAA DNS queries also succeeded. That evidence does not establish the cause of the earlier 502 responses or prove one address is consistently unreachable.

The environment is a disposable Ubuntu 24.04 VM with Linux 6.8, Docker 29.1.3, and the fixed Cloudflare DNS-over-HTTPS profile. No account credential was sent. See the [foundation verification report](../docs/reports/2026-09-07-p001-foundation.md) for the final passing artifact.

## Impact and next steps

Approved outbound requests can fail in this verification environment. Rejection remains closed: no general tunnel, alternate host, insecure TLS, or private-address fallback was enabled. A failed model request can still interrupt useful work, so passing isolation assertions do not establish reliable deployment connectivity.

Reproduce with bounded, secret-free diagnostics that distinguish DNS lookup, TLS establishment, and upstream response failure. Compare on the intended deployment host before P009 readiness. Keep any diagnostic hooks out of the normal runner and never retry an ambiguously delivered model request merely to obtain a pass. Record the cause and verification, or retain an explicit measured environment limitation.
