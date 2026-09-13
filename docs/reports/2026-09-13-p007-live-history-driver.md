# P007 bounded native-history verification driver — 13 September 2026

`pnpm test:live --history` now implements P007-07's separate native/account history and restart scenario. Actual authenticated execution is still **unverified** because dedicated credentials are unavailable. This is a specialist runtime check; the existing real Harbor browser/API/database/supervisor P007 E2E remains the application-level evidence.

## Implemented scenario and bounds

The lane requires `HARBOR_TEST_OPENAI_API_KEY`, an explicitly selected `HARBOR_TEST_CODEX_MODEL` supported by the pinned runtime with low effort, and the supported trusted Linux/XFS fixture. It accepts no personal credential or default-model fallback. Missing prerequisites return exit 2 before fixture or model effects.

It creates fresh owned managed storage and native state, completes one short read-only turn, and inspects the exact native thread, turn IDs, inputs and reply. It confirms retirement of the first runtime generation before reopening persisted history and resuming the same thread in a second generation. Only one explicit new input is sent. The final history must retain both distinct turns without replaying the original input. At most two model turns are attempted, each bounded to 60 seconds; unexpected tool use or requests fail the scenario.

SIGINT/SIGTERM ownership is installed before effects. Cancellation closes captured transports and prevents later generations or turns. The exact owned runtime and storage service are retired; unconfirmed native retirement preserves the fixture and reports cleanup uncertainty. A private ownership record retains only whitelisted IDs, paths, generations and process IDs needed for recovery. It contains no environment map or credential values. Canonical source digests are captured before resources and after cleanup, and a changed source cannot produce a passing result.

## Review and isolated evidence

Implementation commits are `5f341ac7f4d7f7f6a75ecf3fd6b7cc68bfa35010` and corrective `7e75de8a6a69770eeffdc241c77b50a0a534dd1a`, based on `2d88e99`. Only `tests/live/run.ts`, `history.ts` and `history.test.ts` changed; no production adapter, launcher, schema, dependency or deferred P010/P012 code was imported.

Two independent review rounds completed. Round 1 requested interruption ownership, source identity before/after execution and durable recovery ownership. Round 2 closed all three corrections without an actionable finding. Five controlled driver/prerequisite checks, Node 24.11.1 typecheck and targeted formatting passed. The retained corrected driver log SHA256 is `5f4f19f9b465332fd612a88cd854443e21ab9f7b1ca3fe459091784dd8e402bc`.

Those tests use a synthetic native boundary and AbortController schedules. Actual OS/Linux signal delivery, source-digest wiring and ownership persistence were source-reviewed; no model, guest or installed application execution is claimed. The original four-check checkpoint and subsequent correction evidence remain in the isolated worktree handoff.

## Common-use integration

The exact three reviewed files were applied after core commit `17da161`. Integrated source is `df0d2b97fb062d75378b791f7e981d08171adaba7fcec4bc479f3499ae057dd8` /1,041 files. Production code is unchanged from the [passing core critical candidate](2026-09-13-common-use-acknowledgement.md), source `ce2531fd…85403` /1,039. The added live-only tests do not relabel that earlier critical run as having executed this new lane.

On the integrated source, Node 24.11.1 typecheck, targeted formatting and all five no-model checks passed. Their actual retained main test log SHA256 is `0edb02cb489eaddf48872e3ee72f4af3e3617c4ac55c6ac87e0b5788af56c626`. The canonical `pnpm test:live --history` returned exit 2 with `DEDICATED_KEY_REQUIRED`, before resources or model calls; log SHA256 `7b73fa1536a8f1f498905328425310b1bb566f353563ab8c3903ab99b53ac2f2`.

Main's first collector invoked the local Mach-O pnpm executable through a shell and failed with exit 126 before pnpm ran. The actual native executable invocation corrected this tool-path mistake; no source change or repeated successful type/format/driver checks was needed. Both logs and their precise provenance are retained in `.test-runs/common-use-release-20260913/live-history/validation.json`. The unavailable exit is evidence of a blocked prerequisite, never a passing live test.

## Remaining gate

The [common-use live acceptance issue](../../issues/2026-09-13-110315-common-use-live-acceptance.md) remains Blocked for actual execution with the [dedicated credential prerequisite](../../issues/2026-09-07-171225-live-runtime-credentials.md). Use the [developer workflow](../developer/development.md#command-availability) and existing authorization when the prerequisites are available. Preserve the lane's owned cleanup and exact source evidence. P007 is still Implemented, not Verified; this report does not finish a proposal, establish deployment continuity or satisfy protected restore/promotion.
