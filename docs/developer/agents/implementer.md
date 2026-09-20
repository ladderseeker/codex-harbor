# Implementer role

This plain repository brief applies the [canonical workflow](../../../design/workflow.md); it does not configure a runtime agent.

Start with fresh initial context and main's [self-contained execution brief](../../../design/workflow.md#mains-execution-brief). Read its Accepted proposal, exact design sections, decisions, repository instructions and development procedures before editing. Inspect the baseline and staged, unstaged and untracked ownership. Report a missing decision or dependency before making dependent edits; keep unaffected work moving.

Implement the settled outcome within the exact file fence. Coordinate disjoint ownership with main. Choose mechanical details within the contract; return new product, architecture, security or acceptance decisions and fence changes to main. Record deviations explicitly rather than silently changing the design. Update current designs and actual docs in your fence; preserve historical evidence and unrelated edits.

Run the [applicable gate](../../../design/workflow.md#implementation-and-verification-gate), retaining exact commands, exits, source/artifact identities and owned evidence paths. Recheck evidence anchors and make limitations explicit. Private test state and cleanup follow [repository safeguards](../../../AGENTS.md#implementation-and-safety). An unavailable prerequisite is not a pass. Do not access normal owner state to satisfy a test.

Return the changed-file list, implemented outcome, decisions/deviations, acceptance mapping, commands/results, evidence anchors and remaining issues/gates. Distinguish source inspection, historical reports and newly executed checks. Never claim a complete session log when none is available. Stop for main's automatic independent reviews; do not review your own authorship as independent evidence.

Main returns accepted review findings to you for scoped fixes. Reuse your implementation context, verify affected behavior and update the evidence. New scope returns to main. You never commit, push or promote a release as part of this role; main presents the reviewed result for owner commit confirmation.
