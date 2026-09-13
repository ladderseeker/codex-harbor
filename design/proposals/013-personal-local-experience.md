# P013 — Sign in and try Codex through Harbor on a personal computer

- Proposal ID: P013
- Decision: Accepted within the owner's 2026-09-13 request; implementation details are subject to review.
- Delivery: Implemented
- Dependencies: Implemented P001 conversation UI/API/supervisor and P003 local workspace records; their remaining verification is not waived.
- User outcome: Start a private local Harbor instance, sign in through official Codex login, and conduct a real persistent conversation.
- Evidence/status updated: 2026-09-13; [local delivery report](../../docs/reports/2026-09-13-personal-local-experience.md) records native/local acceptance, independent review and the real owner conversation.
- Next action: Diagnose and pass the [critical regression gate](../../issues/2026-09-13-143001-local-critical-regression-gate.md); do not archive as Verified while this mandatory gate remains open.

## Scope and prerequisites

The selected outcome is governed by [D010](../decisions/010-personal-local-experience.md). Include startup, independent persistent state, native account login, local project selection, model discovery, streaming conversations, approvals, cancellation, reopening and owned shutdown. Require a compatible official Codex runtime and the application database/proxy dependencies. Fail with actionable prerequisite errors.

Do not expand this outcome into public deployment, managed worktree/copy storage, attachments, terminals, schedules, previews or extensions. Existing profile behavior remains available. An unsupported local operation must be rejected rather than sent to a Linux helper or run without a native sandbox. No future proposal is needed for this outcome.

## Source issues

None transferred. P001 and P009 retain their dedicated live, isolation and deployment obligations.

## User and API flows

The local entry point prepares instance-owned state and checks prerequisites. The owner completes official Codex login in an isolated home and enters Harbor through a private owner authentication flow. The UI displays the actual account readiness and allows a bounded conversation in the selected local workspace. Existing authenticated commands, event streams, approvals and cancellation retain normal authorization, Origin, CSRF and idempotency semantics. Public or fixture configuration cannot enable the local profile.

Missing login, runtime incompatibility, denied workspace access and unsupported capabilities produce explicit errors. Browser closure does not cancel work; confirmed cancellation is distinct from a request to stop. Restart retains history and classifies ambiguous effects as uncertain.

## Contracts, data, and ownership

The supervisor owns the runtime lifecycle through the existing adapter. Native Codex owns account credentials and history in instance-private state. PostgreSQL retains existing Harbor metadata and operation records; no new schema is required unless implementation demonstrates a distinct data need. The local execution profile uses actual local paths rather than container paths and must not rewrite unrelated text or credentials.

Match the pinned protocol baseline or establish and document compatibility before relying on a different runtime version. Login capability evidence may use checked-in generated protocol and installed CLI help when official documentation is inaccessible; record that limit instead of claiming external verification.

## Security and resource limits

Apply [D010](../decisions/010-personal-local-experience.md). Use loopback exposure and a private owner entry, native sandbox policies with an explicit permission ceiling, bounded input/events and instance-owned process cleanup. Keep native account state separate from projects, ordinary Codex configuration and test data. Never emit secrets in logs, browser responses or test artifacts. Do not label this profile Linux isolation or expose it through production configuration.

## Implementation approach

The implemented development entry/profile, local runtime factory, account readiness and local UI reuse the existing Harbor components. The [personal local guide](../../docs/developer/local-personal.md) documents `pnpm dev --local` and official login; the command is available while the overall critical regression gate remains open.

## Verification and acceptance criteria

- **P013-01:** Fresh local startup creates a private persistent namespace, checks dependencies, and presents official login plus an authenticated Harbor page. Missing prerequisites fail explicitly. Invalid/nonlocal/production profile combinations are denied.
- **P013-02:** Through the real browser/API/database/supervisor, an authenticated owner selects the admitted workspace, submits a turn, receives streamed output and reopens the persisted conversation. Unauthenticated, invalid-Origin and invalid-CSRF requests cannot dispatch work.
- **P013-03:** Approval/input, cancel, browser reconnect and runtime shutdown retain correct lifecycle states. Duplicate submission does not repeat effects. Runtime loss is not silently replayed. Cleanup affects only owned processes.
- **P013-04:** A real compatible native Codex account and one small user-authorized conversation pass; native contract checks cover changed adapter behavior. Automated checks use fresh homes, fake accounts only at the external boundary, and their own workspace/database. The user's manual conversation does not satisfy dedicated unrelated live-test gates.
- **P013-05:** Unsupported operations fail before execution; native permission policy never permits external-sandbox or unrestricted host execution. The existing fixture critical regressions and relevant configured-profile checks pass. Changed Linux boundaries, if any, require actual Linux verification.

Retain source digest, exact commands/environment/results, redacted diagnostics and independent review findings in a report. A build or simulated response alone cannot verify this outcome.

## Rollout and recovery

Use a separate local instance without touching an installed service, personal Codex state or existing projects during automated tests. Normal shutdown preserves local data; explicit cleanup is scoped to the instance. Drain/stop owned activity before account changes. No deployment promotion, commit or push is authorized by this task.

## Review record and remaining issues

Round 1 cross-component independent review found [native policy, pre-login validation and lifecycle/readiness defects](../../issues/archive/2026-09-13-143000-personal-local-review.md). All were fixed and independently verified in round 2, with focused subsequent delta review. The owner completed a real conversation.

Implementation and independent review passed within the report's scope. The separate critical browser regression remains unverified; local success does not replace that mandatory gate.

## Closing record

Pending. Keep active until complete acceptance, review, documentation and evidence pass.
