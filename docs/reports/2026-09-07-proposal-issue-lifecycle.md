# Proposal and issue lifecycle review — 7 September 2026

One independent review round completed with no actionable findings. The documentation checks passed. This report establishes the repository workflow and record migration only.

## Scope and rationale

This change implements the owner's requested proposal and issue management workflow. [AGENTS.md](../../AGENTS.md) owns the rules; directory indexes expose current work and archive locations. Proposal completion requires the existing verification gate. An issue transferred to a proposal retains its unresolved obligations, severity, and evidence requirements.

Preserving the rationale for significant decisions and linking replacements follows [Microsoft's ADR guidance](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record). [GitHub's issue closure guidance](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/closing-an-issue) distinguishes completion from other reasons to close an issue. Harbor's explicit `Transferred` disposition is a repository workflow choice: the issue record leaves the standalone queue while receiving proposals continue to track the work.

The [runtime compatibility finding](../../issues/2026-09-07-073831-codex-runtime-compatibility.md) was archived as Transferred to P001 and P009, preserving their separate local-runtime and target-host gates. Its medium-severity risk and both evidence parts remain pending. This organizational change does not advance any of the 12 Draft/Planned proposals or establish runtime compatibility, implementation, or deployment readiness.

## Source and verification

The change starts from Git revision `a645599bb957f67b47d587970c7814b5bd2b6396`. The [earlier design review](2026-09-07-design-review.md) remains historical evidence for that baseline; its source digest and review results are preserved and were checked against the committed baseline.

Final source snapshot SHA-256: `1bb7b1d19d84df2f4c5c47a942028566a477ab53d1cdf3b477018663d90f9b43`. It covers 24 Markdown files, excluding `docs/reports/` to avoid self-reference. Hash input is each lexicographically sorted repository-relative POSIX path encoded as UTF-8, a NUL byte, its raw file bytes, then a NUL byte. This digest identifies the reviewed lifecycle source independently of the later commit.

The coordinating agent used a temporary Python standard-library validator outside the repository on Darwin 24.6.0 / arm64 with Python 3.9.6. `python3` validation exited `0`: 27 files, 26 Markdown documents, 161 local links and heading anchors, 12 active Draft/Planned proposals, and 78 unchanged unique acceptance IDs. Checks covered local navigation, document titles and code fences, final newlines and whitespace, proposal status/index consistency, the dependency graph, archive indexes, reciprocal issue ownership, and the historical digest. `git diff --check` also exited `0`.

Independent review round 1 checked completion evidence, mandatory gates, complete and partial transfers, multiple owners, reopening, supersession, current indexes, and preserved historical evidence. It found no actionable issues, so the review cycle stopped after that round under the repository rule. The coordinator then finalized this report and checked its links and recorded evidence.

No application, E2E, live-runtime, or Linux isolation tests were run or claimed for this documentation-only change. The transferred compatibility finding remains an implementation/release gate; archiving has not resolved it.

## Navigation and ownership addendum — 20 September 2026

P017 reconciled legacy planning records into the [proposal archive](../../design/proposals/archive/). [Current subsystem designs](../../design/systems/) now own requirements, and unfinished acceptance belongs to the [issue inbox](../../issues/) until a new proposal is selected. Historical statements here about active proposal states, queues, permissions and recovery locations describe the recorded date. This addendum changes navigation/ownership only: original tested sources, commands, results, review rounds and limitations above remain historical evidence. No application gate was rerun for the documentation migration. Historical raw artifacts or worktrees not present in this checkout were not newly verified.
