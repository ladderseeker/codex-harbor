# An uncertain turn blocks every personal VPS deploy

- Severity: High; one uncertain turn stops every later deploy, and nothing in the product clears it.
- Owner: Inbox. [P025](../design/proposals/025-clean-supervisor-shutdown-and-restart.md) is the proposed receiving plan (Draft, not yet selected).
- Status: Open; found by source inspection, not reproduced. The read-only preflight on 25 September reported no busy operation, so the live instance was not in this state then.
- Recorded: 26 September 2026.
- Related: [project review](../docs/reports/2026-09-25-project-review.md#shutdown-and-deploy-safety), [output-limit issue](2026-09-25-120000-output-limit-uncertain-turn.md), [retained-runtime issue](2026-09-21-174500-personal-stop-retained-runtimes.md).

Source inspection of `d0c505b` found that [deploy-release](../infra/personal-vps/deploy-release) counts every operation that is queued, dispatching, running, waiting for an approval or an answer, or `uncertain` as busy. `promote` refuses before stopping anything while that count is above zero, and requires it to be zero again after stopping the supervisor.

In the personal profiles an uncertain turn never leaves that state. The [supervisor](../apps/supervisor/src/main.ts) marks a turn `uncertain` when it restarts during the turn, when the runtime connection is lost, when a cancellation cannot be confirmed, and when output persistence fails, for example on the [output limits](2026-09-25-120000-output-limit-uncertain-turn.md). Nothing later changes that state: acknowledging uncertainty in the [recovery routes](../apps/api/src/recovery.ts) only records the acknowledgement, the [API](../apps/api/src/server.ts) refuses those routes in both personal profiles, and the [conversation design](../design/systems/001-conversations-and-access.md) keeps original uncertain operations uncertain permanently. A turn queued behind an uncertain turn in the same conversation also stays queued, and counts as busy, because dispatch waits while the conversation is uncertain or holds an unacknowledged uncertain operation, which the personal profiles cannot resolve; [P030](../design/proposals/030-composer-and-conversation-flow.md)'s queued follow-ups would make that case common.

Impact: after any one of those events, every later deploy through the [GitHub Actions workflow](../docs/developer/github-actions-deploy.md) refuses with "Work is active; nothing was changed", and **Stop processes** does not help. The product offers no recovery; only a manual database change over SSH, which no guide documents, would clear it.

A correction must keep refusing while work can still run or a runtime is held, must not mark an uncertain turn complete or replay it, must settle a turn queued behind it without running it, and must report uncertain operations as their own count. Because the workflow runs the candidate's own `deploy-release`, a corrected script applies to the deploy that installs it.

Recheck on a Linux candidate instance with the Codex fixture: leave one turn uncertain by killing the supervisor during it, restart, confirm that no runtime, background mark or active operation remains, and run `promote`. It must succeed, and the turn must still be uncertain afterwards.
