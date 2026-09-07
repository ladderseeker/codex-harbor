# Worker creation can follow expiry during preparation

- Severity: Medium
- Status: In progress
- Owner: P010 implementer; independent lifecycle review
- Affected files: `infra/self/worker.py`, worker lifetime contracts
- Acceptance: [P010-05](../design/proposals/010-self-development.md#independent-acceptance), absolute lifetime in [D008](../design/decisions/008-isolated-self-development-workers.md)

## Evidence — 8 September 2026

Checkpoint `0e2ef4638967f8ce8172d4d42944ed4f6fdd06b1` correctly binds the fresh verification worker to its retired build and inherits the original deadline. Its `open_worker` checks that deadline before preparation, but after `seed` it selects main container creation and start without rechecking elapsed lifetime. Readiness subsequently rejects the expired worker and records uncertainty; a new worker has already been selected for startup.

Main reproduced this control flow on exact worker SHA-256 `5bb81bf519ae4a86802ef3a6b794e723cde01661147ccc294147d20137d39605`. A synthetic parent expires at 1001; the intercepted seed advances the clock from 1000 to 1002. The observed effects are container creation and Docker start selection at 1002, followed by an uncertain receipt retaining deadline 1001. Receipt storage, preparation, argument construction and every process boundary were intercepted. No Docker, network, real privilege or application execution occurred; this is a source-boundary finding.

The exact source-only driver/result are retained in `.test-runs/p010-start-deadline-repro-20260908.py` and `p010-start-deadline-20260908.json`. Its initial harness attempt failed a trusted-directory check before reaching the tested boundary; that limitation and the explicit synthetic-storage correction are recorded. The two existing lifetime/diagnostic contracts independently pass at this checkpoint, but do not cover expiry during preparation.

## Impact and next steps

Preparation can consume the remaining job lifetime before the next worker starts, weakening the fixed two-hour resource limit. Bound preparation by the remaining lifetime and check expiry before new creation/start effects, while retaining uncertain resources until exact retirement is confirmed. Cover this transition and independently review the correction, then record committed integration and the relevant actual Linux lifecycle evidence. Keep the separately corrected [relay deadline](2026-09-08-061531-p010-relay-deadline.md) finding distinct.
