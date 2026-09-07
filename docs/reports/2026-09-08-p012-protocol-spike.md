# P012 account-free native protocol spike

Recorded 2026-09-08 (Asia/Shanghai). This checks upstream non-model capability for the [P012 design](../../design/proposals/012-managed-skills-and-mcp.md); Harbor implementation and feature verification remain pending.

## Environment and identity

- Repository design baseline: `fee16e7`; no application source was changed by the probe.
- macOS 15.7.4 ARM64, Node 24.11.1, real pinned Codex 0.153.4, stdio app-server with strict configuration and `experimentalApi: false`.
- A fresh run-specific home, project, skill directory and local STDIO MCP fixture; no account environment, personal native state or model request. The runner's own process group was retired at completion. Exit status: 0.
- Retained ignored artifacts: `.test-runs/p012-protocol-20260907/{spike.mjs,mcp-server.mjs,result.json}`. The date in this artifact directory uses UTC; the report date uses the local timezone.
- Probe source SHA-256: `887a9384539a72f5a9bf87b3b91e5ef8c51c67524b9f939fee7519fa1688354d`.
- MCP fixture SHA-256: `33d8589affd8ba8f36c907af39a80d88a013e3444a8a5bd1ae9f23bf70227a9f`.
- Result SHA-256: `7c186474e5da7ad6161512da6b23bf4d1f55bac4c372b6e11d20296f21d4225d`.

## Observed results

The command `node <run-owned-probe>/spike.mjs` started the pinned binary with an explicit local fixture MCP configuration and fixed timeouts. It successfully initialized, set a process skill extra root, discovered the synthetic skill with `skills/list`, disabled it with `skills/config/write`, and observed the disabled state after reload. A fresh read-only thread started without model authentication.

Thread-scoped `mcpServerStatus/list` discovered the fixture's echo and confirmation tools. `mcpServer/tool/call` returned the expected harmless echo. The confirmation tool initiated a real `mcpServer/elicitation/request` standard form; the probe supplied its fixed test answer and received the corresponding confirmation result. Model request count was zero.

The probe's fixed answer is test-fixture behavior, not a proposed Harbor auto-approval policy. P012 requires normal current-authority, exact-operation, bounded-schema and expiry handling for real owner answers.

## Limits and next evidence

This was a host-process protocol check. It does not establish Linux runner confinement, Harbor UI/API/database integration, immutable extension publication, disable/restart fencing, or model-directed skill/MCP use. The published P012 contract and its independent review must cover those outcomes. Dedicated live-account verification remains blocked by the [credential issue](../../issues/2026-09-07-171225-live-runtime-credentials.md).

The current documentation exposes some fields absent from the repository's generated 0.153.4 types. Implementation must use the pinned contract and fail closed on unsupported capabilities. The [official reference](https://learn.chatgpt.com/docs/app-server) explains the corresponding methods; the successful run establishes only the specific pinned behavior listed above.
