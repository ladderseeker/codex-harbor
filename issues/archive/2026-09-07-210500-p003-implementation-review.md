# P003 implementation review findings

- Severity: High
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-07
- Owner: [P003](../../design/proposals/003-parallel-project-workspaces.md)
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

The implementer accepted this batch and is adding focused interruption and bounded-retry regressions before repeating the affected application and actual Linux checks. A separate reviewer will evaluate the corrected source and evidence. P003 remains In progress; record the final source identity, commands, environment, outcomes, and review rounds before resolution and archival. The [dedicated live-account gate](../2026-09-07-171225-live-runtime-credentials.md) remains independently open.

## Round 2 — 7 September 2026

The reviewer confirmed the three original corrections at source digest `3bf651d8899e101852c457ed40a27133caf58e575322006163e8e0270c461449` (822 files). Node 24 checks, 28 contract/integration tests, real P003 E2E `harbor-workspaces-f648acc433`, and the actual Linux artifact `p003-review1-linux-result.json` passed with matching source identities. Transport tests rejected a truncated reply in 17 ms and a slow response at the configured 100 ms total deadline in 104 ms. Actual partial-removal/SIGKILL recovery retained pending metadata ownership and completed the same recorded operation without removing neighboring files.

One related High durability finding remains. Creation/removal can publish and fsync a completed receipt on the separate control filesystem before flushing the corresponding project-filesystem changes. Host or power loss may therefore recover the receipt ahead of those files, after which retry skips cleanup. This is a source-only ordering finding; the process-SIGKILL results above do not establish host-crash durability.

Add a trusted filesystem durability barrier before completion publication, covering creation, Git metadata, removal and abandoned-stage cleanup. Failed or incomplete flush must retain reconciliation state. Verify the actual Linux path and error handling, then independently review the bounded correction. The shared authority integration and live-account gates remain separate.

## Corrective review checkpoint — 7 September 2026

The bounded durability correction closes round 2 on feature commit `c96755e`, source digest `aed1994e3fd222d28b178386e276b23bb0bddda573ef6251ab1eae300265df86` (822 files). The reviewer inspected the trusted `syncfs` and receipt-directory barriers, exact applied-creation identity/content validation, and idempotent applied-removal cleanup. Error, mismatch or timeout retains pending reconciliation without copying newer source content or reporting completion.

Node 24.11.1 ran 28 combined workspace/contract/integration tests, types, formatting and documentation checks. Real P003 E2E `harbor-workspaces-55c9cedde7` and actual Linux `p003-review2-validated-linux-result.json` passed at matching source digests. The Linux fixture used kernel 6.8.0-134, Docker 29.1.3 and XFS tools 6.6.0; it injected `syncfs` EIO, changed an applied checkout, and verified restart/error/reconciliation ordering and exact inode preservation. This is kernel-error and process-loss evidence, not an actual power-cut test. The final E2E used the already-built unchanged UI; a separate build at this exact final source was not recorded. The combined integration will build fresh assets.

No actionable critical finding remains in the reviewed P003 fix scope. Keep the issue active until the current P002 authority integration and combined application/Linux evidence are recorded. Dedicated live-account acceptance remains separately blocked.

## Resolution — 7 September 2026

The historical pending dispositions above are superseded by this closure. Reviewed integration commit `ea8816f7678c3fe689791f4621d01468b99388ce` combines P003 and the current P002 authority correction. Its exact source digest `b012ef67ca4bc6cf35c190256f50504f53b6c32f4d3e4f1e77bdb50f35cdd972` (831 files) is present in main. A separate integration review found no actionable issue in the combined authorization, resource ownership, route policy or conflict resolutions.

Node 24.11.1 passed a clean build, types/formatting/documentation, 30 combined workspace/integration/contracts, complete P001/P002 E2E `harbor-e2e-b7d6b45d2a`, P003 E2E `harbor-workspaces-c273fcb089`, and actual supported Linux `p003-integrated-linux-result.json`; application and Linux source digests match at both ends. The [implementation report](../../docs/reports/2026-09-07-p003-workspaces.md) records commands, environment, image identities, two feature review rounds plus integration review, and meaningful evidence limits.

All findings owned by this review issue are resolved. P003 remains active and unverified because dedicated real-account parallel-turn evidence is unavailable. The separate authority issue retains P007 integration ownership, and P009 retains host deployment/restore obligations. Archiving this review does not close those gates.
