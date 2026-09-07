# Candidate static verifier accepts a parent-directory link

- Severity: Medium
- Status: In progress
- Owner: P010 implementer; independent verifier review
- Affected files: `infra/self/verify_artifact.py`, candidate archive verification tests
- Acceptance: [P010](../design/proposals/010-self-development.md#independent-acceptance), outside-worker artifact validation

## Evidence — 8 September 2026

Main tested the in-progress verifier with a fresh synthetic source archive and a self-consistent candidate manifest containing `payload/node_modules/escape` linked to `../..`. Relative to the release payload, the normalized target is exactly `..`. The check rejects targets beginning with `../` but misses equality with `..`, so `inspect` returned `staticBinding: true` and `runtimeVerified: false`.

The verifier SHA-256 was `dba3f4bffbfcb197d6b22fd1093eb3529ec32831bb687425c284c910a089d975`. Bounded evidence is retained in `.test-runs/p010-artifact-boundary-20260908.json`. This diagnostic only constructed and read archive bytes; it extracted nothing and accessed no outside file. Source inspection confirms P009's separate installer rejects this link before extraction. No host access or full candidate-verification bypass is established.

## Impact and next steps

The outside-worker static check can accept an artifact that violates its release-containment rule and will fail the downstream installer. Reject both the exact parent target and parent-prefixed paths, retain supported internal dependency links, and add a focused hostile-archive regression. Independently inspect the correction and matching test evidence before archiving this bounded issue. P010's full verifier, application and Linux acceptance remain separate requirements.
