# Fresh candidate view opens an unauthenticated application route

- Severity: Medium; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: Medium
- Status: In progress
- Owner: P010 implementer; separate verifier reviewer checks the correction

Complete deferred outcome and acceptance are tracked in [2026-09-20-000003-self-development-acceptance.md](2026-09-20-000003-self-development-acceptance.md); this record retains its individual finding and correction evidence.

- Affected files: `apps/api/src/self-views.ts`, candidate browser acceptance coverage
- Acceptance: [P010-01/02/07](../design/proposals/archive/010-self-development.md#independent-acceptance)

## Evidence and impact — 13 September 2026

Independent round 1 at isolated checkpoint `f6b5f27dfa98cef63e7da3cb5647826578c0bb3e` found that `apps/api/src/self-views.ts:253` always opens a new candidate hostname at `/`. A fresh hostname initially holds only its outer viewing cookie. The actual candidate's `apps/api/src/server.ts:197–212` returns `401 AUTH_REQUIRED` for `/` without its separate Harbor session cookie. The fixed bootstrap proxy does not rewrite that response; the trusted verifier explicitly checks `/` for 401 and begins authentication at `/auth/login`.

The authorized owner can therefore receive an error response after opening a newly granted candidate instead of reaching its login flow. This is proven from the reviewed source, not a reproduced browser or guest failure. It does not establish a credential leak or an authorization bypass.

## Correction and review obligations

The implementer accepted the finding. Use the fixed candidate login entrypoint and add an actual browser regression from a fresh one-use viewing grant through fixture login to the authenticated application. Preserve the unique candidate host, separate stable/candidate cookies, fixed destination and current-authority checks. Record the corrected source, exact commands/environment/results and independent round 2; complete actual guest/installed acceptance and main integration before resolution and archive.

The remainder of this bounded review found no actionable issue in grant authority after lock waits, HMAC/report identity, Host/Origin validation, cookie filtering, HTTP/SSE/WebSocket leases, exact verifier relay lifecycle or existing P011 defaults. The reviewer matched four retained report hashes to the scoped PostgreSQL/routes/HTTP/IPC and focused contracts without rerunning them. Those tests use synthetic ready-job/relay boundaries; they do not establish complete guest, stable UI, installed configuration or main acceptance.
