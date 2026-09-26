# Change proposal template

Copy to `design/proposals/<number>-<stable-name>.md` and replace every placeholder. Search the [proposal directory](proposals/README.md), [archive](proposals/archive/README.md) and [issue inbox](../issues/README.md) first. Follow the [canonical workflow](workflow.md); this template supplies the plan structure, not a second lifecycle definition. Scale detail to the outcome and explain any non-applicable section.

## Metadata

- ID: `<stable P-number, never reused>`
- Status: `Draft` initially; use the workflow's `Draft → Accepted → Implemented` states.
- Priority: `<optional Urgent, High, Medium or Low, as set or confirmed by the owner, with its date and source>`
- Created: `<date>`
- Owner: `<main conversation / accountable owner>`
- Outcome: `<one cohesive observable result>`
- Authorization: `<existing owner direction and its limits>`
- Dependencies: `<required capability/evidence, source, satisfied or missing, and whether it blocks execution or completion; None if none>`
- Source issues: `<linked issue IDs; None if none>`
- Design references: `<current architecture/subsystem/decision/UI sections>`
- Exact file fence: `<link to the exact permitted paths below>`
- Acceptance IDs: `<stable IDs defined below>`

## Problem, outcome and exclusions

Describe the trigger, existing behavior and intended observable result. Select a complete outcome, including relevant UI/API/state/permissions/lifecycle/failure behavior together. Size and technical layers are not splitting rules. Exclude unrelated outcomes explicitly. A proposal may change several subsystems but must remain logically closed after its declared dependencies.

## Dependencies and current design

For each metadata dependency, identify the delivered capability or required evidence, source revision/limits and reproducible setup in a fresh environment. Explain any gate that remains missing and the exact dependent work it blocks. Do not rely on cycles or a future proposal to make this outcome exercisable.

Name the current canonical requirement and the proposed change. Settle product, architecture, security and acceptance decisions before execution; link a focused decision record for a major reversal. Do not copy whole current designs into the plan or turn historical archived plans into binding authority.

## Source issues

Map every obligation taken from each linked issue to a named acceptance ID or section. Retain severity, risk, blocked gate and evidence status. State any obligation left with another owner; a partial transfer stays in the inbox. Follow the [transfer rules](workflow.md#issue-resolution-and-transfer).

## User and API flows

Describe the successful browser and public API paths, authentication/authorization, loading/waiting states, cancellation, errors and unsupported/uncertain outcomes. Mark a missing UI or API surface not applicable with a reason. State how the owner recognizes durable success rather than mere request acceptance.

## Contracts, state and security

Specify changes to endpoints/events, durable records and owners, revisions/idempotency, concurrency, retries, disconnect/recovery, retention and migration compatibility. Identify external Codex capabilities, pinned-version evidence and fail-closed behavior. Cite primary sources for new consequential external claims.

Describe affected permission ceilings, mounts/paths, secrets, untrusted rendering, network exposure and quotas, with observable denial assertions. Apply the same policy to UI and API. Candidate/build work must keep trusted fixed authority, disposable resources and stable-instance recovery separate from untrusted project execution.

## Implementation brief

Describe the settled component changes and sequence, named designs to read first, per-worker ownership if needed, baseline/diff ownership, acceptance commands and private evidence/resources. Supply a [self-contained execution brief](workflow.md#mains-execution-brief) to the fresh-context implementer; do not rely on inherited conversation history. Mechanical choices within the contract are delegated; new design decisions and fence changes return to main.

## Exact file fence

List every permitted added/edited/deleted tracked path, including both sides of moves. No directory glob expands this fence. Name private run-owned scratch/evidence locations separately. Main must amend this plan before dependent edits outside the fence.

- `<repository-relative exact path>`

## Verification and acceptance

Assign stable IDs such as `P018-01` to reproducible setup, actions and observable assertions. Map each to tests/evidence as implemented. Cover the complete outcome's relevant success, denial, retry, idempotency, reconnect/recovery, concurrency, quotas and failure behavior. Include durable results through the actual browser/API/persistence/supervisor where applicable.

Name the [applicable gate](workflow.md#implementation-and-verification-gate) and available commands from the [developer guide](../docs/developer/development.md#command-availability). Behavioral work retains build/check/test, real-stack E2E and critical regressions, plus real-runtime/live or actual Linux lanes for changed boundaries. Fixtures replace external boundaries only. Documentation-only work uses structure/consistency, local links/anchors and whitespace, including new files; do not invent application checks.

Specify source/artifact identity, isolated instance setup and cleanup, command/environment/exit evidence, redaction and unavailable-gate handling. Identify reused unchanged-boundary evidence with its tested revision and limits. A build or report alone does not establish the complete outcome.

## Rollout and recovery

Describe configuration, migrations, resource prerequisites, candidate validation, promotion/draining, rollback compatibility and irreversible effects where applicable. Existing authorization governs those actions; prepare the concrete tested result before any required approval. Preserve unrelated work, owned resources and interruption recovery.

## Review and findings

After the green gate, main automatically invokes separate fresh-context design and provenance reviewers using the [review contract](workflow.md#delegation-and-review). Record each round's findings, main's dispositions, original-implementer fixes, verified results and evidence limits. Stop at most after three rounds. Link unrelated findings and any remaining blocker to issues; do not silently expand scope or waive a missing gate.

## Closing record

Keep pending until the [completion conditions](workflow.md#proposal-completion-and-archive) pass. Record:

- Outcome, date and archive disposition.
- Tested source revision or reproducible source/artifact digest and exact scope.
- Commands, environment, results, review rounds/dispositions and linked report.
- Current designs/docs, source-issue evidence, limitations and follow-up ownership.
- Owner-facing uncommitted result for review and commit confirmation.

Retain dated reopening or supersession history when needed. An intentionally retired plan keeps its actual state and evidence; it cannot acquire Implemented merely through archival.
