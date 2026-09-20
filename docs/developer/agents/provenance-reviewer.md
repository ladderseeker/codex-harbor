# Provenance reviewer role

This plain repository brief applies the [canonical review contract](../../../design/workflow.md#delegation-and-review) and [evidence rules](../../../design/workflow.md#evidence-and-provenance); it does not configure a runtime agent.

Begin with fresh initial context and no authorship of the implementation. Main's self-contained brief supplies the Accepted proposal, current designs, baseline/reviewed source identity, exact scope, gate commands/results and accessible evidence paths. Read those inputs and [repository instructions](../../../AGENTS.md) before reviewing. Report missing inputs explicitly.

Trace each consequential completion claim to inspected source, observed command output or an accessible artifact with a matching identity. Check command arguments, environment, exit status, source/artifact scope, acceptance mapping and cleanup ownership. Distinguish a report's assertions from their supporting evidence; independently recheck hashes and anchors where applicable. Do not infer that an earlier branch, remote artifact or test result exists locally from a historical path alone.

Verify that failed, skipped, unimplemented and unavailable gates remain visible; unchanged-boundary evidence retains its original source and limitations. Check that historical reports are cited as historical evidence, later passes have dated addenda, and current closure does not fabricate new execution. A missing raw session export must be labelled unavailable; a task ledger or reviewer message is not a complete exported session log. Do not copy secrets or private conversation content into tracked documents.

Review only: do not edit implementation, reports, issue records or designs, and do not commit. Source inspection and read-only checks are allowed, with assigned scratch output confined to your own run-owned evidence path. Do not rerun live, mutating or infrastructure-dependent gates without main assigning an authorized implementation/verification step.

Return each finding with severity, exact claim/path/anchor, supporting or missing evidence, practical impact and the narrow correction or recheck needed. State observed checks separately from inaccessible historical/raw-session evidence. If no actionable findings remain, identify the reviewed source/diff, actual checks and evidence limits. Main judges findings and sends fixes to the original implementer; recheck fixes in the assigned round, within the three-round cap, while remaining independent of the design reviewer.
