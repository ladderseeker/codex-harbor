# Common-use conversation acknowledgement correction

This bounded change extracts the already-reviewed shared acknowledgement fix from P012 checkpoint `268d86f` onto the common-use main baseline `2d88e99`. It imports no extension/self-development behavior, schema or dependencies. P010/P012 remain deferred under [D009](../../design/decisions/009-common-use-release.md).

## Behavior and independent test

The supervisor now locks the conversation before changing its acknowledged operation from dispatching to running, matching native request/notification persistence. Dispatch admission, uncertainty and no-replay behavior remain unchanged. An uncertain dispatch event may include only a five-character uppercase/digit database error code; SQL, credentials and native payloads are not logged. The [High finding](../../issues/archive/2026-09-13-022009-native-acknowledgement-deadlock.md) retains the original failure and isolated correction evidence.

`tests/e2e/acknowledgement.ts` runs once within ordinary `pnpm test:e2e`, using an API-created conversation and the actual API/PostgreSQL/supervisor. Only external Codex/OIDC boundaries are fixtures. A fresh-database trigger holds the ACK update on an owned advisory lock. PostgreSQL identifies the ACK backend blocked by the owned gate, then a session-row request-persistence backend blocked by that exact ACK backend. The fixture marker omits the earlier `turn/started` notification so the observed contender is the ordinary approval request. Its 100-ms delay is a setup aid; actual database waits, not elapsed time, establish the schedule.

After releasing the gate, the test requires one pending approval, successful API answer and completed conversation result, one native turn/start trace for that conversation, and no uncertainty event. The finally path releases the owned gate and removes the exact trigger/function, including ambiguous DDL responses, with bounded cleanup and original-error preservation. No Harbor row is seeded to a successful outcome and no P012 metadata is involved.

## Prepared checkpoint

The four owned source/test paths are `apps/supervisor/src/main.ts`, `tests/e2e/acknowledgement.ts`, `tests/e2e/run.ts` and `tests/fixtures/codex/server.mjs`. Prepared source is `e5c250cf254dccf1635e3d333a9a26fbd6b2f48fb6889688085d2600491b6bbb` / 1,037 files. Absolute Node 24.11.1 typecheck passed against existing root dependencies; `.test-runs/common-use-acknowledgement/typecheck-pre-review.log` is empty (SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`). No dependency installation was required.

Independent extraction/test review and the final canonical critical/check/build/integration/pinned-contract batch are pending at this prepared checkpoint. Final evidence will be appended with its exact source identity. Existing Linux isolation and installed reports retain their separate tested source and scope; no unchanged Linux suite is claimed rerun. Dedicated live-account, deployed history/reboot and protected restore/promotion gates remain unverified. This report does not mark a proposal Verified or a production release ready.

## 2026-09-13 independent review and transport correction

Round 1 found one Low test-harness issue: an uncertain rollback could return the advisory-lock transaction to the shared pool, and server statement timeout did not bound connection or reply loss. The production lock-order extraction and actual contention schedule had no finding. Round 2 closed the correction without remaining actionable findings: the case now uses a dedicated bounded pool, destroys its gate connection on every exit, and destroys the bounded DDL cleanup connection. No racing connection-acquisition promise can leave a late checkout.

The frozen corrected source is `82a8e932e59e9590d633f86d3ca7732bef06d57989776be284fd6b2997f239a6` / 1,039 files. Two additional owned paths are `tests/e2e/acknowledgement-db.ts` and `tests/e2e/acknowledgement-db.test.ts`. Node 24.11.1 typecheck passed (`typecheck-review2-final.log`, empty SHA-256 as above). Both controlled synthetic transport cases passed: stalled connection acquisition and lost ROLLBACK reply terminate within their bounds and leave no owned socket or pooled client. Their retained log is `.test-runs/common-use-acknowledgement/transport-review2-final.log`, SHA-256 `7d81f55c7e20b4f2f5ee0e80cf1ed4f1540c0a17115207f067291550dc971c6b`. These are transport fault tests, not PostgreSQL or Harbor end-to-end evidence.

The initial sandbox loopback denial and first fixture failure remain in separate logs. The latter was an observation defect: the stalled fake server did not consume startup bytes and therefore did not observe the peer closing; consuming those bytes corrected the fixture. The independent reviewer inspected final source and actual logs without duplicating runs. The canonical real PostgreSQL case and required final batch follow this source freeze.

## Canonical batch: deterministic policy boundary correction

On the frozen 1,039-file ACK source, `pnpm check` and `pnpm build` passed. The first `pnpm test` failed only the existing future-key assertion at `tests/integration/policy.test.ts:16`: it constructed `Date.now() + 300001`, then `checkKey` obtained another wall-clock value. One millisecond between those reads can turn the intended expired key into the permitted boundary. This is a test timing defect, not a changed policy or an attribution of older unrelated failures. The original failure remains in `batch-test.log` (SHA-256 `f1b5106918d9a989d7a203855fe1af63e5d96f5b3ae82fbb72484f3e58d083c2`).

A separately reviewed test-only correction captures one `now` and passes the existing clock argument to all three assertions. The reviewer closed that bounded correction with no finding; scoped formatting and Node 24 typecheck passed. Final source becomes `d4d48cadf6f5f450b4dacc6ebc0f8a33442c6848e1bde3fb1766092db82cdd5d` / 1,039 files. The production source is identical to the passing check/build checkpoint. The continuation reruns affected integration tests and proceeds to the previously unrun pinned contracts and single canonical critical run; it does not relabel the first failed run or repeat the passing build.

## Critical setup correction and final execution

The continuation passed all 11 integration tests and all 20 pinned Codex 0.153.4 account-free contracts, including the native PTY contract. Its first canonical critical attempt stopped at the new ACK case's session creation with HTTP 403, before installing the gate or trigger. The case was placed after credential replacement and had omitted the existing `newSession` helper's workspace release and effective-capability readiness check. A transient model-readiness rejection is a source-supported explanation; the response error code was not captured, so it is not an established failure cause. Original log `continued-test-e2e.log` and the failed run's earlier screenshots in `.test-runs/harbor-e2e-d8be38a621` remain intact.

The independently reviewed test-only correction passes the fresh session ID returned by that existing real API/setup helper. It preserves every contention and effect assertion. Scoped formatting and Node 24 typecheck passed. This final source is `ce2531fdc5a176d21a65b160d3800678fe89497518ac8f9ddd6d1ee268d85403` / 1,039 files. Only the critical suite was retried; passing build, integration and contracts were not repeated. There were two critical attempts, not a single uninterrupted passing batch. The ACK production bytes remained unchanged throughout.

## Final bounded acceptance result

The final canonical `pnpm test:e2e` passed in 223.39 seconds on macOS, Node 24.11.1, Chromium 1194 and the pinned external Codex fixture contract. Run `harbor-e2e-1704c722e8` records matching start/end source `ce2531fdc5a176d21a65b160d3800678fe89497518ac8f9ddd6d1ee268d85403` / 1,039 files. Its result SHA-256 is `ede616b5da9d90b7e6bbd8873db55277bb7e977413cd3ebb301c6030c1a4db00`; the canonical log SHA-256 is `ff122ff265387ada9af18c9dfdd76e26abf373db0ab0c6b263af94dff16f92eb`.

The separate `acknowledgement-contention.json` in that run has SHA-256 `b5520cba6e6021c4ff299f0ca7d95319282ce388ffc9f50517962a7b4c24e28d`. It passed the actual PostgreSQL gate → ACK PID 84 → request PID 76 chain, exact operation completion, one turn/start, one approval, no uncertainty event and empty cleanup errors. The entire critical suite then passed its remaining conversation, attachment, recovery and authenticated API assertions. Canonical teardown completed with exit 0; a separate bounded read-only Docker query confirmed zero remaining containers for both exact test Compose projects, recorded in `.test-runs/common-use-acknowledgement/cleanup.json`.

| Verification | Tested source | Result |
| --- | --- | --- |
| `pnpm check`, `pnpm build` | `82a8e932…239a6` / 1,039 | Passed; later changes are only test readiness/clock setup |
| `pnpm test` | `d4d48cad…cdd5d` / 1,039 | 11/11 passed after deterministic clock correction |
| `pnpm test:contract` | `d4d48cad…cdd5d` / 1,039 | 20/20 passed; actual pinned 0.153.4 no-account runtime, including PTY |
| Final scoped typecheck/formatting | `ce2531fd…85403` / 1,039 | Passed |
| `pnpm test:e2e` | `ce2531fd…85403` / 1,039 | Passed; actual Harbor/browser/PostgreSQL with external fixtures |
| Transport fault regressions | `82a8e932…239a6` / 1,039 | 2/2 passed; controlled transport only |

The command/status/duration/log-hash ledgers are `batch-result.json`, `continued-result.json` and `critical-final-result.json` under `.test-runs/common-use-acknowledgement/`. There were three ACK extraction/harness rounds: initial source review, cleanup correction, and final readiness correction; the clock test also received a separate narrow review. No production change followed the initial two ACK hunks. The first failed integration assertion and first failed critical setup remain historical evidence; no acceptance result is retroactively relabeled.

Main independently recomputed the final canonical source digest and matched the actual result and contention artifact hashes before [resolving and archiving the shared issue](../../issues/archive/2026-09-13-022009-native-acknowledgement-deadlock.md). The associated proposal and both issue indexes were updated together. This closing navigation update does not change any historical test baseline.

This closes the bounded common-use ACK correction's local acceptance, not the complete common-use release. Dedicated live-account application acceptance, deployment/reboot continuity and protected fresh-host restore/promotion remain separate gates. No Linux isolation, installed service, model call, protected backup or deferred P010/P012 feature was executed or claimed by this change.

## Navigation and ownership addendum — 20 September 2026

P017 reconciled legacy planning records into the [proposal archive](../../design/proposals/archive/). [Current subsystem designs](../../design/systems/) now own requirements, and unfinished acceptance belongs to the [issue inbox](../../issues/) until a new proposal is selected. Historical statements here about active proposal states, queues, permissions and recovery locations describe the recorded date. This addendum changes navigation/ownership only: original tested sources, commands, results, review rounds and limitations above remain historical evidence. No application gate was rerun for the documentation migration. Historical raw artifacts or worktrees not present in this checkout were not newly verified.
