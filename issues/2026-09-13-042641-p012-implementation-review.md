# P012 implementation review findings

- Severity: Medium; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: Medium
- Status: In progress
- Owner: P012 implementer; separate P012 reviewer verifies corrections

Complete deferred outcome and acceptance are tracked in [2026-09-20-000004-managed-extensions-acceptance.md](2026-09-20-000004-managed-extensions-acceptance.md); this record retains its individual finding and correction evidence.

- Affected files: `apps/supervisor/src/extension-actions.ts`, `packages/extensions/src/removal.ts`, `packages/extensions/src/catalog.ts`, `apps/api/src/extensions.ts`, `apps/web/src/Extensions.tsx`, and extension acceptance coverage
- Acceptance: [P012-01–06](../design/proposals/archive/012-managed-skills-and-mcp.md#independent-acceptance), as mapped below

## Evidence and scope — 13 September 2026

The first independent review of the isolated P012 implementation found four Medium defects at frozen checkpoint `344b826beb65dff97b3471dd7478ff9688b0d323` plus adapter correction `e951907`. The schedules below are proven from that source; the reviewer did not reproduce them at runtime. File line numbers refer to this reviewed checkpoint, not necessarily the current main branch. The implementer accepted the findings and is preparing corrections and observable regressions.

This record does not replace the separate [shared native acknowledgement finding](archive/2026-09-13-022009-native-acknowledgement-deadlock.md), other control-retry findings, or the proposal's remaining native, module, restore and live gates. Passing publication tests do not establish these four corrections. Each part remains In progress until its fix, relevant actual application evidence, independent review and main integration are recorded.

## R1 — Rejected queued actions can indefinitely pin a version

- Severity/status: Medium / In progress
- Source: `apps/supervisor/src/extension-actions.ts:303–315`, `packages/extensions/src/removal.ts:27–32`, `apps/web/src/Extensions.tsx:496–517`
- Acceptance: P012-02/03/04; [dispatch and recovery](../design/proposals/archive/012-managed-skills-and-mcp.md#revision-dispatch-disable-and-recovery) and [unused-version removal](../design/proposals/archive/012-managed-skills-and-mcp.md#immutable-sources-and-trusted-configuration)

With a ready disabled MCP version, pause the supervisor and accept a probe. Revoke or expire its browser authority, or invalidate the captured revision, before resuming dispatch. `rejectUnowned` fails this queued request before writer or native admission but leaves `retired=false`. Removal treats that action as a pin and returns `EXTENSION_VERSION_PINNED`; the failed-action UI offers no cancellation, and acknowledgement is limited to uncertain actions. A request that never executed can therefore prevent removal through the available UI.

Atomically retire only a rejection whose pre-dispatch state proves it never executed. Preserve fencing and uncertainty for any ambiguous dispatch. Required regression: hold the actual supervisor, invalidate queued authority, resume it, prove zero native thread/tool sends and retained failed provenance, then use a fresh owner's UI to remove the version successfully.

## R2 — A nonconnected MCP server can report a successful empty probe

- Severity/status: Medium / In progress
- Source: `apps/supervisor/src/extension-actions.ts:528–536,549`, `packages/extensions/src/catalog.ts:24–31`
- Acceptance: P012-01/03/06; [owner flow](../design/proposals/archive/012-managed-skills-and-mcp.md#owner-and-api-flow) and [bounded discovery](../design/proposals/archive/012-managed-skills-and-mcp.md#revision-dispatch-disable-and-recovery)

After 100 status polls, the probe continues regardless of `runtimeStatus`. Catalog validation checks the server name and tools but does not require a connected runtime. The pinned protocol permits failed, cancelled, starting or null status with an empty tool map, so an unsuccessful startup can become a successful empty catalog.

Require confirmed connection before publishing a successful catalog. A failed or never-connected server must produce a bounded visible failed or uncertain outcome, no partial callable catalog, and exact retirement. Required regressions distinguish failed and persistently starting servers from a connected server with a legitimately empty catalog; the last case must still succeed.

## R3 — The owner cannot inspect each captured source and digest before trusting it

- Severity/status: Medium / In progress
- Source: `apps/api/src/extensions.ts:155–168`, `apps/web/src/Extensions.tsx:327–330`
- Acceptance: P012-01/02/05; [source/path/digest visibility](../design/proposals/archive/012-managed-skills-and-mcp.md#owner-and-api-flow)

The API omits each version's captured registration/source metadata. The panel discards the result and manifest hash, showing a shortened UUID, file count and byte size instead. Refresh may change the source workspace, path or entrypoint, so extension-level source fields can describe another version. The owner cannot inspect the immutable code identity before Enable or Probe.

Expose and render bounded per-version workspace and relative source path, relevant entrypoint or skill metadata, and the full snapshot digest before execution authorization. Do not expose native host paths. Required regression: create two versions from different sources, inspect their distinct captured identities in the real UI, and verify hostile metadata renders as inert text.

## R4 — Silent action truncation hides unresolved recovery controls

- Severity/status: Medium / In progress
- Source: `apps/api/src/extensions.ts:172–177,178–182`, `apps/web/src/Extensions.tsx:316–323`
- Acceptance: P012-01/04; [bounded pages and visible unresolved controls](../design/proposals/archive/012-managed-skills-and-mcp.md#revision-dispatch-disable-and-recovery)

The project detail response returns only the latest 20 actions without an action cursor. Its `nextCursor` pages versions, and the UI renders only returned actions. After more than 20 retained actions, an older unresolved action can disappear while still pinning a version or reservation. Fetching an already known action ID is not a way for the owner to discover that hidden recovery obligation.

Provide bounded, filter-bound action pagination, or an always-visible unresolved list with paged history. Required regression: retain more than 20 actions and verify the oldest unresolved action remains discoverable, inspectable and recoverable through the actual UI. Do not delete evidence or release a resource merely to make the list test pass.

## Next steps and review history

Round 1 completed with these four findings. The implementer owns their corrections and actual application regressions; a separate reviewer will inspect the frozen changes and evidence in round 2. Record source identities, commands, environment, results, remaining limitations and main integration before resolving and archiving this record. Full proposal acceptance remains a separate gate.

### Isolated correction review — 13 September 2026

Checkpoint `6ac72b60b00570b2dd3f33c228f811ee723d382d` corrects all four source findings. Node 24.11.1 focused run `0e07831340` and complete extension-actions regression `48dae85504` passed at identical start/end source `34e8954ef87a9494982f36daa82a522f156d64d9d88d197894a4b8e4fc5f5745` across 1,080 files. Their result SHA-256 values are respectively `0f3f9d75ca16de0c47c4f1418fabdda04c4f42f64b6fa66b0455f2a8562a35de` and `88b1119b76bbae093c6a996d02542fe058269b5d734ced61dcc843b7bfc72262`, retained under the P012 worktree's `.test-runs/harbor-e2e-<run>/result.json`. Check, build and catalog checks also passed. Independent round 2 inspected the frozen source and both application results and closed with no actionable finding in this correction scope.

The runs use actual UI/API/PostgreSQL/supervisor components with external Codex/OIDC fixtures and seeded immutable metadata. They prove queued expiry sends no native request and permits fresh-owner UI removal admission, distinguish unsuccessful startup from a connected empty catalog, show captured trust data as inert text, and page to an older uncertain action for recovery. R1 still needs its complete actual managed publication-to-physical-removal outcome; seeded admission alone does not satisfy that closing criterion. Captured inventory/form images also do not yet establish the required complete visible desktop/mobile views. Current main integration and the relevant final regressions remain pending, so the issue stays In progress. Other module, native, full-feature, restore and live obligations remain with P012.

### Actual R1 removal and captured-trust evidence — 13 September 2026

Frozen checkpoint `81377fb` ran `tests/e2e/run.ts --extension-publication` on owned Linux D with Node 24.11.1, managed XFS/root storage IPC and actual browser/API/PostgreSQL/supervisor components. Run `harbor-e2e-0fcabdff0a` passed six groups at matching start/end source `9ac651060edc156005002219b416f2f22f0cc4d17e539108dc8cefee1670a2d6` across 1,085 files. The additional R1 group creates its immutable MCP version through the real UI, holds the supervisor, queues a probe, expires its browser authority, resumes dispatch and asserts failed/retired provenance with zero native method sends. A fresh owner then physically removes the snapshot through the UI; source bytes survive and the original publication is denied by its tombstone. This supplies the physical outcome missing from the earlier seeded regression.

The same run captures the exact immutable trust block and its controls before Probe. Main inspected all four desktop/mobile PNGs: complete digest, captured workspace and relative path, entrypoint and Probe/Enable/Remove controls are readable at 1,280- and 390-pixel viewport widths. This supplements R3's earlier distinct-version/inert-text application assertions; it does not replace complete feature visual acceptance.

The local P012 worktree retains `.test-runs/p012-complete-20260913/harbor-e2e-0fcabdff0a/`: `result.json` SHA-256 `99f4e0e9b06c190c94e505e182313ab9ceab92d416f4fe2f69c5feded1beff54`, `publication-cases.json` `8bdebd27da622ba7faf18eefbf94c5e558c49d0e401ea4585bf91f6f47ded8db`, and per-PNG hashes in `collection.json`. The collector confirmed only the two pre-existing D deployment containers remained. The [recovery addendum](../docs/reports/2026-09-13-interrupted-work-recovery.md#p012-publication-artifact-collection--13-september-2026) preserves the first missing-web-build failure and the artifact collection review history.

External OIDC and queued Codex boundaries are fixtures. No successful MCP/model invocation, supervisor restart, native-derived flow or protected restore is claimed by this run. The two independent source correction rounds remain closed; main integration and current regressions are still required before issue resolution and archive.
