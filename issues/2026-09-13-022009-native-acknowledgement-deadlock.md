# Native turn acknowledgement can deadlock with request persistence

- Severity: High
- Status: In progress
- Owner: P012 implementer; shared P001 lifecycle integration and independent review
- Affected files: `apps/supervisor/src/main.ts`, native request fixtures and shared turn acceptance coverage
- Acceptance: [P001-03/07](../design/proposals/001-secure-persistent-conversations.md#independent-acceptance) and [P012-01/04](../design/proposals/012-managed-skills-and-mcp.md#independent-acceptance)

## Evidence and impact — 8 September 2026

After native turn acknowledgement, the shared supervisor transaction updates the operation before acquiring its conversation row. Native request persistence acquires those rows in the reverse order. An immediate request can therefore deadlock with acknowledgement, changing an accepted turn to uncertain and expiring its pending input.

P012 run `255dfe010d` captured PostgreSQL SQLSTATE `40P01` after the native turn was bound and an MCP approval persisted. Main inspected that safe operation/approval/event diagnostic before the interruption. Earlier failures `aa4ab38486` and `2f75d8728f` had weaker diagnostics; their exact causes are not inferred from later evidence. The failed harness did not retain a full source digest, and its host-side JSON is no longer available. The committed P012 development report retains those qualifications.

The issue affects the shared turn path, including existing core conversations. Uncertainty and no-replay handling protect against blind duplicate execution but do not make this a successful user outcome. Main `9c005f0` still has the opposite lock order.

## Isolated correction and next steps

P012 checkpoint `268d86f69d543ad1317e02fd3f68d6f76bce2a8a` acquires the conversation before updating its operation. Its dispatching-state condition, uncertainty handling and no-replay semantics remain unchanged. Only a bounded five-character database error code is added to the existing dispatch-failure event; SQL, native payloads and credentials are not logged.

Historical Node 24.11.1 run `829df2d1b8` passed at identical start/end source `cd3240e317236547cabae546817aa8a4bac3cb1aa3c104f27adfeb2d79c13c6b` across 1,032 files. Its real PostgreSQL advisory barrier holds the acknowledgement update, observes a contending native-request transaction, releases the barrier, and requires successful completion. Four further sequential timing cases passed. The application uses external OIDC/Codex fixtures and seeded immutable extension metadata; this is a shared lifecycle correction, not full P012 or live-model acceptance.

Complete independent review, main integration and current relevant application/critical regression evidence before resolving. Recreate retained evidence during the owning feature's next justified run; do not manufacture a historical failed-source digest or relabel an unrelated passing run as a causal fix.
