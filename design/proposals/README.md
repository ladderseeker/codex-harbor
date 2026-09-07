# Feature proposals

Every proposal below has **Decision: Draft** and **Delivery: Planned**. These documents define work; no feature or application test is implemented. Design review, implementation, and verification are separate events. Follow the [proposal template](../proposal-template.md) and [repository rules](../../AGENTS.md) when changing status.

The [architecture](../architecture.md) owns shared security, runtime, state, and development contracts. A proposal owns the feature-specific additions and observable acceptance criteria. Do not repeat the full architecture in every proposal.

## Closed features and dependencies

An independently verifiable feature may rely on its declared, already delivered dependencies. Its own outcome must be usable and testable in a fresh environment without any future proposal. Dependencies include their transitive dependencies. Split by outcome, not complexity, layer, or estimated effort; implementation tasks within a proposal may be as small as useful.

| ID | Complete outcome | Direct dependencies | Acceptance IDs / specialist lanes |
| --- | --- | --- | --- |
| [P001](001-secure-persistent-conversations.md) | Sign in and conduct a protected Codex conversation that survives browser closure | None | P001-01–08; contract, live, isolation |
| [P002](002-programmatic-api-access.md) | Use revocable, scoped credentials from an external API client | P001 | P002-01–06; contract/live when adapter behavior changes |
| [P003](003-parallel-project-workspaces.md) | Work across projects and parallel conversations with clear workspace ownership | P001 | P003-01–06; isolation, live |
| [P004](004-files-and-change-review.md) | Inspect, edit, download, and review project changes through Harbor | P003 | P004-01–06; isolation |
| [P005](005-attachments-and-rich-input.md) | Submit validated files and pasted images with a conversation | P001 | P005-01–06; contract, live, isolation |
| [P006](006-persistent-terminal.md) | Use and reconnect to a terminal in a selected project workspace | P003 | P006-01–06; contract, live, isolation |
| [P007](007-session-history-and-recovery.md) | Find past work and resolve reconnect, crash, and uncertain-delivery states | P001 | P007-01–07; contract, live |
| [P008](008-scheduled-tasks.md) | Run recurring or one-time work and review its results | P003, P007 | P008-01–07; live |
| [P009](009-portable-deployment-and-restore.md) | Install, update, back up, and restore a working Harbor on a compatible VPS | P001, P007 | P009-01–07; live, isolation |
| [P010](010-self-development.md) | Develop and test Harbor through its running stable instance | P002, P003, P009 | P010-01–07; self E2E, isolation, live |
| [P011](011-private-project-previews.md) | Open a private preview of a project's running application | P003 | P011-01–06; isolation |
| [P012](012-managed-skills-and-mcp.md) | Configure and use trusted skills and MCP tools within a project | P003 | P012-01–06; contract, live, isolation |

All features require their relevant deterministic browser/API E2E scenarios and critical regressions. Specialist lanes supplement those tests; they do not replace them. P001 includes the executable development/test foundation because a working, secure conversation is the first complete outcome. It does not require later API tokens, attachment UI, file editor, terminal UI, or scheduler.

One valid order that enables self-development early is **P001 → P002 → P003 → P007 → P009 → P010**. P004, P005, P006, P008, P011, and P012 can follow their own dependency paths. IDs are stable references, not a mandatory schedule. P009 supplies an extensible backup/restore registry; every subsequently delivered data-owning feature adds its migration, backup, and restore assertions in its own proposal. We do not wait for every possible feature before verifying deployment.

## Shared verification contract

The [planned command contract](../architecture.md#local-first-development-and-portable-environments) is not runnable today. P001 introduces working setup, `pnpm dev`, `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live`, and `pnpm test:isolation` as its acceptance requires. P010 adds `pnpm test:e2e:self`. Missing prerequisites or unimplemented commands never become successful placeholders.

Tag executable acceptance tests with their stable proposal IDs; document the implemented feature-selection syntax when the harness exists. Each run starts the actual proxy, UI where applicable, API, PostgreSQL, supervisor, adapter, and relevant workspace/launcher services. Only external Codex and OIDC boundaries use deterministic fixtures. An API-only assertion may use an HTTP client instead of a browser. Fixture mode is private and rejected for public deployments; remote inspection uses the approved authenticated access route.

Fresh fixtures include an isolated owner identity, allowed and denied workspace roots, empty database, known repository revision, bounded test credentials, and a run-specific resource manifest. Tests do not use ordinary owner projects, production data, or the developer's default Codex state. Reuse only delivered dependency setup, never future features or mocks of Harbor components. Keep setup assertions separate from the behavior under test.

The relevant [real-runtime and Linux lanes](../architecture.md#repeatable-verification-through-the-application) are mandatory for claims about those boundaries. Missing real credentials, runtime, or Linux prerequisites mean **unverified**, with an issue linked; fixture success cannot close that gate. Record revision or source digest, versions, environment, acceptance IDs, commands, exit codes, and redacted evidence. Clean up only resources in the test-run manifest. Failed tests must preserve other development and stable instances.

Before `Delivery: Verified`, the outcome, negative paths, lifecycle assertions, required specialist lanes, and independent review must pass. Update actual user/developer documentation and link a report under `docs/reports/`. Review the existing [runtime compatibility gate](../../issues/2026-09-07-073831-codex-runtime-compatibility.md) when a proposal depends on an upstream capability.

## Further desktop parity

Voice, full browser/computer automation, hosted plugin-catalog/OAuth parity, and a dedicated pull-request management workflow require additional capability research and separate complete proposals. P004 covers local code/change review; P011 covers project previews; P012 covers managed skills/MCP. Those features do not establish the broader desktop capabilities. Keep these targets visible without marking unsupported controls usable.
