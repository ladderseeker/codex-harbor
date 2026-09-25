# Evidence-based delivery workflow

This is the canonical repository collaboration and record-lifecycle contract adopted by [D013](decisions/013-evidence-based-delivery-workflow.md). [AGENTS.md](../AGENTS.md) provides essential working directives; [the developer guide](../docs/developer/development.md) documents available commands. These are repository instructions, not runtime agent configuration.

## Document ownership and lifecycle

The [architecture](architecture.md) owns shared system invariants. Numbered [subsystem designs](systems/README.md) own current feature contracts, source ownership and explicit unavailable boundaries. The [HTML guide](design-tokens.html) owns visual tokens and interaction patterns; the [prototype](prototypes/harbor-redesign.html) demonstrates them. Numbered decisions explain significant choices and supersession. Resolve contradictions in the canonical design before relying on a changed contract.

Proposals describe a bounded change against named designs. One proposal can change multiple subsystems, and one subsystem can evolve through multiple proposals. Keep each current requirement in one design location and link to it; archived plans and reports are historical evidence. User/developer docs under `docs/` describe available behavior and procedures. Findings belong in `issues/`. All authored repository content follows the [language policy in AGENTS.md](../AGENTS.md#start-here).

New proposals use exactly these states:

- **Draft:** scope or decisions are being prepared; it is not an execution instruction.
- **Accepted:** the complete plan is settled and authorized under the owner's existing direction. Implementation may proceed within that scope; this state does not claim delivery.
- **Implemented:** the scoped outcome, every mandatory acceptance gate, both independent review roles, accepted fixes, current designs/docs and closing record are complete.

There is no separate proposal delivery-state axis. An Accepted proposal remains Accepted during execution or while a mandatory gate is unavailable. State metadata does not create an additional permission gate for already authorized work. The legacy `Finished / Baseline reconciled` disposition in D013 is a one-time migration exception, never a shortcut for finishing a new proposal.

## Discover and select one outcome

Read the [proposal directory](proposals/README.md), [issue inbox](../issues/README.md) and their archive directories; search for the same need, finding and dependency. Directory README files explain navigation and rules, with no manually maintained per-record priority or status tables. Folder listings discover records; record metadata carries their facts. A proposal may record a priority from P0 (highest) to P3 in its metadata when the owner sets or requests one; it informs the owner's selection and is not a queue position. Do not create a standing roadmap from all inbox items.

The main conversation selects one complete user or developer outcome from the owner's need. Execute one proposal at a time unless the owner explicitly requests otherwise. A cohesive outcome includes its relevant UI, API, storage, authorization, execution lifecycle, failure behavior and acceptance. File count, complexity and frontend/backend boundaries do not justify splitting it. Unrelated outcomes receive separate plans when selected.

Allocate a stable proposal ID across both proposal folders and preserve its ID and filename when moving or renaming the title. New issues use `YYYY-MM-DD-HHMMSS-short-name.md`, allocated across active and archive folders with a unique suffix on collision. Never overwrite an unrelated record or reuse an ID.

Use the [proposal template](proposal-template.md). Metadata names the ID, state, owner, source issues, current design references, dependencies and exact permitted files. Each dependency identifies the required capability or evidence, its source and whether it is satisfied. Missing required dependencies block dependent execution or completion as specified; a missing unrelated gate does not prevent unaffected work. Cycles and requirements on future proposals cannot make a plan independently verifiable. A deferred legacy outcome selected again receives a new proposal linked to its preserved history and current issue obligations.

## Main's execution brief

Main settles product, architecture, security and acceptance decisions before implementation. A self-contained brief contains:

- The selected outcome, exclusions, Accepted proposal path, baseline source identity and relevant owner authorization.
- Exact design/decision sections and operational docs to read, plus the permitted file list. List old and new paths for moves; broad directory ownership is not an exact fence.
- The settled behavior and contracts, satisfied dependencies and blocking prerequisites, acceptance IDs, reproducible gates and evidence to retain.
- Current staged/unstaged/untracked ownership, disjoint worker responsibilities, run-owned resources and cleanup/recovery constraints.
- Required return format: changed paths, decisions/deviations, command results and evidence anchors, remaining issues and unmet gates; no commit.

Start the implementer with fresh initial context: provide the brief and explicit references, not the main conversation's full history. The worker reads those sources and inspects the baseline before editing. Mechanical choices within the settled design and file fence remain the implementer's responsibility. A new product/security/architecture decision or needed path outside the fence returns to main before dependent edits. Main amends the plan/design within existing authorization or asks the owner only if the change exceeds it. Preserve unaffected progress while the decision is pending.

Several workers may implement disjoint bounded parts of the same selected proposal when useful; main owns coordination and the combined gate. Each must have an exact fence. This does not authorize executing several proposals concurrently.

## Implementation and verification gate

The [implementer role](../docs/developer/agents/implementer.md) changes only its allowed files, updates current designs and actual docs, records deviations, and runs the applicable gate. It rechecks evidence links and source/artifact identities before handoff and never commits. Main reconciles the complete diff against the plan and combines worker evidence.

For behavioral changes, retain `pnpm build`, `pnpm check`, `pnpm test`, the selected outcome's real-stack E2E and critical regression checks. Internal Harbor services remain real; deterministic fixtures may replace only external Codex and identity-provider boundaries. Adapter/integration changes additionally need pinned real-runtime contracts and bounded live smoke checks. Launch, sandbox, mount or network-policy changes need actual supported Linux isolation. Applicable specialist checks supplement these gates. The [architecture verification contract](architecture.md#repeatable-verification-through-the-application) defines those boundaries; the [developer guide](../docs/developer/development.md#command-availability) identifies actual commands and prerequisites.

For documentation-only work, run `node scripts/check-docs.mjs` and `git diff --check`; include new/untracked Markdown in structure, consistency, local-path/anchor, trailing-whitespace and final-newline checks. Audit the changed path list against the fence. Review any document-specific mapping or history-preservation obligations. Do not run or claim unrelated application acceptance as documentation evidence.

Reuse evidence for unchanged boundaries only with its tested revision, environment and limitations explicit. Rerun checks for changed code, failures or unresolved concerns; do not repeatedly run unchanged suites to fill time. A required missing credential, runtime, infrastructure or approval makes its gate unavailable, never passed. Record the blocker in an issue, continue unaffected work, and deliver a reviewable candidate with the missing gate stated. It cannot reach Implemented while that mandatory gate remains missing.

All test state is private and run-owned: fresh database, credentials, directories, ports, project fixtures, `CODEX_HOME` and resource manifest. Never use personal projects, ordinary Codex state or production data. Keep stable, editable and candidate installations separate; fixed trusted build/test templates confer only disposable candidate authority. Cleanup touches only resources identified by the run. Repository edits preserve unrelated Git changes/stashes and the [safety constraints](../AGENTS.md#implementation-and-safety).

## Delegation and review

Once the applicable combined gate is green, main automatically starts two independent review roles, without another permission request:

1. The [design reviewer](../docs/developer/agents/design-reviewer.md) checks the outcome, contracts, scope, design consistency, dependencies and acceptance completeness against the actual diff.
2. The [provenance reviewer](../docs/developer/agents/provenance-reviewer.md) checks claims against source identity, observed commands/results and accessible artifacts, including what remains unavailable.

Both reviewers begin with fresh context and no authorship of the changes. Main gives each a self-contained brief with the proposal, canonical designs, source/diff identity, exact scope, gate artifacts, role and report format. They may inspect source and perform read-only checks; any scratch output must stay in a separate assigned run-owned evidence path. They only report, never edit the implementation, decide the product contract or commit. Each remains responsible for its own assessment rather than treating the other review as proof. If a required gate is unavailable, a bounded advisory review may help the candidate, but must be labelled advisory and cannot satisfy the normal completion review gate.

A round consists of both role reviews, main's finding dispositions, any fixes, and verification of those fixes. Main records each finding as accepted, rejected with reason, or outside scope with an issue link. Main sends accepted scoped fixes to the same implementer, keeps reviewers free of code authorship, and reruns affected checks. Subsequent review uses the same reviewers when their context is useful; initial independence is preserved. Do not add speculative improvements to the selected plan.

Stop early when the scoped gate and both reviews are clear. Stop after at most three rounds, including fix verification; there is no extra critical-issue exception beyond that cap. Remaining blockers go to the owner with a concrete issue, impact, evidence and next decision. The proposal stays Accepted. Do not silently waive findings or turn an exhausted review budget into completion.

Out-of-scope findings are recorded promptly in the inbox. Only a blocker to the current outcome or a critical correctness, security or data-loss problem interrupts the selected work. Main judges scope and evidence, remains accountable for the combined result, and does not outsource that judgment to a reviewer.

## Evidence and provenance

Retain the tested source revision or reproducible source/artifact digest, exact path scope, environment/runtime versions, commands, exit codes, observed results, acceptance mapping, review rounds and findings/dispositions. Give run artifacts stable paths and identities; distinguish raw command output from interpretation. Recheck path and anchor links before delivery. Screenshots support observable assertions but cannot prove an unexercised backend or isolation boundary.

A report is not independent proof of its own assertions. Trace claims to source inspection, actual command output and accessible artifacts. Historical reports may establish what was reported at their dated source, not a newly executed check or a current artifact's availability. When a referenced artifact or complete raw session log is unavailable, say so explicitly and qualify any derived claim. Reviewer messages may be identified as review evidence; do not describe them as a complete exported session log. Never copy secrets or private conversation contents into tracked documentation.

Keep evidence that must survive interruption in persistent ignored storage and record ownership/recovery for unfinished changes and test resources. OS temporary files are for recreatable scratch. Do not erase earlier failed runs or rewrite historical results after a later pass; append a dated correction or follow-up.

## Proposal completion and archive

Main checks that every scoped acceptance ID and mandatory dependency/gate is satisfied, both review roles are clear, fixes are verified and no in-scope finding remains unresolved. Update the current designs and actual behavior docs, source-issue evidence and all affected navigation before setting Implemented.

The closing record includes date, delivered outcome, tested source/artifact identity, commands, environment, results, review rounds and dispositions, limitations/follow-ups, issue links and current docs. A linked report under `docs/reports/` may hold detail. Move the same proposal file to `design/proposals/archive/` with `Archive disposition: Completed` and its date. Preserve the ID/filename; repair inbound/outbound paths and anchors across the entire tree, including archived records and historical reports. Directory README files remain navigation, not status queues.

A plan intentionally replaced or abandoned can be archived as Superseded or Withdrawn with its actual state, date, rationale, replacement links and dependency impact. Those dispositions do not mean Implemented. Rehome every unresolved obligation in an inbox issue or an explicitly selected receiving plan before retiring its owner. The D013 baseline reconciliation is a separately bounded historical exception.

Main presents the coherent uncommitted result, validation, review rounds and remaining issues to the owner, who reviews and confirms the commit. Implementers never commit; main commits only with that confirmation, using the configured or owner-provided identity. Push and deployment follow their own applicable authorization. Reconcile staged, unstaged and untracked contents and owned stashes with any resulting commit; identify deferred work and its owner.

## Issue resolution and transfer

An inbox file describes one concrete problem: affected files or behavior, evidence/reproduction, impact and severity, ownership (or explicitly awaiting owner selection), remaining obligation and a reproducible recheck path. It is a factual record, not an entry in a priority queue. Existing dated status history may remain inside the record.

An issue leaves the inbox only when every obligation is explicitly taken by an Accepted proposal, a correction requiring no new design choice is verified, or it is retired with an evidence-backed reason. Use a proposal for a new product outcome, substantial design/security/storage/API change or coherent group of findings. A bounded correction under the current design may use a direct fix; retain applicable validation, both independent review roles and documentation before resolving it.

For transfer, map every obligation to receiving proposal IDs and named acceptance IDs/sections. The plan links back under Source issues and retains severity, risk, gate and evidence status. A partial handoff stays in the inbox. On a complete handoff, archive the same issue as Transferred with date and ownership mapping; transfer is not resolution and waives no gate. If several selected owners are explicitly authorized, record each part separately. If an owner disappears or is archived without satisfying the obligation, reopen the same issue immediately.

For resolution, record fix/date, source or artifact identity, commands/environment/results, reviews and limitations; archive as Resolved. A transferred issue becomes Resolved only after every mapped obligation passes. Other retirement dispositions are Duplicate or Not planned, with date, evidence, rationale and canonical issue/decision link. Retirement cannot erase a product or release gate: explicitly change its owning design within authorization, or preserve the gate and its owner.

## Reopening and design maintenance

If closure proves invalid, reopen the same record, add dated history and current ownership, move it back to its active folder, and repair links. Reassess evidence affected by behavior or dependency changes while preserving prior results as historical facts. A distinct regression or new scope may receive a linked new issue/proposal.

Update canonical designs before relying on major changes to scope, contracts, security/isolation, storage, lifecycle or dependencies. A major reversal receives a focused numbered decision with context, options, decision, consequences and reciprocal supersession links. Small corrections need no new decision document. A worker returns unsettled decisions to main; main applies existing owner authorization without inventing another approval barrier.

For UI changes, follow the HTML guide's ownership: specify and demonstrate a new pattern there and in the prototype before application use, in the same change. Review desktop/mobile and keyboard, hover/touch and relevant state behavior. Documentation-only edits check consistency without claiming rendered interaction or application acceptance.
