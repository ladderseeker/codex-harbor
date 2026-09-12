# Preview retirement misclassifies an already removed relay

- Severity: Medium
- Status: In progress
- Owner: P011 implementer; independent lifecycle reviewer
- Affected files: `infra/previews/launcher.ts`, `tests/previews/retirement-linux.ts`
- Acceptance: [P011-01/05](../design/proposals/011-private-project-previews.md#independent-acceptance)

## Observed defect — 8 September 2026

The actual owned Docker canary `preview-retire-fM28Kz` removes a relay after the exact-name listing and before inspection. The container is physically absent, but retirement throws instead of reconciling that absence. Its retained failure records source `89d176107524629eed7e8eea29ad304ee14cdcffe49693c9dc3da89d108e1f14` across 1,027 files. This can retain uncertainty and workspace ownership after execution has stopped; it does not demonstrate unauthorized container removal.

The correction accepts absence only after a successful fresh exact-name query. An unavailable Docker daemon, a remaining container, or changed ownership still prevents confirmed retirement. It similarly reconciles removal failure without substituting an unchecked container identity. The actual corrected canary `preview-retire-pivr7O` passed both inspection and removal disappearance schedules at source `93d3ef15e720b03285498a20e4ab5843e1e1a0362412654483de9f6649ca5d29` across 1,028 files; a wrong-instance container remained untouched. One bounded independent source review closed this correction.

## Recovery and remaining integration — 13 September 2026

The original macOS working files were lost, but the immutable installed preview release and named Linux evidence survived. Recovery matched launcher SHA-256 `8490a82b6b30efb71cdf71c74835231b6475fcad51c4c6054dd630f363e56e2e` and actual test SHA-256 `832411165063c6b801983539f503d218ccd2884007aadd4a7d8582fd99910cdd`. The correction is committed on the isolated P011 branch in `4218d71`, with passing Node 24 source/document checks and two preview adapter contracts. Those recovery checks are not a new Linux acceptance run.

Complete reviewed main integration and the final relevant P011 lifecycle/regression checks before archiving. Keep the earlier `c88de2288c` lifetime failure separate: its precise failing stage was not captured, and this proven race does not retrospectively establish that cause. See the [recovery report](../docs/reports/2026-09-13-interrupted-work-recovery.md) for evidence ownership and retained limitations.
