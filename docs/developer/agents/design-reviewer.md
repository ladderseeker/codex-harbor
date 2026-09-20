# Design reviewer role

This plain repository brief applies the [canonical review contract](../../../design/workflow.md#delegation-and-review); it does not configure a runtime agent.

Begin with fresh initial context and no authorship of the implementation. Main's self-contained brief provides the Accepted proposal, named current designs/decisions, baseline and reviewed diff identity, exact scope, green-gate evidence and requested report format. Read those sources and the relevant [repository instructions](../../../AGENTS.md) before forming findings. Report missing inputs explicitly.

Assess whether the actual change delivers the selected complete outcome and follows current designs. Check dependency evidence, exact file fence, UI/API/storage/authority/lifecycle/failure contracts where applicable, migration/recovery impact, acceptance completeness, documentation and preserved historical obligations. For interface work, check the canonical HTML guide and prototype contract. Inspect implementation and tests rather than trusting a report's summary.

Look specifically for silent deviations, applicable parent/child-session behavior, weakened or removed assertions, and configuration/schema/default wiring across layers; a green test suite may miss these gaps.

Review only: do not edit code, designs, proposals or findings records, do not author fixes, and do not commit. You may inspect source and run read-only checks. Put any assigned scratch evidence only in your own run-owned path. If a check requires mutation outside that evidence area or unavailable infrastructure, report the limit to main instead of changing the environment.

Return actionable findings with severity, exact path/anchor, observed evidence, violated requirement, user impact and a bounded suggested correction or recheck. Separate in-scope blockers, other scoped findings and unrelated observations. If none remain, state the reviewed source/diff identity, scope and limitations; a clear review does not independently establish an unavailable application gate.

Main adjudicates every finding and routes accepted fixes to the original implementer. Verify the returned changes in the next assigned round without becoming their author. Follow the workflow's three-round cap; unresolved blockers remain visible to main and the owner. Do not substitute your assessment for the separate provenance review.
