# Private tools-disk recovery requires explicit authorization

- Severity: Medium
- Status: Blocked
- Owner: Repository maintainer; P010 verification infrastructure
- Affected resources: C's obsolete sealed tools disk and certificate, local recovery storage and capacity for the next candidate base
- Acceptance: [P010-01/03/07](../design/proposals/010-self-development.md#independent-acceptance); this infrastructure record does not replace the feature's mandatory checks
- Related evidence: [Interrupted-work recovery](../docs/reports/2026-09-13-interrupted-work-recovery.md#private-tools-disk-recovery-rejection--13-september-2026)

## Observation — 13 September 2026

After exact generated-cache cleanup, C's physical control filesystem had 20,739,600,384 bytes available, below the production admission minimum of 21,541,945,344 bytes. A new combined cache/fixture image also requires preparation space. The existing budget remains enforced; no new candidate or sealed base was started in this assessment window.

The obsolete `cache-refresh-e179278b367c4148843a2c51152ab8db/sealed/guest.qcow2` under `/var/lib/harbor-verification/` is 3,229,377,536 bytes, SHA-256 `88006634b3a944510ce0cdc00a724334323f8e1d950d3a62c91860a9d58d66ab`, device 64769/inode 529735, root-owned mode 0444. Its 976-byte `preparation.json` is SHA-256 `8306c2947089f44b4c68ba1a7006d127abb73c833ee9b8c64837f627e0922e1c`, inode 529729. Read-only checks found no open source handles or running containers and the two historical diagnostic controllers inactive/dead. Historical configurations still refer to the original disk path and remain preserved.

Retained exact preparation source and receipts establish a tools-only phase using public inputs, without candidate execution or Harbor database/model configuration in that preparation. Independent provenance review could not exclude private OS/Docker metadata or residual generated guest-key bytes. The image is therefore a **private task-owned recovery disk**, with no claim that it is a sanitized public archive. Pristine base `4c34124113be96a16e876a0e5e9a95f217b2e610db7ee2029fe0ccce1c9209f0`, both certificates and all historical evidence remain unchanged.

## Prepared action and automatic rejection

The prepared helper would copy only this exact disk and certificate through the existing authenticated loopback connection to a new `.test-runs/private-tools-recovery-20260913/` directory on the same Mac. It checks current user/VM ownership, source identities and idle state, enforces fixed byte limits, independently reads back the expected hashes and syncs the local files and directory entries. The new directory would be mode 0700 and files mode 0600. It performs no boot, mount, source deletion or access change. Any later source retirement would be a separate operation after durable recovery and fresh checks.

Fresh ownership proof `.test-runs/recovery-20260913/c-sealed-base-audit/provenance.json`, SHA-256 `10efcd5827d44fc135d87dda94e41e8b36e3eedce0d8d64bdf6de09762119db1`, establishes UID 501's existing master 6887, loopback Lima listener and local 48 GiB VM disk. The first audit stopped locally before any guest command because it had mistakenly reused D's 32 GiB disk-size guard; that failed helper was preserved before the correct C identity check passed.

One bounded independent helper review found a missing parent-directory sync. The corrected helper, SHA-256 `441354e4e5d83ed753c8b12948be20776b721e04bfa27d6b394357b6bf06432a`, passed the focused correction review and local/embedded Python syntax checks. Neither review executed the recovery.

Automatic approval review then rejected process creation because the 3.2 GB private disk may contain residual guest keys or metadata, and the agent's justification could not establish trusted-user authorization for that sensitive payload and destination. **The recovery did not execute; its destination directory does not exist.** The source disk and certificate were neither exported nor retired. The exact helper and rejection receipt are retained under the audit directory.

## Next steps

Continue unaffected implementation, review and tests. Assess already established public-cache/image inputs and unused blocks for safe capacity recovery while preserving both sealed bases, evidence and the production reserve. Do not count unmeasured reclaimable space as available capacity.

If the private recovery remains necessary, obtain explicit authorization for these two exact files and the same-Mac private destination before submitting that action again. Do not use another agent, transport, indirect command or deletion to bypass the rejection. Preserve the original disk path's historical references and document restoration of its exact bytes before any future reuse after an authorized retirement.

The [protected P009 backup-transfer rejection](2026-09-07-231526-p009-backup-transfer-approval.md) and [persistent SSH enrollment rejection](2026-09-13-022007-test-host-ssh-recovery.md) remain separate. Source/test-artifact approvals do not authorize these private or administrative operations. Resolve this infrastructure issue only with recorded authorized recovery or an independently reviewed alternative that removes the capacity dependency while preserving the required evidence.

## Bounded capacity follow-up — 13 September 2026

After the rejection, a separately approved fixed free-block discard on `/srv/harbor-worker-verification` reclaimed space from the earlier exact generated-cache cleanup. It removed no files and exported no disk. The check required the three owned generated directories absent, no containers, the original `/dev/loop1` mapping/backing inode and the recorded XFS quota flags. The backing's logical size and both inspected sealed-image hashes were unchanged afterward. Physical control availability rose from 20,739,584,000 to 21,438,017,536 bytes; allocated backing storage fell by the same 698,433,536 bytes. Worker filesystem availability remained 19,575,406,592 bytes.

Receipt `.test-runs/recovery-20260913/c-public-cache-trim-after-mode.json` has SHA-256 `e2e4cfe5e17a1f4a50399f903b84686c50086154d64fc46e0caf1d5e6cd8e036`. This administrative result remains below the unchanged production minimum and does not provide space for the new full base. It is neither private recovery nor complete candidate cleanup acceptance. The separate `/srv/harbor-verification` mount is a 2 GiB filesystem and must not be mistaken for this worker mount.

A fixed metadata-only check also found another historical sealed file under `worker-ee4b195a1095d8a4ea3d681dfe4d140a`; retained local records did not establish its purpose or recovery dependencies. It remains preserved. Neither its name/size nor absence of current containers authorizes treating its contents as disposable. No additional disk export or retirement was attempted, and the original rejection remains in force.
