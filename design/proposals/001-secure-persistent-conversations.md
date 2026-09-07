# P001 — Secure persistent conversations

- Decision: Draft
- Delivery: Planned
- Dependencies: None
- Outcome: The owner signs in, selects an allowed project folder, asks Codex to do work, and returns to the same conversation after closing the browser.

## Scope and user flow

Deliver the first usable vertical feature: executable local development stack, owner OIDC login, approved project-root configuration, registration/creation of a first project folder, text composer, effective model/effort and permission choices, streamed conversation, approval/input requests, cancellation, and session reopening. The owner sees running, waiting, finished, interrupted, and uncertain states. The API used by this UI requires the same owner cookie and policy checks.

Implement the actual runtime adapter, isolated runner, durable dispatch, history mapping, replay baseline, and test environment needed for this outcome. Bootstrap work stays inside this feature rather than becoming disconnected frontend/backend proposals. Programmatic PATs, rich attachments, advanced history search, multiple-workspace management, file-editor UI, terminal UI, and scheduling belong to later proposals.

## Contracts and security

Use the [architecture's state/API contract](../architecture.md#api-events-and-state-transitions). Persist project/workspace, facade session/native thread mapping, operation intent, effective execution grant, approvals, and events. One active turn per conversation; additional input is explicitly queued or steered. Duplicate submissions resolve to the same operation. An ambiguous runtime delivery is never silently replayed.

Implement normal authorization on pages/assets, cookie API requests, and SSE. Use a disposable real OIDC provider for deterministic tests, not an auth bypass. Keep app-server private, protect the owner credential onboarding flow, enforce permission ceilings and project-root confinement, and isolate coding processes from Harbor configuration/database credentials. Render streamed content as untrusted. Baseline quota/retention settings, logout revocation, and emergency stop are part of the feature, not deferred security hardening.

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

Introduce real scripts for the ordinary command contract and relevant contract/live/isolation lanes, pinned tools/lockfile, setup/teardown, and feature-tag selection. Run `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live`, and `pnpm test:isolation` as applicable to the criteria. These commands are planned until implemented. Follow [shared test isolation/evidence rules](README.md#shared-verification-contract).

Record host/runtime capabilities and update the developer guide with commands that actually work. No public deployment is claimed by this local feature. Missing account or Linux evidence keeps delivery unverified and links an issue. Initial schema/configuration must leave room for additive feature migrations, without implementing later capabilities. Complete independent review and link its report before `Verified`.
