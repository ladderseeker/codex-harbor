# Codex Harbor repository instructions

## Scope and sources of truth

- Build a single-owner web interface and authenticated API around the official Codex runtime. Keep deployment portable across compatible Linux VPS providers.
- This repository is currently at the design stage. Do not claim an application, command, test, deployment, or security control exists without inspecting its implementation and evidence.
- Read [design/architecture.md](design/architecture.md) and the relevant entry in [design/proposals/README.md](design/proposals/README.md) before implementation. Resolve contradictions in the documents rather than silently choosing a different contract.
- Read [docs/developer/development.md](docs/developer/development.md) for the current development and verification workflow.

## Document ownership and proposal lifecycle

- Put product designs, architecture decisions, and future feature proposals in `design/`. Put documentation for available user behavior, developer workflows, and completed reports in `docs/`. Put unresolved findings in `issues/`.
- Keep each requirement in one canonical design or proposal and link to it. User and developer docs explain the implemented behavior; do not copy evolving specifications into them or present planned setup commands as available.
- Each proposal must deliver a complete, independently verifiable outcome after its explicit dependencies are delivered. Independence does not mean dependency-free. Do not split proposals by complexity, technical layer, or implementation effort.
- Include UI, API, storage, authorization, execution lifecycle, failure behavior, and end-to-end acceptance criteria in the same proposal where applicable. State exclusions and dependencies explicitly; architecture-wide invariants stay in the architecture document.
- Track design decisions separately from delivery. Use `Draft`, `Accepted`, or `Superseded` for the decision state; use `Planned` → `In progress` → `Implemented` → `Verified` for delivery. Acceptance of a design is not implementation evidence. New details remain draft unless covered by the user's approved direction or a recorded decision within that scope. These states do not create an additional permission gate for already authorized work.
- `Implemented` means the scoped behavior exists. `Verified` requires the proposal's acceptance evidence, required checks, and independent review, with no unresolved critical issues. Record the tested revision, commands, environment, results, and meaningful limitations. Reassess verification when behavior or dependencies change.
- Update the targeted proposal and affected actual documentation with each behavior change. Update indexes when moving or adding documents, fix links, and preserve relevant decision history without maintaining competing specifications.

## Implementation and repository management

- Use the module boundaries and stack specified in the architecture. Keep Codex protocol handling behind the adapter and authorization on the server; never expose a raw unrestricted runtime proxy.
- Work locally on macOS or Linux first, using portable scripts, repository-relative paths, pinned dependencies, and a committed lockfile once a package workspace exists. Do not add developer-specific absolute paths or Hostinger-specific dependencies.
- Use an isolated branch/worktree per proposal when parallel implementation requires it. Coordinate file ownership, inspect working-tree changes first, and never reset, overwrite, or discard unrelated user changes.
- Keep changes focused on the proposal. Record material new design decisions before relying on them. Make small, meaningful commits only when requested or already authorized; do not commit or push merely to finish a task.
- The planned command contract is `pnpm dev`, `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live`, `pnpm test:isolation`, and `pnpm test:e2e:self`. These commands are unavailable until implemented. Introduce the commands and developer instructions needed by the first executable feature, then expand them with their owning features; never add successful no-op placeholders.
- Use the same entry points locally and on the VPS. Configuration may choose the environment; it must not silently weaken authentication, permissions, or isolation.

## Verification

- Every behavioral feature must have end-to-end acceptance coverage for its complete user or API outcome. Exercise real Harbor UI where applicable, API, persistence, and supervisor. Deterministic Codex and identity-provider fixtures may replace those external boundaries; do not mock Harbor components and label the result end-to-end.
- Run the changed feature's end-to-end scenarios and the critical regression suite. Add contract, integration, unit, or security checks where they cover distinct risks. Broaden or repeat checks when changes, failures, or unresolved concerns justify them; avoid tests that merely mirror implementation.
- Adapter and integration changes require contracts and a smoke check against the pinned real Codex runtime. Launch, sandbox, mount, or network-policy changes require the actual supported Linux isolation lane. A fixture or macOS process test cannot establish Linux isolation.
- If required credentials, runtime, or infrastructure are unavailable, report the affected checks as unverified and record the release blocker in `issues/`. Do not silently skip a required gate or mark its proposal verified. Continue unaffected work.
- Tests use fresh run-specific databases, directories, ports, project fixtures, `CODEX_HOME`, and credentials. Never point automated tests at personal projects, normal Codex state, or live deployment data. Redact secrets from logs, traces, screenshots, and reports.
- Clean up only resources owned by the test run. Avoid broad process termination, shared-volume deletion, and container cleanup that can affect another developer or the running service.
- For documentation-only changes, validate structure, consistency, links, and whitespace. Do not invent application tests or claim end-to-end execution for a repository that has no runnable application.

## Developing Harbor through Harbor

- Keep the running stable installation separate from the editable source worktree and any candidate installation. Agents may edit source and run isolated candidate tests; they must not modify live service binaries, configuration, credentials, or production data.
- On macOS, run deployment-representative isolation checks in a supported Linux VM. If required isolation is unavailable, report the limitation instead of enabling privileged or host-access execution for convenience.
- Provide a trusted, restricted build/test capability using fixed templates and disposable resources for candidate dependencies. Never give coding runners a host Docker socket, privileged Docker-in-Docker, host administration, or arbitrary launcher flags.
- Candidate databases, ports, secrets, runtime state, and workspaces remain separate from the stable installation. Require end-to-end evidence and the identity/digest of the tested artifact before promotion.
- Promotion must drain active work or explicitly interrupt it, with visible consequences. Back up state before migrations and document rollback compatibility and restore limits. Maintain a documented SSH recovery path outside Harbor.
- Follow the user's existing authorization when testing or promoting a candidate. Ask for permission only when the action is outside that authorization or requires explicit approval; do not infer an extra approval barrier merely because Harbor is developing itself.

## Delegation and review

Act as the director: define tasks and acceptance criteria, coordinate subagents, evaluate findings, and remain accountable for the result.

- Delegate implementation to subagents and use a separate subagent for independent review.
- Reuse existing implementers or reviewers when their context is useful; spawn new agents when fresh context or another perspective would help. Choose the approach yourself.
- Follow an implementation → review → fix → verification cycle. Coordinate edits to avoid conflicts and verify accepted fixes.
- Aim for 2–3 review rounds; stop earlier if requirements are satisfied and no actionable findings remain. Each round consists of a review and any resulting fixes and verification.
- After round 3, continue only for unresolved critical issues: blockers to core requirements, security vulnerabilities, data loss, or severe correctness failures. Stop after at most 6 rounds and clearly report any remaining blockers.
- Record unresolved issues in `issues/` at the project root. Use `YYYY-MM-DD-HHMMSS-short-name.md`; add a unique suffix if needed and never overwrite an unrelated issue. Include severity, affected files, evidence or reproduction steps, impact, and suggested next steps.
- In the final response, summarize the outcome, validation, completed review rounds, and links to recorded issues. Do not claim completion while critical issues remain.
