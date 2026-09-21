# Native macOS ownership cannot prove complete conversation retirement

- Severity: High for native macOS lifecycle completion; outside the selected VPS release.
- Owner: Main, [P018](../../design/proposals/018-concurrent-conversations-and-runtime-capacity.md), acceptance P018-03/05/06/09.
- Recorded: 2026-09-21, Asia/Shanghai.
- Archive disposition: Not planned
- Archived: 2026-09-21
- Reason: The owner selected VPS-only support; native macOS lifecycle parity is outside this release.

## Evidence

Pinned Codex 0.153.4 starts ordinary non-PTY commands in a separate process group and session. Bounded probes found those commands alive after native SIGTERM and the old guardian/group retirement reported completion. PTY closure can mask the gap. Process-group, process-tree and experimental native background-terminal inventories do not establish complete ownership; the latter omits standalone command execution. Probe identity, independent observations and bounded cleanup are retained in `.test-runs/p018/tests/native-probe-evidence.json`. Complete raw historical session exports are unavailable.

P018 adds durable per-conversation runtime capacity, idle eviction and targeted retirement, which require confirmed absence before releasing a slot. Linux now uses delegated cgroup-v2 ownership; its actual pinned native contract run passed 28 checks on snapshot 04, as qualified in the [execution report](../../docs/reports/2026-09-21-p018-concurrency.md). That mechanism does not provide a native macOS ownership boundary. Current non-Linux inspection remains unknown and cannot claim successful retirement or restored capacity.

The [historical P013 review](2026-09-13-143000-personal-local-review.md) already retained a process-group containment limit and did not claim Linux-equivalent retirement. Its six resolved findings remain resolved. This new issue tracks P018's stronger ownership and capacity requirements, rather than invalidating those earlier fixes.

## Impact and required decision

Native macOS runtime reuse may continue, but an unknown member remains counted and cannot be automatically reclaimed. A successful turn or group exit is insufficient to declare its complete descendants gone. Native macOS P018 completion is therefore unverified, and its scope cannot silently inherit Linux acceptance.

The pending owner choice is to release the verified Linux/VPS scope and explicitly defer native macOS P018 lifecycle completion, or to select a supported Linux-container runtime on macOS. The latter needs a settled plan and actual isolation evidence before implementation or delivery. Until that choice, retain P018 as Accepted and do not advertise native macOS lifecycle completion. Continue unaffected Linux/application verification.

## Recheck

For any selected ownership mechanism, prove ordinary idle, non-PTY detached command and preview ownership independently of the implementation under test. Exercise exact-generation retirement, sibling survival, complete absence before capacity release, restart and substituted/missing identity handling on the supported platform. Record pinned source/runtime identity, commands, exits, cleanup and the required independent reviews. A release-scope decision must update D014, current profile documentation and P018 acceptance explicitly; it is not a passing platform test.

## Owner decision — 21 September 2026

The owner confirmed that VPS support is sufficient and only VPS performance is required. D014 and the current profile designs now limit P018/P024 release acceptance to Linux/VPS. This record is archived as Not planned, not Resolved: the native macOS ownership gap remains technically unverified and no process-group absence claim is restored. A later owner-selected native macOS outcome must reopen this record and satisfy its platform gates. The current VPS outcome retains actual Linux retirement, sandbox, application and live-account requirements.
