# Issue index

Use this index and the [issue archive](archive/README.md) to find existing findings before creating work. The [repository lifecycle rules](../AGENTS.md#issue-resolution-and-transfer) define direct fixes, proposal transfers, archive dispositions, and reopening. The [active proposal index](../design/proposals/README.md) tracks delivery by the receiving owners.

## Active issues

The critical P001 implementation review is resolved in the archive. A live-account blocker and two medium follow-ups remain active. The earlier runtime finding remains Transferred with partial local evidence below.

| Issue | Severity | Status | Owner | Next action |
| --- | --- | --- | --- | --- |
| [Dedicated live-test credentials](2026-09-07-171225-live-runtime-credentials.md) | High | Blocked | P001; later live-test owners | Supply dedicated test credentials through the documented test configuration, then run bounded real-account acceptance. Continue other implementation and verification. |
| [Replay and control bounds](2026-09-07-185228-p001-retention-control-bounds.md) | Medium | In progress | P007 corrective implementation; P001 acceptance | Enforce replay age/count and bounded reserved cancellation/recovery storage; verify P007-02/05/06 and inherited P001-03/07 before closure. |
| [Linux gateway availability](2026-09-07-185228-linux-gateway-availability.md) | Medium | Open | P001; P009 target-host lane | Second VM reproduced DNS/TLS transport failures in 5/20 probes; retain denial policy and compare target-host connectivity. |

## Pending work transferred to proposals

| Finding | Severity | Disposition | Owners and remaining gate | Next action |
| --- | --- | --- | --- | --- |
| [Codex runtime compatibility](archive/2026-09-07-073831-codex-runtime-compatibility.md) | Medium | Transferred; not resolved | [P001](../design/proposals/001-secure-persistent-conversations.md#source-issues): contracts and Linux passed, live account pending; [P009](../design/proposals/009-portable-deployment-and-restore.md#source-issues): target-host/release/restore evidence, Planned. | Verify the remaining mapped gates and update evidence per part. Deployment readiness remains unverified. |
