# Documentation

This directory describes available behavior, developer procedures and dated reports. The [subsystem designs](../design/systems/README.md) distinguish current source, deferred boundaries and remaining evidence obligations; the [delivery workflow](../design/workflow.md) governs changes. Reports retain their historical tested scope and are not fresh execution evidence. Discover plans and findings through the [proposal directory](../design/proposals/README.md) and [issue inbox](../issues/README.md).

The sections below group the same guides and reports by audience. The deployed product is the personal VPS profile; managed-profile guides describe source that is not deployed.

## Start here

- [User guides](user/README.md): available conversation and account controls, with current verification limits.
- [Developer workflow](developer/development.md): working on the repository now, command availability, and verification prerequisites.
- [Design index](../design/README.md): current architecture, subsystem contracts, decisions and bounded plans.
- [Repository instructions](../AGENTS.md): document ownership, implementation rules, and independent review.
- [Issue index](../issues/README.md): concrete findings, ownership and recheck routes, with archive navigation.

## Personal VPS and personal local profiles

- [Personal VPS setup](developer/personal-vps.md): subscription/original-folder candidate commands and native trust limits.
- [GitHub Actions deployment](developer/github-actions-deploy.md): the manual workflow that builds and promotes personal VPS releases from GitHub-hosted runners, its run history and current hazards.
- [Personal local experience](developer/local-personal.md): explicit local Codex account startup and its verification limits.
- [Attachment verification](developer/attachments.md): upload/draft persistence, Linux publication checks and the separate live gate.

## Development roles

- [Implementer](developer/agents/implementer.md), [design reviewer](developer/agents/design-reviewer.md) and [provenance reviewer](developer/agents/provenance-reviewer.md): plain repository role briefs.

## Managed profile guides

These features exist in source for the managed profile. They are unavailable in the personal VPS profile.

- [Files and changes](developer/files.md): reviewed editor, file and Git behavior, Linux requirements and integration limits.
- [Terminal user guide](user/terminals.md): shell control, detach versus termination, replay limits and current isolation restrictions.
- [Schedule user guide](user/schedules.md): recurrence, offline execution, attention and pause/cancel behavior.
- [Schedule developer guide](developer/schedules.md): API authority, test commands and recovery boundaries.
- [Programmatic API](developer/programmatic-api.md): bearer authentication, current scopes, streaming, and safe retries.
- [Deployment development commands](developer/deployment.md): current P009 administrator tooling, partial Linux evidence and blocked restore/transfer gates.
- [Linux execution verification](developer/linux-verification.md): dedicated XFS storage, real runner checks, and scoped cleanup.

## Dated reports

Reports are historical records of the scope, source and evidence they name.

- [Project review, 25 September 2026](reports/2026-09-25-project-review.md): architecture verdict, user-experience walkthrough, documentation corrections and recommended proposal priorities as of that date.
- [Workflow migration report](reports/2026-09-20-workflow-migration.md): documentation migration scope, observed checks, independent reviews and evidence limits.
- [Frontend redesign delivery](reports/2026-09-13-frontend-redesign.md): completed P014 implementation, review and verification evidence.
- [Personal VPS development delivery](reports/2026-09-14-personal-development.md): development environment, titles/replies, private preview and reviewed verification evidence.
- [Personal VPS candidate evidence](reports/2026-09-13-personal-vps-candidate.md): three reviews, native/browser/critical results and remaining owner-configured deployment gates.
- [Personal local delivery](reports/2026-09-13-personal-local-experience.md): reviewed local/native checks, real owner conversation and the dated addendum recording the later critical-regression pass.
- [Common-use delivery and deferred work](reports/2026-09-13-common-use-delivery.md): historical reduced release scope, qualified verification and P010/P012 branch handoff; inspect current availability before reuse.
- [Common-use conversation acknowledgement](reports/2026-09-13-common-use-acknowledgement.md): narrow shared correction, PostgreSQL contention coverage and exact current check/review evidence.
- [P007 live-history test driver](reports/2026-09-13-p007-live-history-driver.md): reviewed bounded native history/restart command and no-model checks; authenticated execution remains blocked.
- [P004 feature evidence](reports/2026-09-08-p004-files.md): two feature review rounds and exact-source browser/API/Linux results; subsequent module evidence is linked below.
- [P006 feature evidence](reports/2026-09-08-p006-development.md): two review rounds, complete terminal/critical/workspace acceptance and separately qualified native Linux checks.
- [File/terminal/deployment integration](reports/2026-09-08-p004-p006-integration.md): reviewed combined source and shared Git correction, followed by the installed evidence below.
- [Installed module integration](reports/2026-09-08-installed-module-integration.md): file/terminal registry, maintenance and restored-authority implementation, with exact intermediate and current Linux evidence and remaining gates.
- [P009 development checkpoint](reports/2026-09-08-p009-development.md): partial implementation and installed-profile results; not a release-readiness report.
- [Feature verification host preparation](reports/2026-09-08-feature-verification-host.md): fresh quota storage, pinned public tools and actual forwarding canary; feature acceptance remains separate.
- [P008 scheduling evidence](reports/2026-09-08-p008-development.md): two feature reviews, qualified schedule/critical results, module integration and reviewed real-stack DST follow-up; live/restore gates remain explicit.
- [Expanded design review](reports/2026-09-07-design-review.md): completed independent review rounds, documentation checks, and remaining runtime validation.
- [Proposal and issue lifecycle review](reports/2026-09-07-proposal-issue-lifecycle.md): historical lifecycle migration and documentation checks; D013 and the current workflow supersede those rules.
- [Integration stash reconciliation](reports/2026-09-08-stash-reconciliation.md): accounting for temporary P004/P009 snapshots and their recoverable cleanup.
- [Interrupted-work recovery](reports/2026-09-13-interrupted-work-recovery.md): restored persistent worktrees, recovered preview corrections/evidence, missing drafts with explicit owners, and the blocked test-host SSH recovery.
- [P010 command diagnostics](reports/2026-09-13-p010-command-diagnostics.md): qualified failed guest attempts, bounded diagnostic/framing corrections, focused contracts and independent review; complete candidate acceptance remains pending.
- [P010 executable cache correction](reports/2026-09-13-p010-cache-executable-modes.md): reviewed mode binding and actual serialized-cache offline/native-tool verification; corrected sealed-base and complete candidate acceptance remain pending.
- [P001 foundation verification](reports/2026-09-07-p001-foundation.md): delivered behavior, source/artifact identity, four review rounds, passing checks, and remaining gates.
- [P005 workspace/history integration](reports/2026-09-07-p005-integration.md): combined Node 24 application/workspace acceptance and inherited actual Linux publication evidence.
- [P005 attachment checkpoint](reports/2026-09-07-p005-attachments.md): rich drafts/uploads, real Linux publication evidence, review fixes and the blocked live-account gate.
- [P002 API-token verification](reports/2026-09-07-p002-api-tokens.md): scoped credentials, original reviews and focused authority correction, actual browser/API and contract evidence, and remaining gates.
- [P003 workspace verification](reports/2026-09-07-p003-workspaces.md): reviewed workspace/storage behavior, combined token/workspace checks, Linux evidence and remaining live/upstream gates.
- [P007 history/recovery integration](reports/2026-09-07-p007-history-integration.md): bounded history, explicit uncertainty recovery, combined Node 24 acceptance, review and resolved source findings.
- [Gateway transport diagnostic](reports/2026-09-07-gateway-transport-diagnostic.md): measured DNS/TLS failure stages in a second disposable Linux VM, with the availability issue still open.
- [P012 native capability spike](reports/2026-09-08-p012-protocol-spike.md): account-free skill discovery/disable and local MCP call/form checks on pinned Codex; feature, Linux and live evidence remain pending.
- [P011 headless capability spike](reports/2026-09-08-p011-protocol-spike.md): historical account-free exact command identity acknowledgement and termination prerequisite; application and Linux evidence are recorded separately below.
- [P011 implementation and review](reports/2026-09-08-p011-development.md): main acceptance after two review rounds, actual private preview UI/API, Linux and installed checkpoints, recovered evidence and cumulative critical checks; protected/fresh-host restore and upstream gates remain explicit. See the current [preview guide](user/previews.md) and [developer setup](developer/previews.md).
- [P024 installed attachment correction](reports/2026-09-21-p024-installed-attachment-fix.md): the reviewed correction deployed as `311f750`, installed checks and the retained-runtime recovery.
- [P024 attachments and composer](reports/2026-09-21-p024-attachments-and-composer.md): initial execution record, later reopened by the installed correction above.
- [P018 concurrent conversations](reports/2026-09-21-p018-concurrency.md): personal VPS concurrency, live acceptance and deployment record.
- [P023 sidebar owner-review corrections](reports/2026-09-20-sidebar-owner-review.md), [sidebar loading correction](reports/2026-09-20-sidebar-loading.md), [query-recency correction](reports/2026-09-20-query-recency.md) and [sidebar and transcript refinement](reports/2026-09-20-sidebar-and-transcript.md): the P023 delivery and its correction cycles.
- [Conversation-first interface](reports/2026-09-15-conversation-interface.md): P016 delivery record.
- [Conversation Markdown rendering](reports/2026-09-14-markdown-rendering.md): focused assistant Markdown rendering fix and its deployment.

Add user documentation when the corresponding behavior works. Reports identify the inspected source/environment, actual commands/results, accessible evidence and limitations. Current requirements and bounded change plans belong in `design/`; concrete unresolved findings belong in `issues/`. Keep unavailable historical artifacts and raw session logs explicitly unavailable.
