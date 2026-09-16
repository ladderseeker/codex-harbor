# P016 — A conversation-first Harbor interface

## Status and outcome

- Proposal ID: P016
- Decision: Accepted, 2026-09-15 under the owner's explicit implementation, push and deployment request.
- Delivery: Verified
- Archive disposition: Completed, 2026-09-16
- User outcome: Read and continue conversations in a quiet interface, find existing controls in contextual menus, copy original content, and choose the runtime's supported reasoning effort accurately.
- Closing outcome: P016-01–06 passed; final source `180bdabc2e4400fa612421c0d23d3392b63547e1` is deployed with installed browser/runtime acceptance.

The owner's final instruction to implement supersedes the quoted requirement document's earlier Markdown-only scope. The [architecture](../../architecture.md) retains authorization, runtime and persistence ownership. This proposal owns the bounded interface extension to [P014](014-consistent-frontend.md), alongside existing P001/P003/P007/P015 behavior.

## Scope and prerequisites

Use the implemented conversation, history, workspace and personal VPS boundaries. A fresh deterministic stack seeds disposable OIDC/Codex boundaries and real Harbor API, PostgreSQL and supervisor. No deferred P010/P012 work is resumed.

Include unified current-project search/filter, contextual project and conversation controls, settings, resource indicators, message/block copy, volatile reactions, and model-specific reasoning settings. Preserve supported features without showing unavailable placeholders. Exclude new search scope, scheduling/terminal/file features, right sidebar, feedback collection, Markdown diagram execution, runtime upgrades and isolation changes.

## Source issues

None transferred. Existing upstream release and restore obligations remain with their owners in the [issue index](../../../issues/README.md).

## User and API flows

The sidebar's top search icon opens a single search and active/archived/all filter surface scoped explicitly to the current project. Project details retain existing workspace, environment, storage and supported tool access. The bottom-right gear opens settings actions including account settings; configuration uses dialogs, with notices only reporting results.

Each conversation has an ellipsis button available on hover, keyboard focus and touch. Its actions retain existing rename/revision and archive semantics and expose status and supported resource release. Archiving changes visibility without deleting conversation data or interrupting active work; the existing personal-profile behavior also retires idle retained processes. This remains distinct from an explicit resource-release action. Stop background processes retires retained execution and frees its reservation; it does not mean stop the current answer. Active answer interruption remains separately named. Green resource dots indicate actual retained resources/reservation, never connection health or generation progress. Unknown state is not reported as confirmed idle. Details explain state and resource ownership. Action-blocking failures, disconnection, approval and uncertainty remain visible when needed.

User messages copy their raw text. A completed assistant turn has one toolbar after its final body segment, ordered copy, like, dislike. Copy combines that turn's original body fragments without tool events or UI text. Code and literal Markdown source blocks have a separate bottom-right toolbar outside the content. Copy preserves code whitespace without outer fences, and source Markdown syntax. No per-paragraph buttons. Success appears only after clipboard completion; failure is explicit. Reactions are mutually exclusive and toggleable, reset on refresh, and never send requests, analytics or persisted data.

## Contracts, data, and ownership

Keep existing authenticated/revisioned commands, retry receipts, persisted messages and supervisor lifecycle. No feedback endpoint, database migration or new resource-release primitive. The UI derives copy payloads from message source rather than rendered DOM. Runtime capability discovery controls model-specific options and the server revalidates current capabilities before dispatch.

GPT-6 Astra officially supports `low`, `medium`, `high`, `xhigh`, `max`, labelled Low, Medium, High, Extra High, Max. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra) was searched and opened on 2026-09-15. Harbor must retain separate xhigh/max values through schema, validation and adapter. Only modes actually advertised by the pinned runtime are selectable; missing expected Astra modes require clear compatibility messaging rather than fabricated capability. Other models use their own discovered modes. Never submit `light`.

## Security and resource limits

Existing owner authentication, CSRF, server authorization and permission ceilings remain. No raw runtime proxy, network requests for reactions, or new filesystem authority. Markdown remains escaped/sanitized with remote images as explicit links. Copy is an explicit user gesture; failure cannot claim success. Resource labels cannot release a fence or infer retirement from a disconnected browser.

## Implementation approach

Extend the [canonical guide](../../design-tokens.html) and [standalone prototype](../../prototypes/harbor-redesign.html) for search, menus, semantic resource green and message toolbars. Reuse existing neutral surfaces, type, spacing, icons, dialogs, focus restoration and mobile touch patterns. Move existing functionality into these surfaces, add reusable clipboard/reaction components, and remove the hardcoded effort narrowing while preserving runtime validation.

## Verification and acceptance criteria

- **P016-01 Navigation:** Real UI/API history search and active/archive filtering stay current-project scoped, with one search entry; persisted rename/archive remain functional. Settings and project details retain supported capability access, without placeholders. Keyboard/touch menus and focus return pass.
- **P016-02 State:** Conversation canvas omits persistent storage/environment/workspace/finished/connected clutter. Required errors and recovery remain visible. Status is reachable, resource dots reflect real retention/reservation, and existing release action frees its owned resources with truthful failures.
- **P016-03 Content actions:** Browser clipboard assertions cover raw user Markdown, complete multi-fragment assistant turns, fenced/nested Markdown and code whitespace, success/failure, and toolbar placement. Reactions toggle mutually exclusively, create no requests and reset on refresh; no tool-event duplicate actions.
- **P016-04 Models:** Schema, API capabilities, per-model validation and adapter agree on all five Astra efforts. Unsupported values/models fail. Pinned actual model discovery and adapter contracts pass; runtime limitations remain explicit. A bounded installed test confirms usable model settings when available.
- **P016-05 Presentation:** Inspect rendered guide/prototype and real UI at desktop and mobile sizes, including overflow, hover/focus/touch, loading/empty/error/disabled states. Build/check, appropriate integration and critical E2E regressions pass with fresh run-owned resources.
- **P016-06 Delivery:** Independent review and fixes pass; docs reflect actual behavior. Push identified source, build immutable candidate, verify inventory and pinned runtime, drain admission, retain private matched recovery state and promote. Verify public HTTPS and signed-in owner browser after deployment. Record all evidence and limitations.

Unchanged Linux sandbox policies reuse identified prior evidence; any actual launcher/isolation change would require its supported Linux lane. No unrelated proposal is closed by this outcome.

## Rollout and recovery

Use the existing personal VPS immutable package workflow and complete pinned native distribution. Inspect the installed identity/configuration first. Preserve write-path drop-ins, private credentials and separate state. Stop new admission, drain active work and retire retained processes before the matched private backup and release switch. No migration is expected. Retain predecessor and checkpoint; assess newly accepted work before any rollback or restoration. Existing user authorization covers commit, push and deployment.

## Review record and remaining issues

The [delivery report](../../../docs/reports/2026-09-15-conversation-interface.md) records current checks and review findings. Root coordinates UI, message actions and model capability implementers and a separate independent reviewer. Unavailable required gates must remain recorded; no completion claim from build or screenshots alone.

## Closing record

Completed 2026-09-16. The linked delivery report records source/artifact digests, commands, environments, results, three independent review rounds, the final bounded focus correction, installed acceptance, recovery checkpoint and unchanged upstream limitations. Current behavior is documented in the user guides and developer workflow.
