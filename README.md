# Codex Harbor

A single-owner web interface and authenticated API for Codex, being built for compatible Linux VPS hosts. The first conversation workflow runs locally; the roadmap includes parallel workspaces, scheduled tasks, terminals, files, and attachments.

## Status

P001 is Implemented. Its deterministic browser/API E2E and actual Linux/XFS isolation passed, and four review rounds closed the critical findings. Required live-account evidence and medium follow-ups remain open, so no proposal is marked finished. See the [foundation report](docs/reports/2026-09-07-p001-foundation.md) and [developer workflow](docs/developer/development.md) for tested commands and limits.

## Start here

- [Design index](design/README.md): architecture, decisions, and feature proposals.
- [Proposal index](design/proposals/README.md): active feature outcomes, dependencies, verification gates, and the proposal archive.
- [Issue index](issues/README.md): active findings, pending work transferred to proposals, and the issue archive.
- [Developer workflow](docs/developer/development.md): local development, future VPS self-development, and testing requirements.
- [Documentation index](docs/README.md): documentation for available behavior and completed reports.
- [Repository instructions](AGENTS.md): document ownership, implementation, and independent review rules.

Designs and feature proposals belong in `design/`. User/developer documentation and reports belong in `docs/`. Findings and their archived history belong in `issues/`. Follow the [document lifecycle](AGENTS.md#document-ownership-and-lifecycle) when starting, closing, transferring, or reopening work.
