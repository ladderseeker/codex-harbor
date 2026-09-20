# P007 history and recovery integration checkpoint

Date: 2026-09-07. Decision: Accepted. Delivery is Implemented after integrated review and Node 24 acceptance; mandatory live-account evidence remains open. This report records implementation evidence, not Verified delivery.

## Source and scope

The candidate merges reviewed P007 `93a034a444cc95b6d8da8f5c6a905d1fc0f256c9` with reviewed P003/P002 `ea8816f7678c3fe689791f4621d01468b99388ce`. Its source/configuration digest is `2976f6286a9aea9645e2a27dfcb497e677c5268d5ff034593752dc98211b40bd`, covering 842 files under the repository's path-and-content SHA256 convention. Documentation is excluded. The independent integration review closed with no actionable finding; the merge checkpoint is recorded in Git.

The integration retains P002 route allowlisting, resource filtering, token admission limits and post-lock authority checks. Browser history/recovery stays browser-only. It wires P007 recovery to P003 project/workspace locks and exact reservation release using the captured workspace writer generation, rather than the session epoch changed by restart. A previously released reservation is accepted only while it is still unowned; a successor blocks recovery. Derived probes use the registered checkout and imported Git common-store identities. Confirmed completed-turn release ignores only explicitly acknowledged historical uncertainty. Conversation archive, including the legacy endpoint, changes visibility while active work continues; project/workspace archive remains idle-gated.

P007's native reconciliation/retirement algorithm is unchanged from its reviewed standalone implementation, except for obtaining registered workspace identities and passing the captured nullable writer generation to the release hook. `git diff ea8816f -- infra packages/codex-adapter` is empty: runner, storage helper, network enforcement, adapter and exact retirement primitives are byte-identical to the integrated P003 Linux checkpoint. No duplicate Linux run was performed solely to obtain a new aggregate digest.

## Validation

Environment: macOS arm64, Node 26.7.0, pnpm 12.3.4, PostgreSQL 17.6, Codex 0.153.4 and Chromium 1194. Each E2E run used fresh databases, ports, credentials, runtime homes and project fixtures. Harbor UI, HTTPS, API, persistence and supervisor are real; deterministic fixtures replace only external Codex and OIDC boundaries.

- `pnpm check`: passed types, documentation links/whitespace, OpenAPI integration assertions and maintained-source formatting.
- `pnpm build`: passed clean Vite build and typecheck.
- `pnpm test`: 9 passed.
- `pnpm test:workspaces`: 8 passed, including owned helper/process-death and durable storage receipt reconciliation.
- `pnpm test:contract`: 15 passed, including the pinned real-runtime non-model smoke and history contracts.
- `node --import tsx tests/e2e/run.ts --workspaces`: passed `harbor-workspaces-5e0a57a497`, identical start/end candidate digests. Adds derived-checkout crash, exact reservation recovery, independently acknowledged new input, original uncertainty/file preservation and completed-turn reservation release to the P003 acceptance lane.
- `pnpm test:e2e`: passed `harbor-e2e-3890f83dff`, identical start/end digest `44285c761c564728834de678114711e3ff296b242224c39c3e7924617901fbf9`. This is identical production source; the candidate subsequently adds only the derived-workspace E2E case. It covers P001/P002/P007, including active conversation archive and restart recovery across distinct session/writer epochs.

The standalone P007 checkpoint `90aa34aa3d55516ce3e4a0209cb697d10011a07d8314f07955a4499470e5a507` passed its full suite and two independent review rounds. The inherited integrated P003/P002 Linux checkpoint `b012ef67ca4bc6cf35c190256f50504f53b6c32f4d3e4f1e77bdb50f35cdd972` established the unchanged native isolation boundary; its original evidence and limitations remain in the P003 report maintained at integration. These are separate checkpoints, not a claim that every historical command ran on this candidate.

## Review and remaining gates

Independent integration review closed in one bounded round with no actionable finding across authority, reservation fencing, continuation, scopes, archival and UI/OpenAPI merge seams. The Node 24 checkpoint and source-issue closures are recorded below. Dedicated live-account/model credentials remain unavailable; no personal state was used and no successful model smoke is claimed. See the [canonical proposal](../../design/proposals/archive/007-session-history-and-recovery.md), [history user guide](../user/conversations.md) and [workspace developer guide](../developer/workspaces.md).

## Node 24 integration and issue closure

Reviewed integration commit `0118dfe` and documentation merge `ca1a2cf` retain source `2976f6286a9aea9645e2a27dfcb497e677c5268d5ff034593752dc98211b40bd` (842 files). The main agent explicitly selected Node 24.11.1 and passed `pnpm check`, `pnpm build`, `pnpm test` (9), `pnpm test:contract` (15) and `pnpm test:workspaces` (8); output is `.test-runs/p007-integrated-node24-checks.log` in the integration worktree. The first unpinned shell selected Node 26.7.0 and repeated those checks; that invocation is not Node 24 evidence.

`pnpm test:e2e` passed `harbor-e2e-10d1a7178a`; `node --import tsx tests/e2e/run.ts --workspaces` passed `harbor-workspaces-a5ce817a7b`. Both exited 0 with identical start/end digest. The full run deliberately interrupts the supervisor/database; its process-exit diagnostic accompanies expected failure injection. All Harbor components are real, external Codex/OIDC use fixtures, and run-owned cleanup completed.

The [P007 review](../../issues/archive/2026-09-07-203000-p007-implementation-review.md), [authority correction](../../issues/archive/2026-09-07-202308-authority-expiry-after-lock-wait.md) and [replay/control bounds](../../issues/archive/2026-09-07-185228-p001-retention-control-bounds.md) are Resolved and archived. Two original feature rounds and one separate integration review are complete. The unchanged boundary retains its prior Linux checkpoint as described above. Dedicated live-account evidence still prevents Verified delivery; no completed proposal is claimed.

## Navigation and ownership addendum — 20 September 2026

P017 reconciled legacy planning records into the [proposal archive](../../design/proposals/archive/). [Current subsystem designs](../../design/systems/) now own requirements, and unfinished acceptance belongs to the [issue inbox](../../issues/) until a new proposal is selected. Historical statements here about active proposal states, queues, permissions and recovery locations describe the recorded date. This addendum changes navigation/ownership only: original tested sources, commands, results, review rounds and limitations above remain historical evidence. No application gate was rerun for the documentation migration. Historical raw artifacts or worktrees not present in this checkout were not newly verified.
