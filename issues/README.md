# Issue index

Use this index and the [issue archive](archive/README.md) to find existing findings before creating work. The [repository lifecycle rules](../AGENTS.md#issue-resolution-and-transfer) define direct fixes, proposal transfers, archive dispositions, and reopening. The [active proposal index](../design/proposals/README.md) tracks delivery by the receiving owners.

## Active issues

P001/P003/P005/P007 implementation reviews, authority-expiry integration and replay/control bounds are resolved in the archive. The live-account blocker, gateway availability, storage inventory and a Low unexplained browser-test timeout remain active. The earlier runtime finding remains Transferred with partial local evidence below.

| Issue | Severity | Status | Owner | Next action |
| --- | --- | --- | --- | --- |
| [Dedicated live-test credentials](2026-09-07-171225-live-runtime-credentials.md) | High | Blocked | P001; later live-test owners | Supply dedicated test credentials through the documented test configuration, then run bounded real-account acceptance. Continue other implementation and verification. |
| [Linux gateway availability](2026-09-07-185228-linux-gateway-availability.md) | Medium | Open | P001; P009 target-host lane | Second VM reproduced DNS/TLS transport failures in 5/20 probes; retain denial policy and compare target-host connectivity. |
| [Unregistered project allocation](2026-09-07-205511-unregistered-project-allocation.md) | Medium | Open | P009 preflight and backup registry | Reproduce commit failure after slot allocation; detect and safely reconcile unregistered quota units without adopting or deleting unknown data. |
| [Upload-recovery visibility timeout](2026-09-07-224419-p005-reload-visibility.md) | Low | Open | P005/browser regression owners | Capture the HTTP/page diagnostics on recurrence and reproduce before changing behavior or the intended assertion. |

## Pending work transferred to proposals

| Finding | Severity | Disposition | Owners and remaining gate | Next action |
| --- | --- | --- | --- | --- |
| [Codex runtime compatibility](archive/2026-09-07-073831-codex-runtime-compatibility.md) | Medium | Transferred; not resolved | [P001](../design/proposals/001-secure-persistent-conversations.md#source-issues): contracts and Linux passed, live account pending; [P009](../design/proposals/009-portable-deployment-and-restore.md#source-issues): implementation In progress, target-host/release/restore evidence pending. | Verify the remaining mapped gates and update evidence per part. Deployment readiness remains unverified. |
