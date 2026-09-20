# Confined development fixture ends before an accepted build

- Severity: Medium; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: Medium
- Status: In progress
- Owner: P010 implementer; separate fixture-boundary reviewer verifies the correction

Complete deferred outcome and acceptance are tracked in [2026-09-20-000003-self-development-acceptance.md](2026-09-20-000003-self-development-acceptance.md); this record retains its individual finding and correction evidence.

- Affected files: `tests/fixtures/codex/server.mjs`, confined fixture process handling and its tests; the existing contract is in `infra/self/gateway/pnpm.mjs`
- Acceptance: [P010-01/02/03/05](../design/proposals/archive/010-self-development.md#independent-acceptance), under [D008's confined external fixture refinement](../design/decisions/008-isolated-self-development-workers.md)

## Source finding — 13 September 2026

Independent review of `0e943ae` found that the new `[self-build]` path in `tests/fixtures/codex/server.mjs:291–298` kills its fixed wrapper after 30 seconds or 16 KiB of combined output. The real wrapper in `infra/self/gateway/pnpm.mjs` waits for an accepted job's terminal state for up to two hours and streams its bounded retained logs, which can reach 2 MiB. A normal slow or verbose build can therefore produce a failed stable fixture turn while the accepted Harbor job continues.

The implementer confirmed the mismatch. This is source-proven, not a reproduced full UI or Linux failure. The component guest roundtrip uses a separate fixed controller and is not attributed to this new fixture defect. The bounded review found no additional public-admission, host-authority, image-selection or ordinary native-path security defect. The reported 21 passing pinned no-account contracts do not exercise this missing long-running fixture outcome; actual confined image and full UI acceptance remain pending.

## Correction and required evidence

Align the fixed fixture lifetime with the accepted development job, drain legitimate bounded log output without reporting it as failure, and retain a small safe turn summary. Preserve fixed commands, finite output/lifetime limits and exact child cleanup on stop/failure. Exercise a slow and verbose wrapper through a controlled process/clock boundary without waiting two real hours; independently review the correction and retain the actual confined Linux/UI flow as a separate gate.

Record the correction's source identity, commands, environment, results, review rounds and main integration before resolving and archiving. Do not report fixture completion as successful artifact verification unless the real accepted job reaches that outcome.

## Corrective review round 2 — 13 September 2026

Checkpoint `84db3eb` corrects the original duration/output mismatch with a two-hour-plus-ten-second observer, a 3 MiB stream ceiling and a 4 KiB retained summary tail. The fixed image identity includes the new helper. Four local controlled contracts passed; `.test-runs/confined-fixture/corrective-contracts.log` in the P010 worktree retains their output. The reviewer inspected that log and source without repeating the tests. Actual confined image, Linux and complete UI execution remain pending.

The review leaves two related obligations. A Medium interruption race in `tests/fixtures/codex/server.mjs:287–297` allows the deferred helper import to spawn a wrapper after the turn has already been interrupted, and an active wrapper lacks turn-interruption cleanup. The correction must fence the deferred spawn and retain exact child ownership through interruption. A Low result-settlement race in `infra/self/fixture/build.mjs:45` detaches output observers on child `exit`, before output pipes necessarily close; trailing completion text or excess output can then be missed. Successful settlement must wait for `close`, while timeout/excess failures stay bounded. The event distinction is documented by [Node's child-process API](https://nodejs.org/api/child_process.html#event-exit).

The implementer owns both corrections. Add controlled delayed-import interruption, active-child interruption and exit-then-late-data-then-close cases, then complete the third bounded review round. These are source findings; no full UI failure or remaining production admission security defect is inferred.

## Corrective review round 3 — 13 September 2026

Checkpoint `3cd127be149b58894aa87b1dbd8bbfaa32a9ff40` installs per-turn abort ownership before helper loading, checks it before synchronous spawn, kills only the owned active child on interruption, and suppresses delayed completion. Identity comparisons prevent an old callback from deleting a successor's ownership. Success waits for child `close`; trailing output and excess remain observed after `exit`, while bounded failure settlement does not require an exit acknowledgement. The fixed builder and validator both include the changed fixture/server/helper bytes in image identity.

Six controlled local schema/admission/lifecycle tests passed. The retained P010 worktree `.test-runs/confined-fixture/lifecycle-contracts.log` has SHA-256 `749ab54040b24f6673e99b1c6773b02a6cc932de1fd4a63bf12c103786de75ff`. Coverage includes the delayed-import and active-child interruption schedules, unrelated-child preservation, and exit followed by late output/excess before close. Independent round 3 inspected the source and retained log without rerunning tests and closed with no actionable finding. The original four-test correction log remains preserved separately (`1e55c78f7ad2f452b475e0437857a9ed8f0c67352d0844be84e664c5b111f17b`).

This closes the bounded source review, not complete P010 acceptance. Actual confined fixture image/launch, Linux/UI behavior and main integration remain pending. The issue remains In progress until that scoped evidence and integration are recorded.
