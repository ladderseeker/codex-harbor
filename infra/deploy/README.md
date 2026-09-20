# Deployment implementation

## Design and evidence ownership — 20 September 2026

[Current subsystem designs](../../design/systems/) own behavior and limits; the [issue inbox](../../issues/) owns unfinished acceptance. Historical proposal IDs below identify feature lineage and evidence, not active execution. Future changes follow a newly selected proposal under the [workflow](../../design/workflow.md); baseline reconciliation did not rerun application gates.

The deployment implementation provides the fixed administrator profile in D006. The Python administrator modules own installation, services and filesystem publication; the packaged TypeScript bridge owns database-aware validation and state transitions. Neither interface accepts project commands or executable restore hooks. Complete installed release/restore acceptance remains unverified in the inbox.
