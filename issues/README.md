# Issue index

Use this index and the [issue archive](archive/README.md) to find existing findings before creating work. The [repository lifecycle rules](../AGENTS.md#issue-resolution-and-transfer) define direct fixes, proposal transfers, archive dispositions, and reopening. The [active proposal index](../design/proposals/README.md) tracks delivery by the receiving owners.

## Active issues

The archive contains resolved source-review findings, installed web/workspace corrections, authority and retention corrections, allocation detection/reconciliation, and the P002/P005 harness corrections. Current P010 integration, P004/P006 restore obligations, P005/P007 regression observations, live-account and backup-transfer blockers, and gateway availability remain active. The earlier runtime finding remains Transferred with partial local evidence below.

| Issue | Severity | Status | Owner | Next action |
| --- | --- | --- | --- | --- |
| [P011 implementation review](2026-09-13-024503-p011-implementation-review.md) | High | In progress | P011 | Correct stop-attempt reservation and accepted-execution readiness; verify the actual failure schedules and independently review. |
| [P010 artifact link boundary](2026-09-08-045236-p010-artifact-link-boundary.md) | Medium | In progress | P010 | Exact-parent containment correction and independent hostile-archive checks passed; record committed P010 integration before archiving. |
| [P005 attachment draft regression](2026-09-08-044009-p005-selection-regression.md) | Medium | Open | Regression maintainer | Reviewed bounded diagnostics integrated in e1b754a; inspect them on recurrence to establish the unexplained failing phase and cause. |
| [P007 regression evidence](2026-09-08-020429-p007-regression-evidence.md) | Medium | Open | Regression maintainer | Original-error/cleanup diagnostics are reviewed and a full critical run passed; inspect them on recurrence to establish the earlier409 cause. |
| [P004 implementation review](2026-09-08-012652-p004-implementation-review.md) | High | Blocked | P004/P009 | Feature and installed module scope passed; obtain required protected fresh-host restore/authority evidence under P009-04. |
| [P006 implementation review](2026-09-08-005028-p006-implementation-review.md) | High | Blocked | P006/P009 | Terminal and installed module scope passed; obtain required protected fresh-host restore/authority evidence under P009-04. |
| [Dedicated live-test credentials](2026-09-07-171225-live-runtime-credentials.md) | High | Blocked | P001; later live-test owners | Supply dedicated test credentials through the documented test configuration, then run bounded real-account acceptance. Continue other implementation and verification. |
| [P009 backup transfer authorization](2026-09-07-231526-p009-backup-transfer-approval.md) | High | Blocked | P009; dependent checkpoint users | Automatic review rejected generated private-state/secret export to the owned B SFTP repository. Finish available implementation/review, then obtain exact payload/destination authorization before the transfer. |
| [Linux gateway availability](2026-09-07-185228-linux-gateway-availability.md) | Medium | Open | P001; P009 target-host lane | Second VM reproduced DNS/TLS transport failures in 5/20 probes; retain denial policy and compare target-host connectivity. |

## Pending work transferred to proposals

| Finding | Severity | Disposition | Owners and remaining gate | Next action |
| --- | --- | --- | --- | --- |
| [Codex runtime compatibility](archive/2026-09-07-073831-codex-runtime-compatibility.md) | Medium | Transferred; not resolved | [P001](../design/proposals/001-secure-persistent-conversations.md#source-issues): contracts and Linux passed, live account pending; [P009](../design/proposals/009-portable-deployment-and-restore.md#source-issues): partial installed evidence and reviewed baseline, remaining implementation/release/restore gates pending. | Verify the remaining mapped gates and update evidence per part. Deployment readiness remains unverified. |
