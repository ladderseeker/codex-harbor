# D013 — Evidence-based delivery and current-baseline reconciliation

- Decision: Accepted, 2026-09-20, within the owner's explicit request to write and implement this workflow.
- Changes: repository collaboration, design ownership and record lifecycle only; no application, runtime, deployment or security behavior.
- Replaces: the former dual proposal-state model, manually maintained status/priority queues, optional shared-context review and up-to-six-round review loop; D009's requirement to retain incomplete legacy plans as active execution owners.
- Retains: product/security/release acceptance obligations, historical evidence, owner authorization and [D009's common-use scope](009-common-use-release.md).
- Execution record: [P017](../proposals/archive/017-evidence-based-delivery-workflow.md); [migration evidence](../../docs/reports/2026-09-20-workflow-migration.md).
- Current contract: [delivery workflow](../workflow.md), [architecture](../architecture.md) and [subsystem designs](../systems/README.md).

## Context

The repository accumulated partially delivered, deferred and verified plans, with overlapping specifications, issue ownership and hand-maintained delivery queues. A stale P016 queue row still requested work already reported complete. Old plans made identifying a single next need difficult and encouraged parallel roadmap execution rather than a closed outcome.

The owner requested a simpler arrangement: issues are an inbox, proposals are executable plans, and structural design documents describe the current system. Main plans and adjudicates; fresh-context implementation and two independent review roles provide an evidence-backed result for the owner's commit review.

## Options and decision

Keeping the old plans active preserves their original gates but also preserves competing specifications and stale queues. Relabelling every old proposal Implemented would falsely imply that deferred behavior and missing gates passed. The selected option separates historical delivery from current design and explicitly assigns every remaining obligation before archiving the legacy records.

The [workflow](../workflow.md) defines the sole detailed collaboration/lifecycle rules: cohesive plans with dependency metadata and exact file fences, `Draft → Accepted → Implemented`, one owner-selected proposal at a time, fresh initial implementation/review context, automatic design and provenance reviews after the green gate, main's finding dispositions, fixes by the original implementer, and at most three review rounds. The owner reviews the concrete result and confirms a commit. Plain role briefs are repository documentation; no runtime agent configuration is introduced.

Current requirements belong to architecture, subsystem designs and the UI guide, with linked decision history. Proposals change those requirements within a bounded outcome. Directory README files explain discovery through folder listings, rather than duplicating record states in queues or tables. New needs receive new proposals when selected; there is no requirement to execute an inherited backlog first. This supersedes D009's blanket scheduling interpretation and requirement to resume the same retired legacy plans, while retaining its unfinished acceptance obligations and the deferred status of self-development and managed extensions.

## One-time legacy reconciliation

P001–P013 and P015 are rewritten as current-baseline records and moved, with stable IDs and filenames, to the proposal archive. Each records `Record status: Finished`, `Archive disposition: Baseline reconciled` and the reconciliation date. This closes the historical planning record only. It is neither the new Implemented state nor a claim that the full original outcome shipped. P014 and P016 retain their already recorded completion evidence and gain current-design references.

Each rewritten record identifies delivered, partial, deferred and unverified boundaries using source paths and dated reports, preserving the original plan, acceptance IDs, anchors and evidence under a non-normative historical section. Every unresolved obligation maps explicitly to an inbox issue. The runtime-compatibility issue is reopened under its original filename because its former proposal owners are retired; its P001/P009 acceptance and release/restore obligations survive. P010/P012 receive complete-outcome acceptance issues as well as their existing defect records. P013's later critical-regression pass is reconciled from its dated report addendum rather than recreated as a new blocker.

The [development and extensions design](../systems/005-development-and-extensions.md) identifies P010/P012 as unavailable on the current main baseline. Historical branches and their reports are recovery references, not evidence that those branches are available or integrated here. The migration does not reopen or verify their implementation. Future selected work names current dependency evidence and remaining obligations in a new proposal.

This is the only authorization for the legacy `Finished / Baseline reconciled` disposition. It supersedes the old rule that all these plans must stay active until every original gate passes. It does not waive any product, security or release gate, resolve an issue solely through archival, or allow future proposals to hide unverified work.

## Consequences and evidence

Contributors can find the current contract without treating archived plans as binding specifications. Each issue retains its evidence, risk and recheck route while awaiting owner selection. Main remains accountable for scope, combined checks, findings and an honest result within the review cap. Missing mandatory gates prevent normal Implemented closure; the owner may receive a reviewable candidate with explicit blockers.

Historical reports retain their original tested source and results. Later corrections are dated addenda; inaccessible artifacts and raw session logs are explicitly unavailable. The P017 report records actual documentation commands, source identity and review evidence without claiming application tests or a complete exported session transcript. This decision authorizes no commit, push, deployment, credentials change or host administration.
