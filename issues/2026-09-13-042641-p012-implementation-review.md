# P012 implementation review findings

- Severity: Medium
- Status: In progress
- Owner: P012 implementer; separate P012 reviewer verifies corrections
- Affected files: `apps/supervisor/src/extension-actions.ts`, `packages/extensions/src/removal.ts`, `packages/extensions/src/catalog.ts`, `apps/api/src/extensions.ts`, `apps/web/src/Extensions.tsx`, and extension acceptance coverage
- Acceptance: [P012-01–06](../design/proposals/012-managed-skills-and-mcp.md#independent-acceptance), as mapped below

## Evidence and scope — 13 September 2026

The first independent review of the isolated P012 implementation found four Medium defects at frozen checkpoint `344b826beb65dff97b3471dd7478ff9688b0d323` plus adapter correction `e951907`. The schedules below are proven from that source; the reviewer did not reproduce them at runtime. File line numbers refer to this reviewed checkpoint, not necessarily the current main branch. The implementer accepted the findings and is preparing corrections and observable regressions.

This record does not replace the separate [shared native acknowledgement finding](2026-09-13-022009-native-acknowledgement-deadlock.md), other control-retry findings, or the proposal's remaining native, module, restore and live gates. Passing publication tests do not establish these four corrections. Each part remains In progress until its fix, relevant actual application evidence, independent review and main integration are recorded.

## R1 — Rejected queued actions can indefinitely pin a version

- Severity/status: Medium / In progress
- Source: `apps/supervisor/src/extension-actions.ts:303–315`, `packages/extensions/src/removal.ts:27–32`, `apps/web/src/Extensions.tsx:496–517`
- Acceptance: P012-02/03/04; [dispatch and recovery](../design/proposals/012-managed-skills-and-mcp.md#revision-dispatch-disable-and-recovery) and [unused-version removal](../design/proposals/012-managed-skills-and-mcp.md#immutable-sources-and-trusted-configuration)

With a ready disabled MCP version, pause the supervisor and accept a probe. Revoke or expire its browser authority, or invalidate the captured revision, before resuming dispatch. `rejectUnowned` fails this queued request before writer or native admission but leaves `retired=false`. Removal treats that action as a pin and returns `EXTENSION_VERSION_PINNED`; the failed-action UI offers no cancellation, and acknowledgement is limited to uncertain actions. A request that never executed can therefore prevent removal through the available UI.

Atomically retire only a rejection whose pre-dispatch state proves it never executed. Preserve fencing and uncertainty for any ambiguous dispatch. Required regression: hold the actual supervisor, invalidate queued authority, resume it, prove zero native thread/tool sends and retained failed provenance, then use a fresh owner's UI to remove the version successfully.

## R2 — A nonconnected MCP server can report a successful empty probe

- Severity/status: Medium / In progress
- Source: `apps/supervisor/src/extension-actions.ts:528–536,549`, `packages/extensions/src/catalog.ts:24–31`
- Acceptance: P012-01/03/06; [owner flow](../design/proposals/012-managed-skills-and-mcp.md#owner-and-api-flow) and [bounded discovery](../design/proposals/012-managed-skills-and-mcp.md#revision-dispatch-disable-and-recovery)

After 100 status polls, the probe continues regardless of `runtimeStatus`. Catalog validation checks the server name and tools but does not require a connected runtime. The pinned protocol permits failed, cancelled, starting or null status with an empty tool map, so an unsuccessful startup can become a successful empty catalog.

Require confirmed connection before publishing a successful catalog. A failed or never-connected server must produce a bounded visible failed or uncertain outcome, no partial callable catalog, and exact retirement. Required regressions distinguish failed and persistently starting servers from a connected server with a legitimately empty catalog; the last case must still succeed.

## R3 — The owner cannot inspect each captured source and digest before trusting it

- Severity/status: Medium / In progress
- Source: `apps/api/src/extensions.ts:155–168`, `apps/web/src/Extensions.tsx:327–330`
- Acceptance: P012-01/02/05; [source/path/digest visibility](../design/proposals/012-managed-skills-and-mcp.md#owner-and-api-flow)

The API omits each version's captured registration/source metadata. The panel discards the result and manifest hash, showing a shortened UUID, file count and byte size instead. Refresh may change the source workspace, path or entrypoint, so extension-level source fields can describe another version. The owner cannot inspect the immutable code identity before Enable or Probe.

Expose and render bounded per-version workspace and relative source path, relevant entrypoint or skill metadata, and the full snapshot digest before execution authorization. Do not expose native host paths. Required regression: create two versions from different sources, inspect their distinct captured identities in the real UI, and verify hostile metadata renders as inert text.

## R4 — Silent action truncation hides unresolved recovery controls

- Severity/status: Medium / In progress
- Source: `apps/api/src/extensions.ts:172–177,178–182`, `apps/web/src/Extensions.tsx:316–323`
- Acceptance: P012-01/04; [bounded pages and visible unresolved controls](../design/proposals/012-managed-skills-and-mcp.md#revision-dispatch-disable-and-recovery)

The project detail response returns only the latest 20 actions without an action cursor. Its `nextCursor` pages versions, and the UI renders only returned actions. After more than 20 retained actions, an older unresolved action can disappear while still pinning a version or reservation. Fetching an already known action ID is not a way for the owner to discover that hidden recovery obligation.

Provide bounded, filter-bound action pagination, or an always-visible unresolved list with paged history. Required regression: retain more than 20 actions and verify the oldest unresolved action remains discoverable, inspectable and recoverable through the actual UI. Do not delete evidence or release a resource merely to make the list test pass.

## Next steps and review history

Round 1 completed with these four findings. The implementer owns their corrections and actual application regressions; a separate reviewer will inspect the frozen changes and evidence in round 2. Record source identities, commands, environment, results, remaining limitations and main integration before resolving and archiving this record. Full proposal acceptance remains a separate gate.
