# P001 — Secure persistent conversations

- Decision: Accepted
- Delivery: Implemented
- Dependencies: None
- Outcome: The owner signs in, selects an allowed project folder, asks Codex to do work, and returns to the same conversation after closing the browser.

## Scope and user flow

Deliver the first usable vertical feature: executable local development stack, owner OIDC login, approved project-root configuration, registration/creation of a first project folder, text composer, effective model/effort and permission choices, streamed conversation, approval/input requests, cancellation, and session reopening. The owner sees running, waiting, finished, interrupted, and uncertain states. The API used by this UI requires the same owner cookie and policy checks.

Implement the actual runtime adapter, isolated runner, durable dispatch, history mapping, replay baseline, and test environment needed for this outcome. Bootstrap work stays inside this feature rather than becoming disconnected frontend/backend proposals. Programmatic PATs, rich attachments, advanced history search, multiple-workspace management, file-editor UI, terminal UI, and scheduling belong to later proposals.

## Source issues

- [Native acknowledgement deadlock](../../issues/2026-09-13-022009-native-acknowledgement-deadlock.md): High, In progress. P012 found a shared acknowledgement/request lock inversion affecting P001-03/07; its isolated correction and historical PostgreSQL barrier passed, while independent review, main integration and current regressions remain required.
- [Resolved P001 implementation review](../../issues/archive/2026-09-07-174757-p001-review-findings.md): critical lifecycle/security and input-decline corrections passed four independent review rounds and corresponding regression/isolation checks.
- [Replay/control storage bounds](../../issues/archive/2026-09-07-185228-p001-retention-control-bounds.md): Medium severity, Resolved by reviewed P007 integration; exact replay count/age, reserved control storage and inherited P001-03/07 regressions passed. The archived record preserves discovery and closing evidence.
- [Linux gateway availability](../../issues/2026-09-07-185228-linux-gateway-availability.md): Medium severity, Open; intermittent approved-endpoint failures remain a measured environment limitation despite final passing isolation. P009 must verify target-host connectivity.
- [Dedicated live-test credentials unavailable](../../issues/2026-09-07-171225-live-runtime-credentials.md): High severity verification blocker for P001-08's real-account smoke. No test credentials are configured; contract, deterministic application, and Linux isolation work continue. This does not waive the live gate.
- [Codex runtime compatibility finding](../../issues/archive/2026-09-07-073831-codex-runtime-compatibility.md): Medium severity; transferred on 2026-09-07, not resolved. P001 owns the pinned runtime and matching schemas, conversation/streaming/approval/cancel/recovery contracts, and local Linux runner prerequisites/isolation. These map to **P001-03–08** and [Delivery and verification](#delivery-and-verification), under the [architecture's compatibility boundary](../architecture.md#official-foundation-and-compatibility-boundary).
- Partial evidence is recorded in the [foundation verification report](../../docs/reports/2026-09-07-p001-foundation.md): pinned contracts, deterministic UI/API outcomes, and actual Linux/XFS isolation passed. The missing real-account gate still blocks P001 verification. Later feature owners extend this baseline through their own acceptance under the [shared runtime verification contract](../architecture.md#repeatable-verification-through-the-application).
- [P009](009-portable-deployment-and-restore.md#source-issues) owns the separate target-host/release/restore evidence and upgrade gates. Local success does not establish deployment readiness or require P001 to wait for P009. Update this finding's P001 evidence when verified; leave the issue Transferred while P009's part remains pending.

## Contracts and security

Use the [architecture's state/API contract](../architecture.md#api-events-and-state-transitions). Persist project/workspace, facade session/native thread mapping, operation intent, effective execution grant, approvals, and events. One active turn per conversation; additional input is explicitly queued or steered. Duplicate submissions resolve to the same operation. An ambiguous runtime delivery is never silently replayed.

Implement normal authorization on pages/assets, cookie API requests, and SSE. Use a disposable real OIDC provider for deterministic tests, not an auth bypass. Keep app-server private, protect the owner credential onboarding flow, enforce permission ceilings and project-root confinement, and isolate coding processes from Harbor configuration/database credentials. Render streamed content as untrusted. Baseline quota/retention settings, logout revocation, and emergency stop are part of the feature, not deferred security hardening.

[D004](../decisions/004-protected-runtime-credentials.md) defines the initial capability and encrypted credential onboarding path. Initial bounded conversation storage admits at most 2 MiB of text, 2,000 messages, 500 operations, and 100 approvals per conversation, with a 32 KiB approval scope. Stop admitting new work before reaching these limits; preserve cancellation and recovery. Event replay retains at most 2,000 events and seven days, with explicit snapshot resynchronization for older or missing cursors. These limits govern the initial implementation and must be visible to the owner. Durable history and unresolved work do not expire through replay cleanup.

Retain active and uncertain idempotency records throughout their operations and completed tombstones for the 24-hour retry window. Reject old immutable timestamps after collection, rather than treating them as new intent. Apply ordered, checksum-validated SQL migrations under an exclusive migration lock; a changed previously applied migration fails explicitly.

Browser closure and API restarts leave the supervisor's subscriptions and work alive. A runtime crash produces a safe interrupted/uncertain state with preserved native history; P007 later adds richer navigation and recovery workflows. Pending approval survives a viewer disconnect, expires with its runtime generation, and is answered once after current authorization is rechecked.

## Independent acceptance

Start from an empty test instance with an owner and denied identity, known project fixture, real Harbor services/launcher, and external Codex/OIDC fixtures. No later feature is used.

1. **P001-01:** From fresh setup, start the stack, sign in as the allowlisted owner, register/create a permitted folder, and submit text. Assert the visible final result and durable session/operation mapping. A denied identity cannot enter.
2. **P001-02:** Request protected pages, assets, APIs, and SSE without credentials, with expired credentials, and with invalid CSRF/Origin on mutations. Assert denial before runtime dispatch.
3. **P001-03:** Close every browser during a delayed turn, then reopen. Restart only the API separately. Assert work continues once and the owner sees the recovered result without duplicate items.
4. **P001-04:** Request approval/input, disconnect, then answer from two tabs. Assert exactly one valid answer, no unattended approval, and denial of stale-generation answers.
5. **P001-05:** Retry a submission with the same key, reuse it with changed input, and crash around dispatch acknowledgement. Assert deduplication, conflict rejection, or explicit uncertainty without blind resend.
6. **P001-06:** Cancel a running turn, wait for confirmed interruption, and inspect any surviving processes. Logout closes interactive access without implicitly cancelling authorized work; emergency stop prevents new dispatch.
7. **P001-07:** Attempt forbidden paths, permission escalation, hostile rendered output, quota overflow, and access to control-plane canary secrets. Assert the corresponding denial and bounded resource use.
8. **P001-08:** With the pinned real Codex runtime, complete a small authenticated conversation and approval/cancel smoke scenario; separately probe actual Linux isolation. Fixture output cannot satisfy this criterion.

## Delivery and verification

The ordinary command contract and relevant contract/live/isolation lanes, pinned tools/lockfile, and setup/teardown are implemented. Run `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live`, and `pnpm test:isolation` as applicable to the criteria. Later feature suites extend scenario selection. Follow [shared test isolation/evidence rules](README.md#shared-verification-contract).

Record host/runtime capabilities and update the developer guide with commands that actually work. No public deployment is claimed by this local feature. Missing account or Linux evidence keeps delivery unverified and links an issue. Initial schema/configuration must leave room for additive feature migrations, without implementing later capabilities. Complete independent review and link its report before `Verified`.

## Implementation record

- 2026-09-07: Adopted this proposal for implementation under the owner's authorization to deliver the roadmap and make implementation decisions autonomously. Started the executable backend, persistent supervisor, real OIDC flow, React interface, pinned-runtime adapter, and Linux runner/test foundation. Current checks and delivery remain incomplete; acceptance and archival require the evidence above.
- 2026-09-07: Recorded [D001](../decisions/001-confined-runtime-egress.md) for the trusted egress proxy and project-internal network. This refines the existing execution boundary without weakening the required Linux or live checks.
- 2026-09-07: Recorded [D002](../decisions/002-registered-mount-authority.md) for trusted mount ancestry, disjoint project roots, filesystem identity, and descriptor-relative project operations. Implementation and adversarial verification remain in progress.
- 2026-09-07: Independent review found lifecycle, workspace-access, and CONNECT hostname-confinement defects. Fixes and regression coverage are in progress; the fixed gateway supersedes the unsafe tunnel in D001. Recorded [D004](../decisions/004-protected-runtime-credentials.md) for protected credential/bootstrap ownership and the initial storage/retention bounds above.
- 2026-09-07: Recorded [D003](../decisions/003-quota-backed-project-storage.md) for administrator-provisioned XFS project storage, automatic session-native allocation, restricted runner access, and mandatory hard-limit evidence.
- 2026-09-07: Added the [current user guide](../../docs/user/conversations.md) and [tested local workflow](../../docs/developer/development.md). Runtime/live gates and critical review fixes remain open; these guides do not mark delivery verified.
- 2026-09-07: Marked Implemented after the final browser E2E and full Linux isolation passed matching source SHA256 05971cd8dfcba617b16dd68eaf33f17dadcc0fbfbc1aad99c4c1e65d118183e0, and four review rounds closed all critical findings. See the [report](../../docs/reports/2026-09-07-p001-foundation.md) for commands, environment, results, and limitations. This is not completion: live-account acceptance and recorded medium bounds remain open, so this proposal stays active.

- 2026-09-07: P007 resolved the replay/control bound follow-up and shared authority correction, with passing combined Node 24 regression and independent review. The [integration report](../../docs/reports/2026-09-07-p007-history-integration.md) records the evidence. P001's dedicated live-account and separate gateway obligations remain open.
