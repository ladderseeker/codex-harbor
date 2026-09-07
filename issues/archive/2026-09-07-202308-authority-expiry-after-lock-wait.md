# Recheck credential expiry after acquiring authority locks

- Severity: High
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-07
- Owner: [P002](../../design/proposals/002-programmatic-api-access.md); [P003](../../design/proposals/003-parallel-project-workspaces.md) and [P007](../../design/proposals/007-session-history-and-recovery.md) own their resource/recovery-path integrations
- Recorded: 2026-09-07
- Affected files: packages/policy/src/authority.ts; browser/recovery authority queries using the same locking pattern
- Acceptance: P002-03/05; P003-05; P007-04/06 and inherited browser expiry/dispatch guarantees

## Evidence and reproduction

The main agent reproduced an expired PAT being accepted by the actual committed `requireAuthority` helper on source digest `2a14f17585b36d28ef9883e4e4f4c879db7175b90c97f75fd0dbe4ac5665f84e`, integrated in `fb6127a`. This was discovered after the two original P002 review rounds and does not change their historical results.

In a fresh PostgreSQL 17.6 fixture, create a synthetic token expiring in two seconds. Hold its row with `SELECT ... FOR UPDATE` on one connection, and call production `requireAuthority` on another connection. Wait 3.1 seconds, confirm `expires_at < clock_timestamp()` is true using the holding connection, then commit to release its lock. The waiting helper returned success:

```json
{"outcome":"accepted","expiredBeforeRelease":true,"elapsedMs":3106}
```

The expiry predicate uses `clock_timestamp()` in the locking query's `WHERE` clause. This reproduction shows that qualifying the row before waiting for `FOR SHARE` is insufficient to enforce expiry after the wait. The browser branch and P007's in-progress recovery query use the same pattern; their exact variants require regression coverage rather than inference from the PAT result alone.

The probe used Node 24.11.1, the actual policy module, a run-owned database/container, fresh synthetic credentials, and scoped cleanup. No normal owner state or account credential was used.

## Impact and correction

A delayed authority check can admit work after the credential's stated validity window. Keep P002 active and unverified. Acquire authority locks in a consistent order, then evaluate current identity, revocation, absolute/idle expiry and resource grants after all relevant waits. Preserve the distinction between proven pre-wire rejection and uncertain delivery so a denied new control does not poison already-authorized work.

Add real PostgreSQL lock-wait cases for token expiry and browser absolute/idle expiry, plus relevant final-dispatch/control scenarios and identity changes. Integrate the shared correction into P007 recovery and other affected new routes. The P002 implementer owns the focused fix; a separate agent must review it and its evidence. Record source identity, commands, environment, results, and remaining limitations before resolution and archival.

## Focused review follow-up

P002 review round 3 inspected the proposed correction at source digest `84cd8ec7f633217e4ee4aa2fd9bbeaf8d5550c34fe39739841b31ecbc6a4b35c` (808 files). The reviewer accepted the shared helper's lock-then-fresh-validation pattern and browser idle-touch logic, and identified three caller regressions for the same fix batch:

- Logout's generic post-callback check sees its own deliberate revocation and rolls the transaction back. Logout must commit that authorized revocation.
- Queued cancellation needs a fresh authority check after acquiring the target session lock, not only before waiting for it.
- The repeated pre-wire check must preserve cancellation's existing permission-profile rule: a token with cancellation authority can stop an already-running workspace-write turn even when the token's ceiling would prevent starting that turn.

These are unresolved review findings, not delivered corrections. The implementer accepted all three. Existing logout acceptance plus targeted queued-cancellation expiry and cross-profile cancellation scenarios must pass before the focused round closes.

## P002 correction evidence — 7 September 2026

The three caller corrections and shared helper are now implemented in feature commit `482f632`, source digest `9b01ead96025c7b47664911b76ed08496f245fa8b03d3640a6e52d6fa4e6672a` (808 files). Independent focused round 3 closed with no remaining actionable critical findings in that scope. The preceding paragraph records the initial review disposition; this is its subsequent correction evidence.

Check/build, nine integration tests, thirteen pinned-runtime contracts and full P001/P002 E2E passed in the feature worktree (Node 26.7.0, `harbor-e2e-cc7b466f60`) and integrated main source (Node 24.11.1, `harbor-e2e-402f47b9ab`). Both E2E artifacts have matching start/end source digests. The original fresh-PostgreSQL probe now rejects the expired token after the same lock wait: `{"outcome":"rejected","expiredBeforeRelease":true,"elapsedMs":3112}`. See the [corrective report](../../docs/reports/2026-09-07-p002-api-tokens.md#authority-correction-and-integration--7-september-2026).

This issue remains In progress for P007 recovery and P003 resource-lock integration. The corrected P002 baseline does not establish the combined feature behavior or waive dedicated live-account evidence.

P003 integration is now established by reviewed commit `ea8816f`, source `b012ef67ca4bc6cf35c190256f50504f53b6c32f4d3e4f1e77bdb50f35cdd972` (831 files), present on main. Node 24 combined P001/P002 and P003 E2E passed, including expiry while API and supervisor release commands wait for workspace locks, with the reservation preserved. Thirty contracts/integration/workspace tests and actual Linux checks also passed; a separate integration reviewer found no actionable issue. The [workspace report](../../docs/reports/2026-09-07-p003-workspaces.md) records the evidence. P007 remains the pending integration owner.

## Resolution — 7 September 2026

P002 policy/caller corrections, P003 resource checks and P007 recovery integration passed their mapped acceptance and separate reviews. Recovery locks current authority before project/workspace/session state and rechecks it after waits and before exact retirement/release. P002 completed focused review round 3; P003 and P007 each received separate integration review. The original expired-token probe rejects, as recorded above.

Reviewed integration `0118dfe`/`ca1a2cf` has source `2976f6286a9aea9645e2a27dfcb497e677c5268d5ff034593752dc98211b40bd` (842 files). Node 24.11.1 on macOS arm64 passed check/build, 9 integration tests, 15 pinned Codex 0.153.4 contracts and 8 workspace tests. Full real Harbor P001/P002/P007 E2E `harbor-e2e-10d1a7178a` and workspace E2E `harbor-workspaces-a5ce817a7b` exited 0 with identical start/end digests. Runs used PostgreSQL 17.6, Chromium 1194 and disposable external OIDC/Codex fixtures; cleanup affected only run-owned resources. Independent review accepted the unchanged native boundary's separate P003 Linux evidence.

The [integration report](../../docs/reports/2026-09-07-p007-history-integration.md) records exact checks and limitations. This resolves this finding, not its proposals: the [dedicated live-account gate](../2026-09-07-171225-live-runtime-credentials.md) and separately tracked gateway/deployment obligations remain open. Earlier sections preserve historical discovery and intermediate status.
