# Automatic approval review blocks the P009 test backup transfer

- Severity: High
- Status: Blocked
- Recorded: 2026-09-07 23:15:26 Asia/Shanghai
- Owner: [P009](../design/proposals/009-portable-deployment-and-restore.md#source-issues)
- Category: Verification authorization prerequisite
- Affected: P009-04/05 encrypted off-host backup and fresh-host restore; P009-06 promotion/rollback paths that require that verified checkpoint; candidate `infra/deploy/harborctl` and backup implementation

## Evidence and exact scope

On 7 September 2026, automatic approval review rejected two attempts to run the fixed P009 backup command in the owned disposable source VM, `harbor-quota-20260907`. The second attempt followed read-only checks establishing `accountConfigured: false`, zero projects, zero conversations, and task-generated configuration. No backup transfer ran.

The selected test instance is `deploy-f1694c7e`, installed artifact `40f139a8104bb7026f665cec12056460fcaa3aa859a19bb8287d2b26148462d3`. The backup implementation is an evolving P009 candidate, not a final reviewed source digest. The command invokes `harborctl --config <owned test configuration> backup`; the exact command and run-specific endpoint remain in the ignored test/agent evidence rather than portable operator instructions.

The proposed destination is the separate owned test VM `harbor-restore-20260907`, its restricted SFTP account `hbrbackup0907`, and `/repository` inside the task's dedicated 1 GiB chroot filesystem. An authenticated synthetic-file roundtrip and host-file, root-write, shell, link and forwarding denials passed before the rejected backup. Those probes transferred no Harbor database, configuration or secret. Their evidence is `.test-runs/p009-sftp-network-20260907.json` and `.test-runs/p009-sftp-host-20260907.json` in the root checkout.

The blocked encrypted payload contains a fresh PostgreSQL snapshot with test OIDC sessions/grants/metadata; generated protected configuration and database password/pgpass; a local test TLS private key/certificate; an unused generated model-encryption key; Caddy state; and historical launcher/receipt metadata. It contains no personal projects or configured model-account credential at this checkpoint. The SFTP private key and Restic repository password remain out of band and are excluded, as are redundant native authentication copies. Generated secret material remains private even in a disposable fixture.

The final automatic-review rejection states:

> This action was rejected due to unacceptable risk. Reason: Although read-only evidence shows a disposable instance, the backup still exports generated secrets and other private state to an SFTP destination; the assistant’s justification cannot substitute for trusted user authorization of that exact payload and destination. Do not bypass this rejection through a workaround or indirect execution.

## Impact and next steps

Do not rerun, reroute or indirectly execute the rejected transfer without the required exact user authorization. The owner's broad autonomous roadmap authorization did not satisfy this automatic-review decision. Preserve the blocked gate while completing authorized implementation, independent review, local integrity/extraction/compatibility checks, isolated installation/reboot/UID/Linux checks and application regressions. A local or redacted fixture cannot substitute for the required protected A-to-B recovery evidence.

Before requesting the remaining approval, finish the implementation and available checks so the user can review a concrete tested command, source/artifact identity, complete payload classes and exact owned destination. Refresh the payload inventory if later test state changes. Explain that the approval requirement comes from automatic approval review, not an invented project lifecycle gate. Approval, if provided, authorizes only the stated transfer scope; it is not a passing backup or restore result.

Once authorized, run the bounded encrypted backup, full Restic data check, fresh disabled B restore and applicable promotion/rollback acceptance. Record exact source/artifact/snapshot identities, commands, environment, results, independent review and limitations before resolving this issue. Until then, P009 remains unverified and any dependent deployment/self-development verification requiring a complete checkpoint remains blocked.
