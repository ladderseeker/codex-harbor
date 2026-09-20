# Correct deployment command and restore findings

- Severity: High
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-08
- Owner: P009 implementer; independent reviewer and main-agent integration
- Recorded: 2026-09-08
- Affected files: infra/deploy/common.py, harborctl, backup.py, control.py, extract.py, publish.py, probe.ts and destination configuration
- Acceptance: [P009-01–07](../../design/proposals/archive/009-portable-deployment-and-restore.md#independent-acceptance)

## Round 1 evidence

A separate agent reviewed exact source `3d69c240815de3678516fd70b5cc4fa29506336e3a1a9bee8a09b92418c5753a` (886 files), without modifying it or attempting the blocked backup transfer. Earlier installed-artifact results remain valid only for their historical tested bytes; they do not establish the following later source paths.

1. **High — administrator subprocess wrapper is broken.** `common.py:34–69` references undeclared `input_file` and `capture_limit`, and rejects those keyword arguments used by callers. A harmless `run(['/usr/bin/true'])` independently reproduced `NameError` before process launch. Repair its complete bounded interface and cover real harmless stdin, capture, file and timeout behavior.
2. **High — status command name is shadowed.** `harborctl:129` assigns local `status`, making the earlier `status(c)` call around line77 an uninitialized local. Rename it and test real CLI dispatch with application services unavailable.
3. **High — backup and restore file limits disagree.** `backup.py:100–102,203–207` permits regular files above 512 MiB within its 32 GiB aggregate while `extract.py:103` rejects them. A permitted checkpoint can be unrestorable. Share exact producer/consumer limits and reject before upload, or stream supported large files within explicit bounds. Verify the 512 MiB boundary.
4. **High — Caddy remains a checkpoint writer.** `control.py:215` stops API/supervisor/storage but leaves Caddy running while `backup.py:182–198,289–303` inventories and snapshots its state. A renewal/config write can disagree with the recorded inventory; Restic pack integrity alone cannot detect that Harbor mismatch. Quiesce Caddy and compare actual snapshot content/inventory to the registry before publishing verified completion. Test mutation between inventory and capture.
5. **High — restore can destroy unknown pool-slot contents.** `publish.py:143–172` recursively clears a quota-verified slot, while quota validation establishes accounting/access/headroom rather than emptiness or ownership of those bytes. Require the exact known-empty prepared shape before an exclusive durable claim. Retry may clear only content proven owned by that restore operation. Preserve an unknown sentinel and test interrupted owned publication.
6. **High — valid removed-workspace history prevents activation.** `probe.ts:17–26` refuses retained native history for a legitimately removed derived checkout. P003 permits clean idle workspace removal while retaining conversations/homes; restore intentionally omits the removed checkout. Provide an explicitly read-only history-validation context without recreating the removed workspace or granting execution fallback. Test a completed conversation, clean removal, and retained-history validation.

Findings3–6 are source-inferred concrete paths, not claims of executed A-to-B reproductions. The existing extraction/lifecycle fixtures correctly label themselves unit contracts. The passing checks did not exercise the broken complete administrator wrapper/CLI paths.

## Impact and next steps

These findings affect core administration, checkpoint usability, preservation of unknown bytes and restore activation. The implementer owns one focused correction batch with harmless/local fault tests, followed by independent round2 and applicable installed checks. Preserve earlier evidence and do not modify selected immutable releases in place.

The [protected transfer approval](../2026-09-07-231526-p009-backup-transfer-approval.md) and [dedicated live-account](../2026-09-07-171225-live-runtime-credentials.md) gates remain separate blockers. Do not bypass either gate or describe local fixtures as a real checkpoint/restore. Record correction identities, actual commands/results and review closure before archiving this same issue; P009 remains active while mandatory verification is incomplete.

## Round 2 and real CLI contract — 8 September 2026

Independent round 2 inspected frozen source `3c34d0aee9be82362ce0aeb85834a2bf4424ccdb1e07bf459235cb3d7ebb9554` (892 files). It accepted the six original source corrections and their explicitly limited local/installed evidence, then found a Medium filename collision: `extract.py` selected every descendant named `registry.json` as a possible authoritative registry. A normal project file with that name prevented checkpoint verification or restore. Select only the dedicated authenticated top-level backup source and preserve ordinary project files with the same name.

During that correction, the implementer checked pinned Restic 0.19.1 and found that real `ls` JSON omits symlink targets assumed by the snapshot-verification fixture. Verification now reads bounded authenticated tree metadata. A new real CLI contract uses only fresh public text/symlink fixtures in a disposable local repository; it accesses no Harbor installation, private configuration, SFTP destination or rejected payload and is not A-to-B acceptance. Its first run exposed a further interaction: the strict small-file output limit also constrained Restic's repository lock-file creation. Immutable snapshot `ls`, `dump` and `cat tree` reads now use `--no-lock` under the administrator operation lock, retaining content limits and write-operation locking. Missing content still fails verification.

The final focused review closed without actionable findings on source `b6599ab31a6b4690b54a9bd0632f3c668e98ebb88b2905f1f7f82066327a4289` (893 files). Seventeen Python contracts and the actual public Restic CLI contract passed; the latter's record explicitly qualifies a subsequent narrowing from generic `cat` to `cat tree`, with the exercised commands unchanged. Main-agent Node 24.11.1 `pnpm check` and full E2E `harbor-e2e-d47ae72678` passed with identical start/end source. Root integration preserves that exact source; only documentation needed conflict resolution. Two review rounds are closed for this baseline. The [deployment report](../../docs/reports/2026-09-08-p009-development.md) preserves separate installed-artifact and Linux publication evidence without relabeling those artifacts as the final source.

## Remaining implementation audit — 8 September 2026

The issue remains In progress because a required operator flow is still missing: a freshly restored host cannot yet enroll or update its own ongoing off-host backup destination independently of the repository used as its restore source. The current configuration uses one endpoint for both roles. A repository located on restored B cannot qualify as B's ongoing off-host destination.

P009 owns a bounded, versioned administrator enrollment/update path that retains immutable restore-source authority, validates a distinct pinned remote host identity, compares expected destination revisions and prevents configuration changes from redirecting an interrupted restore. Its connectivity probes transfer only public canaries; no protected payload or repository-secret initialization may bypass the existing approval blocker. Available Linux administrator stale-lock recovery and complete allocation-inventory/reconciliation evidence also remain pending. Complete and independently review this required behavior and its available checks before closing this record; keep the separate blocked transfer/live gates visible afterward.

## Enrollment implementation review — 8 September 2026

The separate future-destination flow now has initial public-canary CLI evidence, including same-host refusal, exact lost-response reconciliation and stale-version denial. The new source CLI ran against earlier installed services; it is not a packaged-new-artifact result. No repository initialization or protected transfer occurred. Installed stale-lock and allocation-inventory lanes also passed their stated bounded checks, with final evidence reconciliation under review.

The new-behavior review found a **High** exact-host-pin defect: SSH's global known-host database can supply trust outside the configured destination pin. The implementation owner accepted a correction to exclude alternate trust sources and verify rejection when another globally trusted key differs from the selected pin. Keep enrollment unverified until this correction, public-only failure tests and independent closure pass. The earlier two baseline rounds remain historical closed reviews; they did not cover this newly implemented flow.


## Resolution — 8 September 2026

Author commit `2dc2ecff33e0b99311c022e9f0c8c9082a213397` delivers the required follow-up on source `6d3a9c13c7c4f967fed64e542651b0235f3662598b8edeaf9d0af6962ff31b34`, 900 files. Node 24 check and 21 Python contracts passed; the report qualifies the earlier build/socket checks and separately tested public Restic metadata contract. Independent review closed the new-flow correction and its precise final artifacts with no actionable finding. This is a third bounded review scope following the two closed baseline rounds, not a new claim about protected transfer or restore.

Both enrollment and all Restic transports use the shared exact SSH policy, excluding global known-hosts, alternate trust, agent identities, proxies and connection sharing. Actual Linux public-loopback testing reproduced the old global-key fallback, rejected that alternate key under the fix, and accepted the exact configured key. Its evidence is explicitly transcript-derived from successful session 71877: test SHA `e4c8ecc04c5aa1e25ab1adc715badaf204b1e9ec3be4a2a345b1e0d805a52f41`, policy SHA `49e04eca25e269a4d3861b6f72c37097eea352f72fc55d9e42d7557741513667`. No host trust database was changed.

The final public enrollment result records source CLI component `4d7f41d3c5ead4405d27c2472991a67e83209f6eaea7c4534b40288aa034f049`, 26 files, and CLI SHA `69a43bb46f51914dfbabf39d60d9ac210c4f146b32f97402244c5a197b5fa970`. Python 3.12.3 ran the new source CLI against unchanged installed artifact `6dd02dba8efa54179667afef6e48c2623986d32a76e1bed68ea8cae4355b9dc8` in disposable `deploy-29946354`; this is not a newly packaged release pass. API-UID/same-host denial, exact public roundtrip cleanup, lost-response reconciliation, stale CAS and failed-authentication preservation passed. The destination remained uninitialized, with no protected transfer.

The same installed artifact passed the independently reviewed exact administrator stale-lock recovery: actual pinned Codex, injected stale lock, paused owned runner and owner SIGKILL, acknowledgement/inode denials, whole-runner retirement, unchanged generation ledger, rejected old generation and fresh read-only initialization/retirement. Original uncertainty and reservation remained intact. The separate [allocation inventory issue](2026-09-07-205511-unregistered-project-allocation.md) records its completed detection/reconciliation and preservation evidence.

Main integration preserves every deployment production/test byte from the reviewed commit; only the report's dated addenda needed conflict resolution. Combined root source `8d5479e8acb408f1f53b1c03a4946d8295adf9b6cc43e7e8ea32a3b481f3130d`, 928 files, passed Node 24 `pnpm check`, including 72 documentation files. No redundant Linux run is attributed to the larger aggregate source.

The original findings and missing follow-up behavior are resolved. P004/P006 module, writer, drain and restored-authority integration remains in their active implementation issues. P009's protected checkpoint/restore, actual restored-history activation, promotion/rollback and live-account gates remain active in their proposals and separate blocker records. This issue closure does not mark P009 Verified or authorize a blocked transfer.

## Ownership navigation — 20 September 2026

The disposition and evidence above are historical. Retired proposal references identify feature lineage; any unfinished inherited acceptance is retained in the [active inbox](../) and the [current subsystem designs](../../design/systems/). The P017 baseline migration did not resolve another finding or rerun this record’s checks.
