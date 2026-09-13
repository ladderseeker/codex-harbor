# Feature proposals

P001–P008 and P011 are Accepted and Implemented, with mandatory verification and upstream follow-ups still open. P009, P010 and P012 are Accepted and In progress. No proposal has passed its completion gate. Design review, implementation, and verification are separate events. Follow the [proposal template](../proposal-template.md) and [canonical lifecycle rules](../../AGENTS.md#document-ownership-and-lifecycle) when changing status.

## Current delivery queue

The owner's 13 September scope change is recorded in [D009](../decisions/009-common-use-release.md). This index includes unfinished and deferred work; it is not a queue to implement all proposals concurrently.

| Priority | Proposals | Current action |
| --- | --- | --- |
| Common-use release | P001–P007 | Shared conversation correction and current critical acceptance passed. Integrate the reviewed P007 specialist live driver and retain its real-account execution gate, plus applicable installed/recovery gates. |
| Installed release prerequisites | P009 | Retain the reviewed installer and its evidence; complete the applicable installed acceptance before claiming a usable deployed artifact. Full restore/promotion obligations remain open in P009. |
| Existing optional behavior | P008, P011 | Preserve integrated code and evidence. No feature expansion during the common-use release; their remaining live/restore gates remain open. |
| Deferred | P010, P012 | Implementation is paused with commits, drafts and findings retained. Resume one proposal when selected for a concrete need; neither is complete or withdrawn. |

The [proposal archive](archive/README.md) is empty. Review it and the [issue index](../../issues/README.md) when discovering work or allocating IDs.

The [architecture](../architecture.md) owns shared security, runtime, state, and development contracts. A proposal owns the feature-specific additions and observable acceptance criteria. Do not repeat the full architecture in every proposal.

## Active proposals and dependencies

An independently verifiable feature may rely on its declared dependencies. Implementation can proceed once prerequisite behavior exists and is available in an isolated test instance. Any missing mandatory upstream evidence remains visible and blocks dependent verification where relevant; it does not turn an Implemented dependency into a finished proposal. This sequencing follows the owner's authorization to implement the roadmap and the repository requirement to continue unaffected work. Each outcome must be usable and testable without a future proposal. Dependencies include their transitive dependencies. Split by outcome, not complexity, layer, or estimated effort.

| ID | Complete outcome | Decision | Delivery | Direct dependencies | Acceptance IDs / specialist lanes |
| --- | --- | --- | --- | --- | --- |
| [P001](001-secure-persistent-conversations.md) | Sign in and conduct a protected Codex conversation that survives browser closure | Accepted | Implemented | None | P001-01–08; contracts/E2E/Linux passed, live and medium follow-ups pending |
| [P002](002-programmatic-api-access.md) | Use revocable, scoped credentials from an external API client | Accepted | Implemented | P001 | Original acceptance, third authority review and combined P003/P007 integration passed; live/upstream gates pending |
| [P003](003-parallel-project-workspaces.md) | Work across projects and parallel conversations with clear workspace ownership | Accepted | Implemented | P001 | Two feature reviews plus P002 integration passed; [workspace-import](../../issues/archive/2026-09-08-031857-workspace-quota-import.md) and [post-create identity](../../issues/archive/2026-09-08-035221-workspace-validation-identity.md) corrections integrated and passed; P003-06 live and upstream gates pending |
| [P004](004-files-and-change-review.md) | Inspect, edit, download, and review project changes through Harbor | Accepted | Implemented | P003 | Two feature rounds plus module review; host/Linux and installed ordinary/fault flows passed, protected fresh-host restore and upstream gates pending |
| [P005](005-attachments-and-rich-input.md) | Submit validated files and pasted images with a conversation | Accepted | Implemented | P001 | Three feature rounds plus integration review; Node 24 combined E2E/contracts and Linux passed, P005-06 live pending |
| [P006](006-persistent-terminal.md) | Use and reconnect to a terminal in a selected project workspace | Accepted | Implemented | P003 | Two feature rounds plus module review; complete terminal/host/Linux and installed retirement/rebind passed, protected fresh-host restore and upstream gates pending |
| [P007](007-session-history-and-recovery.md) | Find past work and resolve reconnect, crash, and uncertain-delivery states | Accepted | Implemented | P001 | Two feature rounds plus independent integration; Node 24 combined E2E/contracts passed, P007-07 live pending |
| [P008](008-scheduled-tasks.md) | Run recurring or one-time work and review its results | Accepted | Implemented | P003, P007 | Two feature rounds, module integration and targeted DST reviews closed; qualified schedule/critical/Linux metadata and real-stack DST evidence passed; live and protected restore pending; [resolved source findings](../../issues/archive/2026-09-08-044007-p008-implementation-review.md) |
| [P009](009-portable-deployment-and-restore.md) | Install, update, back up, and restore a working Harbor on a compatible VPS | Accepted | In progress | P001, P007 | Baseline and enrollment/SSH reviews closed; installed administrator checks passed, [web-asset packaging correction](../../issues/archive/2026-09-08-031032-p009-installed-web-assets.md) and file/terminal installed acceptance passed; later-module and protected restore/live gates pending |
| [P010](010-self-development.md) | Develop and test Harbor through its running stable instance | Accepted | In progress | P002, P003, P009 | Reviewed storage admission/cleanup and source/log framing checks passed in isolation; main integration, full self E2E/isolation, checkpoint and live gates remain pending. |
| [P011](011-private-project-previews.md) | Open a private preview of a project's running application | Accepted | Implemented | P003 | Two review rounds, corrective local/Linux lifecycle and cumulative main verification passed; protected/fresh-host restore and upstream gates remain. [Evidence](../../docs/reports/2026-09-08-p011-development.md#main-acceptance--13-september-2026). |
| [P012](012-managed-skills-and-mcp.md) | Configure and use trusted skills and MCP tools within a project | Accepted | In progress | P003 | Implementation and module corrections passed two review rounds; actual managed publication/removal and desktop/mobile trust inspection passed. Complete native/module/live acceptance and main integration remain pending. |

The common-use candidate's [shared acknowledgement correction](../../issues/archive/2026-09-13-022009-native-acknowledgement-deadlock.md) is resolved after independent review and current critical acceptance. Next action: integrate the reviewed [P007 live history/restart driver](../../issues/2026-09-13-110315-common-use-live-acceptance.md) and execute required real-account acceptance when its [dedicated credentials](../../issues/2026-09-07-171225-live-runtime-credentials.md) are available. P010/P012 remain deferred, and [automatic approval review still blocks the P009 backup transfer](../../issues/2026-09-07-231526-p009-backup-transfer-approval.md). Passing available checks does not finish a proposal with an open mandatory gate. The transferred [runtime compatibility finding](../../issues/archive/2026-09-07-073831-codex-runtime-compatibility.md) retains partial [P001 evidence](001-secure-persistent-conversations.md#source-issues) and pending [P009 evidence](009-portable-deployment-and-restore.md#source-issues).

All features require their relevant deterministic browser/API E2E scenarios and critical regressions. Specialist lanes supplement those tests; they do not replace them. P001 includes the executable development/test foundation because a working, secure conversation is the first complete outcome. It does not require later API tokens, attachment UI, file editor, terminal UI, or scheduler.

The dependency path **P001 → P002 → P003 → P007 → P009 → P010** remains valid, but D009 defers the earlier plan to implement self-development immediately. IDs are stable references, not a mandatory schedule. P009 supplies an extensible backup/restore registry; every subsequently delivered data-owning feature adds its migration, backup, and restore assertions in its own proposal. We do not wait for every possible feature before verifying deployment.

## Shared verification contract

P001 implements setup, `pnpm dev`, `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live`, and `pnpm test:isolation` under the [command contract](../architecture.md#local-first-development-and-portable-environments). The [developer workflow](../../docs/developer/development.md#command-availability) records availability, actual results, and prerequisites. P010 will add `pnpm test:e2e:self`; it remains unavailable. Missing prerequisites or unimplemented commands never become successful placeholders.

Tag executable acceptance tests with their stable proposal IDs; document the implemented feature-selection syntax when the harness exists. Each run starts the actual proxy, UI where applicable, API, PostgreSQL, supervisor, adapter, and relevant workspace/launcher services. Only external Codex and OIDC boundaries use deterministic fixtures. An API-only assertion may use an HTTP client instead of a browser. Fixture mode is private and rejected for public deployments; remote inspection uses the approved authenticated access route.

Fresh fixtures include an isolated owner identity, allowed and denied workspace roots, empty database, known repository revision, bounded test credentials, and a run-specific resource manifest. Tests do not use ordinary owner projects, production data, or the developer's default Codex state. Reuse only delivered dependency setup, never future features or mocks of Harbor components. Keep setup assertions separate from the behavior under test.

The relevant [real-runtime and Linux lanes](../architecture.md#repeatable-verification-through-the-application) are mandatory for claims about those boundaries. Missing real credentials, runtime, or Linux prerequisites mean **unverified**, with an issue linked; fixture success cannot close that gate. Record revision or source digest, versions, environment, acceptance IDs, commands, exit codes, and redacted evidence. Clean up only resources in the test-run manifest. Failed tests must preserve other development and stable instances.

Apply the [proposal completion rules](../../AGENTS.md#proposal-completion-and-archive) after acceptance, including documentation, review evidence, source-issue updates, and archiving. Review the transferred [runtime compatibility gate](../../issues/archive/2026-09-07-073831-codex-runtime-compatibility.md) when a proposal depends on an upstream capability; its required evidence remains pending.

## Further desktop parity

Voice, full browser/computer automation, hosted plugin-catalog/OAuth parity, and a dedicated pull-request management workflow require additional capability research and separate complete proposals. P004 covers local code/change review; P011 covers project previews; P012 covers managed skills/MCP. Those features do not establish the broader desktop capabilities. Keep these targets visible without marking unsupported controls usable.
