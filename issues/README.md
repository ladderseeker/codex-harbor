# Issue index

Use this index and the [issue archive](archive/README.md) to find existing findings before creating work. The [repository lifecycle rules](../AGENTS.md#issue-resolution-and-transfer) define direct fixes, proposal transfers, archive dispositions, and reopening. The [active proposal index](../design/proposals/README.md) tracks delivery by the receiving owners.

## Active issues

The P001 and P003 implementation reviews are resolved in the archive. P005/P007 implementation findings, authority-correction integration, the live-account blocker, and medium bounds, gateway and storage-inventory follow-ups remain active. The earlier runtime finding remains Transferred with partial local evidence below.

| Issue | Severity | Status | Owner | Next action |
| --- | --- | --- | --- | --- |
| [Dedicated live-test credentials](2026-09-07-171225-live-runtime-credentials.md) | High | Blocked | P001; later live-test owners | Supply dedicated test credentials through the documented test configuration, then run bounded real-account acceptance. Continue other implementation and verification. |
| [Authority expiry after a lock wait](2026-09-07-202308-authority-expiry-after-lock-wait.md) | High | In progress | P002 policy; P003/P007 integration | P002 correction and P003 resource-lock integration passed review/Node 24 acceptance; integrate P007 recovery and verify combined behavior. |
| [P007 implementation review](2026-09-07-203000-p007-implementation-review.md) | High | In progress | P007 | Batch recovery/admission/pagination fixes and missing boundary assertions, then independently re-review and verify. |
| [P005 implementation review](2026-09-07-213300-p005-implementation-review.md) | Medium | In progress | P005 | Correct draft expiry, early upload pause and exact PNG chunk validation; verify real boundary cases and independently review the frozen result. |
| [Replay and control bounds](2026-09-07-185228-p001-retention-control-bounds.md) | Medium | In progress | P007 corrective implementation; P001 acceptance | Enforce replay age/count and bounded reserved cancellation/recovery storage; verify P007-02/05/06 and inherited P001-03/07 before closure. |
| [Linux gateway availability](2026-09-07-185228-linux-gateway-availability.md) | Medium | Open | P001; P009 target-host lane | Second VM reproduced DNS/TLS transport failures in 5/20 probes; retain denial policy and compare target-host connectivity. |
| [Unregistered project allocation](2026-09-07-205511-unregistered-project-allocation.md) | Medium | Open | P009 preflight and backup registry | Reproduce commit failure after slot allocation; detect and safely reconcile unregistered quota units without adopting or deleting unknown data. |

## Pending work transferred to proposals

| Finding | Severity | Disposition | Owners and remaining gate | Next action |
| --- | --- | --- | --- | --- |
| [Codex runtime compatibility](archive/2026-09-07-073831-codex-runtime-compatibility.md) | Medium | Transferred; not resolved | [P001](../design/proposals/001-secure-persistent-conversations.md#source-issues): contracts and Linux passed, live account pending; [P009](../design/proposals/009-portable-deployment-and-restore.md#source-issues): target-host/release/restore evidence, Planned. | Verify the remaining mapped gates and update evidence per part. Deployment readiness remains unverified. |
