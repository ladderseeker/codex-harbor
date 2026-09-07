# Documentation

This directory describes available behavior, developer workflows, and completed reports. P001–P003, P005 and P007 are Implemented with required verification/follow-ups still open; the proposal index distinguishes current evidence from finished delivery.

- [Developer workflow](developer/development.md): working on the repository now, command availability, and verification requirements.
- [Files and changes](developer/files.md): reviewed editor, file and Git behavior, Linux requirements and integration limits.
- [P004 feature evidence](reports/2026-09-08-p004-files.md): two review rounds, exact-source browser/API/Linux results and pending terminal/deployment integration.
- [Terminal user guide](user/terminals.md): shell control, detach versus termination, replay limits and current isolation restrictions.
- [P006 feature evidence](reports/2026-09-08-p006-development.md): two review rounds, complete terminal/critical/workspace acceptance and separately qualified native Linux checks.
- [File/terminal/deployment integration](reports/2026-09-08-p004-p006-integration.md): reviewed combined source, shared Git correction and pending installed-module acceptance.
- [Deployment development commands](developer/deployment.md): current P009 administrator tooling, partial Linux evidence and blocked restore/transfer gates.
- [P009 development checkpoint](reports/2026-09-08-p009-development.md): partial implementation and installed-profile results; not a release-readiness report.
- [Linux execution verification](developer/linux-verification.md): dedicated XFS storage, real runner checks, and scoped cleanup.
- [Attachment verification](developer/attachments.md): upload/draft persistence, Linux publication checks and the separate live gate.
- [Programmatic API](developer/programmatic-api.md): bearer authentication, current scopes, streaming, and safe retries.
- [User guides](user/README.md): available conversation and account controls, with current verification limits.
- [Design index](../design/README.md): the target architecture, feature proposals, and acceptance criteria.
- [Repository instructions](../AGENTS.md): document ownership, implementation rules, and independent review.
- [Issue index](../issues/README.md): active findings, work transferred to proposals, and archived records.
- [Expanded design review](reports/2026-09-07-design-review.md): completed independent review rounds, documentation checks, and remaining runtime validation.
- [Proposal and issue lifecycle review](reports/2026-09-07-proposal-issue-lifecycle.md): lifecycle rules, archive migration, and documentation verification.
- [P001 foundation verification](reports/2026-09-07-p001-foundation.md): delivered behavior, source/artifact identity, four review rounds, passing checks, and remaining gates.
- [P005 workspace/history integration](reports/2026-09-07-p005-integration.md): combined Node 24 application/workspace acceptance and inherited actual Linux publication evidence.
- [P005 attachment checkpoint](reports/2026-09-07-p005-attachments.md): rich drafts/uploads, real Linux publication evidence, review fixes and the blocked live-account gate.
- [P002 API-token verification](reports/2026-09-07-p002-api-tokens.md): scoped credentials, original reviews and focused authority correction, actual browser/API and contract evidence, and remaining gates.
- [P003 workspace verification](reports/2026-09-07-p003-workspaces.md): reviewed workspace/storage behavior, combined token/workspace checks, Linux evidence and remaining live/upstream gates.
- [P007 history/recovery integration](reports/2026-09-07-p007-history-integration.md): bounded history, explicit uncertainty recovery, combined Node 24 acceptance, review and resolved source findings.
- [Gateway transport diagnostic](reports/2026-09-07-gateway-transport-diagnostic.md): measured DNS/TLS failure stages in a second disposable Linux VM, with the availability issue still open.
- [P012 native capability spike](reports/2026-09-08-p012-protocol-spike.md): account-free skill discovery/disable and local MCP call/form checks on pinned Codex; feature, Linux and live evidence remain pending.
- [P011 headless capability spike](reports/2026-09-08-p011-protocol-spike.md): account-free exact command identity acknowledgement and termination; HTTP readiness, application and Linux evidence remain pending.

Add user documentation when the corresponding features work. Add reports for completed investigations or verification, including the revision and environment checked. Keep future feature specifications in `design/`, and unresolved findings in `issues/`.
