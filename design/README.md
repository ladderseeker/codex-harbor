# Harbor design

The architecture is the accepted implementation baseline. P014 completed the scoped frontend redesign; broader implementation and verification remain under way. The [proposal index](proposals/README.md) owns current feature status, dependencies, evidence and next actions. Decision (`Draft`, `Accepted`, `Superseded`) and delivery (`Planned`, `In progress`, `Implemented`, `Verified`) remain separate. Existing session authorization governs work; metadata does not create a universal approval gate.

- [Architecture](architecture.md): system boundaries, identity, runtime/data contracts, local development, verification, self-development, and releases.
- [Design tokens and UI guide](design-tokens.html): approved visual baseline, component rules, and workflow for extending the design consistently.
- [Interface prototype](prototypes/README.md): standalone monochrome reference for the approved design before application implementation.
- [D001 — Confined runtime egress](decisions/001-confined-runtime-egress.md): fixed gateway and isolated networks; Linux denials/connectivity passed, intermittent availability tracked.
- [D002 — Registered mount authority](decisions/002-registered-mount-authority.md): trusted ancestry, disjoint projects, and descriptor-relative operations; local/Linux checks passed.
- [D003 — Quota-backed project storage](decisions/003-quota-backed-project-storage.md): trusted XFS allocation, runner access, and persistent hard limits; actual Linux checks passed.
- [D004 — Protected runtime credentials](decisions/004-protected-runtime-credentials.md): supervisor-owned discovery and encrypted onboarding; fixture/cleanup checks passed, live-account gate pending.
- [D005 — Managed parallel workspaces](decisions/005-managed-project-workspaces.md): trusted Git/copy storage, workspace ownership and durable metadata operations; combined application/Linux checks passed, live-account gate pending.
- [D006 — Portable releases and a fenced host restore](decisions/006-portable-release-and-restore.md): accepted deployment/backup/restore design in progress; packaged installation and bounded administrator recovery passed, protected fresh-host restore remains pending in P009.
- [D007 — Separate project-preview origins and a confined runner connection](decisions/007-confined-project-preview-origins.md): implemented origin, browser-grant, fixed relay and reader-lease contract for P011; two review rounds and browser/Linux acceptance passed on the [recorded sources](../docs/reports/2026-09-08-p011-development.md), with protected restore and upstream gates pending.
- [D008 — Confined self-development workers](decisions/008-isolated-self-development-workers.md): accepted broker, container/guest boundary, independent verifier and exact-artifact contract for P010; implementation and Linux/performance evidence remain pending.
- [D009 — Common-use release before roadmap expansion](decisions/009-common-use-release.md): current delivery priority; finish and verify everyday workflows, preserve deferred P010/P012 work, then deliver one needed outcome at a time. Existing acceptance gates remain unchanged.
- [D010 — Personal local Codex experience](decisions/010-personal-local-experience.md): the owner's selected local account-login and conversation outcome, implemented under P013 with explicit native execution boundaries.
- [D011 — Personal VPS existing-project experience](decisions/011-personal-vps-workspace.md): selected P015 subscription/account and original-folder deployment with explicit native execution limits.
- [Active proposals](proposals/README.md): complete user outcomes, dependencies, acceptance criteria, and implementation status.
- [Proposal archive](proposals/archive/README.md): completed, superseded, or withdrawn proposals, including completed P014.
- [Proposal template](proposal-template.md): the required structure for a new or revised feature proposal.
- [Developer guide](../docs/developer/development.md): implemented commands, development workflow, and verification limits.
- [Issue index](../issues/README.md): active findings and pending proposal-owned work, with access to issue history.

The [repository document lifecycle](../AGENTS.md#document-ownership-and-lifecycle) owns status, completion, archive, transfer, and reopening rules. The architecture is the canonical system design; the linked decision records preserve significant implementation choices and later changes.

A feature can depend on earlier accepted capabilities, but must be exercisable and verifiable in a fresh isolated environment without waiting for a future feature. Split proposals by complete outcomes, not frontend/backend layers or arbitrary size. Do not mark a feature complete from mock-only tests, a design review, or a successful build alone.
