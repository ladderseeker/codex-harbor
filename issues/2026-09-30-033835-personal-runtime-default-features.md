# Personal runtimes leave Codex's other default features on

- Severity: Medium. A design rule may not hold; nobody has checked what these features actually expose through Harbor.
- Owner: Awaiting owner selection in this inbox.
- Status: Open. Recorded from a provenance review finding on 30 September 2026 and a credential-free check the same day.
- Recorded: 30 September 2026.
- Related: [P035](../design/proposals/035-bounded-disk-use.md), which turned off only `plugins`, and the [official foundation rule](../design/architecture.md#official-foundation-and-compatibility-boundary).

## Problem

The architecture says browser automation, voice, plugins and connectors, pull-request workflows and desktop integrations each need separate assessment, and none should appear functional merely because the desktop offers it. [P035](../design/proposals/035-bounded-disk-use.md) starts every personal runtime with `-c features.plugins=false` to stop the plugin catalog download. It changed no other Codex feature.

Codex 0.153.4 turns many features on by default. With Harbor's personal arguments, `codex features list` in a fresh credential-free home reports these, among others, as stable and true: `apps` (connectors), `browser_use`, `computer_use`, `hooks`, `image_generation` and several `in_app_*` features. Nobody has checked which of them an app-server started by Harbor actually offers to the model or the account, or whether any starts network, disk or process activity.

## Evidence

- `codex -c cli_auth_credentials_store="file" -c features.plugins=false features list`, run with Codex 0.153.4 in an empty `CODEX_HOME` on 30 September 2026, listed the features above as enabled.
- P035's live smoke, one real turn through the pinned binary with Harbor's personal arguments, received two `mcpServer/startupStatus/updated` notifications. Which servers sent them was not recorded.

## Impact

Unassessed surfaces, most plausibly connectors through `apps`, may be active in personal runtimes, contrary to the architecture. The actual exposure is unknown.

## Recheck

Start the pinned runtime with Harbor's personal arguments in a run-owned home, signed in with a copied test credential, and record the MCP servers it starts, the tools a turn can see and any network or disk activity at startup. Then decide per feature whether to assess it or turn it off, as P035 did for `plugins`, with contract tests for the chosen arguments.
