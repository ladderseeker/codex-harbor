# Codex Harbor

A single-owner web interface and authenticated API for Codex on compatible Linux VPS hosts, with separate personal local and VPS profiles. The source includes conversations, scoped API access, managed workspaces, file/Git tools, attachments, terminals, history/recovery, scheduling and private previews. Profile availability and remaining acceptance limits are documented in the [current subsystem designs](design/systems/README.md) and [user guides](docs/user/README.md).

The deployed product is the [personal VPS profile](docs/developer/personal-vps.md): the owner's instance runs concurrent conversations (four active turns by default), attachments, personal development previews, history and search. Managed-profile features in the source, such as Git worktree and copy workspaces, the file editor, terminals, schedules, API tokens and managed previews, are not deployed. Releases reach the VPS through the manual [GitHub Actions deployment](docs/developer/github-actions-deploy.md). The [25 September 2026 project review](docs/reports/2026-09-25-project-review.md) records an architecture assessment and recommended proposal priorities as of that date.

Historical reports record reviewed application, runtime and Linux checks at their identified source revisions. Managed installation and full protected restore/live acceptance remain incomplete. Self-development and managed extensions are deferred and unavailable on main; historical branch handoffs do not establish current integration or readiness. See the [deployment guide](docs/developer/deployment.md) and [development/extension design](design/systems/005-development-and-extensions.md).

The [delivery workflow](design/workflow.md) selects one cohesive outcome from current need, with bounded plans, independent design and provenance review, and owner confirmation before committing. Legacy proposal records are reconciled into the archive under [D013](design/decisions/013-evidence-based-delivery-workflow.md); their unresolved obligations remain in the issue inbox. Archiving those records does not mean their full original plans passed.

## Start here

- [Design index](design/README.md): architecture, subsystem contracts, visual rules and decisions.
- [Proposal directory](design/proposals/README.md): bounded execution plans and archive navigation.
- [Issue inbox](issues/README.md): concrete problems, evidence and recheck routes awaiting selection.
- [Developer workflow](docs/developer/development.md): implemented commands, local setup and verification limits.
- [Documentation index](docs/README.md): available behavior and historical verification reports.
- [Repository instructions](AGENTS.md): essential implementation, safety and collaboration directives.

Designs, decisions and plans belong in `design/`; actual user/developer guidance and reports belong in `docs/`; findings and their history belong in `issues/`. Follow the [canonical record lifecycle](design/workflow.md#document-ownership-and-lifecycle) when selecting, closing, transferring or reopening work.
