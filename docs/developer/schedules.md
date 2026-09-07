# Schedule API and verification

P008 is Implemented, not Verified. Feature and bounded module integration reviews have closed; Targeted DST end-to-end acceptance has passed; dedicated live-account and protected full restore/promotion evidence remain pending. The [user guide](../user/schedules.md) describes the implemented interface, while [P008](../../design/proposals/008-scheduled-tasks.md) retains full acceptance, dependency and live-account obligations. The real Linux metadata rebind check establishes the fixed administrator bridge, not a full filesystem restore or installed release.

The versioned `/api/v1/openapi.json` document declares request/response schemas, path parameters and token scopes. Cookie mutations require exact Origin and X-CSRF-Token. Cookie-free bearer calls use explicit project grants and the following scopes:

| Operation | Token scopes |
| --- | --- |
| List, detail, occurrence history, attention, preview | `schedules:read` |
| Pause | `schedules:manage` |
| Create/edit/activate or run now | `schedules:manage`, `execute` |
| Cancel an occurrence | `schedules:manage`, `cancel` |

Material edits also require the selected execution profile; standalone edits require a workspace-write ceiling even when their later turn is read-only.

Routes are `GET/POST /schedules`, `POST /schedules/preview`, `GET/PUT /schedules/{id}`, `POST /schedules/{id}/activation`, `POST /schedules/{id}/pause`, `GET/POST /schedules/{id}/runs`, `POST /schedules/{id}/runs/{occurrenceId}/cancel`, and `GET /schedule-attention`. Preview is read-only despite using POST for its structured rule; browser CSRF/Origin checks still apply.

Mutations use `Idempotency-Key: <unixMs>:<uuid>`. Reuse the exact key and body after a lost response within the 24-hour retry window. Retained retries reconcile before changed-revision admission. HTTP 409 requires reviewing the current revision or control attempt; changing a request while retaining its key is rejected. HTTP 429 can describe a durable capacity limit, which waiting alone does not fix, or a request-window limit with Retry-After. The ordinary and reserved control classes remain rate limited. Credentials, raw runtime methods and approval decisions are not granted by internal schedule actors.

`packages/schedules` owns the shared bounded Temporal evaluator, immutable versions, source-bound execution grants, occurrence admission and lifecycle. The pg-boss job contains only occurrence identity and epoch. PostgreSQL commits it together with the occurrence, stable downstream IDs and cursor. Jobs wake the supervisor; durable rows determine work. Workspace creation and turns use the same domain helpers as manual requests. Trusted workspace receipts can reconcile metadata effects, while uncertain native turns require explicit owner recovery.

Available specialist entry points are:

- `pnpm test:schedules`: calendar boundaries and actual isolated PostgreSQL/pg-boss admission, including COMMIT rejection and post-lock authority checks.
- `pnpm test:e2e --schedules`: fresh Caddy/PostgreSQL/browser/API/supervisor with external OIDC and Codex fixtures. It includes actual persisted quota prefill for boundary tests, clearly distinguished from physically running work.
- `pnpm test:e2e --schedules-dst`: targeted real UI/API/PG/supervisor timezone preview and persisted occurrence checks for New York gap/fold, Lord Howe half-hour gap and Apia skipped day, including restart during the repeated hour. This uses only the guarded scheduler clock, not a changed authentication clock.
- `pnpm test:isolation --schedules`: the supported Linux XFS profile, using real managed allocation/copy and API/supervisor scheduling. The Codex boundary remains a fixture; this command does not establish model behavior or replace native runner isolation evidence. Actual managed-XFS copy scheduling passed on Node24.11.1; see the [development evidence](../reports/2026-09-08-p008-development.md).
- `pnpm test:live --schedules`: the managed Linux stack plus one real pinned Codex scheduled occurrence, with the browser closed. It requires a dedicated `HARBOR_TEST_OPENAI_API_KEY`; `HARBOR_TEST_CODEX_MODEL` selects an explicitly discovered configured model. The observed missing-key path exits 2 before resources or model requests. The real-account branch remains unverified.

The private `HARBOR_SCHEDULE_TEST_CLOCK=1` control requires NODE_ENV=test and the private external-fixture profile. It changes scheduling time only, never authentication, lease, approval or retry clocks. Production and the Linux/live lane use actual wall time. Evidence records source fingerprints, Node/time-engine versions, injected boundaries and fresh resource identities. Run the cumulative critical suite and pinned contracts before freezing shared-helper changes.

P009 integration must inventory every schedule table and pg-boss namespace, pause restored schedules, revoke all old grants and prevent old queue wakeups from creating work. Lower-ID migration 013 applied after installed module migration 016 requires the exact supported-predecessor manifest and an actual upgrade test; never disable the compatibility check. Protected promotion and off-host restore remain separately gated.

With the deployment module installed, fixed inventory includes schedule revisions, grants, occurrences, command receipts and the time-engine state. Maintenance retains accepted occurrences while closing new schedule admission and preparation. Active storage/native effects remain subject to the existing drain/receipt rules. Administrator interruption pauses schedules and revokes future grants. Fresh-instance rebind preserves historical outcomes, revokes source grants and browser authority, and leaves every schedule paused; explicitly activate it after destination validation. Old queue notifications never authorize catch-up.

For schema upgrades adding013 to a release already containing016, package with the exact supported predecessor manifest. The compatibility guard requires its artifact identity and complete unchanged migration map. Local metadata-rebind and compatibility tests do not replace the protected restore/promotion acceptance gate.
