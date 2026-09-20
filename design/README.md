# Harbor design

Current requirements live in the architecture, numbered subsystem designs and the UI guide. Proposals describe bounded changes against those documents; archived proposals and reports preserve dated decisions and evidence. [D013](decisions/013-evidence-based-delivery-workflow.md) records the ownership change and legacy reconciliation. Design acceptance never establishes implementation or deployment readiness.

## Current contracts

- [Architecture](architecture.md): shared identity, runtime, data, isolation, verification and release invariants.
- [Subsystem designs](systems/README.md): current feature contracts, source ownership, partial/deferred boundaries and remaining evidence obligations.
- [Design tokens and UI guide](design-tokens.html): approved visual tokens, interaction patterns and the rules for extending them.
- [Interface prototype](prototypes/README.md): the standalone reviewable reference; application behavior requires its own acceptance.
- [Delivery workflow](workflow.md): proposal lifecycle, main/worker responsibilities, review, provenance, issue ownership and closure.
- [Proposal template](proposal-template.md): metadata, exact file fence, dependencies and acceptance for a selected change.

## Decision records

These explain significant choices; follow later explicit supersession notes and current design ownership.

- [D001 — Confined runtime egress](decisions/001-confined-runtime-egress.md).
- [D002 — Registered mount authority](decisions/002-registered-mount-authority.md).
- [D003 — Quota-backed project storage](decisions/003-quota-backed-project-storage.md).
- [D004 — Protected runtime credentials](decisions/004-protected-runtime-credentials.md).
- [D005 — Managed parallel workspaces](decisions/005-managed-project-workspaces.md).
- [D006 — Portable releases and a fenced host restore](decisions/006-portable-release-and-restore.md).
- [D007 — Separate project-preview origins and a confined runner connection](decisions/007-confined-project-preview-origins.md).
- [D008 — Confined self-development workers](decisions/008-isolated-self-development-workers.md).
- [D009 — Common-use release scope](decisions/009-common-use-release.md).
- [D010 — Personal local Codex experience](decisions/010-personal-local-experience.md).
- [D011 — Personal VPS existing-project experience](decisions/011-personal-vps-workspace.md).
- [D012 — Personal VPS development](decisions/012-personal-vps-development.md).
- [D013 — Evidence-based delivery workflow](decisions/013-evidence-based-delivery-workflow.md).

## Work and evidence

Discover records through the [proposal directory](proposals/README.md), [proposal archive](proposals/archive/README.md), [issue inbox](../issues/README.md) and [issue archive](../issues/archive/README.md). Their folder listings replace manual per-record status and priority tables. Select one cohesive outcome from current need; do not treat all historical unfinished work as an execution queue.

The [developer guide](../docs/developer/development.md) documents available commands and verification prerequisites. [Documentation](../docs/README.md) contains actual behavior guides and dated reports. Legacy baseline reconciliation closes old planning records while preserving every unresolved obligation in issues; it is not proof that a deferred feature shipped or a missing gate passed.
