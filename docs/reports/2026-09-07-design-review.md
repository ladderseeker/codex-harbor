# Expanded design review — 7 September 2026

Two independent design review rounds completed for the expanded Harbor plan. Round 2 found no remaining actionable design findings. This is documentation verification: no application, end-to-end, live Codex, or Linux isolation tests were executed.

## Scope and source

Reviewed the [architecture](../../design/architecture.md), [12 feature proposals](../../design/proposals/README.md), proposal template, repository workflow, developer guidance, and their consistency. The expanded scope includes local-first development, browser/API verification, persistent execution, candidate self-development, isolation, portable deployment, and recovery.

The reviewed material is the uncommitted working tree; task files are untracked. No Git revision is asserted. The earlier architecture review was historical context and is separate from the two expanded-scope rounds recorded here.

Final source snapshot SHA-256: `b88f078f0ff4ef72ffac18ffdfb917a8274bc3bd7c7b57ccee57d70cad4e08a3`. This covers 21 Markdown files: root `AGENTS.md` and `README.md`, plus all Markdown under `design/`, `docs/`, and `issues/`, excluding reports to avoid a self-referential digest. Hash input is each lexicographically sorted repository-relative POSIX path encoded as UTF-8, a NUL byte, its raw file bytes, then a NUL byte.

## Independent review results

Round 1 produced four corrections, all applied before round 2:

1. Scoped the credential prohibition to the stable installation, trusted broker administration, and other instances. Disposable candidate code can use its own database/OIDC and restricted candidate-launcher credentials.
2. Required self-development E2E acceptance to use an immutable snapshot of the actual Harbor repository, an editable candidate worktree, and a controlled change; a toy application is insufficient.
3. Replaced an incorrect “implemented” claim in P010 with an explicit requirement upon delivery.
4. Mapped the compatibility issue to P001's runtime/local Linux checks and P009's target VPS/release gate, replacing obsolete phase references.

Round 2 independently verified those corrections and reported no remaining actionable findings. Review completion does not change proposal approval or delivery status: all 12 proposals remain `Decision: Draft` and `Delivery: Planned`.

## Documentation checks

The coordinating agent ran an inline Python standard-library validator using `python3` on Darwin 24.6.0 / arm64 with Python 3.9.6. The final complete-tree pass exited `0`: 22 Markdown files, 89 local links and heading anchors, 12 proposals, and 78 unique acceptance IDs.

The checks covered local target paths and anchors, code fences, final newlines, trailing whitespace, proposal status fields, dependency graph acyclicity and registry consistency, acceptance identifier consistency, and removal of the obsolete architecture path. These were direct documentation checks, not repository test scripts or executable application commands. `git diff --check` also exited `0`; the direct file checks supplied coverage of the untracked documents that command does not inspect.

## Remaining validation

The [medium-severity Codex compatibility issue](../../issues/2026-09-07-073831-codex-runtime-compatibility.md) remains open. It is an implementation/release gate, not an unresolved design blocker. P001 must establish the delivered runtime and local Linux capability baseline; P009 must establish target-host and release/restore readiness. Later features extend the relevant evidence.

No running Harbor services, feature implementation, security enforcement, deployment readiness, or E2E success is established by this report.
