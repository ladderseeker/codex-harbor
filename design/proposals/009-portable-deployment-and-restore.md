# P009 — Portable deployment and restore

- Decision: Accepted
- Delivery: Planned
- Dependencies: [P001](001-secure-persistent-conversations.md), [P007](007-session-history-and-recovery.md)
- Outcome: The owner installs a working Harbor on a compatible Linux VPS, updates it deliberately, and recovers its data on a fresh compatible host.

## Scope and operator flow

Provide versioned images/artifacts, Compose configuration, prerequisite checks, HTTPS/owner setup, private service networks, startup supervision, health checks, backup/restore tooling, release manifests, and an out-of-band SSH recovery runbook. Use the same portable commands/configuration contract across providers. Hostinger is an example deployment, not a dependency.

Cover all delivered module state through a backup registry: PostgreSQL, native Codex state, project roots/worktrees, attachments if delivered, and required protected configuration. Later data-owning features extend the registry and restore assertions in their own changes. This feature does not depend on terminal/file-editor/scheduler UI. Unimplemented module entries are absent, not fake empty backups.

## Source issues

- [Codex runtime compatibility finding](../../issues/archive/2026-09-07-073831-codex-runtime-compatibility.md): Medium severity; transferred on 2026-09-07, not resolved. P009 owns target-host kernel/container prerequisites, deployed account/runtime capabilities, real isolation, and release/restore readiness. These map to **P009-01/02/04/06/07**, the [Release and recovery contract](#release-and-recovery-contract), and [Delivery and verification](#delivery-and-verification).
- Evidence is pending. Publish supported, unsupported, and experimental capabilities for the delivered deployment profile with measured prerequisites, versions, limitations, and tested rollback/restore compatibility. Re-run applicable runtime and isolation checks before upgrades under the [architecture's compatibility boundary](../architecture.md#official-foundation-and-compatibility-boundary) and [release rules](../architecture.md#release-retention-and-rollback-rules); later delivered features extend this evidence through their own acceptance.
- [P001](001-secure-persistent-conversations.md#source-issues) owns the local runtime/Linux baseline. Its evidence does not replace the target-host checks. Missing P009 evidence blocks this proposal's verification and deployment-readiness claims. Update the source issue's P009 evidence when verified; resolve the transfer only after both owners' mapped obligations pass.
- [Linux gateway availability](../../issues/2026-09-07-185228-linux-gateway-availability.md): Medium, active and Open. A second disposable VM reproduced aggregate DNS failures and a reset before TLS establishment in five of twenty unauthenticated probes; the other fifteen returned the expected 401. P009-02/07 must measure the target host's approved-endpoint connectivity while preserving routing/TLS/address-denial policy. The [diagnostic report](../../docs/reports/2026-09-07-gateway-transport-diagnostic.md) records the observed stages and unresolved network cause; this is an active ownership link, not archival transfer or resolution.
- [Unregistered project allocation](../../issues/2026-09-07-205511-unregistered-project-allocation.md): Medium, active and Open. Source inspection identifies a filesystem/database commit gap in initial project creation; runtime reproduction is pending. P009-01/04/05 and D006 preflight/backup registry own detection, explicit validated reconciliation, unrelated-data preservation and complete inventory evidence. P003's derived-workspace receipts do not close this finding.

## Release and recovery contract

[D006 — Portable releases and a fenced host restore](../decisions/006-portable-release-and-restore.md) owns the accepted packaging, service privilege, backup consistency/encryption, module registry, destination rebinding and administrator-operation decisions. Implement that contract with the [architecture's migration/draining/rollback rules](../architecture.md#release-retention-and-rollback-rules). The initial profile retains a trusted root supervisor and separate root storage service, with an unprivileged API and private dependencies; installer packaging must not claim a privilege separation absent from the launcher implementation.

P009 delivers the complete operator outcome using D006's immutable packages and pinned Restic checkpoint. Restoration uses a new disabled instance, explicit authority revocation, credential re-encryption and validated filesystem rebinding before activation. Installed module registry coverage includes P002 and incoming P003/P007/P005 when delivered; adding those entries does not make undelivered modules dependencies. Show the recovery point, uncertain work and possible lost writes. The accepted design amendment is In progress; P009 implementation remains Planned and the proposed administrator commands are unavailable until implemented and tested.

## Independent acceptance

Provision isolated Linux environments A and B using P001/P007 plus synthetic state for delivered modules. No real production database or owner projects are test fixtures.

1. **P009-01:** Install from the documented package on a fresh compatible host, authenticate, and complete a conversation through browser and API. Assert actual dependency/health readiness.
2. **P009-02:** Probe unauthenticated public routes and direct internal ports; attempt to start with missing sandbox prerequisites or fixture/public configuration. Assert denial/fail-closed startup.
3. **P009-03:** Reboot the isolated test host and verify service startup, preserved history, and honest interrupted/uncertain states with no automatic repeated turn.
4. **P009-04:** Back up A, verify full data integrity and registry coverage, restore into B with changed filesystem identities, and exercise restored projects/history and delivered module state. Assert old cookies/PATs and receipt retries are denied, model ciphertext is rebound safely, uncertainty remains explicit, and admission stays disabled until validation with no contact with A's runtime.
5. **P009-05:** Corrupt/incompletely copy a backup, omit a required module or decryption key, interrupt restore, and simulate disk pressure. Assert explicit failure never replaces a healthy installation or enables execution, with recovery instructions and bounded owned cleanup.
6. **P009-06:** Promote a tested compatible candidate, then exercise rollback; separately test a schema-incompatible downgrade. Assert the latter is refused or follows a deliberate documented restore/forward-repair path.
7. **P009-07:** Complete real pinned-Codex/account and Linux isolation checks on the deployed profile, and demonstrate administrative recovery with Harbor unavailable.

## Delivery and verification

Use planned build/check/E2E, contract/live, and isolation lanes. Host reboot/restore scenarios run only in explicitly disposable VMs/VPS fixtures identified in the manifest. Record provider-independent prerequisites and measured resource use, not an unsupported claim to run on every VPS or OS. Follow [shared evidence rules](README.md#shared-verification-contract).

Add usable installation, operations, update, backup, and recovery guides under `docs/` with tested commands. Release packaging must remain independently testable before P010 self-development exists. Missing fresh-host restore or real isolation evidence keeps this delivery unverified.
