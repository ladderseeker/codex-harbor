# Codex Harbor repository instructions

## Start here

- Build a portable, single-owner web interface and authenticated API around the official Codex runtime. Inspect source and evidence before claiming behavior, commands, deployment or security controls exist.
- Read [architecture](design/architecture.md), the relevant [subsystem designs](design/systems/README.md), [workflow](design/workflow.md), selected proposal and [developer guide](docs/developer/development.md) before implementation. Resolve contradictory contracts explicitly.
- Discover existing records in [proposals](design/proposals/README.md), [issues](issues/README.md) and their archive folders before creating work. Folder listings provide discovery; do not create manual priority queues or per-record status tables.
- Current requirements belong in design documents; proposals are bounded execution plans. [D013](design/decisions/013-evidence-based-delivery-workflow.md) owns the workflow change and one-time legacy reconciliation. Archived plans and reports preserve history, not competing specifications.
- English is the default language for all authored repository content, including documentation, proposals, designs, issues, reports, role briefs, code comments, and developer-facing or user-facing prose, unless the owner explicitly requests another language. Conversation in Chinese does not change the repository's output language. Preserve functional multilingual input/test data and machine-significant identifiers; language cleanup must not change behavior.

## Delivery and delegation

- Select one cohesive, independently verifiable outcome and execute one proposal at a time unless the owner explicitly requests otherwise. [D013](design/decisions/013-evidence-based-delivery-workflow.md) governs selection from current need; [D009](design/decisions/009-common-use-release.md) preserves common-use scope and unresolved gates. Self-development and managed extensions remain deferred until selected.
- Main writes the plan and a self-contained execution brief with settled decisions, dependency evidence, acceptance gates and an exact file fence. Missing required dependencies block dependent work; file count or technical layers are not reasons to split an outcome.
- Follow the [canonical lifecycle](design/workflow.md#document-ownership-and-lifecycle): `Draft → Accepted → Implemented`. Acceptance authorizes execution within existing owner authorization; completion requires the entire scoped gate and review. Unavailable mandatory checks prevent completion.
- Delegate implementation with fresh initial context using the [implementer brief](docs/developer/agents/implementer.md). Workers read the named designs first, edit only their fence, and return new design decisions or fence changes to main.
- After a green gate, automatically start separate fresh-context [design](docs/developer/agents/design-reviewer.md) and [provenance](docs/developer/agents/provenance-reviewer.md) reviewers. Reviewers only report and run read-only checks; they do not author fixes.
- Main adjudicates findings, sends scoped fixes to the same implementer, and verifies them. Stop when clear or after three review rounds at most; report remaining blockers to the owner. Record unrelated findings in issues without expanding the selected outcome, except current blockers or critical correctness, security or data-loss problems.
- Implementers never commit. Main presents the reviewed result and evidence; the owner confirms the commit. Do not push or deploy without applicable authorization.

## Interface consistency

- Before UI changes, read the [canonical token and interaction guide](design/design-tokens.html) and inspect the [standalone prototype](design/prototypes/harbor-redesign.html). Preserve the approved monochrome foundation, typography, spacing, compact composer and sidebar behavior, including only documented semantic exceptions.
- Reuse those patterns. A needed new token, component or state must be specified in the guide and demonstrated in the prototype in the same change before application use. This adds no separate approval gate within existing authorization.
- Inspect affected desktop/mobile layouts and hover, keyboard-focus, touch, empty/loading/error/disabled states. Render and check changed prototype interactions for visual work; documentation-only edits need consistency, links and whitespace checks. Prototype evidence does not replace application acceptance.

## Implementation and safety

- Follow architecture module boundaries and pinned dependencies. Keep runtime protocol handling behind the adapter and authorization on the server; never expose an unrestricted runtime proxy.
- Use portable scripts, repository-relative paths and the committed lockfile on macOS/Linux and compatible VPS hosts. Inspect implemented command entry points; never add successful no-op test placeholders or silently weaken authentication, permissions or isolation by profile.
- Inspect staged, unstaged and untracked files before editing. Coordinate exclusive file ownership and use supported isolated checkouts when needed; never reset, overwrite or discard unrelated changes.
- Keep enduring work and evidence in persistent ignored storage; use OS temporary storage only for recreatable scratch. Before interruption, record owners, coherent checkpoints within existing authorization, and recovery plans for unfinished edits and run resources.
- Account for each temporary stash's owner, base, purpose and integration. Reconcile staged, unstaged and untracked contents before delivery; remove only the specific reconciled stash and retain a named recovery reference when useful. Never clear unrelated stashes.
- Keep stable installation, source and candidate resources separate. Never edit live binaries, configuration, credentials or production data through a coding runner. No host Docker socket, privileged Docker-in-Docker, host administration or arbitrary launcher flags.
- Candidate build/test authority uses trusted fixed templates and disposable resources. Promotion needs identified tested artifacts, drain or explicit interruption, backup before migrations, documented rollback/restore limits and an SSH recovery path. Existing authorization governs promotion; prepare the reviewable candidate before any needed approval.

## VPS SSH handoff

- Standing owner direction, confirmed 21 September 2026: Linux/VPS is the required deployment and performance target. Native macOS runtime lifecycle support is outside the current release scope; macOS may still host development and isolated Linux verification. Do not make native macOS parity a VPS release gate unless the owner selects it later.
- The owner authorizes use of the existing VPS Codex login credential for Harbor work, including future bounded live verification, without asking again. For tests, copy only the credential into fresh private run-owned state, preserve the installed credential, use synthetic projects/data and remove copied credentials after confirmed owned retirement. This authorization does not permit copying ordinary history/configuration, exposing secrets or using live project data as test fixtures.

- The current Hostinger VPS uses local SSH alias `harbor-vps`: host `187.77.140.226`, port `22`, user `root`, expected hostname `srv1464935`. The Harbor site is <https://harbor.seekworld.tech/>. These are deployment-specific connection details, not application defaults.
- On the owner's Mac, `~/.ssh/config` defines the alias with `IdentityFile ~/.ssh/harbor_vps`, `IdentitiesOnly yes`, `AddKeysToAgent yes`, `UseKeychain yes`, and `ForwardAgent no`. The owner loaded the key with `ssh-add --apple-use-keychain ~/.ssh/harbor_vps`. Keep passwords, passphrases, and private-key contents out of this repository, chat, and logs. The alias, key, and agent state are local prerequisites; they are not automatically available on another machine or in every new session.
- When a new session needs VPS access, begin with this read-only connectivity check:

  ```sh
  ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes harbor-vps 'whoami; hostname'
  ```

  On 2026-09-14, this returned `root` and `srv1464935` without a password prompt after scoped network escalation. This verifies SSH connectivity only, not deployment readiness. If the sandbox blocks SSH, use the scoped network approval mechanism; do not disable host-key checking or other safeguards. If the key is locked or unavailable, have the owner unlock or configure it locally.
- Cloud coding sessions (checked 25 September 2026) have HTTPS egress only and no SSH client, so they cannot reach `harbor-vps`. From such a session, VPS work goes through the manual [GitHub Actions deployment](docs/developer/github-actions-deploy.md) workflow, and only with the owner's go-ahead for that run.
- For diagnosis and deployment, inspect the actual installed configuration, services, and artifact identity, then follow [the deployment workflow and SSH recovery documentation](docs/developer/deployment.md). Preserve the source/candidate/live boundaries above and follow existing user authorization; access as `root` does not authorize unrelated server changes. This handoff adds no separate approval gate and does not waive any deployment verification or release blocker.

## Verification and evidence

- Behavioral changes require `pnpm build`, `pnpm check`, `pnpm test`, relevant real-stack E2E and critical regressions. Exercise real Harbor UI/API, persistence and supervisor; only external Codex and identity-provider boundaries may use deterministic fixtures.
- Adapter/integration changes also require pinned real-runtime contracts and bounded live smoke checks. Launch, sandbox, mount or network-policy changes require actual supported Linux isolation; fixture or macOS process evidence cannot substitute.
- Reuse identified evidence for unchanged boundaries; broaden or repeat checks only for changed code, failures or unresolved concerns. Missing credentials/runtime/infrastructure mean unverified, with a linked issue and retained blocker; continue unaffected work.
- Tests own fresh databases, directories, ports, project fixtures, `CODEX_HOME` and credentials. Never use personal projects, ordinary Codex state or live deployment data. Redact secrets from logs, traces, screenshots and reports.
- Clean up only resources owned by the run. No broad process termination, shared-volume deletion or unscoped container cleanup.
- Documentation-only gates check structure, consistency, local paths/anchors and whitespace, including new files. Do not imply application tests ran.
- Record source/artifact identity, commands, environment, exits, results, review dispositions and evidence limits. Recheck anchors; unavailable raw session logs or historical artifacts stay explicitly unavailable. A report alone is not proof of its own claims.
- Keep current designs and actual docs aligned, preserve dated historical evidence, and follow [archive, transfer and reopening rules](design/workflow.md#issue-resolution-and-transfer). Final delivery states the outcome, checks, review rounds and remaining issues honestly.
