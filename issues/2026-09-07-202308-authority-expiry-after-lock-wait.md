# Recheck credential expiry after acquiring authority locks

- Severity: High
- Status: In progress
- Owner: [P002](../design/proposals/002-programmatic-api-access.md); [P007](../design/proposals/007-session-history-and-recovery.md) owns its recovery-path integration
- Recorded: 2026-09-07
- Affected files: packages/policy/src/authority.ts; browser/recovery authority queries using the same locking pattern
- Acceptance: P002-03/05; P007-04/06 and inherited browser expiry/dispatch guarantees

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
