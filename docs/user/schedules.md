# Scheduled work

P008 is Implemented, not Verified. Two feature review rounds and bounded module integration review have closed. Targeted DST end-to-end acceptance has passed; dedicated live-account and protected full restore/promotion evidence remain pending. The [proposal](../../design/proposals/008-scheduled-tasks.md) owns the full contract and delivery gates.

Open **Schedules** below **New chat** in the sidebar in a managed installation, choose a project, and create a schedule. Enter the prompt, model, effort and permission profile, then preview the next occurrences before activating it. The preview shows the requested local minute, timezone, UTC offset and actual UTC instant.

A schedule can run once or use five numeric cron fields: minute, hour, day of month, month and day of week. Recurring minutes skipped by daylight-saving changes do not run. A repeated local minute runs only at its first instant. A one-time minute that does not exist is rejected.

The default creates a new workspace and conversation for each occurrence. Choose committed Git content or explicitly authorize a snapshot of a non-Git folder. An optional Git revision fixes the source commit; otherwise occurrence admission captures the current committed source under the project lock. Creating a workspace requires workspace-write authority even if the resulting Codex turn is read-only. Existing-conversation schedules respect its workspace reservation and manual work; they do not bypass the ordinary queue or an unresolved effect.

Activation records a grant lasting 1–90 days, with a 30-day default for browser-created schedules. Closing the browser or signing out does not revoke that grant. A grant created through an API token also depends on that token's current expiry, revocation, scopes, project access and permission ceiling. Already-running work retains its recorded authorization. Future preparation and dispatch must pass current checks.

**Pause future runs** stops future admission. **Run once now** creates a separate occurrence and does not resume a paused schedule. **Cancel occurrence** requests cancellation of that occurrence, with the result reported separately from future scheduling. Neither pausing nor archival deletes a conversation or workspace.

After downtime, the default skips old occurrences. Optional catch-up selects at most the latest three due occurrences within 24 hours and processes that fixed selection in order. It does not refill a growing backlog. The history marks omitted ranges without inventing an exact count. Each schedule permits one unresolved occurrence at a time.

The attention view links to approvals, failed preparation and uncertain delivery. Offline approvals expire through the normal five-minute deadline. Uncertain work is never automatically replayed. Open its conversation, confirm fencing, and explicitly acknowledge unknown effects before submitting a new operation through the ordinary recovery flow. The original uncertain operation and its history remain intact.

The interface shows bounded, paginated schedule and occurrence lists. Loading older pages pauses automatic replacement of those pages; **Refresh schedules and occurrences** returns to current results. Schedule edits use an expected revision. A conflicting edit leaves the draft available for inspection; discard it explicitly before loading the latest version. A lost mutation response retains the exact request in memory for retry, without creating a new operation silently.

Limits include 16 enabled schedules per project, 64 enabled globally, 64 retained per project, and 256 retained globally. Settled occurrence history is bounded to 256 per schedule and 90 days; unresolved uncertainty is retained. Workspaces are retained for inspection and remain subject to the project's separate storage and workspace limits. Pause and cancellation have reserved, bounded control records independent of the ordinary schedule-management command quota.

A standalone Git run captures the source commit when its occurrence is accepted. A later change to source HEAD cannot change that occurrence. A busy source rejects a manual run before acceptance; retry deliberately after the current writer finishes. Emergency stop pauses all schedules and revokes future grants, while each occurrence retains its actual completion, interruption or uncertainty history. A new pause request also stops a run-now grant created after an earlier pause; retrying the exact older pause request only reconciles that earlier result.
