# P009 — Portable deployment and restore

- Decision: Accepted
- Delivery: In progress
- Dependencies: [P001](001-secure-persistent-conversations.md), [P007](007-session-history-and-recovery.md)
- Outcome: The owner installs a working Harbor on a compatible Linux VPS, updates it deliberately, and recovers its data on a fresh compatible host.

## Scope and operator flow

Provide versioned images/artifacts, Compose configuration, prerequisite checks, HTTPS/owner setup, private service networks, startup supervision, health checks, backup/restore tooling, release manifests, and an out-of-band SSH recovery runbook. Use the same portable commands/configuration contract across providers. Hostinger is an example deployment, not a dependency.

Cover all delivered module state through a backup registry: PostgreSQL, native Codex state, project roots/worktrees, attachments if delivered, and required protected configuration. Later data-owning features extend the registry and restore assertions in their own changes. This feature does not depend on terminal/file-editor/scheduler UI. Unimplemented module entries are absent, not fake empty backups.

## Source issues

- [P009 implementation review](../../issues/2026-09-08-005028-p009-implementation-review.md): High, In progress. Two review rounds closed the integrated baseline's command/consistency/preservation corrections on source `b6599ab3…7a4289`. P009 still owns separate restored-host backup destination enrollment and available administrator recovery/inventory checks; local evidence does not replace the blocked protected transfer/live gates.

- [Codex runtime compatibility finding](../../issues/archive/2026-09-07-073831-codex-runtime-compatibility.md): Medium severity; transferred on 2026-09-07, not resolved. P009 owns target-host kernel/container prerequisites, deployed account/runtime capabilities, real isolation, and release/restore readiness. These map to **P009-01/02/04/06/07**, the [Release and recovery contract](#release-and-recovery-contract), and [Delivery and verification](#delivery-and-verification).
- Evidence is partial. The [deployment report](../../docs/reports/2026-09-08-p009-development.md) records installed service/UID/reboot and account-free native confinement checks on identified artifacts. Full deployed conversation history, live-account, checkpoint/restore and release gates remain pending. Publish supported, unsupported, and experimental capabilities with measured prerequisites, versions, limitations, and tested rollback/restore compatibility. Re-run applicable checks before upgrades under the [architecture's compatibility boundary](../architecture.md#official-foundation-and-compatibility-boundary) and [release rules](../architecture.md#release-retention-and-rollback-rules); later delivered features extend this evidence through their own acceptance.
- [P001](001-secure-persistent-conversations.md#source-issues) owns the local runtime/Linux baseline. Its evidence does not replace the target-host checks. Missing P009 evidence blocks this proposal's verification and deployment-readiness claims. Update the source issue's P009 evidence when verified; resolve the transfer only after both owners' mapped obligations pass.
- [Linux gateway availability](../../issues/2026-09-07-185228-linux-gateway-availability.md): Medium, active and Open. A second disposable VM reproduced aggregate DNS failures and a reset before TLS establishment in five of twenty unauthenticated probes; the other fifteen returned the expected 401. P009-02/07 must measure the target host's approved-endpoint connectivity while preserving routing/TLS/address-denial policy. The [diagnostic report](../../docs/reports/2026-09-07-gateway-transport-diagnostic.md) records the observed stages and unresolved network cause; this is an active ownership link, not archival transfer or resolution.
- [Unregistered project allocation](../../issues/2026-09-07-205511-unregistered-project-allocation.md): Medium, active and In progress. A real installed API/PostgreSQL/XFS deferred COMMIT failure reproduced the gap; explicit existing-project recovery preserved the exact original identity. P009-01/04/05 and D006 preflight/backup registry retain detection, validated reconciliation, unrelated-data preservation and complete inventory acceptance pending independent review. P003's derived-workspace receipts do not close this finding.
- [Backup transfer authorization](../../issues/2026-09-07-231526-p009-backup-transfer-approval.md): High, active and Blocked. Automatic approval review rejected the generated private-state/secret payload transfer from disposable A to the owned B SFTP repository. P009-04/05 and checkpoint-dependent P009-06 require exact user authorization followed by actual encrypted backup/restore evidence. Continue available implementation/review and other checks; no local/redacted fixture closes this gate.

## Release and recovery contract

[D006 — Portable releases and a fenced host restore](../decisions/006-portable-release-and-restore.md) owns the accepted packaging, service privilege, backup consistency/encryption, module registry, destination rebinding and administrator-operation decisions. Implement that contract with the [architecture's migration/draining/rollback rules](../architecture.md#release-retention-and-rollback-rules). The initial profile retains a trusted root supervisor and separate root storage service, with an unprivileged API and private dependencies; installer packaging must not claim a privilege separation absent from the launcher implementation.

P009 delivers the complete operator outcome using D006's immutable packages and pinned Restic checkpoint. Restoration uses a new disabled instance, explicit authority revocation, credential re-encryption and validated filesystem rebinding before activation. Installed module registry coverage includes P002 and delivered P003/P007/P005; adding those entries does not make undelivered modules dependencies. Show the recovery point, uncertain work and possible lost writes. Implementation is In progress; the [operator guide](../../docs/developer/deployment.md) identifies available commands and their tested limits. Independent destination enrollment, remaining administrator acceptance and blocked restore/live gates prevent completion.

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

## Implementation record

- 2026-09-07: Started isolated implementation from the integrated P001–P003 baseline `d4f9e96`, under the owner's roadmap authorization. Incorporate the reviewed P007 integration and delivered attachment module before final registry/restore checks. Disposable Linux A/B prerequisite setup and the pinned Restic download are preparation, not completed P009 acceptance. Migration 009 is reserved for this feature.

- 2026-09-07 development checkpoint: a fresh production-mode package using the delivered P005/P007 schema started root storage/supervisor, an unprivileged API and private Unix-socket PostgreSQL. Actual HTTPS owner login and API project creation passed on the dedicated Linux/XFS fixture; unrelated/runner UIDs were denied private sockets, API could not read model keys/projects or replace socket entries, and incorrect SCRAM authentication failed. The installed runtime artifact was `f7490e28eec65a338e920aff83f944a45af986643dfa544991a528cff5d17ecd`; a subsequent administrator-only cold-start readiness correction was used for incomplete-install recovery. This is partial evidence, not a final immutable candidate or complete P009 acceptance. Restore/promotion implementation, independent review and mandatory live/transfer gates remain outstanding.

- 2026-09-08 reviewed feature handoff: two independent review rounds closed after six High corrections and the registry/real-Restic metadata correction. Source `b6599ab31a6b4690b54a9bd0632f3c668e98ebb88b2905f1f7f82066327a4289` /893 passed Node 24 `pnpm check` and full critical E2E `harbor-e2e-d47ae72678` with matching start/end source. Seventeen local Python contracts and the isolated public Restic 0.19.1 CLI metadata contract passed. See the [development report](../../docs/reports/2026-09-08-p009-development.md) for exact historical installed artifacts, review scope and limitations. Delivery stays In progress: the protected transfer, fresh-host restore/promotion and dedicated live-account gates remain unverified; no blocked action was retried.
