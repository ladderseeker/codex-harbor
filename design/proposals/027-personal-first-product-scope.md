# P027 — Personal-first product scope

## Metadata

- ID: P027
- Status: Draft
- Priority: P1, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); decide it before P028 to P031 start, because it removes managed-profile obligations from their scope. The owner confirms or changes the priority.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: The repository's designs, guides, gates and delivery rules treat the personal VPS profile as the product, and the managed profile no longer adds scope to new work.
- Authorization: Proposal writing only. The two decisions below are the owner's; nothing changes until the owner picks options.
- Baseline: Source and document inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529`.
- Dependencies: None.
- Source issues: None transferred. Decision 1 would park the managed-only records listed below without resolving them.
- Design references: [Architecture scope](../architecture.md#recommendation-and-scope), [deployment and profiles](../systems/004-deployment-and-profiles.md), [D009 common-use scope](../decisions/009-common-use-release.md), [D011](../decisions/011-personal-vps-workspace.md), [D012](../decisions/012-personal-vps-development.md), [D013 workflow](../decisions/013-evidence-based-delivery-workflow.md), [workflow](../workflow.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P027-01–P027-05.

## Problem, outcome and exclusions

Harbor has four runtime profiles: managed, fixture, personal local and personal VPS. Only the personal VPS runs for the owner. The [review](../../docs/reports/2026-09-25-project-review.md#scope-and-process-weight) measured about 14,200 lines of managed-only application code, 13,200 lines of managed infrastructure and 21,600 lines in managed-only test lanes, against about 1,200 lines of personal VPS infrastructure. About 200 profile checks are spread through the supervisor, API, web app and configuration. About 23 of the 29 open issues concern managed, self-development or extension work that the owner does not use. Every new feature must currently be designed and verified around all of it, and the delivery workflow adds two independent reviews and a long report to every change, including copy and styling fixes.

This plan records two owner decisions and applies them to the documents and gates. It changes no application behavior.

Excluded: deleting managed code, which needs its own plan if the owner picks option 1C; changing any security boundary of the personal VPS profile; and changing the owner's authority over commits, pushes and deployments.

## Dependencies and current design

The architecture recommends the managed profile as the primary deployment, with D011 and D012 recorded as the explicit personal VPS exception. D009 reduced the common-use release scope but kept managed acceptance obligations open. The owner's 21 September direction already made Linux VPS the only required deployment target and dropped native macOS lifecycle parity. D013 defines one delivery path for every change.

### Decision 1: product scope

- **1A, recommended: personal-first, managed frozen.** The personal VPS profile is the product. New user-facing work targets it and need not define managed behavior; managed code paths may reject a new capability explicitly. Managed code stays in the tree, keeps compiling and keeps its tests, which run when shared or managed code changes. Its open acceptance records are parked under a new decision record and are not selected until the owner reverses it. Personal local stays a development convenience without lifecycle parity.
- **1B: keep all profiles equal.** Today's rule. Every feature continues to carry managed design, tests and evidence.
- **1C: remove the managed profile.** Freeze first as in 1A, then delete managed-only code, infrastructure, tests and guides in a separate plan. This gives the largest simplification but loses the container isolation path, and restoring it later means recovering it from Git history.

Records parked under 1A: the live runtime credentials, Linux gateway availability, P009 backup transfer approval, P006 and P004 implementation reviews, all P010 and P012 records, test-host SSH recovery, common-use live acceptance, self-development and managed-extensions acceptance, and managed interruption lock order. Records that stay active: personal VPS acceptance, retained runtimes after stop, conversation report downloads, runtime compatibility, P007 regression evidence and P005 selection regression.

### Decision 2: weight of small changes

- **2A, recommended: a small-change path.** A change that touches only documentation, user-facing copy or styling, with no API, storage, runtime, authentication or rendering-safety effect, needs one fresh-context reviewer covering both design and provenance, and its pull request description is its delivery record. Every other change keeps the full D013 path. All delivery reports keep to outcome, identity, commands, results, review and limits.
- **2B: keep D013 unchanged.**

## Source issues

No obligation transfers. Under 1A, the decision record lists every parked issue by path; parked issues keep their severity, evidence and recheck path and become selectable again if the owner reverses the decision.

## User and API flows

Not applicable; no application behavior changes.

## Contracts, state and security

No security boundary changes. Under 1A, the personal VPS keeps every D011, D012 and D014 control. A shared-code change still must not break managed tests while managed code remains.

## Implementation brief

After the owner decides, add decision record D015 with the chosen options and parked issue list, and update the architecture's scope section, the profile design, the systems index, the developer guide's gate description, the README and AGENTS.md. Under 2A, also update the workflow, the proposal template and both reviewer briefs.

## Exact file fence

- `design/proposals/027-personal-first-product-scope.md`
- `design/decisions/015-personal-first-product-scope.md`
- `design/README.md`
- `design/architecture.md`
- `design/systems/README.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/workflow.md`
- `design/proposal-template.md`
- `docs/developer/agents/design-reviewer.md`
- `docs/developer/agents/provenance-reviewer.md`
- `docs/developer/development.md`
- `issues/README.md`
- `README.md`
- `AGENTS.md`

## Verification and acceptance

- **P027-01:** D015 records the owner's options, the date and the parked issue paths.
- **P027-02:** Architecture, profile design and README name the personal VPS as the product under 1A, and no current design requires managed behavior for new personal work.
- **P027-03:** The developer guide states which lanes a personal-only change must run and when managed lanes still run.
- **P027-04:** Under 2A, the workflow, template and reviewer briefs define the small-change path and its limits consistently.
- **P027-05:** `node scripts/check-docs.mjs` and `git diff --check` pass, including new files.

Gate: documentation-only.

## Rollout and recovery

Documentation only. Reversing the decision is a later dated decision record that reactivates the parked issues.

## Review and findings

Pending. The full D013 review applies to this plan itself.

## Closing record

Pending.
