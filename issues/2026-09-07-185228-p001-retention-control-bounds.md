# Align replay retention and cancellation storage bounds

- Severity: Medium
- Status: In progress
- Owner: [P007](../design/proposals/007-session-history-and-recovery.md) corrective implementation; [P001](../design/proposals/001-secure-persistent-conversations.md#contracts-and-security) acceptance
- Recorded: 2026-09-07
- Affected files: packages/storage/src/maintenance.ts; apps/api/src/server.ts
- Acceptance: P001-03 replay resynchronization and P001-07 bounded storage; inherited by subsequent API clients

## Evidence and impact

Independent review round 3 identified these remaining bounds at source digest 05971cd8dfcba617b16dd68eaf33f17dadcc0fbfbc1aad99c4c1e65d118183e0:

- The replay cleanup predicate uses sequence strictly less than the current sequence minus 2,000, retaining 2,001 rows after maintenance. Cleanup runs periodically rather than enforcing the documented limit within each event transaction.
- Seven-day age cleanup excludes sessions with active or uncertain operations. Their durable state must survive, but the proposal separately promises a seven-day replay bound.
- Turn admission counts all operations and refuses new turns at 500. Cancellation rejects terminal turns and coalesces pending requests for the same target, but has no explicit total/reserved-control bound. Controls for previously admitted turns and repeated failed control requests can exceed 500 records.

The implemented replay and cancellation workflows remain available, but their exact storage limits do not fully match the canonical P001 contract. This record carries the noncritical follow-up from the [implementation review](archive/2026-09-07-174757-p001-review-findings.md); it is not a claim that these bounds were fixed.

## Next steps

On 7 September 2026, P007 took corrective implementation ownership for both replay age/count and reserved cancellation/recovery capacity, mapping to P007-02/05/06 and inherited P001-03/07. Its canonical proposal records the concrete design while implementation proceeds. This issue remains active until the complete correction, independent review, boundary tests, and documentation pass; ownership is not resolution or archival transfer.

Enforce a documented event count/age bound without expiring durable messages, unresolved operations, approvals, or required idempotency records. Reserve bounded cancellation/recovery capacity before admitting ordinary work, and prevent failed/no-op control retries from accumulating indefinitely.

Exercise the boundary through the real database/API, including retained-cursor resynchronization, unresolved work, exhausted ordinary admission, cancellation headroom, and repeated failed controls. Record the implementation, independent review, source identity, and evidence before resolving this issue. Keep the affected P001 acceptance unverified meanwhile.
