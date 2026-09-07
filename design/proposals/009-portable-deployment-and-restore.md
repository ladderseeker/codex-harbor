# P009 — Portable deployment and restore

- Decision: Draft
- Delivery: Planned
- Dependencies: [P001](001-secure-persistent-conversations.md), [P007](007-session-history-and-recovery.md)
- Outcome: The owner installs a working Harbor on a compatible Linux VPS, updates it deliberately, and recovers its data on a fresh compatible host.

## Scope and operator flow

Provide versioned images/artifacts, Compose configuration, prerequisite checks, HTTPS/owner setup, private service networks, startup supervision, health checks, backup/restore tooling, release manifests, and an out-of-band SSH recovery runbook. Use the same portable commands/configuration contract across providers. Hostinger is an example deployment, not a dependency.

Cover all delivered module state through a backup registry: PostgreSQL, native Codex state, project roots/worktrees, attachments if delivered, and required protected configuration. Later data-owning features extend the registry and restore assertions in their own changes. This feature does not depend on terminal/file-editor/scheduler UI. Unimplemented module entries are absent, not fake empty backups.

## Release and recovery contract

Separate editable source, immutable installed release, and persistent state. Record source/artifact digest, dependency/runtime/schema versions, configuration schema, backup manifest, and supported host capabilities. Bind internal services privately and expose only the authenticated gateway plus explicitly controlled administration. Validate real Linux sandbox/network requirements before accepting work.

Create consistent backups by quiescing relevant mutations or using a documented snapshot procedure; encrypt off-host copies and include integrity checks. Restore into a fresh namespace with execution admission disabled until validation finishes. Restore procedure covers secrets separately: no plaintext credential archive or accidental rotation that prevents recovery. Show the recovery point and possible lost writes.

Apply [migration/draining/rollback rules](../architecture.md#release-retention-and-rollback-rules). A compatible API-only release may switch traffic while the supervisor remains. Replacing a runtime generation drains or explicitly interrupts work; never run competing unfenced supervisors on the same state. An old binary is not a rollback when it cannot read the migrated database/native format. Follow existing user authorization for promotion; prepare exact tested artifacts before asking if new approval is required.

## Independent acceptance

Provision isolated Linux environments A and B using P001/P007 plus synthetic state for delivered modules. No real production database or owner projects are test fixtures.

1. **P009-01:** Install from the documented package on a fresh compatible host, authenticate, and complete a conversation through browser and API. Assert actual dependency/health readiness.
2. **P009-02:** Probe unauthenticated public routes and direct internal ports; attempt to start with missing sandbox prerequisites or fixture/public configuration. Assert denial/fail-closed startup.
3. **P009-03:** Reboot the isolated test host and verify service startup, preserved history, and honest interrupted/uncertain states with no automatic repeated turn.
4. **P009-04:** Back up A, verify integrity, restore into B, and exercise restored projects/history and delivered module state. Assert admission remains disabled until validation and no contact with A's runtime.
5. **P009-05:** Corrupt/incompletely copy a backup and simulate disk pressure. Assert a failed restore never replaces a healthy installation, with recovery instructions and bounded cleanup.
6. **P009-06:** Promote a tested compatible candidate, then exercise rollback; separately test a schema-incompatible downgrade. Assert the latter is refused or follows a deliberate documented restore/forward-repair path.
7. **P009-07:** Complete real pinned-Codex/account and Linux isolation checks on the deployed profile, and demonstrate administrative recovery with Harbor unavailable.

## Delivery and verification

Use planned build/check/E2E, contract/live, and isolation lanes. Host reboot/restore scenarios run only in explicitly disposable VMs/VPS fixtures identified in the manifest. Record provider-independent prerequisites and measured resource use, not an unsupported claim to run on every VPS or OS. Follow [shared evidence rules](README.md#shared-verification-contract).

Add usable installation, operations, update, backup, and recovery guides under `docs/` with tested commands. Release packaging must remain independently testable before P010 self-development exists. Missing fresh-host restore or real isolation evidence keeps this delivery unverified.
