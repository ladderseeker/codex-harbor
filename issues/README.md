# Issue index

Use this index and the [issue archive](archive/README.md) to find existing findings before creating work. The [repository lifecycle rules](../AGENTS.md#issue-resolution-and-transfer) define direct fixes, proposal transfers, archive dispositions, and reopening. The [active proposal index](../design/proposals/README.md) tracks delivery by the receiving owners.

## Active issues

The archive contains resolved P001/P003/P005/P007/P009 review findings, authority and retention corrections, allocation detection/reconciliation, and the P002/P005 harness corrections. Current feature/integration reviews, installed deployment/workspace defects, P005/P007 regression observations, live-account and backup-transfer blockers, and gateway availability remain active. The earlier runtime finding remains Transferred with partial local evidence below.

| Issue | Severity | Status | Owner | Next action |
| --- | --- | --- | --- | --- |
| [P008 implementation review](2026-09-08-044007-p008-implementation-review.md) | High | In progress | P008 | Two corrective source/feature rounds closed; record committed correction and independent regression-evidence review. |
| [Resume readiness](2026-09-08-044008-p009-resume-readiness.md) | Medium | In progress | P009 | Preserve maintenance until bounded readiness, independently review the correction and verify the actual Linux command outcome. |
| [P005 selection regression](2026-09-08-044009-p005-selection-regression.md) | Medium | In progress | Regression maintainer | Review bounded diagnostics and preserve unexplained failures separately from the passing critical run; establish cause on recurrence. |
| [Created workspace identity](2026-09-08-035221-workspace-validation-identity.md) | High | In progress | P003/P009; P008 worker | Preserve complete identity in post-create managed validation, independently review and verify actual derived/copy application readiness/use on Linux. |
| [Workspace quota import](2026-09-08-031857-workspace-quota-import.md) | High | In progress | P003/P009; installed-module integration | Replace the broken textual quota import and verify real Linux workspace/file paths with independent review. |
| [Installed web assets](2026-09-08-031032-p009-installed-web-assets.md) | High | In progress | P009; installed-module integration | Package the actual served Vite output and verify authenticated UI/assets plus file/terminal outcomes on a fresh immutable artifact; independently review the correction. |
| [P007 regression evidence](2026-09-08-020429-p007-regression-evidence.md) | Medium | Open | Regression maintainer | Original-error/cleanup diagnostics are reviewed and a full critical run passed; inspect them on recurrence to establish the earlier409 cause. |
| [P004 implementation review](2026-09-08-012652-p004-implementation-review.md) | High | In progress | P004 | Two feature rounds closed with matching critical/Linux passes. Complete shared P006/P009 writer, inventory, drain and restore integration. |
| [P006 implementation review](2026-09-08-005028-p006-implementation-review.md) | High | In progress | P006 | Two corrective rounds and complete terminal acceptance passed, including the confirmed output-retention deadlock fix. Critical/workspace regressions passed; complete P004/P009 integration. |
| [Dedicated live-test credentials](2026-09-07-171225-live-runtime-credentials.md) | High | Blocked | P001; later live-test owners | Supply dedicated test credentials through the documented test configuration, then run bounded real-account acceptance. Continue other implementation and verification. |
| [P009 backup transfer authorization](2026-09-07-231526-p009-backup-transfer-approval.md) | High | Blocked | P009; dependent checkpoint users | Automatic review rejected generated private-state/secret export to the owned B SFTP repository. Finish available implementation/review, then obtain exact payload/destination authorization before the transfer. |
| [Linux gateway availability](2026-09-07-185228-linux-gateway-availability.md) | Medium | Open | P001; P009 target-host lane | Second VM reproduced DNS/TLS transport failures in 5/20 probes; retain denial policy and compare target-host connectivity. |

## Pending work transferred to proposals

| Finding | Severity | Disposition | Owners and remaining gate | Next action |
| --- | --- | --- | --- | --- |
| [Codex runtime compatibility](archive/2026-09-07-073831-codex-runtime-compatibility.md) | Medium | Transferred; not resolved | [P001](../design/proposals/001-secure-persistent-conversations.md#source-issues): contracts and Linux passed, live account pending; [P009](../design/proposals/009-portable-deployment-and-restore.md#source-issues): partial installed evidence and reviewed baseline, remaining implementation/release/restore gates pending. | Verify the remaining mapped gates and update evidence per part. Deployment readiness remains unverified. |
