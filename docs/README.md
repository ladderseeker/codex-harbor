# Documentation

This directory describes available behavior, developer workflows, and completed reports. P001–P003 are Implemented with required verification/follow-ups still open; the proposal index distinguishes current evidence from finished delivery.

- [Developer workflow](developer/development.md): working on the repository now, command availability, and verification requirements.
- [Linux execution verification](developer/linux-verification.md): dedicated XFS storage, real runner checks, and scoped cleanup.
- [Programmatic API](developer/programmatic-api.md): bearer authentication, current scopes, streaming, and safe retries.
- [User guides](user/README.md): available conversation and account controls, with current verification limits.
- [Design index](../design/README.md): the target architecture, feature proposals, and acceptance criteria.
- [Repository instructions](../AGENTS.md): document ownership, implementation rules, and independent review.
- [Issue index](../issues/README.md): active findings, work transferred to proposals, and archived records.
- [Expanded design review](reports/2026-09-07-design-review.md): completed independent review rounds, documentation checks, and remaining runtime validation.
- [Proposal and issue lifecycle review](reports/2026-09-07-proposal-issue-lifecycle.md): lifecycle rules, archive migration, and documentation verification.
- [P001 foundation verification](reports/2026-09-07-p001-foundation.md): delivered behavior, source/artifact identity, four review rounds, passing checks, and remaining gates.
- [P002 API-token verification](reports/2026-09-07-p002-api-tokens.md): scoped credentials, original reviews and focused authority correction, actual browser/API and contract evidence, and remaining gates.
- [P003 workspace verification](reports/2026-09-07-p003-workspaces.md): reviewed workspace/storage behavior, combined token/workspace checks, Linux evidence and remaining live/upstream gates.
- [Gateway transport diagnostic](reports/2026-09-07-gateway-transport-diagnostic.md): measured DNS/TLS failure stages in a second disposable Linux VM, with the availability issue still open.

Add user documentation when the corresponding features work. Add reports for completed investigations or verification, including the revision and environment checked. Keep future feature specifications in `design/`, and unresolved findings in `issues/`.
