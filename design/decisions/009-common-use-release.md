# D009 — Finish a common-use release before expanding the roadmap

## Current ownership — 20 September 2026

The [current subsystem designs](../systems/) apply this decision alongside architecture; [D013](013-evidence-based-delivery-workflow.md) and the [workflow](../workflow.md) now govern execution and record lifecycle. Proposal references below identify historical plans, not active work owners. Unfinished evidence remains in the [issue inbox](../../issues/), and future work receives a newly selected proposal. The dated decision rationale and technical constraints below are preserved.

D013 supersedes this decision’s ongoing common-use queue, automatic resumption of old proposal records and requirement to keep those legacy plans active until every original gate passes. The authorized baseline reconciliation archives records without passing missing acceptance. Product, security, isolation, live-account and release/restore constraints remain in force; selecting a new owner-requested outcome does not waive them or require executing the old backlog first.

- Decision: Accepted, 2026-09-13, within the owner's explicit change of delivery scope.
- Replaces: the all-proposals implementation schedule, including prioritizing P010 self-development early. It does not replace any security contract or acceptance criterion.
- Delivery state and next actions: [proposal index](../proposals/README.md).

## Context and decision

2026-09-13 interface addendum: the owner selected implementation of the approved visual guide and prototype across the existing frontend. [P014](../proposals/archive/014-consistent-frontend.md) owns this complete UI outcome and bounded local project-folder browsing. It was completed and archived after scoped verification, without resuming deferred modules or waiving existing release gates.

2026-09-13 addendum: the owner subsequently selected a real local account-login and conversation experience. [D010](010-personal-local-experience.md) and [P013](../proposals/archive/013-personal-local-experience.md) own that bounded outcome. It takes current implementation priority without waiving the common-use candidate's existing verification gates or resuming deferred work.

The owner wants a usable, verified product while conserving the remaining agent quota. Main already contains P001–P008 and P011 implementation, with substantial review and verification evidence. P010 and P012 have extensive separate work but unfinished integration and mandatory acceptance. Completing every proposal together has delayed a usable release.

Freeze feature expansion. Use the existing main branch as the common-use candidate and integrate only corrections required by its everyday workflows. Preserve the deferred branches, drafts, findings and evidence. Do not merge the combined P010/P012 branch, remove working features or rewrite existing migrations to simplify the release.

The first release focuses on owner login and account setup, conversations and reconnect, projects/workspaces, attachments, history/recovery, file/change review, terminals and scoped API access. Their requirements remain canonical in P001–P007. Scheduling and previews are already integrated; preserve them and their current evidence, but do not expand them during this release. P009 owns installed operation and its outstanding deployment gates. P010 self-development and P012 managed skills/MCP are deferred until a concrete need selects each separately.

## Bounded delivery sequence

1. Integrate the [shared conversation acknowledgement correction](../../issues/archive/2026-09-13-022009-native-acknowledgement-deadlock.md) without importing extension or self-development code. Exercise the actual PostgreSQL contention and ordinary conversation outcome.
2. Freeze that source, independently review the narrow change, and run the core application regression suite and applicable build, type, integration and pinned-runtime checks. Retain prior evidence for unchanged boundaries, stating its exact source and scope; rerun a boundary only when a change or unresolved concern warrants it.
3. Prepare one candidate with clear setup instructions and a verification report. Installed acceptance must identify the tested artifact and cover the actual installed workflow before claiming that workflow verified.
4. Execute the relevant real-account and deployment gates when their prerequisites are available. Archive each proposal only after its own complete acceptance, applicable dependencies, documentation and review pass. An unavailable gate remains explicit; finish unaffected work and report the candidate instead of starting unrelated features to fill the wait.

There is no new permission gate. Existing user authorization continues to apply. Missing credentials or a rejected action are unresolved prerequisites, not invitations to weaken authentication, isolation or evidence requirements.

## Completion and remaining work

This decision changes priority, not the meaning of finished. A passing fixture suite does not establish authenticated real Codex behavior. Non-model contracts do not establish model-backed history/restart acceptance. Local installed-module checks do not establish protected fresh-host restore, promotion or rollback. Keep those obligations with their current proposals and issues.

Deferred proposals retain their actual `In progress` delivery state and an explicit deferred queue entry. They remain discoverable and own their unresolved issues. Deferral is neither completion nor withdrawal, so it does not move them to the completed archive. Already implemented proposals retain `Implemented` until their remaining gates pass. Do not create replacement proposals merely to relabel partial work as verified.

Resume one complete user outcome at a time: confirm the need, inspect its existing proposal and handoff, implement the remaining scope, verify, review, document and archive it before selecting another independent feature. New proposals are appropriate for new outcomes; existing P009/P010/P012 already own their remaining outcomes. Shared critical defects can interrupt that order.

## Consequences and retained decisions

The [architecture](../architecture.md#delivery-through-complete-feature-outcomes) continues to define the full target system. [D006](006-portable-release-and-restore.md) remains the deployment/recovery contract and [D008](008-isolated-self-development-workers.md) remains the deferred self-development contract. Their mandatory gates are unchanged. The [issue index](../../issues/README.md) keeps live-account, deployment-transfer and deferred feature findings visible.

This limits concurrent implementation and repeated broad verification. It also means a blocked real-account or recovery gate may prevent proposal closure even after the candidate's available checks pass. Report that distinction directly rather than assigning a completion percentage to unexecuted checks.

## 2026-09-13 personal VPS addendum

The owner subsequently selected [P015](../proposals/archive/015-personal-vps-workspace.md). [D011](011-personal-vps-workspace.md) authorizes a separately configured personal VPS profile with authenticated HTTPS, subscription login and approved existing folders. It supersedes the native-only-local restriction only for that explicit profile; P013 remains loopback-only, managed isolation requirements and outstanding proposal gates remain unchanged.
