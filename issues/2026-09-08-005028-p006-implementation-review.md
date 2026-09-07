# Correct terminal dispatch and restart findings

- Severity: High
- Status: In progress
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
