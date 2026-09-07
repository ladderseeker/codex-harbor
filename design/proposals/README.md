# Feature proposals

P001–P003 are Accepted and Implemented, with required live-account evidence and upstream follow-ups still open. P005 and P007 are Accepted and In progress. P004 and P009 have Accepted designs and Planned implementation; the remaining proposals are Draft and Planned. No proposal has passed its completion gate. Design review, implementation, and verification are separate events. Follow the [proposal template](../proposal-template.md) and [canonical lifecycle rules](../../AGENTS.md#document-ownership-and-lifecycle) when changing status.

The [proposal archive](archive/README.md) is empty. Review it and the [issue index](../../issues/README.md) when discovering work or allocating IDs.

The [architecture](../architecture.md) owns shared security, runtime, state, and development contracts. A proposal owns the feature-specific additions and observable acceptance criteria. Do not repeat the full architecture in every proposal.

## Active proposals and dependencies

An independently verifiable feature may rely on its declared dependencies. Implementation can proceed once prerequisite behavior exists and is available in an isolated test instance. Any missing mandatory upstream evidence remains visible and blocks dependent verification where relevant; it does not turn an Implemented dependency into a finished proposal. This sequencing follows the owner's authorization to implement the roadmap and the repository requirement to continue unaffected work. Each outcome must be usable and testable without a future proposal. Dependencies include their transitive dependencies. Split by outcome, not complexity, layer, or estimated effort.

| ID | Complete outcome | Decision | Delivery | Direct dependencies | Acceptance IDs / specialist lanes |
| --- | --- | --- | --- | --- | --- |
| [P001](001-secure-persistent-conversations.md) | Sign in and conduct a protected Codex conversation that survives browser closure | Accepted | Implemented | None | P001-01–08; contracts/E2E/Linux passed, live and medium follow-ups pending |
| [P002](002-programmatic-api-access.md) | Use revocable, scoped credentials from an external API client | Accepted | Implemented | P001 | Original acceptance, focused third authority review and P003 integration passed; P007 integration and live/upstream gates pending |
| [P003](003-parallel-project-workspaces.md) | Work across projects and parallel conversations with clear workspace ownership | Accepted | Implemented | P001 | Two feature reviews plus P002 integration, actual E2E/contracts/Linux passed; P003-06 live and upstream gates pending |
| [P004](004-files-and-change-review.md) | Inspect, edit, download, and review project changes through Harbor | Accepted | Planned | P003 | Recorded editor/file/Git/uncertainty contract; P004-01–06 implementation and isolation pending |
| [P005](005-attachments-and-rich-input.md) | Submit validated files and pasted images with a conversation | Accepted | In progress | P001 | P005-01–06; contract, live, isolation |
| [P006](006-persistent-terminal.md) | Use and reconnect to a terminal in a selected project workspace | Draft | Planned | P003 | P006-01–06; contract, live, isolation |
| [P007](007-session-history-and-recovery.md) | Find past work and resolve reconnect, crash, and uncertain-delivery states | Accepted | In progress | P001 | P007-01–07; contract, live |
| [P008](008-scheduled-tasks.md) | Run recurring or one-time work and review its results | Draft | Planned | P003, P007 | P008-01–07; live |
| [P009](009-portable-deployment-and-restore.md) | Install, update, back up, and restore a working Harbor on a compatible VPS | Accepted | Planned | P001, P007 | D006 records release/restore decisions; P009-01–07 implementation, live and isolation pending |
| [P010](010-self-development.md) | Develop and test Harbor through its running stable instance | Draft | Planned | P002, P003, P009 | P010-01–07; self E2E, isolation, live |
| [P011](011-private-project-previews.md) | Open a private preview of a project's running application | Draft | Planned | P003 | P011-01–06; isolation |
| [P012](012-managed-skills-and-mcp.md) | Configure and use trusted skills and MCP tools within a project | Draft | Planned | P003 | P012-01–06; contract, live, isolation |

Next action: integrate P005 attachments and P007 history/recovery on the tested P001–P003 foundation, then implement P004 files and P009 deployment along the dependency paths below. Keep P001's live and medium follow-ups active. [Dedicated live credentials are unavailable](../../issues/2026-09-07-171225-live-runtime-credentials.md), so real-account evidence remains blocked while unaffected work continues. The transferred [runtime compatibility finding](../../issues/archive/2026-09-07-073831-codex-runtime-compatibility.md) has partial evidence owned by [P001's local gate](001-secure-persistent-conversations.md#source-issues) and pending [P009 deployment evidence](009-portable-deployment-and-restore.md#source-issues).

All features require their relevant deterministic browser/API E2E scenarios and critical regressions. Specialist lanes supplement those tests; they do not replace them. P001 includes the executable development/test foundation because a working, secure conversation is the first complete outcome. It does not require later API tokens, attachment UI, file editor, terminal UI, or scheduler.

One valid order that enables self-development early is **P001 → P002 → P003 → P007 → P009 → P010**. P004, P005, P006, P008, P011, and P012 can follow their own dependency paths. IDs are stable references, not a mandatory schedule. P009 supplies an extensible backup/restore registry; every subsequently delivered data-owning feature adds its migration, backup, and restore assertions in its own proposal. We do not wait for every possible feature before verifying deployment.

## Shared verification contract

P001 implements setup, `pnpm dev`, `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live`, and `pnpm test:isolation` under the [command contract](../architecture.md#local-first-development-and-portable-environments). The [developer workflow](../../docs/developer/development.md#command-availability) records availability, actual results, and prerequisites. P010 will add `pnpm test:e2e:self`; it remains unavailable. Missing prerequisites or unimplemented commands never become successful placeholders.

Tag executable acceptance tests with their stable proposal IDs; document the implemented feature-selection syntax when the harness exists. Each run starts the actual proxy, UI where applicable, API, PostgreSQL, supervisor, adapter, and relevant workspace/launcher services. Only external Codex and OIDC boundaries use deterministic fixtures. An API-only assertion may use an HTTP client instead of a browser. Fixture mode is private and rejected for public deployments; remote inspection uses the approved authenticated access route.

Fresh fixtures include an isolated owner identity, allowed and denied workspace roots, empty database, known repository revision, bounded test credentials, and a run-specific resource manifest. Tests do not use ordinary owner projects, production data, or the developer's default Codex state. Reuse only delivered dependency setup, never future features or mocks of Harbor components. Keep setup assertions separate from the behavior under test.

The relevant [real-runtime and Linux lanes](../architecture.md#repeatable-verification-through-the-application) are mandatory for claims about those boundaries. Missing real credentials, runtime, or Linux prerequisites mean **unverified**, with an issue linked; fixture success cannot close that gate. Record revision or source digest, versions, environment, acceptance IDs, commands, exit codes, and redacted evidence. Clean up only resources in the test-run manifest. Failed tests must preserve other development and stable instances.

Apply the [proposal completion rules](../../AGENTS.md#proposal-completion-and-archive) after acceptance, including documentation, review evidence, source-issue updates, and archiving. Review the transferred [runtime compatibility gate](../../issues/archive/2026-09-07-073831-codex-runtime-compatibility.md) when a proposal depends on an upstream capability; its required evidence remains pending.

## Further desktop parity

Voice, full browser/computer automation, hosted plugin-catalog/OAuth parity, and a dedicated pull-request management workflow require additional capability research and separate complete proposals. P004 covers local code/change review; P011 covers project previews; P012 covers managed skills/MCP. Those features do not establish the broader desktop capabilities. Keep these targets visible without marking unsupported controls usable.
