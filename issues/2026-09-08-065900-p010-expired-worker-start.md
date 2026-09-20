# Worker creation can follow expiry during preparation

- Severity: Medium; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: Medium
- Status: In progress
- Owner: P010 implementer; independent lifecycle review

Complete deferred outcome and acceptance are tracked in [2026-09-20-000003-self-development-acceptance.md](2026-09-20-000003-self-development-acceptance.md); this record retains its individual finding and correction evidence.

- Affected files: `infra/self/worker.py`, worker lifetime contracts
- Acceptance: [P010-05](../design/proposals/archive/010-self-development.md#independent-acceptance), absolute lifetime in [D008](../design/decisions/008-isolated-self-development-workers.md)

## Evidence — 8 September 2026

Checkpoint `0e2ef4638967f8ce8172d4d42944ed4f6fdd06b1` correctly binds the fresh verification worker to its retired build and inherits the original deadline. Its `open_worker` checks that deadline before preparation, but after `seed` it selects main container creation and start without rechecking elapsed lifetime. Readiness subsequently rejects the expired worker and records uncertainty; a new worker has already been selected for startup.

Main reproduced this control flow on exact worker SHA-256 `5bb81bf519ae4a86802ef3a6b794e723cde01661147ccc294147d20137d39605`. A synthetic parent expires at 1001; the intercepted seed advances the clock from 1000 to 1002. The observed effects are container creation and Docker start selection at 1002, followed by an uncertain receipt retaining deadline 1001. Receipt storage, preparation, argument construction and every process boundary were intercepted. No Docker, network, real privilege or application execution occurred; this is a source-boundary finding.

The exact source-only driver/result are retained in `.test-runs/p010-start-deadline-repro-20260908.py` and `p010-start-deadline-20260908.json`. Its initial harness attempt failed a trusted-directory check before reaching the tested boundary; that limitation and the explicit synthetic-storage correction are recorded. The two existing lifetime/diagnostic contracts independently pass at this checkpoint, but do not cover expiry during preparation.

## Impact and next steps

Preparation can consume the remaining job lifetime before the next worker starts, weakening the fixed two-hour resource limit. The correction below bounds preparation and rejects later start effects while retaining uncertain resources. Complete root integration and the relevant actual Linux lifecycle evidence before archiving. Keep the separately corrected [relay deadline](2026-09-08-061531-p010-relay-deadline.md) finding distinct.

## Correction and bounded review — 8 September 2026

Isolated checkpoint `a51a4bc53568b645a22ded694dcdd6992f3f2c78` refreshes remaining lifetime after waits and before seed/main creation or start. Key generation, seed polling and Docker create/inspect/start receive bounded remaining time. Expiry or an ambiguous effect preserves its durable journal for exact retirement; it does not replay or release ownership.

Main independently ran `python3 -B -m unittest discover -s tests/self -p '*_test.py'` against a separate exact-source copy on macOS ARM64/Python 3.9: all 28 tests passed. The new transition test covers expiry during seed (no create or start) and during creation (no later start), retaining uncertainty. A separate reviewer inspected the exact correction and closed this bounded source/test review with no actionable finding. Source hashes and results are retained in `.test-runs/p010-start-deadline-fix-20260908.json`. These tests intercept control/storage/process boundaries; they do not establish actual Linux worker retirement or complete P010 acceptance. The issue remains In progress pending those gates and root integration.
