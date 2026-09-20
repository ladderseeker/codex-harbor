# P010 corrected cache-driver transfer requires authorization

- Severity: Medium; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: Medium
- Status: Blocked
- Owner: P010 verification infrastructure / main agent

Complete deferred outcome and acceptance are tracked in [2026-09-20-000003-self-development-acceptance.md](2026-09-20-000003-self-development-acceptance.md); this record retains its individual finding and correction evidence.

- Affected files: `tests/self/cache-warm-linux.py`, `tests/self/cache_docker.py`, the isolated merged public-cache preparation and its retained transfer receipts
- Receiving proposal: [P010](../design/proposals/archive/010-self-development.md), P010-01/03/07
- Related evidence: [Recovery report addendum](../docs/reports/2026-09-13-interrupted-work-recovery.md#corrected-cache-source-transfer-rejection--13-september-2026)
- Next action: finish unaffected implementation and review; obtain authorization for the exact corrective-source payload and existing local-VM destination before resubmission. No transfer retry or alternative execution has occurred.

## Earlier source and metadata staging

The initial request to stage nine fixed preparation-source/manifests and 249 public package-metadata records on C was rejected before execution. Main then obtained fresh read-only evidence that the existing SSH master connects over loopback to the current user's Lima VM on the same Mac, with the original VM disk and XFS backing identity and an absent staging destination. The ownership receipt is `.test-runs/recovery-20260913/c-merged-public-audit/ownership.json`, SHA-256 `5608dd21cc888e67ff6b86b09822791e9a31ae15167316526f06739611ee9bcf`.

Independent payload inspection matched every archived file, all 248 reused public metadata records and all 257 locked registry tarball origins. Internal Harbor preparation source was not described as publicly published. Automatic review accepted the **same original request** after that new evidence. It created only the fixed mode-0700 staging directory and two root-owned mode-0600 archives. Read-only remote checks verified both hashes and sizes:

- `source.tar`: 143,360 bytes, SHA-256 `1045549883d4bd5a7c63bc93158dc42d3b34319204b685190d67befd0726f9a1`.
- `metadata.tar`: 219,514,880 bytes, SHA-256 `8087f82124729360db5ebbf91644c4f32ff040d69f298b5abef1211db0c9a5b0`.

The main receipt `transfer-accepted.json` beside the ownership receipt has SHA-256 `fb706040e0a33dd864b468ff429d61bebec51071842d3bcb6abbf55f3f7f3513`. It records actual transfer/readback tool results. Neither archive was extracted or executed in this step. This accepted staging is distinct from the later rejected correction below.

## Reviewed correction and new rejection

The unexecuted warm driver had two Low review findings: an ambiguous container-create response could leave ownership unresolved without cleanup, and unbounded Docker inspection could outlive the command deadline. Corrective checkpoint `48338e5ed464d1d501d0bd10507947a493166d55` records intent before creation, preserves uncertainty when no immutable identity was captured, and bounds Docker observations and cleanup. Three controlled cache tests passed and independent cache review round 2 closed without actionable findings. The related static-image cleanup completed round 3 with three controlled tests; its previously successful image smoke evidence remains separate. These local checks did not execute the corrected driver on C or establish a complete candidate outcome.

The new correction archive contains only two regular source files:

| File | SHA-256 |
| --- | --- |
| `tests/self/cache-warm-linux.py` | `0b6e58b7614eda3e042b70be5cd43b8cec1737aeb7d2ad7f44809d9fb35d7853` |
| `tests/self/cache_docker.py` | `0601db5a9e7690e409fe71c2b81962dc5bddb0b37cf3555ad5068dc9f1a6dea2` |

Archive `cache-correction-48338e5.tar` is 20,480 bytes, SHA-256 `04294c96d93fe0c576bd634f706134df6dff4ef768a180f141eaf7d9977e4b30`. The request would write it without overwriting an existing file to `/srv/harbor-worker-verification/p010-merged-public-1045549883d4/correction-48338e5.tar` over the same existing C connection. It would not recopy the metadata, extract or execute code, read private runtime state, or change access.

**Automatic approval review rejected this new request before execution.** It stated that the operation exports internal source to a separate VM and that the cited ownership/receipt evidence did not establish user authorization for that specific payload. The exact archive, manifest and `correction-rejection.json` remain under `.test-runs/merged-public-preparation/` in the isolated integration worktree. No resubmission, changed transport, indirect patch or execution of the earlier flawed driver followed. The two previously approved archives remain intact.

The exact `ssh` stdin-write command is retained in `correction-request.sh`, SHA-256 `b073c149c869427a535cd0e039faa894ffd2d379187784e75d18b4158978a462`; the rejection receipt is SHA-256 `064b1c279767b9319ace54c3854aaffa26cd6aeeb00ffac4ff510ea1988e5214`. Main independently rehashed the archive and both regular members locally. This verification executed no remote operation.

## Impact and remaining work

The current-lock Linux warming, strict offline proof and serialized-cache native-tool check cannot proceed through this path until the corrected source is authorized. Earlier static image/protocol checks and source reviews remain valid within their recorded limits. P010 stays In progress; its current cache, sealed-base and full candidate obligations remain unverified.

Continue the deployed module, original-request/control protections, full self-development test driver and independent local checks. Resolve this infrastructure issue only after the authorized exact transfer and readback, or an independently reviewed alternative that completes the same required boundary without bypassing this rejection. Preserve both earlier archives and all original rejection records.

The [private tools-disk recovery](2026-09-13-074853-p010-tools-disk-recovery-approval.md), [protected backup transfer](2026-09-07-231526-p009-backup-transfer-approval.md), [persistent SSH recovery](2026-09-13-022007-test-host-ssh-recovery.md) and [live credentials](2026-09-07-171225-live-runtime-credentials.md) remain separate blockers. Authorization for source staging does not authorize those operations or waive any acceptance gate.
