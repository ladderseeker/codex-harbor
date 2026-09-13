# Codex Harbor repository instructions

## Scope and sources of truth

- Build a single-owner web interface and authenticated API around the official Codex runtime. Keep deployment portable across compatible Linux VPS providers.
- Implementation has started with P001. Use the proposal and issue indexes for current delivery state. Do not claim an application, command, test, deployment, or security control exists without inspecting its implementation and evidence.
- Read [design/architecture.md](design/architecture.md) and the relevant entry in [design/proposals/README.md](design/proposals/README.md) before implementation. Resolve contradictions in the documents rather than silently choosing a different contract.
- Read [docs/developer/development.md](docs/developer/development.md) for the current development and verification workflow.

## Delivery focus

- Follow [D009's common-use release decision](design/decisions/009-common-use-release.md): finish the existing everyday workflows and their verification before expanding the roadmap. P010 self-development and P012 managed extensions are deferred, with their work and unresolved obligations preserved.
- Select one complete user outcome at a time. An active proposal index is a discovery list, not authorization to implement every record concurrently. Fix shared critical defects when required by the selected outcome; do not start optional work merely because a required gate is unavailable.
- Reuse valid evidence for unchanged boundaries and keep its tested revision and limits explicit. Run the relevant acceptance and critical regressions on changed code, review and fix actionable findings, then close only fully verified proposals. Record unavailable gates and deliver a reviewable candidate without inflating completion or repeatedly running unchanged suites.

## Frontend design consistency

- Before designing or changing Harbor UI, read [design/design-tokens.html](design/design-tokens.html) and inspect the [standalone interface prototype](design/prototypes/harbor-redesign.html). The HTML guide owns the approved visual tokens and interaction patterns; the prototype is their reviewable reference. Preserve the monochrome palette, spacing hierarchy, typography, compact composer, and sidebar behavior described there.
- Reuse the existing tokens and patterns. Do not introduce page-specific colors, spacing systems, component styles, or alternate interaction patterns merely for convenience. Keep application styles aligned with the guide; the prototype is not a substitute for real application behavior or acceptance coverage.
- When a new requirement needs a token, component, state, or pattern the guide does not cover, update the canonical guide and demonstrate it in the standalone prototype in the same change, before relying on it in application implementation. Extend existing semantics where possible, document the reason and usage, and reconcile contradictions instead of leaving competing designs. Follow existing user authorization; this workflow does not add a separate approval gate.
- Review affected desktop/mobile layouts and hover, keyboard-focus, touch, and relevant empty/loading/error/disabled states. For visual or interaction changes, inspect the rendered prototype and check the changed interactions; for documentation-only changes, check consistency against the prototype, links, and whitespace. Keep the guide, prototype notes, and affected actual documentation current, with validation scoped to what was changed.

## Document ownership and lifecycle

- Put product designs, architecture decisions, and feature proposals in `design/`. Put documentation for available user behavior, developer workflows, and completed reports in `docs/`. Track findings in `issues/`, including their archived history.
- Keep each requirement in one canonical design or proposal and link to it. User and developer docs explain the implemented behavior; do not copy evolving specifications into them or present planned setup commands as available.
- Each proposal must deliver a complete, independently verifiable outcome after its explicit dependencies are delivered. Independence does not mean dependency-free. Do not split proposals by complexity, technical layer, or implementation effort.
- Include UI, API, storage, authorization, execution lifecycle, failure behavior, and end-to-end acceptance criteria in the same proposal where applicable. State exclusions and dependencies explicitly; architecture-wide invariants stay in the architecture document.

### Work discovery and indexes

- Before creating or selecting work, read the active [proposal index](design/proposals/README.md) and [issue index](issues/README.md), then their linked archive indexes; search existing records for the same outcome, finding, or dependency. Proposals stay in `design/proposals/` while active and move to `design/proposals/archive/` when archived. Issues use `issues/` and `issues/archive/`.
- Each active and archive folder has a `README.md` linking every record it owns. Proposal entries show decision/delivery state, dependencies, and next action or archive outcome. Issue entries show severity, status or archive disposition, work owner, and next action or closing outcome. Keep transferred work with pending evidence visible from the active issue index and receiving proposal index.
- Preserve proposal IDs and record filenames across renames of titles, moves, and reopening. Allocate new proposal IDs across active and archived records; never reuse an ID. Allocate issue filenames across both folders using `YYYY-MM-DD-HHMMSS-short-name.md`, adding a unique suffix on collision.
- Update record status, both affected folder indexes, higher-level navigation, and all inbound/outbound relative links and anchors in the same change as a move. Search the entire tree, including archives and reports, when changing links or dependencies. Remove archived records from the active work queue; keep only the required pending-transfer pointers there. Do not leave duplicate specification copies or stale location stubs.

### Proposal completion and archive

- Track design decisions separately from delivery. Use `Draft`, `Accepted`, or `Superseded` for the decision state; use `Planned` → `In progress` → `Implemented` → `Verified` for delivery, setting `In progress` when implementation begins. Acceptance of a design is not implementation evidence. New details remain draft unless covered by the user's approved direction or a recorded decision within that scope. These states do not create an additional permission gate for already authorized work.
- `Implemented` means the scoped behavior exists. A proposal is finished only at `Verified`: its complete acceptance criteria, required checks, and independent review pass; actual documentation is updated; and no critical scoped blocker or missing mandatory gate remains. Partial, blocked, or unverified delivery stays active. Do not hide unfinished obligations by narrowing the definition of finished.
- On completion, add closing notes with the date, delivered outcome, tested source revision or source/artifact digest, commands, environment, results, review rounds, limitations and follow-ups, and links to affected issues and current documentation. Evidence may live in a linked report under `docs/reports/`. Move the same file to the proposal archive with `Archive disposition: Completed` and the date.
- A proposal intentionally replaced or abandoned may instead be archived as `Superseded` or `Withdrawn`, with the date, reason, replacement links where applicable, and dependency impact. Preserve its actual decision/delivery state and evidence; these dispositions do not mean `Verified` or completed. Archiving does not invalidate an accepted decision or waive dependencies. Rehome unresolved transferred obligations or reopen their source issues before archiving their owner.

### Issue resolution and transfer

- Active issue statuses are `Open`, `In progress`, and `Blocked`. Each record includes severity, affected files, evidence or reproduction, impact, an owner or explicit unassigned state, and next steps. Use a proposal for new product outcomes, substantial design/security/storage/API changes, or a coherent group of findings. Bounded corrections under an existing design may be fixed directly without a proposal.
- Resolve a direct fix only after appropriate validation, independent review, and documentation updates. Record the fix, date, source revision or source/artifact digest, commands/environment/results, review rounds, and remaining limitations or linked follow-ups. Archive the same file as `Resolved` with that evidence. Documentation-only fixes use the documentation checks below.
- An issue may be archived as `Transferred` only when every unresolved obligation maps to receiving proposal IDs and named acceptance IDs or sections. The receiving proposals link back in a `Source issues` section and retain the severity, remaining risk, acceptance obligations, and blocking gate. Record per-part owners and evidence status for a multi-proposal transfer. Partial handoffs stay active; a transfer is explicitly not a resolution and waives no blocker or acceptance criterion.
- Other archive dispositions are `Duplicate` and `Not planned`, with date, rationale, and the canonical issue or decision link where applicable. Preserve evidence and remaining risk. Declining work does not remove a mandatory delivery or release gate; change its owning design explicitly or keep the affected delivery blocked.
- When receiving proposals finish, update the source issue and issue archive index with their per-part evidence. Change a transferred issue to `Resolved` only when all mapped obligations are verified; otherwise retain `Transferred`, its remaining owners, and the pending pointer in the active issue index. Update all related indexes in the same change.

### Reopening and design maintenance

- Reopen the same record if closure proves invalid or unfinished work loses its owner: add dated history, move it back to the active folder, assign an evidence-backed state, and update indexes and links. Preserve prior results as historical facts and reassess current verification when behavior or dependencies change. A new scope or regression may use a new linked issue or proposal.
- Update the canonical design before relying on major changes to product scope, contracts, security/isolation, storage, execution lifecycle, or dependencies. For a major reversal, add a focused decision document under `design/` (for example `design/decisions/`) with context, options, decision, consequences, and reciprocal replacement/supersession links; update the architecture and design index. Small corrections need no separate decision document.
- Update the targeted proposal and affected actual documentation with each behavior change. Preserve relevant decision history without competing specifications. Historical reports retain their tested baseline, digest, and results; use a dated correction or addendum for later navigation or status changes rather than rewriting past verification.

## Implementation and repository management

- Use the module boundaries and stack specified in the architecture. Keep Codex protocol handling behind the adapter and authorization on the server; never expose a raw unrestricted runtime proxy.
- Work locally on macOS or Linux first, using portable scripts, repository-relative paths, pinned dependencies, and a committed lockfile once a package workspace exists. Do not add developer-specific absolute paths or Hostinger-specific dependencies.
- Use an isolated branch/worktree per proposal when parallel implementation requires it. Coordinate file ownership, inspect working-tree changes first, and never reset, overwrite, or discard unrelated user changes.
- Keep long-lived worktrees and verification assets in persistent, ignored storage. Use operating-system temporary directories only for recreatable scratch files. Before an extended interruption, preserve coherent authorized checkpoints and record the owner and recovery plan for unfinished edits and test resources.
- Account for temporary Git stashes explicitly: record their owner, base revision, purpose, and intended integration. Before reporting delivery, reconcile staged, unstaged, and untracked contents with the resulting commits; identify any deferred work and its owner. Remove only the specific reconciled stashes, preserving a named recovery reference when their original snapshots are worth retaining. Never clear unrelated stashes.
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
- Record unresolved findings through the [issue lifecycle](#issue-resolution-and-transfer) and keep the [issue index](issues/README.md) current. Never overwrite an unrelated record.
- In the final response, summarize the outcome, validation, completed review rounds, and links to recorded issues. Do not claim completion while critical issues remain.
