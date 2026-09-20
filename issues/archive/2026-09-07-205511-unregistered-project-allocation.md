# Detect and reconcile allocated project slots without database registration

- Severity: Medium
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-08
- Owner: [P009](../../design/proposals/archive/009-portable-deployment-and-restore.md), deployment readiness and backup consistency
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

The executed result was printed in the tool transcript; no standalone result JSON was written by that test. The [deployment report](../../docs/reports/2026-09-08-p009-development.md), installed package and recovered project retain the supporting evidence. Checkpoint inventory now refuses unregistered managed directories before transfer. Independent review of this issue's complete correction and inventory obligations remained pending at that checkpoint even though two related implementation review rounds had closed; no protected backup was transferred. This is intermediate correction evidence, not complete P009 acceptance.

## Resolution — 8 September 2026

The final inventory/reconciliation test ran against immutable installed artifact `6dd02dba8efa54179667afef6e48c2623986d32a76e1bed68ea8cae4355b9dc8` in disposable `deploy-29946354`, on Ubuntu 24.04 arm64, Node 24.11.1, PostgreSQL 17.6 and quota-backed XFS. `tests/deployment/allocation-loss.ts` uses the real owner-authenticated API, a deferred PostgreSQL COMMIT fault, the trusted allocator and the **installed** `harborctl inventory` command. Only external OIDC identity is a fixture.

The orphan remains on disk and is reported with its explicit registration path. Repeating the original create request fails without replacing the directory. A new, deliberate existing-project registration recovers project `8765cc85-2c64-4acf-900c-97f763d36414` with its original device/inode, and that registered entry disappears from the unregistered inventory. The retained result is `.test-runs/p009-allocation-inventory-linux.json` in the P009 worktree, copied from the installed fixture's `allocation-loss-result.json`; unlike the earlier checkpoint, this run wrote its result directly.

The complementary actual Linux publication lane on source `2ae952b318729bbb08525635a0ae4a04e21d2fe91cd38fdbf2cb33b045285c1f` preserved an unknown pool-slot sentinel and another untouched slot through owned publication failure/recovery. The separate reviewer inspected the final inventory test and retained result together with that preservation evidence, and closed this issue's bounded detection/reconciliation obligations in one focused closure review following the two P009 baseline rounds. The reviewed inventory assertions are retained in the repository test.

Initial project allocation remains non-atomic across SQL and the filesystem; resolution provides detection, blocked completeness claims and deliberate identity-checked recovery, not automatic adoption or rollback. Complete protected backup/restore, later module inventories and release/live gates remain separately owned by P009. No protected transfer, source-host fencing or fresh-host restore is inferred from this issue's closure.

## Ownership navigation — 20 September 2026

The disposition and evidence above are historical. Retired proposal references identify feature lineage; any unfinished inherited acceptance is retained in the [active inbox](../) and the [current subsystem designs](../../design/systems/). The P017 baseline migration did not resolve another finding or rerun this record’s checks.
