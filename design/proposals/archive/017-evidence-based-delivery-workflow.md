# P017 — Evidence-based delivery workflow and baseline reconciliation

## Metadata

- ID: P017
- Status: Implemented
- Archive disposition: Completed
- Completed: 2026-09-20
- Created: 2026-09-20
- Owner: Main conversation; implementation delegated to fresh-context workers.
- Dependencies: None. This is a documentation migration over source `008227355bd05cb27dc13f4fbb585ef709b474b0`; it does not depend on passing unresolved application acceptance.
- Source issues: Existing proposal/issue duplication and ownership gaps are reconciled here; individual application obligations remain in their own issues.
- Design references: [Architecture](../../architecture.md), [D009](../../decisions/009-common-use-release.md), [design navigation](../../README.md); this change adds D013, the workflow contract and six subsystem design documents.
- Authorization: The owner explicitly requested this proposal and its implementation on 2026-09-20. Commit/push/deployment are not authorized by this proposal.
- Scope: One cohesive outcome: a contributor can select one need, execute a bounded plan, verify it, independently review its design and evidence, and close it without stale queues or lost historical obligations.
- Acceptance IDs: P017-01 through P017-07.

## Problem and current baseline

The repository separately maintains proposal states, issue states, multiple status tables, feature specifications in proposals, design decisions and delivery reports. P016 is archived while a current queue row still lists unfinished deployment. P001–P013/P015 hold delivered code, missing acceptance, partial work and deferred work in the same active planning surface. These records obscure the next owner-selected task.

The user requests a one-time reconciliation of old proposals and a durable workflow: issues are an inbox, proposals are executable plans, and structurally managed design documents describe the current system. The main conversation writes plans and judges findings. Fresh-context workers implement and two independent reviewers examine correctness and provenance. One proposal is executed at a time unless the owner explicitly requests otherwise.

This proposal changes documentation and collaboration rules only. UI, API, storage, authorization, runtime lifecycle and deployment behavior are unchanged. No application test or deployment claim may be inferred from this migration.

## Decisions and invariants

1. Current normative requirements live in the architecture, subsystem designs and UI guide, with explicit relationships to numbered decisions. Proposals specify bounded changes against those designs. Archived proposals and reports preserve history and evidence, not competing current specifications. A proposal may touch several subsystems; a subsystem may evolve through many proposals.
2. New proposals use `Draft → Accepted → Implemented`. Accepted is sufficient to execute under the owner's existing authorization. Implemented requires the complete scoped acceptance gate, two independent review roles, resolved in-scope findings, design/document updates and a closure record. Acceptance is never implementation evidence. Unavailable mandatory gates prevent normal completion.
3. Each proposal is a highly cohesive, logically closed outcome. Size, number of files and technical layers are not splitting rules. Unrelated outcomes are separate proposals. Metadata lists stable IDs, status, dependencies, source issues, design references and the exact permitted files. Dependencies name the required capability/evidence and whether it is satisfied; missing required dependencies block dependent execution or completion. Cycles and requirements on future proposals cannot make an outcome closed.
4. The main loop writes a self-contained execution brief. Product, architecture, security and acceptance decisions are settled before implementation. Workers read named designs first, stay within the fixed file fence, record deviations and return newly required decisions/fence changes to the main loop. Mechanical implementation choices within the settled contract do not require another user approval.
5. Issues are one concrete problem per file with evidence, impact and a recheck path. There is no priority queue or manually maintained per-record status table. Folder listings discover active and archived records; README files explain navigation and rules. An issue leaves the inbox when a proposal explicitly takes every obligation, a no-design-choice fix is verified, or it is retired with an evidence-backed reason. Transfer does not imply resolution. Findings outside the selected outcome are recorded promptly; only a current blocker or critical correctness/security/data-loss problem interrupts it.
6. The implementer runs the applicable gate, rechecks evidence anchors, updates designs and reports, and never commits. A separate design reviewer and provenance reviewer only report. They start automatically once the gate is green, with fresh contexts and no code authorship. Main adjudicates each finding, returns scoped fixes to the same implementer, and verifies them. Stop after at most three review rounds; stop earlier when clear. Remaining blockers are reported to the owner, never silently waived. Owner reviews the result and confirms a commit.
7. Behavioral changes retain `pnpm build`, `pnpm check`, `pnpm test`, relevant real-stack E2E and critical regression checks; adapter changes retain real-runtime contract/live checks; execution isolation changes retain actual Linux checks. Documentation-only changes use structure, consistency, local-link/anchor and whitespace checks. Reuse identified evidence for unchanged boundaries instead of repeatedly rerunning unrelated suites.
8. Tests and evidence use private run-owned state. Preserve auth, adapter and isolation boundaries, stable/candidate separation, existing owner files, Git changes and stashes, portable paths and pinned dependencies. No host administration or production changes are part of this work.
9. Provenance claims must resolve to observed commands/results, source or artifact identity and accessible evidence. A report is not independent proof of its own assertions. An unavailable session log or expired artifact is explicitly marked unavailable; historical reports may be cited as historical reports, never as newly rerun checks. No secrets or private conversation contents are copied into tracked documents.

## One-time legacy reconciliation

D013 explicitly supersedes the old rule that all existing proposal plans remain active until every original gate passes. It does not waive any product/security/release gate.

Rewrite P001–P013 and P015 as current-baseline records, keep IDs and filenames, and archive them with `Record status: Finished`, `Archive disposition: Baseline reconciled` and the reconciliation date. This is a one-time legacy record disposition, not the `Implemented` state of the new workflow and not a claim that their full original plans shipped. Describe each delivered, partial or deferred boundary and cite implementation paths plus historical evidence. Preserve the original plan, acceptance IDs and dated evidence under an explicitly non-normative historical section; preserve link anchors. P014 and P016 retain their already verified completion evidence and receive current-design references.

For every unresolved acceptance obligation, retain a named mapping in the rewritten record to an active issue. Reuse existing matching issues and add dated ownership addenda; create the two predeclared gap records below for deferred complete outcomes. Reopen the transferred runtime-compatibility issue under the same filename because its former active proposal owners are being retired, and explicitly retain P009-01–07 including conversation reboot and restore-failure evidence. Active records have inbox ownership awaiting operator selection, rather than implying the archived proposal is still executing. Do not resolve an issue merely because its source proposal is archived. Reconcile P013's stale critical-gate wording against its report's dated P014 addendum; this documented later pass needs no new issue.

- `2026-09-20-000003-self-development-acceptance.md`: deferred complete self-development integration/acceptance, retaining P010 obligations and links to individually recorded defects.
- `2026-09-20-000004-managed-extensions-acceptance.md`: deferred complete managed-extension integration/acceptance, retaining P012 obligations and links to individually recorded defects.

Future work selected from these issues receives a new proposal ID and explicit dependency metadata. Do not manufacture a new standing roadmap, draft every deferred feature, erase old evidence or relabel missing gates as passed.

## Design integration

Add `design/systems/README.md` and six numbered documents:

- `001-conversations-and-access.md`: conversation lifecycle, identity/tokens, history/recovery (P001/P002/P007).
- `002-workspaces-and-resources.md`: projects, file/Git access, attachments, terminals and private previews (P003/P004/P005/P006/P011).
- `003-scheduled-execution.md`: schedules, occurrence authority and restoration constraints (P008).
- `004-deployment-and-profiles.md`: managed deployment versus personal local/VPS profiles, current tooling and remaining recovery gates (P009/P013/P015).
- `005-development-and-extensions.md`: explicitly deferred self-development and managed-extension contracts, partial source/history and unsupported end-to-end claims (P010/P012).
- `006-interface.md`: current interface contracts and ownership of the canonical token guide/prototype (P014/P016).

Each document identifies actual source ownership, current behavior, durable invariants, relevant API/state/failure/security contracts, evidence limits and issue references. Fold feature-specific current requirements from proposals into these documents; do not merely link back to archived plans as binding authority. Keep architecture-wide invariants in architecture and visual tokens in the existing HTML guide. Read the HTML guide and prototype for consistency; no visual assets are changed. Retain planned/deferred boundaries as explicitly unavailable contracts where relevant. Documents must not advertise unimplemented commands or complete managed/self-development readiness.

Add `design/workflow.md` as the canonical detailed collaboration/lifecycle contract, D013 for the decision and one-time migration rationale, and three plain repository role briefs under `docs/developer/agents/`. No runtime-specific agent configuration, plugin, or product feature is introduced. Condense AGENTS.md to essential directives and links (target no more than 110 lines), keeping critical safety and verification obligations directly discoverable. Update the developer guide and navigation to remove competing lifecycle definitions and status tables.

## Implementation sequence and ownership

1. Main writes this Accepted proposal, records the clean baseline and allocates disjoint implementation fences. Read-only baseline research may precede implementation.
2. Workflow implementer owns AGENTS.md, design/workflow.md, D013, architecture, design/README.md, proposal template, role briefs, README.md, docs/README.md and docs/developer/development.md.
3. Baseline implementer owns legacy proposal moves/rewrites, proposal/issue directory READMEs, subsystem designs and all issue records. It updates moved-record links in other existing Markdown files only after the workflow implementer finishes those files. Historical reports receive only link maintenance and dated navigation/ownership addenda; past results are not rewritten.
4. Main owns this proposal and the P017 report, gathers independent outputs and performs the documentation gate. Persistent recreatable evidence lives in `.test-runs/p017-workflow-migration/`.
5. After green checks, two fresh-context reviewers independently inspect the plan/design/diff and observed evidence. Main adjudicates, sends fixes to original workers, and reruns affected checks.
6. Complete the report and archive this proposal with Status Implemented only after P017-01–07 pass. No commit, push or deployment. Present the outcome for owner review.

## Acceptance criteria

- **P017-01 Workflow:** English-only new rules define the three proposal states, cohesive scope, one proposal at a time, exact file fences and dependency metadata; issues have no priority/status tables; concise AGENTS points to one detailed contract and three named roles. Commit confirmation and automatic independent review are explicit.
- **P017-02 Design:** Each P001–P016 topic maps to a current subsystem document plus shared architecture/UI rules. Current source paths exist. Current, partial, deferred and unverified boundaries are distinguished. Archived proposals are not the binding design.
- **P017-03 Baseline:** P001–P016 are in the archive with preserved IDs, acceptance/evidence history and honest delivered scope. Each incomplete legacy criterion/section maps to an inbox issue; runtime compatibility is reopened with historical identity preserved. No original verification is fabricated.
- **P017-04 Navigation:** Directory READMEs provide navigation rather than hand-maintained per-record state/priority tables. All local Markdown paths and anchors resolve after moves. Current guides do not direct contributors to retired queues or use the old dual-state workflow.
- **P017-05 Gate:** `node scripts/check-docs.mjs` and `git diff --check` exit zero; new/untracked Markdown files also satisfy whitespace and final-newline checks. Audit the final changed path list against the exact fence. Application/runtime/HTML/package/test source is unchanged; no application suites are claimed as executed.
- **P017-06 Review and provenance:** Independent design and provenance reviews complete within three rounds, with main's finding dispositions and verified fixes. The report identifies baseline/source digest, actual check commands and results, accessible evidence and explicit unavailable historical/raw-session evidence.
- **P017-07 Delivery:** Current designs/docs and the report are reconciled, P017 is Implemented and archived, there is no active proposal execution or invented backlog, and the final diff remains uncommitted for the owner's review.

## Verification and evidence plan

Use source inspection and historical reports for legacy reconciliation. Record each as documentary evidence, not a fresh application test. The baseline is `008227355bd05cb27dc13f4fbb585ef709b474b0` with a clean working tree. Command logs retained under the run directory are raw validation output; a task ledger lists delegation, reviews, fixes and command artifact identities. Reviewer messages in this task are the review evidence. Do not claim access to a complete exported runtime session log when none is available.

For stable source identity without self-reference, hash the sorted changed/new documentation paths and bytes excluding this proposal and its report; store the path list and digest in the report. Separately inspect final proposal/report links and whitespace. This identifies the implementation assessed by reviewers while allowing their final results to be written afterward. Log reviewer-specific extra checks separately.

## Rollout and recovery

This is an uncommitted documentation-only candidate. Existing Git history preserves the original records. No stashes, worktrees, dependency installs, database migrations or service changes are needed. Reversal is a reviewed inverse documentation patch; do not reset unrelated edits. Full application gates remain owned by their recorded issues and future owner-selected proposals.

## Review record and closure

Completed on 2026-09-20. P017-01–07 deliver the English workflow, concise repository instructions, three independent execution/review roles, six current subsystem designs, reconciled legacy archives and preserved inbox obligations. Two independent review rounds completed: round 1 found one stale workspace-contract paragraph; the original implementer fixed it; both round-2 reviews were clear.

The reviewed implementation digest is `0f2acb84fa8551957aac3af0f5bd477e35d949b611c39fdf975c7bd9edb50eef` against baseline `008227355bd05cb27dc13f4fbb585ef709b474b0`. Documentation checks covered 152 Markdown files, local paths/anchors, all changed/new whitespace, the exact file fence and retained history. The [migration report](../../../docs/reports/2026-09-20-workflow-migration.md) records exact command exits, review dispositions and a separate final bookkeeping digest/gate after this move.

No application behavior changed or application gate was rerun. Historical product acceptance, missing remote artifacts and unavailable full runtime-session export retain their explicit limitations. Legacy Finished / Baseline reconciled is not a new product-verification claim. The working-tree candidate remains uncommitted for owner review; no push or deployment occurred.

## Exact file fence

Only the following tracked paths may be added, changed, moved or removed. Old and new move paths are both listed. Existing historical/report files outside the ownership list above may receive link corrections and dated navigation/ownership notes only. No directory glob expands this fence. Private run-owned scratch artifacts are limited to `.test-runs/p017-workflow-migration/`; they are evidence, not product changes. Any extra tracked path requires main to amend this proposal first.

- `AGENTS.md`
- `README.md`
- `design/README.md`
- `design/architecture.md`
- `design/decisions/001-confined-runtime-egress.md`
- `design/decisions/002-registered-mount-authority.md`
- `design/decisions/003-quota-backed-project-storage.md`
- `design/decisions/004-protected-runtime-credentials.md`
- `design/decisions/005-managed-project-workspaces.md`
- `design/decisions/006-portable-release-and-restore.md`
- `design/decisions/007-confined-project-preview-origins.md`
- `design/decisions/008-isolated-self-development-workers.md`
- `design/decisions/009-common-use-release.md`
- `design/decisions/010-personal-local-experience.md`
- `design/decisions/011-personal-vps-workspace.md`
- `design/decisions/012-personal-vps-development.md`
- `design/decisions/013-evidence-based-delivery-workflow.md`
- `design/proposal-template.md`
- `design/proposals/001-secure-persistent-conversations.md`
- `design/proposals/002-programmatic-api-access.md`
- `design/proposals/003-parallel-project-workspaces.md`
- `design/proposals/004-files-and-change-review.md`
- `design/proposals/005-attachments-and-rich-input.md`
- `design/proposals/006-persistent-terminal.md`
- `design/proposals/007-session-history-and-recovery.md`
- `design/proposals/008-scheduled-tasks.md`
- `design/proposals/009-portable-deployment-and-restore.md`
- `design/proposals/010-self-development.md`
- `design/proposals/011-private-project-previews.md`
- `design/proposals/012-managed-skills-and-mcp.md`
- `design/proposals/013-personal-local-experience.md`
- `design/proposals/015-personal-vps-workspace.md`
- `design/proposals/017-evidence-based-delivery-workflow.md`
- `design/proposals/README.md`
- `design/proposals/archive/001-secure-persistent-conversations.md`
- `design/proposals/archive/002-programmatic-api-access.md`
- `design/proposals/archive/003-parallel-project-workspaces.md`
- `design/proposals/archive/004-files-and-change-review.md`
- `design/proposals/archive/005-attachments-and-rich-input.md`
- `design/proposals/archive/006-persistent-terminal.md`
- `design/proposals/archive/007-session-history-and-recovery.md`
- `design/proposals/archive/008-scheduled-tasks.md`
- `design/proposals/archive/009-portable-deployment-and-restore.md`
- `design/proposals/archive/010-self-development.md`
- `design/proposals/archive/011-private-project-previews.md`
- `design/proposals/archive/012-managed-skills-and-mcp.md`
- `design/proposals/archive/013-personal-local-experience.md`
- `design/proposals/archive/014-consistent-frontend.md`
- `design/proposals/archive/015-personal-vps-workspace.md`
- `design/proposals/archive/016-conversation-first-interface.md`
- `design/proposals/archive/017-evidence-based-delivery-workflow.md`
- `design/proposals/archive/README.md`
- `design/prototypes/README.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/002-workspaces-and-resources.md`
- `design/systems/003-scheduled-execution.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/systems/005-development-and-extensions.md`
- `design/systems/006-interface.md`
- `design/systems/README.md`
- `design/workflow.md`
- `docs/README.md`
- `docs/developer/agents/design-reviewer.md`
- `docs/developer/agents/implementer.md`
- `docs/developer/agents/provenance-reviewer.md`
- `docs/developer/attachments.md`
- `docs/developer/deployment.md`
- `docs/developer/development.md`
- `docs/developer/files.md`
- `docs/developer/linux-verification.md`
- `docs/developer/local-personal.md`
- `docs/developer/personal-vps.md`
- `docs/developer/previews.md`
- `docs/developer/programmatic-api.md`
- `docs/developer/schedules.md`
- `docs/developer/workspaces.md`
- `docs/reports/2026-09-07-design-review.md`
- `docs/reports/2026-09-07-gateway-transport-diagnostic.md`
- `docs/reports/2026-09-07-p001-foundation.md`
- `docs/reports/2026-09-07-p002-api-tokens.md`
- `docs/reports/2026-09-07-p003-workspaces.md`
- `docs/reports/2026-09-07-p005-attachments.md`
- `docs/reports/2026-09-07-p005-integration.md`
- `docs/reports/2026-09-07-p007-history-integration.md`
- `docs/reports/2026-09-07-proposal-issue-lifecycle.md`
- `docs/reports/2026-09-08-feature-verification-host.md`
- `docs/reports/2026-09-08-installed-module-integration.md`
- `docs/reports/2026-09-08-p004-files.md`
- `docs/reports/2026-09-08-p004-p006-integration.md`
- `docs/reports/2026-09-08-p006-development.md`
- `docs/reports/2026-09-08-p008-development.md`
- `docs/reports/2026-09-08-p009-development.md`
- `docs/reports/2026-09-08-p011-development.md`
- `docs/reports/2026-09-08-p011-protocol-spike.md`
- `docs/reports/2026-09-08-p012-protocol-spike.md`
- `docs/reports/2026-09-08-stash-reconciliation.md`
- `docs/reports/2026-09-13-common-use-acknowledgement.md`
- `docs/reports/2026-09-13-common-use-delivery.md`
- `docs/reports/2026-09-13-frontend-redesign.md`
- `docs/reports/2026-09-13-interrupted-work-recovery.md`
- `docs/reports/2026-09-13-p007-live-history-driver.md`
- `docs/reports/2026-09-13-p010-cache-executable-modes.md`
- `docs/reports/2026-09-13-p010-command-diagnostics.md`
- `docs/reports/2026-09-13-personal-local-experience.md`
- `docs/reports/2026-09-13-personal-vps-candidate.md`
- `docs/reports/2026-09-14-markdown-rendering.md`
- `docs/reports/2026-09-14-personal-development.md`
- `docs/reports/2026-09-15-conversation-interface.md`
- `docs/reports/2026-09-20-workflow-migration.md`
- `docs/user/README.md`
- `docs/user/api-tokens.md`
- `docs/user/attachments.md`
- `docs/user/conversations.md`
- `docs/user/previews.md`
- `docs/user/schedules.md`
- `docs/user/terminals.md`
- `docs/user/workspaces.md`
- `infra/deploy/README.md`
- `issues/2026-09-07-073831-codex-runtime-compatibility.md`
- `issues/2026-09-07-171225-live-runtime-credentials.md`
- `issues/2026-09-07-185228-linux-gateway-availability.md`
- `issues/2026-09-07-231526-p009-backup-transfer-approval.md`
- `issues/2026-09-08-005028-p006-implementation-review.md`
- `issues/2026-09-08-012652-p004-implementation-review.md`
- `issues/2026-09-08-020429-p007-regression-evidence.md`
- `issues/2026-09-08-044009-p005-selection-regression.md`
- `issues/2026-09-08-045236-p010-artifact-link-boundary.md`
- `issues/2026-09-08-061531-p010-relay-deadline.md`
- `issues/2026-09-08-065900-p010-expired-worker-start.md`
- `issues/2026-09-13-022007-test-host-ssh-recovery.md`
- `issues/2026-09-13-042641-p012-implementation-review.md`
- `issues/2026-09-13-044423-p010-worker-backing-reserve.md`
- `issues/2026-09-13-052647-p010-source-upload-boundary.md`
- `issues/2026-09-13-054640-p010-fixture-build-lifetime.md`
- `issues/2026-09-13-060202-p012-restored-command-replay.md`
- `issues/2026-09-13-063901-p010-log-diagnostics.md`
- `issues/2026-09-13-065252-p010-candidate-login-landing.md`
- `issues/2026-09-13-070147-p010-cache-executable-mode.md`
- `issues/2026-09-13-074853-p010-tools-disk-recovery-approval.md`
- `issues/2026-09-13-085836-p010-cache-driver-transfer-approval.md`
- `issues/2026-09-13-110315-common-use-live-acceptance.md`
- `issues/2026-09-13-130622-personal-vps-acceptance.md`
- `issues/2026-09-20-000003-self-development-acceptance.md`
- `issues/2026-09-20-000004-managed-extensions-acceptance.md`
- `issues/README.md`
- `issues/archive/2026-09-07-073831-codex-runtime-compatibility.md`
- `issues/archive/2026-09-07-174757-p001-review-findings.md`
- `issues/archive/2026-09-07-185228-p001-retention-control-bounds.md`
- `issues/archive/2026-09-07-202308-authority-expiry-after-lock-wait.md`
- `issues/archive/2026-09-07-203000-p007-implementation-review.md`
- `issues/archive/2026-09-07-205511-unregistered-project-allocation.md`
- `issues/archive/2026-09-07-210500-p003-implementation-review.md`
- `issues/archive/2026-09-07-213300-p005-implementation-review.md`
- `issues/archive/2026-09-07-224419-p005-reload-visibility.md`
- `issues/archive/2026-09-08-005028-p009-implementation-review.md`
- `issues/archive/2026-09-08-015752-p002-rate-limit-acceptance.md`
- `issues/archive/2026-09-08-031032-p009-installed-web-assets.md`
- `issues/archive/2026-09-08-031857-workspace-quota-import.md`
- `issues/archive/2026-09-08-035221-workspace-validation-identity.md`
- `issues/archive/2026-09-08-044007-p008-implementation-review.md`
- `issues/archive/2026-09-08-044008-p009-resume-readiness.md`
- `issues/archive/2026-09-13-022008-preview-retirement-race.md`
- `issues/archive/2026-09-13-022009-native-acknowledgement-deadlock.md`
- `issues/archive/2026-09-13-024011-terminal-contract-home.md`
- `issues/archive/2026-09-13-024503-p011-implementation-review.md`
- `issues/archive/2026-09-13-143000-personal-local-review.md`
- `issues/archive/2026-09-13-143001-local-critical-regression-gate.md`
- `issues/archive/README.md`
