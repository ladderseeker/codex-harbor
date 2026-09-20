# Public dependency cache packaging drops executable permissions

- Severity: Medium; retained impact classification, not a priority.
- Inbox owner: Unassigned; awaiting owner selection.

## Inbox ownership — 20 September 2026

This problem remains in the unprioritized inbox, unassigned until the owner selects a new proposal or a bounded fix. Archiving its legacy proposal did not resolve it. Historical severity, progress and former owner metadata below describe earlier work and do not create an execution queue.

### Previous tracking metadata

- Severity: Medium
- Status: In progress
- Owner: P010 implementer; separate verifier reviewer checks the correction

Complete deferred outcome and acceptance are tracked in [2026-09-20-000003-self-development-acceptance.md](2026-09-20-000003-self-development-acceptance.md); this record retains its individual finding and correction evidence.

- Affected files: `infra/self/cache_refresh.py`, `infra/self/guest/cache-refresh.sh`, serialized-cache verification
- Acceptance: [P010-01/03/07](../design/proposals/archive/010-self-development.md#independent-acceptance)

## Evidence and impact — 13 September 2026

Independent review of frozen checkpoint `f6b5f27dfa98cef63e7da3cb5647826578c0bb3e` confirms that `cache_refresh.py:88–105` serializes every public store file with mode `0444`. Its manifest and validation bind file size and content hash but omit executable mode. The guest extracts and moves that store unchanged, then verifies an offline `--ignore-scripts` install without executing the installed public build tools. A successful install therefore did not prove those tools could run.

The retained 455,802,880-byte refresh bundle has archive SHA-256 `1cb64b3d30ed9745bdf0b99a2075f36f6ca926ba8be9a1ab1a8a392a97cceda5`. Independent inspection found the handed-off public esbuild binary in its executable-store entry with mode `0444`: 9,699,480 bytes, SHA-256 `840ad255d6fd587b126d8b2d59ab506d8562785b9bc76249dc3b0e1bdd2ca449`, AArch64 ELF machine 183. The reviewer inspected that member and the frozen scripts without executing it or rehashing the complete archive. The existing recovery receipt retains the archive identity.

This confirms executable-mode loss in packaging. The third actual C build separately reported esbuild spawn `EACCES` in its retained untrusted log, as recorded in the [diagnostic addendum](../docs/reports/2026-09-13-p010-command-diagnostics.md#third-actual-diagnostic--13-september-2026). Its guest was already retired, so exact failed-path permissions, ancestors and mounts were not inspected. Do not treat the packaging finding as an observation of that removed filesystem, or infer the two earlier failed builds' causes.

## Correction and next steps

Preserve a bounded read-only executable mode for public store executables and bind that mode in the serialized manifest and validator. Verify execution of the exact pinned public binary after installing from the serialized cache, with relevant negative mode/content checks. Retain the old archive, failed attempts, sealed bases and certificates. Record the corrected source, commands/environment/results and independent correction review; complete new cache/base qualification, actual candidate acceptance and main integration before resolving and archiving. Existing sealed guests and mount policy must not be silently relaxed to make the build pass.

## Isolated correction and independent review

Checkpoint `84b8661` binds safe modes in serialization and validation, preserves public executables as `0555` and ordinary files as `0444`, and requires a fixed public native transform after the fresh offline install before cache certification. Three local Python contracts passed. A separately scoped actual Linux test serialized and extracted the production cache, installed the frozen lock from its read-only store with fresh policy state and no network, then executed the shared fixed esbuild transform. It passed with the expected executable hash/mode and exact container cleanup. Generated public directories, quota and archive were explicitly retained.

The [cache correction report](../docs/reports/2026-09-13-p010-cache-executable-modes.md) records commands, environment and exact source/artifact/result identities. Independent correction review matched its retained source and evidence hashes and closed with no actionable code finding; no tests or guest were rerun by the reviewer. Corrected sealed-base preparation, actual candidate acceptance, main integration, the later P012 lock and required image set remain pending. This issue stays In progress.
