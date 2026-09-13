# Native turn acknowledgement can deadlock with request persistence

- Severity: High
- Status: Resolved
- Archive disposition: Resolved, 2026-09-13
- Owner: Common-use release; shared P001 lifecycle correction extracted from P012
- Affected files: `apps/supervisor/src/main.ts`, native request fixtures and shared turn acceptance coverage
- Acceptance: [P001-03/07](../../design/proposals/001-secure-persistent-conversations.md#independent-acceptance) and [P012-01/04](../../design/proposals/012-managed-skills-and-mcp.md#independent-acceptance)

## Evidence and impact — 8 September 2026

After native turn acknowledgement, the shared supervisor transaction updates the operation before acquiring its conversation row. Native request persistence acquires those rows in the reverse order. An immediate request can therefore deadlock with acknowledgement, changing an accepted turn to uncertain and expiring its pending input.

P012 run `255dfe010d` captured PostgreSQL SQLSTATE `40P01` after the native turn was bound and an MCP approval persisted. Main inspected that safe operation/approval/event diagnostic before the interruption. Earlier failures `aa4ab38486` and `2f75d8728f` had weaker diagnostics; their exact causes are not inferred from later evidence. The failed harness did not retain a full source digest, and its host-side JSON is no longer available. The committed P012 development report retains those qualifications.

The issue affects the shared turn path, including existing core conversations. Uncertainty and no-replay handling protect against blind duplicate execution but do not make this a successful user outcome. Main `9c005f0` still has the opposite lock order.

## Isolated correction and next steps

P012 checkpoint `268d86f69d543ad1317e02fd3f68d6f76bce2a8a` acquires the conversation before updating its operation. Its dispatching-state condition, uncertainty handling and no-replay semantics remain unchanged. Only a bounded five-character database error code is added to the existing dispatch-failure event; SQL, native payloads and credentials are not logged.

Historical Node 24.11.1 run `829df2d1b8` passed at identical start/end source `cd3240e317236547cabae546817aa8a4bac3cb1aa3c104f27adfeb2d79c13c6b` across 1,032 files. Its real PostgreSQL advisory barrier holds the acknowledgement update, observes a contending native-request transaction, releases the barrier, and requires successful completion. Four further sequential timing cases passed. The application uses external OIDC/Codex fixtures and seeded immutable extension metadata; this is a shared lifecycle correction, not full P012 or live-model acceptance.

Independent review of the correction and real PostgreSQL contention evidence subsequently closed with no actionable finding. The barrier passed again in P012's later controls run `ec6a705abd` at exact source `71c8dd8979d0d63d23f12778cc1c46203e27ab61f70ffcee704b92fb9d391179` /1,035 files. This evidence belongs to the isolated P012 branch; main still requires the correction and relevant application/critical regression verification before resolution. Do not manufacture a historical failed-source digest or relabel an unrelated passing run as a causal fix.

## Resolution — 13 September 2026

The common-use candidate now contains the narrow shared acknowledgement correction, without P010/P012 feature imports or migrations. Its tested source is `ce2531fdc5a176d21a65b160d3800678fe89497518ac8f9ddd6d1ee268d85403` across 1,039 files. Main independently recomputed that digest and matched the actual critical result. The [closing report](../../docs/reports/2026-09-13-common-use-acknowledgement.md) records commands, environments, source distinctions, failed attempts and complete results.

On macOS with Node 24.11.1, the actual Harbor browser/API/PostgreSQL/supervisor critical suite `harbor-e2e-1704c722e8` passed with identical start/end source. Its ordinary approval scenario observed the real gate → acknowledgement → request lock chain, then required one completed operation, one native turn submission, one approval, no uncertainty event and successful owned cleanup. The result SHA256 is `ede616b5da9d90b7e6bbd8873db55277bb7e977413cd3ebb301c6030c1a4db00`; the contention artifact SHA256 is `b5520cba6e6021c4ff299f0ca7d95319282ce388ffc9f50517962a7b4c24e28d`.

Three current extraction/harness review rounds completed: initial review, bounded connection/rollback cleanup correction, and the final real-session setup correction. A separate narrow review accepted the deterministic clock fix in an existing policy test. Build/check, 11 integration tests and 20 pinned no-account Codex 0.153.4 contracts passed on the explicitly mapped predecessor sources; final type/format and critical acceptance passed on the digest above. Production acknowledgement bytes were unchanged through those test-only refinements.

This resolves the shared lock-order defect and its main integration obligation. P012's complete feature integration remains deferred; no extension feature or live/Linux/installed acceptance is inferred from the ordinary approval case. P001's live-account gate and P009's release/recovery gates remain open. The earlier failed observations and isolated evidence above remain historical facts.
