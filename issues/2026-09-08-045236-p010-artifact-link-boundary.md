# Candidate static verifier accepts a parent-directory link

- Severity: Medium; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: Medium
- Status: In progress
- Owner: P010 implementer; independent verifier review

Complete deferred outcome and acceptance are tracked in [2026-09-20-000003-self-development-acceptance.md](2026-09-20-000003-self-development-acceptance.md); this record retains its individual finding and correction evidence.

- Affected files: `infra/self/verify_artifact.py`, candidate archive verification tests
- Acceptance: [P010](../design/proposals/archive/010-self-development.md#independent-acceptance), outside-worker artifact validation

## Evidence — 8 September 2026

Main tested the in-progress verifier with a fresh synthetic source archive and a self-consistent candidate manifest containing `payload/node_modules/escape` linked to `../..`. Relative to the release payload, the normalized target is exactly `..`. The check rejects targets beginning with `../` but misses equality with `..`, so `inspect` returned `staticBinding: true` and `runtimeVerified: false`.

The verifier SHA-256 was `dba3f4bffbfcb197d6b22fd1093eb3529ec32831bb687425c284c910a089d975`. Bounded evidence is retained in `.test-runs/p010-artifact-boundary-20260908.json`. This diagnostic only constructed and read archive bytes; it extracted nothing and accessed no outside file. Source inspection confirms P009's separate installer rejects this link before extraction. No host access or full candidate-verification bypass is established.

## Impact and next steps

The outside-worker static check can accept an artifact that violates its release-containment rule and will fail the downstream installer. Reject both the exact parent target and parent-prefixed paths, retain supported internal dependency links, and add a focused hostile-archive regression. Independently inspect the correction and matching test evidence before archiving this bounded issue. P010's full verifier, application and Linux acceptance remain separate requirements.

## Reviewed correction checkpoint

The implementer added the exact-parent check and a self-consistent hostile-archive regression. Main independently confirmed rejection of `../..`, `../../elsewhere` and `/outside`, while the contained `../apps/main.ts` link remains accepted. All four cases constructed/read archive bytes only; static success still reported `runtimeVerified: false`. The corrected verifier SHA-256 is `b04f698ea2bfa754f6608eb7562a2d8176bb3291a9b6512a46db8e0a1b7ca2a0`, with test SHA-256 `f71206d4f697eb5e637d6d868830d483f3e6967b041d6b5f6c1730080cd4234f`. Evidence is retained separately in `.test-runs/p010-artifact-boundary-fixed-20260908.json`; the original accepted-invalid-link result remains intact.

One independent bounded source/evidence review found no remaining actionable finding in this correction. The implementation remains in the isolated P010 worktree; record its committed integration before archiving this issue. These parser checks are not P010's complete independent feature review or runtime acceptance.
