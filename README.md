# Codex Harbor

A single-owner web interface and authenticated API for Codex, being built for compatible Linux VPS hosts. Persistent conversations, scoped API tokens, managed parallel workspaces, attachments and history/recovery run locally. File editing, terminal access and portable deployment are in development.

## Status

P001–P003, P005 and P007 are Implemented. The foundation, token controls, workspace lifecycle and recovery passed their recorded browser/API and contract checks, including combined Node 24 integration. Runtime isolation has separately recorded Linux evidence. Required live-account evidence and follow-ups remain open, so no proposal is marked finished. See the [foundation report](docs/reports/2026-09-07-p001-foundation.md), [API-token report](docs/reports/2026-09-07-p002-api-tokens.md), [workspace report](docs/reports/2026-09-07-p003-workspaces.md), [history/recovery report](docs/reports/2026-09-07-p007-history-integration.md), [attachment integration report](docs/reports/2026-09-07-p005-integration.md), and [developer workflow](docs/developer/development.md) for tested commands and limits.

The reviewed P009 deployment candidate is integrated with installation, preflight, maintenance and recovery tooling. Its [operator guide](docs/developer/deployment.md) and [evidence report](docs/reports/2026-09-08-p009-development.md) separate tested behavior from remaining destination enrollment, administrator checks and blocked backup/restore/live acceptance. Scheduling and isolated self-development are also in progress; use the proposal index for current ownership.

## Start here

- [Design index](design/README.md): architecture, decisions, and feature proposals.
- [Proposal index](design/proposals/README.md): active feature outcomes, dependencies, verification gates, and the proposal archive.
- [Issue index](issues/README.md): active findings, pending work transferred to proposals, and the issue archive.
- [Developer workflow](docs/developer/development.md): local development, future VPS self-development, and testing requirements.
- [Documentation index](docs/README.md): documentation for available behavior and completed reports.
- [Repository instructions](AGENTS.md): document ownership, implementation, and independent review rules.

Designs and feature proposals belong in `design/`. User/developer documentation and reports belong in `docs/`. Findings and their archived history belong in `issues/`. Follow the [document lifecycle](AGENTS.md#document-ownership-and-lifecycle) when starting, closing, transferring, or reopening work.
