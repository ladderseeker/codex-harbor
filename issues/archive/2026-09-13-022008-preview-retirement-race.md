# Preview retirement misclassifies an already removed relay

- Severity: Medium
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-13
- Owner: P011 implementer; independent lifecycle reviewer
- Affected files: `infra/previews/launcher.ts`, `tests/previews/retirement-linux.ts`
- Acceptance: [P011-01/05](../../design/proposals/archive/011-private-project-previews.md#independent-acceptance)

## Observed defect — 8 September 2026

The actual owned Docker canary `preview-retire-fM28Kz` removes a relay after the exact-name listing and before inspection. The container is physically absent, but retirement throws instead of reconciling that absence. Its retained failure records source `89d176107524629eed7e8eea29ad304ee14cdcffe49693c9dc3da89d108e1f14` across 1,027 files. This can retain uncertainty and workspace ownership after execution has stopped; it does not demonstrate unauthorized container removal.

The correction accepts absence only after a successful fresh exact-name query. An unavailable Docker daemon, a remaining container, or changed ownership still prevents confirmed retirement. It similarly reconciles removal failure without substituting an unchecked container identity. The actual corrected canary `preview-retire-pivr7O` passed both inspection and removal disappearance schedules at source `93d3ef15e720b03285498a20e4ab5843e1e1a0362412654483de9f6649ca5d29` across 1,028 files; a wrong-instance container remained untouched. One bounded independent source review closed this correction.

## Recovery and remaining integration — 13 September 2026

The original macOS working files were lost, but the immutable installed preview release and named Linux evidence survived. Recovery matched launcher SHA-256 `8490a82b6b30efb71cdf71c74835231b6475fcad51c4c6054dd630f363e56e2e` and actual test SHA-256 `832411165063c6b801983539f503d218ccd2884007aadd4a7d8582fd99910cdd`. The correction is committed on the isolated P011 branch in `4218d71`, with passing Node 24 source/document checks and two preview adapter contracts. Those recovery checks are not a new Linux acceptance run.

Complete reviewed main integration and the final relevant P011 lifecycle/regression checks before archiving. Keep the earlier `c88de2288c` lifetime failure separate: its precise failing stage was not captured, and this proven race does not retrospectively establish that cause. See the [recovery report](../../docs/reports/2026-09-13-interrupted-work-recovery.md) for evidence ownership and retained limitations.

## Resolution — 13 September 2026

Main accepted the corrected implementation in `0822992`, with the final Linux evidence addendum in `5820e5e`. The launcher and disappearance test retain the exact hashes above. One bounded independent review closed the race correction; the full feature subsequently completed two review rounds. Main inspected the source identity, cumulative results and final actual Linux lifecycle evidence without another finding.

The cumulative `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:contract`, preview domain/migration and deployment contract checks passed on Node 24.11.1 and pnpm 12.3.4, with isolated pinned Codex 0.153.4. Critical application run `46bafa3212` and actual Linux `HARBOR_PREVIEW_REVIEW_ONLY=1 node --import tsx tests/previews/e2e.ts` run `c591ca08c4` passed at identical start/end source `991fb86c4a2cefe8908c57df9e69435ae15ae07144c1be184fc1d1fc0b5517c4` /1,036 files. The latter used fresh XFS/native-runner/relay resources and confirmed exact cleanup. The original targeted disappearance canary remains the causal evidence for this correction; the final lifecycle run establishes integrated retirement behavior.

Commands, result hashes, environment and evidence ownership are linked from the [main acceptance report](../../docs/reports/2026-09-08-p011-development.md#main-acceptance--13-september-2026). Documentation links and whitespace are checked with this archive move. This closes the scoped race and main integration; protected restore and upstream live gates remain proposal obligations, and the historical unidentified lifetime failure has not been assigned a retrospective cause.

## Ownership navigation — 20 September 2026

The disposition and evidence above are historical. Retired proposal references identify feature lineage; any unfinished inherited acceptance is retained in the [active inbox](../) and the [current subsystem designs](../../design/systems/). The P017 baseline migration did not resolve another finding or rerun this record’s checks.
