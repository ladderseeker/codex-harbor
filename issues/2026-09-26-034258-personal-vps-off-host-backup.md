# Harbor makes no off-host backup of the personal VPS

- Severity: Medium; unless a copy exists outside Harbor, losing or damaging the host would lose all conversation history and Harbor state.
- Owner: Inbox; awaiting owner selection. No proposal covers it.
- Status: Open; from documentation and source inspection. Whether the hosting provider or the owner keeps host-level snapshots was not checked; such snapshots would not be verified, consistent Harbor restores.
- Recorded: 26 September 2026.
- Related: [project review](../docs/reports/2026-09-25-project-review.md#shutdown-and-deploy-safety), [GitHub Actions deployment limits](../docs/developer/github-actions-deploy.md#limits), and the [P009 backup transfer issue](2026-09-07-231526-p009-backup-transfer-approval.md), which concerns the managed profile only.

The owner's personal VPS instance is the only deployed Harbor. Each promotion through [deploy-release](../infra/personal-vps/deploy-release) writes a private checkpoint under `/var/lib/harbor-personal-backups/` on the same host: a PostgreSQL dump, instance configuration, units and drop-ins, the AppArmor profile and private state except the PostgreSQL data directory. The [personal VPS guide](../docs/developer/personal-vps.md#use-and-recover) says that its installer promises no verified off-host backup, and the [deploy guide](../docs/developer/github-actions-deploy.md#limits) says that checkpoints are same-host copies. No design, proposal or script copies them elsewhere, and the managed profile's backup tooling does not apply to this profile.

Impact: unless the provider or the owner keeps a host-level copy, losing the VPS or its disk would lose every conversation, attachment and setting, and a failed migration could be recovered only from a checkpoint on the same host. The owner's project folders are outside Harbor's state and are not in these checkpoints either.

A correction needs a destination the owner controls, encryption of the database dump and private state, a schedule or a trigger tied to promotion, retention, and a tested restore to a fresh host. Copying credentials or private state off the host needs the owner's explicit decision.

Recheck: once a backup design is selected and implemented, restore the latest off-host copy onto a fresh Linux host and confirm that conversations, attachments and settings match the source instance.
