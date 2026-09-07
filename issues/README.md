# Issue index

Use this index and the [issue archive](archive/README.md) to find existing findings before creating work. The [repository lifecycle rules](../AGENTS.md#issue-resolution-and-transfer) define direct fixes, proposal transfers, archive dispositions, and reopening. The [active proposal index](../design/proposals/README.md) tracks delivery by the receiving owners.

## Active issues

P001/P003/P005/P007 implementation reviews, authority-expiry integration, replay/control bounds, the reproduced P005 browser-test defect and unregistered-allocation detection/reconciliation are resolved in the archive. P004/P006/P009 implementation and integration reviews, P002/P007 regression findings, live-account and backup-transfer blockers, and gateway availability remain active. The earlier runtime finding remains Transferred with partial local evidence below.

| Issue | Severity | Status | Owner | Next action |
| --- | --- | --- | --- | --- |
| [P007 regression evidence](2026-09-08-020429-p007-regression-evidence.md) | Medium | In progress | P006 regression implementer | Preserve the original quota assertion separately from credential-cleanup409, diagnose and verify the supported correction. |
| [P002 rate-limit acceptance](2026-09-08-015752-p002-rate-limit-acceptance.md) | Medium | In progress | P006 regression implementer | Replace a timing-sensitive sequential assertion with a bounded read-only burst, add status/timing evidence, independently review and verify. |
| [P004 implementation review](2026-09-08-012652-p004-implementation-review.md) | High | In progress | P004 | Two feature rounds closed with matching critical/Linux passes. Complete shared P006/P009 writer, inventory, drain and restore integration. |
| [P006 implementation review](2026-09-08-005028-p006-implementation-review.md) | High | In progress | P006 | Two corrective rounds and complete terminal acceptance passed, including the confirmed output-retention deadlock fix. Finish regressions and P004/P009 integration. |
| [P009 implementation review](2026-09-08-005028-p009-implementation-review.md) | High | In progress | P009 | Two baseline rounds and final critical E2E passed. Complete distinct backup destination enrollment and available administrator recovery/inventory checks. |
| [Dedicated live-test credentials](2026-09-07-171225-live-runtime-credentials.md) | High | Blocked | P001; later live-test owners | Supply dedicated test credentials through the documented test configuration, then run bounded real-account acceptance. Continue other implementation and verification. |
| [P009 backup transfer authorization](2026-09-07-231526-p009-backup-transfer-approval.md) | High | Blocked | P009; dependent checkpoint users | Automatic review rejected generated private-state/secret export to the owned B SFTP repository. Finish available implementation/review, then obtain exact payload/destination authorization before the transfer. |
| [Linux gateway availability](2026-09-07-185228-linux-gateway-availability.md) | Medium | Open | P001; P009 target-host lane | Second VM reproduced DNS/TLS transport failures in 5/20 probes; retain denial policy and compare target-host connectivity. |

## Pending work transferred to proposals

| Finding | Severity | Disposition | Owners and remaining gate | Next action |
| --- | --- | --- | --- | --- |
| [Codex runtime compatibility](archive/2026-09-07-073831-codex-runtime-compatibility.md) | Medium | Transferred; not resolved | [P001](../design/proposals/001-secure-persistent-conversations.md#source-issues): contracts and Linux passed, live account pending; [P009](../design/proposals/009-portable-deployment-and-restore.md#source-issues): partial installed evidence and reviewed baseline, remaining implementation/release/restore gates pending. | Verify the remaining mapped gates and update evidence per part. Deployment readiness remains unverified. |
