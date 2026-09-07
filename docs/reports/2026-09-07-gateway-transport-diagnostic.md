# Linux gateway transport diagnostic

Recorded 7 September 2026. This investigation reproduced the [open gateway availability finding](../../issues/2026-09-07-185228-linux-gateway-availability.md) in a second disposable Linux VM. It identifies observed failure stages, not the underlying network fault or deployment readiness.

## Method and identity

Twenty sequential probes used the existing gateway image with its unchanged fixed routing, public-address validation, DNS-over-HTTPS resolver, certificate verification, and time/resource limits. Each request sent unauthenticated `{}` to the fixed Responses route. No credential was sent, no authenticated model turn was attempted, and no failed request was retried. The temporary harness observed the existing proxy's lookup/request seams without changing their arguments or results. It emitted only numeric fields and fixed diagnostic enums; response bytes were discarded.

The container ran as UID/GID 10002, with a read-only filesystem, no capabilities, no new privileges, 64-PID/128-MiB/half-CPU limits, no published ports, and its own outbound network. Only the diagnostic file was mounted read-only. The gateway listener was on container loopback. This is a transport investigation, not an application or isolation acceptance run.

- Host fixture: Ubuntu 24.04 arm64, Linux 6.8.0-134-generic, Docker 29.1.3; separate from the workspace-testing VM and all normal owner state.
- Gateway runtime: Node 24.11.1, image `codex-harbor-egress:1`, Docker image ID `sha256:366a019fdbbe7f51ed5ecfff4b31d9519a629641c2f50350fe278bec60912001`.
- The transferred image archive's SHA-256 was checked before loading: `a4bf4eb7df370c9f4da0f8402290087a1ef3fc663edfaec8eaa20c175b600cc9`.
- Image `proxy.mjs`, `resolver.mjs`, and `policy.mjs` were extracted read-only and compared with main commit `fb6127a`. All three match exactly after formatting with pinned Prettier 3.6.2; their raw differences are formatting only.
- Temporary harness SHA-256: `9493404856ec559008f425ddef63ab06590e6e00347d84c90eacc53188316673`. Invocation inside the restricted container: `node --no-warnings /diagnostic/probe.mjs 20`.
- Run identity: `harbor-gateway-diagnostic-20260907-1159`. Local ignored evidence: `.test-runs/harbor-gateway-diagnostic-20260907-1159/result.jsonl`, SHA-256 `de1454dd9c1a8940f150386a1653f3dfbe5755d52cd3140e1914e57e41b4afd4`.

## Results

| Outcome | Count | Observed evidence |
| --- | --- | --- |
| Expected unauthenticated response | 15 | TLS authorization succeeded; upstream and gateway both returned 401; responses completed without encoding rejection. |
| DNS resolution failure | 4 | Aggregate trusted-resolver failure at 4,011–4,019 ms; no upstream TCP/TLS connection; gateway returned 502. |
| Reset before TLS establishment | 1 | DNS resolved and TCP connected; `ECONNRESET` occurred before `secureConnect`; no upstream HTTP response; gateway returned 502 after approximately 6.8 seconds. |

The harness completed with exit 0 and reported 15 expected responses and five other outcomes. Exit 0 establishes diagnostic completion only. It is not an availability pass. The owned container and network were removed, and label-filtered inspection confirmed neither remained.

A separate agent reviewed the report, issue/index updates, and raw diagnostic rows. It independently confirmed the counts, times, TLS/status fields, evidence checksum, and appropriately open disposition, with no actionable documentation findings. That review did not repeat the main agent's image comparison or cleanup inspection. Documentation links and whitespace passed across 42 Markdown files.

The four resolver failures occurred around the resolver's existing four-second bound. The harness cannot distinguish which DNS family or transport failed, and timing alone does not prove that mechanism. The TLS observation identifies the connection stage, not which network hop reset it. These samples do not attribute every historical 502 to the same cause or establish a long-term failure rate.

## Disposition

Keep the issue open as a measured environment limitation and carry it into P009 target-host verification. Compare the intended deployment host using bounded, secret-free stage diagnostics. Do not weaken routing, address denial, certificate validation, or tunnel restrictions, and do not retry ambiguously delivered model work to obtain a passing result. No application source or production policy changed in this investigation.
