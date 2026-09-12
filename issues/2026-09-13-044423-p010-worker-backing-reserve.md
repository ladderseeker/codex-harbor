# Worker backing growth can consume stable control recovery space

- Severity: High
- Status: In progress
- Owner: P010 implementer; separate reviewer verifies admission and Linux evidence
- Affected files: `infra/self/preflight.py`, `infra/self/allocation.py`, shared worker storage admission and its tests
- Acceptance: [P010-03/04/07](../design/proposals/010-self-development.md#independent-acceptance), under [D008's stable resource reserve](../design/decisions/008-isolated-self-development-workers.md)

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
