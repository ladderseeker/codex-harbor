# Detect and reconcile allocated project slots without database registration

- Severity: Medium
- Status: In progress
- Owner: [P009](../design/proposals/009-portable-deployment-and-restore.md), deployment readiness and backup consistency
- Recorded: 2026-09-07
- Affected files: apps/api/src/server.ts; packages/storage/src/index.ts; infra/storage/quota.py
- Acceptance: P009-01/04/05; trusted storage preflight and complete backup registry

## Source evidence

Source inspection at `fb6127a` shows `/api/v1/projects` calls `createManagedProject` inside the generic SQL command transaction. The trusted allocator renames a quota-backed pool slot into the requested project location before the API inserts its project/workspace rows and commits the idempotent result. The SQL transaction helper cannot reverse that filesystem rename if a later database statement or final commit fails.

This identified a potential allocated-but-unregistered slot after a failed database transaction. At the initial source review it had not been reproduced through the running API or actual XFS allocator. The later installed reproduction below establishes a known rolled-back transaction; an ambiguous connection loss where commit may have succeeded remains a distinct case.

The allocator rejects a subsequent `create: true` request when the target already exists. Explicit `create: false` registration can validate and register an existing managed slot, but there is no delivered inventory/reconciliation workflow connecting an unregistered slot to the interrupted request. The P002 authority fix preserves a granted external effect across credential expiry; it does not make the SQL/filesystem boundary atomic. P003's durable derived-workspace operations do not retrofit initial project creation.

## Impact and next steps

An unregistered slot consumes project quota capacity and may be omitted by a database-driven backup inventory. Preserve its files and provenance. P009 must compare the trusted allocated-slot inventory with database registrations before declaring storage readiness or a complete backup checkpoint, and expose bounded reconciliation or a clear blocked result. Never delete, auto-adopt, or replay an unknown filesystem identity solely because its name matches an interrupted request.

Provide an explicit trusted recovery path that validates identity, quota, ownership, absence of active work, and conflicting registration before adoption. A later project-allocation receipt may provide stronger automatic reconciliation, but any such implementation needs a recorded design and failure evidence. Exercise transaction failure, exact retry, unrelated-slot preservation, inventory completeness, and bounded cleanup in disposable fixtures. Record the tested source and independent review before resolving and archiving this issue.

## Installed reproduction — 8 September 2026

`tests/deployment/allocation-loss.ts` in the P009 worktree exercised immutable artifact `f7490e28eec65a338e920aff83f944a45af986643dfa544991a528cff5d17ecd` in the fresh installed `deploy-c97498fe` instance on the owned Ubuntu 24.04 arm64 VM. It used the actual Harbor API, PostgreSQL and trusted XFS allocator; only external OIDC identity was a fixture. A deferred PostgreSQL COMMIT failure occurred after quota-slot publication. The directory remained without a project row, and the same create-key retry failed explicitly rather than replacing it. A fresh owner request through the supported existing-project registration path recovered project `0eb7c1e9-af22-4108-bcb9-768931e59d44` with the original device/inode identity unchanged.

The executed result was printed in the tool transcript; no standalone result JSON was written by that test. The [deployment report](../docs/reports/2026-09-08-p009-development.md), installed package and recovered project retain the supporting evidence. Checkpoint inventory now refuses unregistered managed directories before transfer. Independent review of this issue's complete correction and inventory obligations remains pending even though two related implementation review rounds closed; no protected backup was transferred. This is intermediate correction evidence, not issue resolution or complete P009 acceptance.
