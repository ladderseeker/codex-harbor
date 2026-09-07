# Developer workflow

Codex Harbor is currently a design-stage repository. There is no application workspace, package manifest, dependency lockfile, development server, or executable test suite. The workflow below distinguishes work that can be done now from the command contract future implementation must provide.

The [architecture](../../design/architecture.md) defines the target system. The [proposal index](../../design/proposals/README.md) defines independently verifiable feature outcomes and their dependencies. [AGENTS.md](../../AGENTS.md) contains the repository's working rules.

## Working on documents now

1. Inspect the working tree, including untracked files, and read the relevant design and proposal before editing.
2. Put new design or feature proposals in `design/`. Update the canonical requirement instead of copying it into another document. Keep the relevant indexes and links current.
3. Put documentation for actual behavior, developer procedures, and completed reports in `docs/`. State limitations and pending verification explicitly.
4. Review changed documents for complete acceptance criteria, dependency consistency, portability, security boundaries, and agreement between architecture and proposals.
5. Validate local Markdown links, document structure, and whitespace; include newly created files in the checks. `git diff --check` can check tracked diffs but does not validate untracked files or links.
6. Complete independent review and any resulting fixes according to [the repository review cycle](../../AGENTS.md#delegation-and-review). Record unresolved findings in `issues/` with evidence and next steps.

Document validation establishes document quality. It does not establish that proposed application behavior, runtime compatibility, or isolation works.

## Delivering a feature

Select a proposal whose dependencies are delivered, then define its acceptance evidence before implementation. A proposal is a complete outcome: its UI, API, persistence, permissions, lifecycle, and failure paths belong together where applicable. A large feature may take several implementation steps without becoming several proposals. A small feature may remain a proposal if it produces a complete useful outcome.

Track the proposal's decision state (`Draft`, `Accepted`, or `Superseded`) separately from its delivery state (`Planned`, `In progress`, `Implemented`, or `Verified`). The delivery state must reflect evidence. A design review cannot advance a proposal to `Verified`, and these states do not require a new permission step when existing task authorization already covers the work.

Use a branch/worktree for isolated implementation, especially when work happens in parallel. Preserve unrelated changes. Keep the proposal current if requirements change, and update actual user/developer documentation as behavior becomes available. Do not make commits or publish changes without task authorization.

Implement the outcome, run its end-to-end acceptance scenarios and the critical regression suite, obtain independent review, fix actionable findings, and verify the fixes. Record the revision, environment, commands, results, skipped gates, and review rounds in an appropriate report linked from the proposal. Screenshots and test traces are supporting evidence, not a substitute for assertions about the result.

## Command availability

**No application or test commands are available today.** The command names, semantics, and feature ownership are specified once in the [design's planned command contract](../../design/architecture.md#local-first-development-and-portable-environments). This guide will contain tested operational instructions as each command becomes available; it must not maintain a competing future command table.

The first executable feature must document supported tool versions, dependency setup, configuration, fixture identity login, startup, shutdown, and feature-test selection here. Later feature owners document their implemented specialist lanes. A missing lane is unavailable or unverified, never a passing placeholder. Until scripts exist, there are no application installation instructions to follow.

## End-to-end verification

End-to-end tests should start from the feature's public entry point and assert its persisted and observable outcome. Browser features use a real browser and Harbor's real API, database, and supervisor. API-only features use an authenticated API client and the same real services. Codex and identity-provider fixtures are permitted at those external boundaries to make ordinary tests repeatable; replacing Harbor's own services does not qualify as end-to-end coverage.

Test the feature's relevant negative and lifecycle cases as well as its successful path. For example, persistent conversation work must distinguish a closed browser from an interrupted runtime; authentication must cover API and streaming entry points, not only the login screen. Exact scenarios belong in the owning proposals rather than in a duplicate checklist here.

Use focused end-to-end coverage plus the critical regression suite for behavioral changes. Add lower-level tests when they cover meaningful risks, not implementation details. Adapter changes also need real pinned-runtime contracts and a live smoke check. Execution-boundary changes also need the real Linux isolation lane. Record unavailable required lanes as unverified and link an issue; do not advance the affected proposal to `Verified`.

Each test run owns isolated databases, project fixtures, temporary directories, listener ports, credentials, and `CODEX_HOME`. Never reuse the developer's ordinary Codex login/state, personal projects, or production database. Acquire real-runtime test credentials through the documented dedicated test configuration without copying them into logs or fixtures. Bound model usage and redact sensitive output from artifacts.

Assign each run a unique identity and clean up only its own processes, containers, volumes, and temporary files. Do not use broad `pkill`, shared-volume destruction, or unscoped container shutdown as test cleanup. A failed test must leave the stable service and other development sessions intact.

## Local and VPS implementation references

Development starts locally on macOS/Linux and later uses the same entry points on compatible Linux VPS hosts. The [local environment design](../../design/architecture.md#local-first-development-and-portable-environments) owns the planned topology and Linux VM requirements. [P010](../../design/proposals/010-self-development.md) owns developing Harbor through its stable instance; [P009](../../design/proposals/009-portable-deployment-and-restore.md) owns deployment, restore, and external recovery.

Those capabilities are planned, not operational today. As they are implemented, add tested setup and recovery instructions here or in linked operational guides. Keep future broker, candidate, and promotion specifications in their canonical design/proposals rather than copying them into this handbook. Existing authorization still governs work; self-development does not create a separate standing permission gate.
