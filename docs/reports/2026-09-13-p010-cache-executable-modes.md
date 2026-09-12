# P010 executable cache correction — 13 September 2026

The third same-source C component retained its completed guest result and bounded untrusted command log. The build returned exit 1 at `candidate-command-result`; the log records an `EACCES` spawn of the public esbuild 0.25.12 ARM64 binary. Exact runtime retirement completed. No candidate artifact, verifier, browser, installed service or promotion result passed.

## Actual diagnostic and scope

The candidate source remains `23d87d4f59e0fde6ac1ddb8ac9122ab0235dcd2735f30ee69ce3960307eae603` (6,451,200-byte archive, 1,321 entries). The controller is the earlier `1baf935` copy with only `infra/self/client.ts` and `tests/self/roundtrip.ts` from independently reviewed `4f69765`. Its job is `f06095a063e88a0787f5e053b9721dc1`, build container `017070ec52282e20bc08d6cc73aa8dc0efd593613ad525ac96d81c7d36f27cc5`, and unused verifier identity `42dc951e0fdcecb0e3e4123312cbb67e`.

The contemporaneous sanitized readback is `.test-runs/roundtrip-diagnostic-4f69765/failed-result.json`, SHA-256 `99eb98d884a34bd018f643fdbe691edc744109535d1442cd9c88b577e0e71dcd`. It binds the result, retired job/worker/guardian receipts, removed allocation, inactive/dead controller service and zero running containers. The 2,741-byte private untrusted log remains on C, with SHA-256 `ad4dbec98ef0a58ced5e3718e3883eb7e2eb497eedb8494fa2e826d82023a9d7`. Later `PIPE_CLOSED` retirement is not evidence of an earlier lease failure.

Read-only inspection found the exact 9,699,480-byte esbuild ELF (`840ad255d6fd587b126d8b2d59ab506d8562785b9bc76249dc3b0e1bdd2ca449`) serialized as `0444` in retained public refresh archive `1cb64b3d30ed9745bdf0b99a2075f36f6ca926ba8be9a1ab1a8a392a97cceda5`. The original C offline-proof copy is `0755`, with executable ancestors on XFS without `noexec`. The builder unconditionally wrote `0444`, and its manifest bound only bytes and hashes. This establishes a packaging defect. The failed guest had already been retired, so its exact executable/ancestor/mount state was not inspected. The two earlier failures retain their unknown causes; they are not retrospectively attributed to this defect.

## Corrected serialization and actual public tooling check

Format 2 binds safe file modes alongside content. Public store executables serialize as `0555`, ordinary files as `0444`; special source permission bits and mismatched/unsafe archive modes are refused. The guest checks those modes after extraction. Its fresh offline installation must then execute a fixed public Vite/esbuild transform before publishing a cache certificate. This runs no candidate source or lifecycle scripts and does not repair an existing sealed disk with a broad chmod.

Three local Python contracts pass, covering complete inventory/lock/digest and link bounds, production-builder executable preservation, mode tampering and unsafe source bits. The synthetic builder test replaces only administrator ancestry/UID checks. Log `.test-runs/cache-mode-unit.log` hashes to `8eae2b9341a0dcb125032f79cad90f202e4eb531cdb3380fe7f24c8dd0b7dda6`; shell syntax also passes.

The actual Linux command is `python3 tests/self/cache-mode-linux.py` with fixed public source cache `public-cache-7e726acbb35f8167cce08ef58a3e2d83`, retained metadata digest `4a87b6b3a62434581db92b7c1419521eed544e45b9f6fe746949cd858d253257`, the earlier complete proof, `/opt/harbor-tools/node_modules` and the task-owned worker XFS root. It builds with the production serializer, validates and extracts the resulting archive, then installs from that exact read-only store using pinned pnpm 12.3.4 and runner image `65cd9c5659eb3b40e2f96276726a1777b91540c339657a434e5827640792f932` (Node 24.11.1). Fresh HOME/config/metadata contains no cached policy-success record. Networking is disabled; lifecycle scripts are ignored; the container is nonroot, capability-free and bounded to one CPU/one GiB, with a separate two-GiB XFS test quota.

Job `9b62976e3b5c5eb68c70cb951a96f444` passed the full frozen policy-active offline installation and the identical fixed guest esbuild native transform. Archive `86a0728a10820b38366d8ad47b587d22bcdd96fad74c318047c5ba6223f000ce` is 455,915,520 bytes and binds current lock `129196ce4278771f7081d75238471ae9bd6d8d6f01fa694012ee9160782c00f4`. The extracted esbuild is the same exact binary, now `0555`. Container `3d9b01112c55b5fb8ecc34012451bcf3f470ef625145734cda4a3445881fd0b6` exited 0 without OOM and was removed by exact name/label/ID checks. The public archive, generated test directories and quota remain retained for subsequent bounded preparation; container cleanup does not claim those files were removed.

| Retained evidence | SHA-256 |
| --- | --- |
| `.test-runs/cache-mode/staging.json` | `7e0f08a82dd97de76a2a7e92bcbf690f554772c885bdee8a3a302edd8ce2f6bb` |
| `.test-runs/cache-mode/linux-output.json` | `6407087d92c5bed038becd56b4633963f7596a26609296f07b31a27e59946b36` |
| `.test-runs/cache-mode/linux-contract.log` | `12e01c427eb6c169d0b1ebf2f121ffeeb9998d3871420e2873a553aa7f66f11c` |
| Actual builder | `bad5dc38bac42b4b2bfcb7d7a08115bdf23034365510111185def81454c7fead` |
| Actual Linux driver | `a6a819c84407d3ead3665c3c8f9412843c23d6209c3c04ab1b38fc371115c8d9` |
| Guest refresh script / shared fixed transform | `1e01b0347ebd5c3f2cf755d39a41a8179b4e1b0b4c0a5db2d24d2456db4cf920` |

This correction is awaiting bounded independent review. No corrected sealed guest refresh or subsequent candidate execution has run. Both original sealed bases and prior failed evidence remain preserved. The P012 lock, additional relay image closure, full P010 UI/API outcome, module integration and protected/live gates remain separate outstanding obligations.

## Independent correction review — 13 September 2026

A separate reviewer inspected frozen `84b8661`, matched the builder/guest/driver/profile and retained result/log/staging/unit hashes, and closed the bounded correction with no actionable code finding. The reviewed execution uses the serialized and extracted cache, a fresh policy-active frozen offline installation and the same fixed public transform as the guest certification path. No tests, VM operations, large artifact operations or private-log inspection were repeated by the reviewer. This addendum supersedes only the earlier pending source-review statement; corrected sealed-base, fresh candidate and full integration gates remain pending in the [active cache issue](../../issues/2026-09-13-070147-p010-cache-executable-mode.md).
