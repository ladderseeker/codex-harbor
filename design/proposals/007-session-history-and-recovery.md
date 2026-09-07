# P007 — Session history and recovery

- Decision: Accepted
- Delivery: In progress
- Dependencies: [P001](001-secure-persistent-conversations.md)
- Outcome: The owner finds previous work, reconnects across storage/restart gaps, and resolves interrupted or uncertain operations without accidental replay.

## Scope and user/API flow

Add searchable/paginated conversation history, rename/archive/unarchive, durable status visibility, snapshot resynchronization after replay retention, and a recovery view for interrupted or uncertain operations. The owner can inspect the last confirmed state and deliberately continue with new input or leave the session stopped. P001 already supplies basic session reopening, browser-disconnect survival, and safe crash classification; this feature must not be required to make P001 safe.

Provide corresponding authenticated history, archive, snapshot, and recovery operations. Reopening a conversation does not automatically restart an old turn. Permanent deletion can be excluded from initial delivery; archival must not delete source folders or active work. Whole-VPS backup/restore is P009; scheduled work is P008.

## Contracts and ownership

Maintain application history indexes and native thread references without editing Codex's private database schema. Native history remains authoritative for conversation content; UI event retention can be shorter. A snapshot identifies its sequence, and a client resumes strictly after that sequence. Detect expired cursors, known gaps, and stale runtime generations.

Use the [operation state machine](../architecture.md#api-events-and-state-transitions). Persist and reconcile dispatch intent, recorded response, native history, and current runtime state. If they cannot establish delivery, keep `uncertain` visible. The owner may explicitly start a new operation after inspecting that risk; never label it an exactly-once continuation. Approval answers and cancellation need the same reconciliation discipline.

Database outage denies new mutations and approval answers; existing authorized work follows bounded buffering/emergency rules. Restoring connectivity cannot manufacture missing events. History search is owner-authorized, bounded, and treats snippets as untrusted content. Active operations/approvals and referenced attachments must survive retention maintenance.

## Independent acceptance

Seed delivered P001 with completed, waiting, failed, and long-running conversations plus deterministic crash points. Use the real database/supervisor and controlled external runtime fixture; no scheduler or deployment UI is needed.

1. **P007-01:** Search, paginate, rename, archive, and reopen conversations. Assert consistent UI/API results and unchanged native conversation/source files.
2. **P007-02:** Reconnect before and after event retention, including a snapshot/stream race. Assert no missing confirmed state, no duplicate rendered items, and explicit resynchronization for a gap.
3. **P007-03:** Kill the runtime before dispatch, after possible delivery, and after execution before acknowledgement. Assert the appropriate interrupted/uncertain state and no automatic duplicate side effect.
4. **P007-04:** Recover a waiting approval after viewer reconnect, then restart its runtime and submit the old answer. Assert the live request is answerable once and the stale request expires.
5. **P007-05:** Make PostgreSQL unavailable during active work, restore it, and exceed the bounded event buffer separately. Assert mutation denial, documented gap/recovery state, and resource bounds.
6. **P007-06:** Resolve uncertainty deliberately, continue a recovered conversation with a new operation, and retry that request. Assert explicit acknowledgement of uncertainty and deduplicated new input.
7. **P007-07:** Repeat native history/restart/resume checks with the pinned real runtime and a bounded live turn. Assert supported behavior rather than inferring it from fixture output.

## Delivery and verification

Use planned `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, and relevant `pnpm test:live`. Fault injection must affect only the run's services and storage. Follow [shared setup/evidence/cleanup rules](README.md#shared-verification-contract). Do not run host reboot or process-kill tests against the developer's normal instance.

Migrate indexes additively, document retention and recovery limitations, and preserve the original native state during reconciliation. Rollback cannot blindly downgrade a native history format; require the [release compatibility rules](../architecture.md#release-retention-and-rollback-rules). Record evidence and independent review before delivery is verified.
