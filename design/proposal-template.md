# Feature proposal template

Copy this structure to `design/proposals/<number>-<stable-feature-name>.md` and replace every placeholder. First check the [active index](proposals/README.md) and [archive index](proposals/archive/README.md) for existing work and allocated IDs. Follow the [canonical lifecycle rules](../AGENTS.md#document-ownership-and-lifecycle). Scale explanation to the feature, but keep every required decision or mark it explicitly not applicable with a reason.

## Status and outcome

- Proposal ID: `<identifier>`
- Decision: `Draft` initially; allowed states are `Draft`, `Accepted`, `Superseded`.
- Delivery: `Planned` initially; allowed states are `Planned`, `In progress`, `Implemented`, `Verified`. Never infer delivery from decision status.
- User outcome: `<one complete capability observable through Harbor>`
- Evidence/status updated: `<date and relevant implementation/review references>`
- Next action: `<concrete remaining work or dependency gate>`

Describe the concrete trigger and visible result. State current behavior and the intended change. Link relevant architecture sections. Do not imply that the user has individually approved every technical detail.

## Scope and prerequisites

List included behavior, meaningful exclusions, and earlier accepted capabilities this proposal requires. Split by a complete outcome rather than frontend/backend layers or estimated size.

Explain how a fresh isolated environment installs or seeds those earlier prerequisites. No future proposal may be necessary to exercise or verify this feature. A dependency on an earlier capability does not waive independent acceptance of the feature's own behavior.

## Source issues

List linked source issues or state `None`. For each transferred issue, map every obligation owned here to named acceptance IDs or sections, retaining severity, remaining risk, the gate it blocks, and pending or completed evidence. Link other owning proposals for shared transfers. Apply the [issue transfer rules](../AGENTS.md#issue-resolution-and-transfer) when changing ownership or completing this proposal.

## User and API flows

Give the successful browser flow, corresponding public API flow, loading/waiting states, cancellation behavior, and relevant errors. Identify authentication and authorization checks. If a browser or API flow is not applicable, explain why.

Describe how the owner can tell success from queued, interrupted, failed, unsupported, or uncertain outcomes. Do not expose internal details in product UI unless they help a decision.

## Contracts, data, and ownership

Specify endpoint/event schema changes, domain records, state transitions, revisions, idempotency, and the component responsible for durable state. Explain concurrency, retries, disconnects, recovery, and retention. Include migration and backward-compatibility implications.

State the Codex capability or other external boundary used, the pinned/version-discovery requirement, and the fallback or fail-closed behavior when unsupported. Use direct first-party citations for consequential external claims.

## Security and resource limits

Describe applicable identity, permission ceilings, mounts/paths, secret handling, untrusted rendering, network exposure, and quota controls. Apply the same policy to UI and API. Define relevant denial tests rather than using a generic claim that the feature is secure.

For agent-driven build/test or self-development features, explain candidate isolation, fixed trusted broker authority, stable-instance resource reservation, and recovery without handing project code blanket launcher privileges.

## Implementation approach

Describe component changes, operational dependencies, and a sequence that yields an independently usable feature. Identify risks needing a small capability spike. Keep implementation commands aligned with the shared architecture/developer command contract. Label unimplemented commands as planned.

## Verification and acceptance criteria

Specify reproducible setup, fixture data, actions, and observable assertions. Include:

- Real browser/frontend/backend/database/supervisor integration for relevant UI outcomes, and authenticated API verification for API outcomes.
- Deterministic protocol fixtures at the external Codex boundary and a disposable OIDC provider for the real login flow; no replacement of internal Harbor behavior under test. Explicit third-party fixture services may exercise integrations without contacting real user services.
- Separate real pinned-Codex contract tests, bounded live-account smoke tests, and actual Linux isolation tests where relevant; do not present fixture results as proof of those boundaries.
- Negative authorization, error/retry, idempotency, reconnect/recovery, concurrency, and quota cases appropriate to the feature.
- Fresh instance namespaces for URLs/ports, database, secrets, Codex state, volumes, and artifacts; cleanup cannot touch a stable instance.
- Evidence to retain: revision/versions, command, exit status, traces/screenshots/logs as applicable, with secret redaction and explicit skips.

List the relevant lanes from the [canonical planned command contract](architecture.md#local-first-development-and-portable-environments). Assign stable acceptance IDs such as `P001-01` and map them to executable tests and evidence when implemented. Do not require unrelated suites or claim commands run before implementation. Documentation-only changes use link/structure/consistency review, not fictional E2E results.

Acceptance criteria must demonstrate the promised complete outcome using earlier prerequisites only. A build, mock response, or design review alone is insufficient for implemented feature acceptance.

## Rollout and recovery

Describe configuration, migrations, resource prerequisites, candidate validation, promotion/draining, rollback compatibility, and any irreversible effects. Follow the user's existing authorization; if approval is needed, prepare the tested concrete artifact first. Do not invent a standing approval requirement.

## Review record and remaining issues

Record implementation → independent review → fixes → verification, with dates and evidence. Link unresolved issue records that include severity, affected files, reproduction/evidence, impact, and next steps. Critical unresolved requirements block implementation completion. Distinguish open dependency validation from defects and from unfinished planning.

## Closing record

Keep this section pending while active. On archive, fill the fields required by the [proposal completion rules](../AGENTS.md#proposal-completion-and-archive):

- Archive disposition and date: `<Completed, Superseded, or Withdrawn; date>`
- Outcome or reason: `<delivered result, replacement, or withdrawal reason>`
- Validation and review: `<tested source revision or source/artifact digest; commands, environment, results, review rounds; linked report>`
- Remaining impact: `<limitations, follow-ups, affected issues/dependencies, replacement links where applicable>`
- Current documentation: `<links to implemented behavior and operational guidance, or not applicable with reason>`

Retain dated status and reopening history below the closing record when needed.
