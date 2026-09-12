# Codex Harbor

A single-owner web interface and authenticated API for Codex, being built for compatible Linux VPS hosts. Implemented features include persistent conversations, scoped API tokens, managed parallel workspaces, file and Git editing, attachments, terminals, history/recovery, scheduling and private project previews. Portable deployment, isolated self-development and managed extensions are in development.

## Status

P001–P008 and P011 are Implemented. Their reports record independently reviewed browser/API, contract and Linux evidence on specific source revisions. The [installed module report](docs/reports/2026-09-08-installed-module-integration.md) covers file/terminal integration; the [scheduling report](docs/reports/2026-09-08-p008-development.md) covers scheduling and its qualified metadata recovery checks. The [preview report](docs/reports/2026-09-08-p011-development.md#main-acceptance--13-september-2026) records two review rounds, cumulative verification and Linux lifecycle acceptance. Mandatory verification and follow-ups remain open, so no proposal is marked finished. Use the [proposal index](design/proposals/README.md) for current delivery gates and the [developer workflow](docs/developer/development.md) for tested commands and limits.

The reviewed P009 deployment candidate is integrated with installation, preflight, maintenance and recovery tooling. Its [operator guide](docs/developer/deployment.md) and [evidence report](docs/reports/2026-09-08-p009-development.md) separate tested behavior from remaining later-module integration and blocked checkpoint/restore, promotion and live acceptance. P010 and P012 implementation continues in isolated worktrees.

## Start here

- [Design index](design/README.md): architecture, decisions, and feature proposals.
- [Proposal index](design/proposals/README.md): active feature outcomes, dependencies, verification gates, and the proposal archive.
- [Issue index](issues/README.md): active findings, pending work transferred to proposals, and the issue archive.
- [Developer workflow](docs/developer/development.md): local development, future VPS self-development, and testing requirements.
- [Documentation index](docs/README.md): documentation for available behavior and completed reports.
- [Repository instructions](AGENTS.md): document ownership, implementation, and independent review rules.

Designs and feature proposals belong in `design/`. User/developer documentation and reports belong in `docs/`. Findings and their archived history belong in `issues/`. Follow the [document lifecycle](AGENTS.md#document-ownership-and-lifecycle) when starting, closing, transferring, or reopening work.
