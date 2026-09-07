# P007 history and recovery integration checkpoint

Date: 2026-09-07. Decision: Accepted. Delivery remains In progress pending required gate disposition. This report records implementation evidence, not Verified delivery.

## Source and scope

The candidate merges reviewed P007 `93a034a444cc95b6d8da8f5c6a905d1fc0f256c9` with reviewed P003/P002 `ea8816f7678c3fe689791f4621d01468b99388ce`. Its source/configuration digest is `2976f6286a9aea9645e2a27dfcb497e677c5268d5ff034593752dc98211b40bd`, covering 842 files under the repository's path-and-content SHA256 convention. Documentation is excluded. The independent integration review closed with no actionable finding; the merge checkpoint is recorded in Git.

The integration retains P002 route allowlisting, resource filtering, token admission limits and post-lock authority checks. Browser history/recovery stays browser-only. It wires P007 recovery to P003 project/workspace locks and exact reservation release using the captured workspace writer generation, rather than the session epoch changed by restart. A previously released reservation is accepted only while it is still unowned; a successor blocks recovery. Derived probes use the registered checkout and imported Git common-store identities. Confirmed terminal release ignores only explicitly acknowledged historical uncertainty. Conversation archive, including the legacy endpoint, changes visibility while active work continues; project/workspace archive remains idle-gated.

P007's native reconciliation/retirement algorithm is unchanged from its reviewed standalone implementation, except for obtaining registered workspace identities and passing the captured nullable writer generation to the release hook. `git diff ea8816f -- infra packages/codex-adapter` is empty: runner, storage helper, network enforcement, adapter and exact retirement primitives are byte-identical to the integrated P003 Linux checkpoint. No duplicate Linux run was performed solely to obtain a new aggregate digest.

## Validation

Environment: macOS arm64, Node 26.7.0, pnpm 12.3.4, PostgreSQL 17.6, Codex 0.153.4 and Chromium 1194. Each E2E run used fresh databases, ports, credentials, runtime homes and project fixtures. Harbor UI, HTTPS, API, persistence and supervisor are real; deterministic fixtures replace only external Codex and OIDC boundaries.

- `pnpm check`: passed types, documentation links/whitespace, OpenAPI integration assertions and maintained-source formatting.
- `pnpm build`: passed clean Vite build and typecheck.
- `pnpm test`: 9 passed.
- `pnpm test:workspaces`: 8 passed, including owned helper/process-death and durable storage receipt reconciliation.
- `pnpm test:contract`: 15 passed, including the pinned real-runtime non-model smoke and history contracts.
- `node --import tsx tests/e2e/run.ts --workspaces`: passed `harbor-workspaces-5e0a57a497`, identical start/end candidate digests. Adds derived-checkout crash, exact reservation recovery, independently acknowledged new input, original uncertainty/file preservation and terminal reservation release to the P003 acceptance lane.
- `pnpm test:e2e`: passed `harbor-e2e-3890f83dff`, identical start/end digest `44285c761c564728834de678114711e3ff296b242224c39c3e7924617901fbf9`. This is identical production source; the candidate subsequently adds only the derived-workspace E2E case. It covers P001/P002/P007, including active conversation archive and restart recovery across distinct session/writer epochs.

The standalone P007 checkpoint `90aa34aa3d55516ce3e4a0209cb697d10011a07d8314f07955a4499470e5a507` passed its full suite and two independent review rounds. The inherited integrated P003/P002 Linux checkpoint `b012ef67ca4bc6cf35c190256f50504f53b6c32f4d3e4f1e77bdb50f35cdd972` established the unchanged native isolation boundary; its original evidence and limitations remain in the P003 report maintained at integration. These are separate checkpoints, not a claim that every historical command ran on this candidate.

## Review and remaining gates

Independent integration review closed in one bounded round with no actionable finding across authority, reservation fencing, continuation, scopes, archival and UI/OpenAPI merge seams. Node 24 integrated checks remain a separate minimum-version checkpoint. Dedicated live-account/model credentials remain unavailable; no personal state was used and no successful model smoke is claimed. The active source findings remain owned by P007 until independent integrated evidence closes their mapped obligations. See the [canonical proposal](../../design/proposals/007-session-history-and-recovery.md), [history user guide](../user/conversations.md) and [workspace developer guide](../developer/workspaces.md).
