# Correct terminal dispatch and restart findings

- Severity: High
- Status: Blocked
- Owner: P006 implementer; independent reviewer and main-agent integration
- Recorded: 2026-09-08
- Affected files: apps/web/src/Terminals.tsx; packages/terminals/src/store.ts; apps/api/src/terminal-stream.ts; apps/supervisor/src/terminals.ts, in the P006 implementation worktree
- Acceptance: [P006-02–06](../design/proposals/006-persistent-terminal.md#independent-acceptance)

## Round 1 evidence

A separate agent reviewed source `95cf523b9ef700d5ba3183c931dd3f41f2cd6ea0eb3e10e83918c6dc8a09c7af` (873 files). These are concrete source-derived failure schedules, not independently executed exploits. The feature's focused Node 24 browser/API and actual Linux results remain historical evidence for their stated scenarios; they do not close these findings.

1. **High — outcome inspection may send input.** `Terminals.tsx:639` presents Check input outcome as inspection but POSTs the stored bytes to admission. `store.ts:185` returns a known frame, otherwise can insert a new one. If the first WebSocket frame was lost before acceptance and no earlier frame established the viewer controller ID, closing that viewer can leave the HTTP-acquired 20-second lease valid. Checking within the lease newly admits input. Provide a strictly read-only lookup for the exact client frame identity; absence must not authorize send.
2. **High — final wire send races emergency stop.** `terminals.ts:97` reads the emergency state without retaining the metadata lock through send. After that check, workspace lookup, input state update and current-actor checks await before `send` around line290. A different owner browser can commit emergency stop between those points because its actor lock differs. Hold the shared emergency authority fence through the irreversible send and verify the post-wait state. Test an actual distinct-browser stop/dispatch race.
3. **Medium — restart hides possible output loss.** `terminals.ts:430` marks restart retirement but preserves output continuity flags. Bytes captured in memory and not yet committed can disappear on supervisor SIGKILL; the next snapshot can still say `gap:false/lost:false`. Persist a conservative discontinuity on unclean restart and test a kill between capture and flush.

The review also identified missing distinct acceptance assertions: snapshot/subscription exact-once replay, a nonreading WebSocket's bounded backlog without harming another viewer, viewer caps, failed retirement retaining its reservation with bounded retry, wrong-project/ceiling denials, and cross-origin WebSocket denial. Existing HTTP/revocation/Linux evidence does not substitute for those cases.

## Expanded acceptance finding — 8 September 2026

The implementer's new real-process retirement assertion exposed an additional defect in the same correction batch: after an unconfirmed close timeout, a later supervisor tick reused `r.reason` to move the terminal automatically from uncertain to retiring. That bypassed the promised deliberate retry limit. Preserve uncertainty and its reservation until an explicit bounded terminate retry is accepted. The test run had already exercised browser transport loss before and after input acceptance; complete corrected-source results and independent round 2 are still pending.

## Impact and next steps

Input inspection and emergency stop can violate their core user-visible contracts; missing output continuity can misrepresent the terminal record. The implementer accepted one focused fix/acceptance batch, followed by independent round 2 and changed-boundary verification. Keep P006 active and unverified until these findings and its required gates are satisfied. Record exact fixes, source identities, commands/environment/results and review closure before archiving this same issue.

## Output retention lock inversion — 8 September 2026

Expanded real-stream acceptance reproduced PostgreSQL `40P01` in runs `harbor-e2e-03f210564c`, `db811f460c` and `2cee072467`. Sanitized wait graphs identify a project/workspace/terminal cycle without recording SQL values or terminal bytes. Output flush held the terminal row, updated its sequence, then updated the retention floor; that second update could acquire foreign-key parent locks. A viewer already held the parent rows while waiting for the terminal. Passing intermediate runs that did not reject a deadlock on the slow viewer do not close this finding.

The correction makes output flush and retention maintenance acquire project → workspace → terminal locks before updating the terminal. The transaction wrapper already awaited its callback and COMMIT; no early-release fix or generic deadlock retry was substituted. The implementer audited admission, retirement and single-statement startup/close/failure writers for the same inversion.

On Node 24.11.1, focused `pnpm test:e2e --terminals --terminal-review-fixes --terminal-stream-check` passed as `harbor-e2e-c50554982c`, exact source `4ea7ddc8327af98343b8103977ee2a7e72096d80017003f3c1bab2fdcc22f7e6` over 876 files. With actual output retention active, the test holds the project row, observes the supervisor waiting at that parent, and still acquires the terminal with NOWAIT. Releasing the parent permits complete fast-viewer output; a real nonreading peer detaches independently. A global assertion rejects every `40P01`.

## Corrective review checkpoint — 8 September 2026

The separate reviewer closed round 2 with no actionable finding in frozen source `89f4f59db58c259ed80e46e63e4eaefa87b861acb5c1dfd8a666c7582d28e688`, 876 files. The source delta from the focused stream result is an expiry-test correction, preserving the production resource-lock fix. Complete terminal acceptance `harbor-e2e-2ecaf4ca80` passed on that exact source. It includes the original three fixes, bounded explicit retirement retry, and expanded stream, authority, retention and outage cases. Node 24 check/build, 11 integration tests and 18 contracts passed on the same production bytes. The native Linux launcher, adapter, mount and seccomp bytes remain unchanged from the separately identified Linux checkpoint; this is not a new aggregate-source Linux pass.

Critical and workspace regressions, main-branch integration, and P004/P009 shared writer, module inventory, drain and restored-authority handling remain pending at this checkpoint. Preserve this active record until those owned obligations are implemented, verified and independently reviewed.

## Reviewed branch delivery — 8 September 2026

Author commit `f033824b495c1b42fe2c6fd9e9d94bac8db8db3f`, based on `cb6be0d`, preserves the reviewed terminal source. Complete workspace regression `harbor-workspaces-c1f16e0a43` passed on the same `89f4f59…8e688` source as complete terminal acceptance. Final critical `harbor-e2e-211efe006b` passed on Node 24.11.1 with exact start/end source `1f83957bf23aa55479a6a05679ff9e6bdf8fb03f5437b97d2ad120e13dfc1204`, 876 files. Only the independently reviewed P002 rate assertion and P007 diagnostics differ from the terminal/workspace checkpoint; production and native confinement bytes are unchanged.

The [feature report](../docs/reports/2026-09-08-p006-development.md) records two closed terminal rounds, integration/contracts and exact separate Linux evidence. The [rate assertion](archive/2026-09-08-015752-p002-rate-limit-acceptance.md) is resolved; the [historical P007 observation](2026-09-08-020429-p007-regression-evidence.md) remains Open without an invented cause. Main-branch P004/P006/P009 merge, deployed module/service/image registration, exact drain and restored-authority integration are now in progress. This issue stays active for those required owned behaviors.

## Shared Git integration finding — 8 September 2026

Independent merge review at combined source `5019bd543d6969614163eb7608f6a849d93b4ce7aa0ebc84190f4d41932ea272`, 950 files, found a **High** project-wide exclusion gap. Terminal admission in workspace B did not check P004's dispatching or unacknowledged-uncertain stage/unstage/commit effect in workspace A. Their common Git metadata can be writable from both, despite each owning a different workspace. Conversation and file admission already use a project fence; terminal admission must participate under the same project lock.

The integration owner accepted a focused correction and a combined admission test, including the reverse ordering where a terminal already owns a writer. The reviewer found no other actionable defect in the inspected scope union, shared nonce/plugins, typed epoch or deployment-image/terminal-purpose merge. Compilation and branch acceptance do not close this newly identified interaction; preserve the record until corrected-source verification and independent closure.

The correction subsequently passed focused real-stack `harbor-e2e-5e4cbbc6b2` on Node 24.11.1, exact start/end `f0a4cdf2aea0738bc790f9bff6eb539ffc0b4ccbdfd7dd83410464d9c8cced99`, 951 files. The separate reviewer closed its source/evidence recheck. The [integration report](../docs/reports/2026-09-08-p004-p006-integration.md) distinguishes real derived checkouts/PTY from explicitly synthetic file lifecycle checkpoints, preserves the initial mistaken HTTP-status assertion, and records remaining cumulative/Linux/deployment work.

## Current integration evidence and remaining blocker — 8 September 2026

Root `04ab86b` includes the reviewed final file/terminal deployment integration. Exact production `f13afc57…ad1d27` passed the recorded host suites and managed Linux checks; immutable artifact `8c11ca94…84f22` passed both ordinary installed browser use and deliberate save-response-loss recovery, actual native PTY/background retirement, inventory and a fresh local synthetic database rebind. Two bounded module review rounds closed, with no remaining actionable source finding in that scope. The [final module report](../docs/reports/2026-09-08-installed-module-integration.md#final-installed-outcome-and-review-closure) distinguishes artifact/source/test-driver identity, reused-fixture qualifications and earlier failed attempts.

Shared writer, nonce, registry, service/image, drain and local restored-authority implementation obligations are now delivered. The proposal is Implemented. This issue remains active and Blocked specifically for its required fresh-host protected filesystem restore/authority evidence under [P009-04](../design/proposals/009-portable-deployment-and-restore.md#independent-acceptance) and the [blocked backup-transfer prerequisite](2026-09-07-231526-p009-backup-transfer-approval.md). The local clone explicitly reports no filesystem restore and cannot close that remaining obligation. No original finding, gate or failed result is silently discarded; append the required fresh-host evidence before resolution/archival.
