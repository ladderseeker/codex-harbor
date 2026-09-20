# Native PTY contract cannot create its Linux helper under temporary storage

- Severity: Medium
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-13
- Owner: P011 integration tester; P006 contract maintainer
- Affected files: `tests/contract/terminal.test.ts`
- Acceptance: [P006-01](../../design/proposals/archive/006-persistent-terminal.md#independent-acceptance), shared pinned-runtime contract gate

## Observed failure and cause — 13 September 2026

P011's Linux contract run at `a8a2f2c` passed 19 of 20 checks; the inherited native PTY check failed with `Terminal exited before readiness`. The original log is retained with SHA-256 `7c9de29075bfb5a81ffc7b764c760a1eb10dea8a9ff848517d0ac99e08be0bca`. Its test creates a fresh `CODEX_HOME` beneath `/tmp` on Linux.

A bounded diagnostic reproduced the failure with both the pre-preview `717ca45` adapter and P011's adapter, using the pinned Codex 0.153.4, fresh unauthenticated homes and the unchanged `workspaceWrite` sandbox. Native diagnostics show that helper alias creation is refused under `/tmp`, followed by failure to find `codex-linux-sandbox` on the test host's PATH. Both exact adapters then acknowledged and completed the same fixed PTY command when their fresh homes were created in a persistent run-owned verification directory. No installed service, personal Codex state or sandbox setting changed.

The two adapter hashes are `20bc5559f9d86b1f02c91ce3272e895846f1e279fe4e81d774e1de806d4b8672` and `0e7f4af986d21106721568378cfce2f9f3790ffaf3878883b4f265fb25a0bb48`. The negative and positive result hashes are `3a5d253a6e88f304c94806d24258eff243747704a62907df942f5b1d0255b7d0` and `882395792f45d51aadc97e5985f2121b3afb8f63b3ce3a1c42328f3729c3aa44`. Source copies, fixed diagnostic drivers and results remain in the main worktree's ignored `.test-runs/recovery-20260913/` and the owned Linux diagnostic directory. An earlier diagnostic setup attempt omitted its ES module package marker and stopped before launching the adapter; it is retained separately and establishes no native result.

## Correction plan

Move only the contract's fresh home to persistent ignored repository storage, preserving run-specific ownership, mode restrictions, exact cleanup, sandbox settings and every existing resize/output/delayed-exit assertion. Independently review the test correction and run the unchanged full PTY contract on the same Linux host before resolving. Main integration remains required. This cause-specific test prerequisite does not invalidate or replace P006's separately recorded container isolation evidence, and P011's original 19/20 result remains a failed contract run.

## Resolution — 13 September 2026

Correction `e0e79f9933b580b63cf997d67119f73480d416dd`, integrated into main as `9b3fe83`, creates fresh private homes in the repository's ignored `.test-runs/terminal-contracts/`. One bounded independent source review closed with no actionable finding. It changes no production code or execution policy.

On Linux `6.8.0-134-generic`, Node 24.11.1 and pinned Codex 0.153.4, `node --import tsx --test tests/contract/terminal.test.ts` passed both checks, including actual PTY readiness, resize, byte output and the 16.3-second delayed exit. The run used a fresh isolated copy of the four exact public source files with the existing pinned public dependency tree. Test SHA-256 is `efb4b16a877de9e82a07c08da8f4fbed3be35f79f8b6110e0ad41e1f09b71886`; the adapter remained `0e7f4af9…a0bb48` above. All generated native homes were confirmed absent afterward. The retained result, including all four source hashes, is `.test-runs/recovery-20260913/terminal-corrected-result.json`, SHA-256 `16a4990a3504e8073a6a8088e7388e2994cffd931693217454f48276d9c156d9`.

Documentation links and whitespace passed after the lifecycle update. This closes the demonstrated test prerequisite and its main integration. Full preview integration, cumulative contracts and the separate live/protected-restore obligations retain their own gates; no full-suite pass is substituted for the original 19/20 run.

## Ownership navigation — 20 September 2026

The disposition and evidence above are historical. Retired proposal references identify feature lineage; any unfinished inherited acceptance is retained in the [active inbox](../) and the [current subsystem designs](../../design/systems/). The P017 baseline migration did not resolve another finding or rerun this record’s checks.
