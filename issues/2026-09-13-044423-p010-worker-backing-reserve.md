# Worker backing growth can consume stable control recovery space

- Severity: High; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: High
- Status: In progress
- Owner: P010 implementer; separate reviewer verifies admission and Linux evidence

Complete deferred outcome and acceptance are tracked in [2026-09-20-000003-self-development-acceptance.md](2026-09-20-000003-self-development-acceptance.md); this record retains its individual finding and correction evidence.

- Affected files: `infra/self/preflight.py`, `infra/self/allocation.py`, shared worker storage admission and its tests
- Acceptance: [P010-03/04/07](../design/proposals/archive/010-self-development.md#independent-acceptance), under [D008's stable resource reserve](../design/decisions/008-isolated-self-development-workers.md)

## Source finding and observed topology — 13 September 2026

At P010 checkpoint `bcb2dbf`, `infra/self/preflight.py:126–150` checks that worker and stable control mounts have different `st_dev` values, and that control has at least 2 GiB free. `infra/self/allocation.py:30–40` separately requires at least 16 GiB free in the worker filesystem. Neither check accounts for the physical filesystem holding a worker loop device's backing file. Artifact collection can additionally retain up to 2 GiB in control storage. Its existing `infra/self/artifacts.py:115–119` check requires the announced artifact bytes plus 2 GiB free before that write, but does not reserve capacity against concurrent worker-backing growth.

A sparse loop-backed XFS mount can satisfy both checks while its permitted growth consumes the same physical free blocks counted as control recovery space. An authorized or malicious candidate filling its allowed worker allocation can therefore erode stable control headroom. Artifact growth can consume the remaining blocks. Different mount/device identities establish logical separation, not this physical capacity guarantee; the result violates the stable recovery reserve even without a filesystem or namespace escape.

Main's read-only inventory of the owned C Linux test host observed exactly this topology: the worker XFS loop device's backing file resides on the control filesystem. After an independently recorded exact free-block trim, control had 18,717,462,528 bytes free and the worker filesystem had 17,495,953,408 bytes free. Both existing thresholds were satisfied, but 16 GiB additional worker growth alone leaves only 1,537,593,344 bytes, below the 2 GiB recovery reserve. An artifact accepted before subsequent worker growth adds another shared obligation. The inventory is retained at `.test-runs/recovery-20260913/c-public-inventory.json`, SHA-256 `497891a26514586de54f5c82bbe2199fcaa80150211d35ec70bdd9a5ec308da9`; the preceding trim identity and unchanged sealed-base evidence remain in the P010 worktree's `.test-runs/cache-refresh/worker-trim-result.json`.

This is a source-proven admission defect with an observed real topology. No candidate was run to exhaust the control filesystem, and no actual ENOSPC, data loss or stable-service outage is claimed. The full candidate run remains gated; public cache preparation and sandboxed browser checks do not establish the missing reserve.

## Correction and required evidence

The implementer confirmed the gap. Add a shared production storage-budget check in preflight and allocation under its ownership lock. Reserve the bounded artifact plus stable recovery allowance on control storage; resolve a supported worker block topology and account for possible worker growth on its actual backing filesystem, combining obligations when they share storage. Preserve ordinary supported separate block filesystems and refuse unsupported or ambiguous backing rather than silently assuming separation. Record the supported topology and conservative bounds in D008 before relying on them.

Validate sufficient and insufficient shared capacity, ordinary separate storage, ambiguous/unsupported backing, changed identities, and the allocation-time check. A bounded actual Linux check should demonstrate denial of the observed insufficient layout before allocation or execution, without filling the real control disk. Then establish admission on a sufficiently provisioned supported layout and retain the full candidate resource/stable-responsiveness acceptance as a separate obligation. Preserve sealed bases, historical evidence and unrelated resources during any test-space reconciliation.

## Review and next steps

Independent bounded assessment confirmed the source finding and High severity, including the existing artifact check's limited protection. Correction review and verification remain pending. Record the correction's source identity, commands, environment, actual Linux results, review rounds and main integration before resolving and archiving. A harness-only capacity check does not close this production admission finding.

### Initial correction review — 13 September 2026

Isolated checkpoint `f728ef3` adds a shared production budget at preflight and under the allocation lock. Its four focused contracts and 46 Python contracts passed. A read-only call of the actual module on C denied the insufficient shared-worker-backing layout before allocation or filling: control free 18,717,454,336 bytes versus the initial required 21,474,836,480 bytes. Module SHA-256 is `657edcdf55d7bf6fad8e6e2e5a2ae7be606188a02e5e6b43e3e4acfd09b1c4a0`; `.test-runs/storage-budget/linux-result.json` in the P010 worktree has SHA-256 `885a45663cb140ccc738a291933a2e2f508fbd4076e6443c07a9591b2d40f306`. This is direct module denial, not installed allocation or positive admission evidence.

Independent correction review found a remaining High case: `storage_budget.py:52–60` resolves worker backing but does not validate the control device. A sparse loop control filesystem backed by a file on the direct worker filesystem can pass the independent logical checks while worker growth consumes control's backing capacity. Unvalidated stacked or thin control storage has the same missing proof. Validate both sides, or explicitly reject unsupported control backing, and add a denial-before-effects regression for this reverse topology. No growth, exhaustion or outage is claimed for this source-derived case.

The implementer is also adding a bounded evidence/control overhead allowance to the artifact and recovery budget. Final combined correction review, actual supported-host positive admission and main integration remain pending; the initial denial does not close the finding.

### Combined correction and cleanup review — 13 September 2026

Checkpoint `b0ed1f8` requires a supported direct control device, rejects the reverse/file-backed/stacked control case, and adds 64 MiB for bounded evidence and control overhead. Five storage contracts and the 49-test Python suite passed. Independent focused review found no remaining actionable source finding in that correction. The exact final module `9d69b198d5b76261bcde12a58b4b406f684002bf179c3a80e8f94868fc545688` again denied C before allocation: 18,717,450,240 bytes available versus 21,541,945,344 required, with the same backing inode. The separately retained `.test-runs/storage-budget/linux-result-v2.json` has SHA-256 `ae99d9cee5741da5fb0708f05388b2ed24cab349e3fdf07bf4cceb5a81bd008f`; earlier results retain their tested thresholds.

The related `799722e6a74c1b1f95b94d2d3d166220810f660a` increment retains allocation ownership through fixed free-block discard on the exact recorded loop-backed worker mount after owned deletion and confirmed container retirement. A separate reviewer inspected its mount/backing identity checks, fixed command, ordering and failure behavior with no actionable finding. Eight focused contracts passed. Its planned small-allocation Linux driver has not yet run and cannot by itself prove quantitative reclamation, full quota exhaustion or container-retirement acceptance. Positive actual admission, this new cleanup's required Linux evidence, complete candidate resource acceptance and main integration remain pending.

A subsequent pre-run integration audit found that the fixed protected guardian can have a different mount namespace and mount ID from the allocating supervisor. Checkpoint `ea65c2e6aac23f22be5e2e8bada759ac1c59c152` records boot and namespace identity: the same namespace must retain its mount ID; a protected guardian view must retain the exact boot, filesystem root and backing identity, and its own view is checked before and after discard. Nine focused contracts passed. A separate focused source review closed with no actionable finding. The revised Linux driver uses the actual protected systemd namespace and preserves the same used-file and sealed-base sentinels; it remains unrun at this checkpoint. Earlier review/check results keep their original scope.

### Actual positive admission and protected cleanup — 13 September 2026

The revised driver subsequently passed on the existing owned C Linux host, using the unchanged cleanup correction from `ea65c2e` at checkpoint `81f8d700af14f2a3934ef924d533067586e19599`. Root Python 3 ran `tests/self/backing-cleanup-linux.py` with fresh owned paths. The retained P010 worktree receipt `.test-runs/backing-cleanup/linux-output.json` has SHA-256 `8e192c689dbca93241b17305394734279686095405b32f0105a9545974ec7216` and records all eight exact source/test hashes; report checkpoint `1baf935` preserves the command, environment and result.

Production admission accepted 22,420,439,040 available bytes against 21,541,945,344 required. A real XFS quota allocation was cleaned through a fixed protected systemd namespace whose namespace and mount IDs differed from the host while the boot, root and backing identities matched. Exact deletion, quota release, filesystem barrier and fixed discard completed; the durable removal and idempotent replay passed. The used-file sentinel, both sealed image inode/hash pairs and unrelated container inventory were preserved. Post-cleanup admission also passed with 22,420,422,656 available bytes.

Independent focused evidence review matched all eight hashes and the receipt to the report, with no actionable finding. This establishes supported positive admission and protected allocation cleanup. It does not establish quantitative reclamation, full quota exhaustion, guest execution or retirement of a complete worker family. Complete candidate resource acceptance and main integration remain pending; this issue stays In progress. Main's earlier public-cache recovery and administrative discard have separate receipts in the [recovery report](../docs/reports/2026-09-13-interrupted-work-recovery.md#public-test-cache-recovery-and-retirement--13-september-2026).
