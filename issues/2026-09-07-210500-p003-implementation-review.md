# P003 implementation review findings

- Severity: High
- Status: In progress
- Owner: [P003](../design/proposals/003-parallel-project-workspaces.md)
- Recorded: 2026-09-07
- Affected files: infra/storage/workspace-client.ts; infra/storage/workspace-service.ts; infra/storage/workspace-paths.py; apps/api/src/workspace-routes.ts
- Acceptance: P003-03/04/05/06 and the inherited supervisor availability and durable storage-operation guarantees

## Round 1 evidence

Independent review examined the P003 production and Linux-test source at digest `7c1353d25ee8024729254936ec8792386d7c5eec3d93a6f3cec950fb7f14117c` (821 files). The subsequent digest `a4f48ed263e342252e6507efa9725a21921031b16955ba9af6cb2fdd508d647c` changed two E2E selectors to exact label matches; the reviewed production and Linux-test code was unchanged. The passing baseline application, contract, and Linux scenarios did not cover these interruption cases.

| Severity | Finding and impact | Required correction/evidence |
| --- | --- | --- |
| High | The private workspace client's response path has no rejection for an aborted response, stream error, premature close, or absolute deadline. The reviewer reproduced a partial Unix HTTP response followed by peer EOF leaving `workspaceCommand` pending. A waiting storage operation can stall the supervisor tick, including cancellation and emergency handling. | Bound the request and response lifetime, reject incomplete transport outcomes, and preserve uncertain external-operation reconciliation. Test partial response, premature close, timeout, and subsequent supervisor progress. |
| High | A removal receipt remains pending while Git administrative metadata and the checkout are being deleted. After a crash partway through deletion, retry can run normal cleanliness inspection against the damaged partial workspace, settle the receipt as failed, and present that workspace as ready. This finding is based on source review; the interrupted-removal reproduction belongs to the fix evidence. | Persist a removal-authorized phase before deletion and resume only the exact recorded filesystem identity after confirming helper retirement. Inject crashes after Git metadata and partial checkout removal, then prove bounded reconciliation without changing unrelated paths or returning a damaged workspace to ready. |
| Medium | DELETE can allocate a fresh storage-operation record without applying the documented 128-record project budget or reusing bounded failed attempts. Repeated failures can accumulate records even after receipt capacity is exhausted. | Apply bounded admission and reuse/retry semantics to removal; test repeated failed requests and exact retained retries without consuming unbounded operation or receipt storage. |

The reviewer found no additional actionable defect in the reviewed Git import, mount authority, or writer-lease implementation. This is a scoped review result, not proof that every behavior is correct. The shared [post-lock authority correction](2026-09-07-202308-authority-expiry-after-lock-wait.md) must also be integrated where P003 acquires later resource locks.

## Disposition

The implementer accepted this batch and is adding focused interruption and bounded-retry regressions before repeating the affected application and actual Linux checks. A separate reviewer will evaluate the corrected source and evidence. P003 remains In progress; record the final source identity, commands, environment, outcomes, and review rounds before resolution and archival. The [dedicated live-account gate](2026-09-07-171225-live-runtime-credentials.md) remains independently open.
