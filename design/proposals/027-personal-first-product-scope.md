# P027 — Personal-first product scope

## Metadata

- ID: P027
- Status: Draft
- Priority: High, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); consider it alongside the Urgent plans; until selected, current profile-specific contracts and D013 remain in force. The owner confirms or changes the priority.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: If the owner selects personal-first scope, align current documents and gates with it while preserving shared safety obligations; separately apply a small-change review path only if the owner selects it. Both decisions remain unset.
- Authorization: On 27 September 2026 the owner authorized evaluation and revision of the open proposals, followed by commit and push of these document changes to `main`. Feature implementation, live experiments and deployment are outside this audit. The two product/process decisions below remain unset.
- Baseline: Source and document inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529`.
- Dependencies: None.
- Source issues: None transferred. Option 1A would park managed-only records by a stated rule, without resolving them.
- Design references: [Architecture scope](../architecture.md#recommendation-and-scope), [deployment and profiles](../systems/004-deployment-and-profiles.md), [development and extensions](../systems/005-development-and-extensions.md), [D009 common-use scope](../decisions/009-common-use-release.md), [D011](../decisions/011-personal-vps-workspace.md), [D012](../decisions/012-personal-vps-development.md), [D013 workflow](../decisions/013-evidence-based-delivery-workflow.md), [workflow](../workflow.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P027-01–P027-05.

## Review note — 27 September 2026

Read-only source review against `e6c2a138563139650af46fe51af44c6eb6c28743`; the original baseline in Metadata and dated evidence remain historical. Both owner decisions remain unset. Existing profile exceptions and scoped verification are retained as the baseline; the proposed small-change path excludes policy, safety and interaction changes. This audit runs documentation checks only and adopts no canonical feature contract, performs no application/runtime/Linux acceptance and closes no issue.

## Problem, outcome and exclusions

Harbor has four runtime profiles: managed, fixture, personal local and personal VPS. Only the personal VPS runs for the owner. The [review](../../docs/reports/2026-09-25-project-review.md#scope-and-process-weight) measured about 14,200 lines of managed-only application code, 13,200 lines of managed infrastructure and 21,600 lines in managed-only test lanes, against about 1,200 lines of personal VPS infrastructure. About 200 profile checks are spread through the supervisor, API, web app and configuration. At `d0c505b`, 23 of the 29 open issues concerned managed, self-development or extension work that the owner does not use. Current contracts already permit explicit profile-specific capabilities and reuse of unchanged evidence; they do not require identical behavior in every profile. Shared code and retained safety obligations still add review and regression work. D013 requires a fresh implementer and two independent reviews, including for copy and styling changes, with evidence proportional to scope.

This plan records two owner decisions and applies them to the documents and gates. It changes no application behavior.

Excluded: deleting managed code, which needs its own plan if the owner picks option 1C; changing any security boundary of the personal VPS profile; and changing the owner's authority over commits, pushes and deployments.

## Dependencies and current design

The architecture recommends the managed profile as the primary deployment, with D011 and D012 recorded as the explicit personal VPS exception. D009 reduced the common-use release scope but kept managed acceptance obligations open. The owner's 21 September direction already made Linux VPS the only required deployment target and dropped native macOS lifecycle parity. D013 defines one delivery path for every change.

### Decision 1: product scope

- **1A, recommended: personal-first, managed frozen.** The personal VPS profile is the product. New user-facing work targets it; managed feature expansion is frozen and managed paths may explicitly reject a new capability. Shared safety and compatibility consequences still need a defined contract. Managed code stays in the tree, keeps compiling and keeps its tests, which run when shared or managed code changes. Its open acceptance records are parked under a new decision record and are not selected until the owner reverses it. Personal local stays a development convenience without lifecycle parity.
- **1B: retain current scoped profile contracts.** Keep the existing explicit personal exceptions and feature-specific verification/evidence reuse, with managed/shared obligations wherever the changed boundary requires them.
- **1C: remove the managed profile.** Freeze first as in 1A, then delete managed-only code, infrastructure, tests and guides in a separate plan. This gives the largest simplification but loses the container isolation path, and restoring it later means recovering it from Git history.

Parking is a rule stated in the decision record, not a list: an inbox record whose remaining obligations concern only the managed profile, self-development or managed extensions is not selected while the decision stands, and keeps its place, severity, evidence and recheck path in the inbox. Folder listings stay the only index of records, as D013 requires. Mixed/shared safety records and records that serve the personal VPS stay active under every option; no rule automatically archives an issue. This includes personal VPS acceptance, retained runtimes after stop, conversation report downloads, runtime compatibility, personal off-host backup and supported reconfiguration, and the live runtime credentials that [P025](025-clean-supervisor-shutdown-and-restart.md), [P029](029-complete-conversation-transcript.md) and [P019](019-durable-approval-waiting-and-delivery.md) need for their live gates.

### Decision 2: weight of small changes

- **2A, recommended: a small-change path.** Non-normative documentation, copy or styling may use one fresh-context reviewer covering design and provenance only when there is no policy, security, product-scope, gate, authority, operational/migration-procedure, API, storage, runtime, authentication, rendering-safety, interaction, accessibility or focus effect. Mixed changes use full D013 review. Fewer reviewers never reduces applicable verification: styling still requires rendered desktop/mobile/focus evidence. The PR description records outcome, source identity, commands/exits, review dispositions and limits; without a PR, retain an equivalent concise repository record. Every other change keeps the full D013 path.
- **2B: keep D013 unchanged.**

## Source issues

No obligation transfers. Under 1A, the decision record states the parking rule; parked issues keep their severity, evidence and recheck path and become selectable again if the owner reverses the decision.

## User and API flows

Not applicable; no application behavior changes.

## Contracts, state and security

No security boundary changes. Under 1A, the personal VPS keeps every D011, D012 and D014 control. A shared-code change still must not break managed tests while managed code remains.

## Implementation brief

After the owner decides, allocate the next available decision ID (provisionally D015) with the chosen options and, under 1A, the parking rule. Add dated notes to D009 and D013 that link to it, as the workflow requires for a decision that changes earlier ones. Audit and align the architecture, every current subsystem design, the systems index, developer gate guide, README and AGENTS.md with the selected options and explicit precedence; preserve mixed/personal obligations and historical documents. Under 2A, also update the workflow, the proposal template, the implementer brief and both reviewer briefs.

## Exact file fence

The paths below are a prospective feature-implementation fence, not authorization to edit them during this audit. The current audit edits only the fourteen selected Draft proposals. Main must settle any missing new paths and check provisional decision/migration numbering before acceptance.

- `design/proposals/027-personal-first-product-scope.md`
- `design/decisions/015-personal-first-product-scope.md`
- `design/decisions/009-common-use-release.md`
- `design/decisions/013-evidence-based-delivery-workflow.md`
- `design/README.md`
- `design/architecture.md`
- `design/systems/README.md`
- `design/systems/001-conversations-and-access.md`
- `design/systems/002-workspaces-and-resources.md`
- `design/systems/003-scheduled-execution.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/systems/005-development-and-extensions.md`
- `design/systems/006-interface.md`
- `design/workflow.md`
- `design/proposal-template.md`
- `docs/developer/agents/implementer.md`
- `docs/developer/agents/design-reviewer.md`
- `docs/developer/agents/provenance-reviewer.md`
- `docs/developer/development.md`
- `issues/README.md`
- `README.md`
- `AGENTS.md`

## Verification and acceptance

- **P027-01:** D015 records the owner's options, the date and, under 1A, the parking rule, and D009 and D013 link to it with dated notes.
- **P027-02:** Architecture, profile design and README name the personal VPS as the product under 1A, and the exact-fence consistency audit finds no conflicting mandate for managed feature expansion. Shared/mixed safety, compile/test, backup and reconfiguration obligations remain explicit.
- **P027-03:** The developer guide states which lanes a personal-only change must run and when managed lanes still run.
- **P027-04:** Under 2A, the workflow, template, implementer brief and reviewer briefs define narrow eligibility, the full path for mixed/policy/interaction/procedure changes, unchanged verification, rendered style evidence and the durable no-PR record consistently.
- **P027-05:** `node scripts/check-docs.mjs` and `git diff --check` pass, including new files.

Gate: documentation-only.

## Rollout and recovery

Documentation only. Reversing the decision is a later dated decision record that reactivates the parked issues.

## Review and findings

Pending. The full D013 review applies to this plan itself.

## Closing record

Pending.
