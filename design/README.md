# Harbor design

The architecture is the implementation baseline; P001–P003/P005/P007 are Accepted and Implemented, with verification/follow-ups still open. P004/P006/P009 are Accepted and In progress. P008 is Accepted and Planned after independent design review. No proposal is finished. Decision (`Draft`, `Accepted`, `Superseded`) and delivery (`Planned`, `In progress`, `Implemented`, `Verified`) are separate states, tracked in the proposal index. Existing session authorization governs work; metadata does not create a universal approval gate.

- [Architecture](architecture.md): system boundaries, identity, runtime/data contracts, local development, verification, self-development, and releases.
- [D001 — Confined runtime egress](decisions/001-confined-runtime-egress.md): fixed gateway and isolated networks; Linux denials/connectivity passed, intermittent availability tracked.
- [D002 — Registered mount authority](decisions/002-registered-mount-authority.md): trusted ancestry, disjoint projects, and descriptor-relative operations; local/Linux checks passed.
- [D003 — Quota-backed project storage](decisions/003-quota-backed-project-storage.md): trusted XFS allocation, runner access, and persistent hard limits; actual Linux checks passed.
- [D004 — Protected runtime credentials](decisions/004-protected-runtime-credentials.md): supervisor-owned discovery and encrypted onboarding; fixture/cleanup checks passed, live-account gate pending.
- [D005 — Managed parallel workspaces](decisions/005-managed-project-workspaces.md): trusted Git/copy storage, workspace ownership and durable metadata operations; combined application/Linux checks passed, live-account gate pending.
- [D006 — Portable releases and a fenced host restore](decisions/006-portable-release-and-restore.md): accepted deployment/backup/restore design in progress; packaging commands and fresh-host evidence remain pending in P009.
- [Active proposals](proposals/README.md): complete user outcomes, dependencies, acceptance criteria, and implementation status.
- [Proposal archive](proposals/archive/README.md): completed, superseded, or withdrawn proposals; currently empty.
- [Proposal template](proposal-template.md): the required structure for a new or revised feature proposal.
- [Developer guide](../docs/developer/development.md): implemented commands, development workflow, and verification limits.
- [Issue index](../issues/README.md): active findings and pending proposal-owned work, with access to issue history.

The [repository document lifecycle](../AGENTS.md#document-ownership-and-lifecycle) owns status, completion, archive, transfer, and reopening rules. The architecture is the canonical system design; the linked decision records preserve significant implementation choices and later changes.

A feature can depend on earlier accepted capabilities, but must be exercisable and verifiable in a fresh isolated environment without waiting for a future feature. Split proposals by complete outcomes, not frontend/backend layers or arbitrary size. Do not mark a feature complete from mock-only tests, a design review, or a successful build alone.
