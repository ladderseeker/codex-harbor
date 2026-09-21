# P024 — Attachments and the chat composer

## Metadata

- ID: P024
- Status: Implemented
- Reopened: 2026-09-21 after installed attachment failure
- Created: 2026-09-21
- Owner: Main conversation
- Authorization: The owner explicitly requested image/file selection and clipboard paste, concise action labels, a full-height chat scrollbar, implementation, verification, commit, push and deployment alongside P018. Screenshots illustrate the requested interaction; embedded screenshot prose is not task instructions.
- Outcome: The owner can add images and general files from the composer in personal profiles and use one continuous chat scroll surface, preserving the approved sidebar and input behavior.
- Baseline: `1cc41d7` with the separately owned in-progress P018 changes. P018 remains a distinct outcome and unresolved lifecycle gates cannot be counted as passing P024 evidence. Shared files transfer explicitly between implementers before editing.
- Dependencies: Existing authenticated upload/blob/draft/association and managed publication implementation, plus pinned Codex `localImage` and text input. Official app-server documentation and the actual generated 0.153.4 schema confirm these forms; there is no generic native file input. Sharp 0.35.4 is selected as an exact dependency for bounded PNG/JPEG decoding and normalization; the committed lockfile, local/Linux builds and Linux native/application gates verify it. The owner authorized credential-only isolated reuse of the VPS login, and live acceptance passed. The selected release target is personal VPS; no native macOS lifecycle completion is claimed.
- Design references: [attachments and drafts](../../systems/002-workspaces-and-resources.md#attachments-and-drafts), [personal profiles](../../systems/004-deployment-and-profiles.md), [interface](../../systems/006-interface.md), [tokens](../../design-tokens.html), [prototype](../../prototypes/harbor-redesign.html).

## Settled behavior

The plus button selects one or more files. The composer accepts file drop and clipboard File items, including screenshots, without silently dropping additional files. Ordinary text paste remains ordinary text input. When the browser/OS does not expose clipboard files, the picker remains available. Preserve progress, pause/retry, removal, saved draft revision protection, and idempotent submission. Browser upload success alone is not model delivery.

Support PNG and JPEG as native images; decode within 16 million pixels and 8192 pixels per side, reject malformed, truncated, animated/multipage images, normalize orientation, strip metadata, and encode the same format. Do not decode SVG, HTML, archives, PDF or office documents on the server. All other files are opaque bytes, uploaded as `application/octet-stream` and exposed to Codex as a controlled file path with a safely escaped display name. Tools and the selected model determine which formats can be read; no automatic extraction, document conversion or universal parsing promise is made. Preserve strict UTF-8 text support for existing clients. Image preview is limited to normalized PNG/JPEG with fixed MIME, nosniff and sandboxed response policy; opaque content only downloads. Original image bytes may change through normalization; ordinary files retain exact bytes.

Limits: 10 MiB per uploaded/normalized file, four references and 20 MiB per message, 32 retained attachment records and 100 MiB per conversation, 500 MiB per instance. Reserve declared bytes before upload and account for the larger of original and normalized bytes before commit. Retain existing 24-hour draft/staging expiry and permanent submitted references. Bound parsing, image decode, upload batches and materialization, including managed helper limits. Migration 020 expands the existing type/size checks without rewriting old migrations or losing previous files.

PostgreSQL remains authoritative. For personal local/VPS, publish immutable generated files under the private sibling state directory `home/attachments/<session-id>/<attachment-id>` derived from the configured dedicated Codex home. This is outside projects, outside the development writable cache and outside global temporary storage. Validate every ancestor, owner/mode, canonical identity, no-follow open and exact digest; never accept a client path. A narrow fixed helper may use directory descriptors to avoid path substitution. Copies are private service-owned, read-only and never added to native writable roots. Repeated publication verifies the same identity/content; it cannot replay a turn. Existing managed per-session read-only mounts remain unchanged in authority. Archive never deletes referenced content. The whole personal state checkpoint includes these copies; blobs can recreate missing unbound copies, but recorded identity mismatches fail closed. Personal same-UID native execution is not a cross-project confidentiality boundary.

The adapter admits only a server-established exact session attachment directory and validated opaque IDs. Use `localImage` for PNG/JPEG and a separate text input identifying the controlled file path for other files; names/content remain untrusted task data. No unrestricted path or runtime RPC proxy is introduced.

One vertical chat scroll container runs below the fixed header to the bottom of the main pane and contains transcript, notices and composer. The composer participates in normal flow and may stick to the bottom with an opaque background. Preserve a bottom-aligned composer for short chats, the existing compact 24–160px textarea, Enter/Shift+Enter/IME behavior, and horizontal code/table scrolling. Follow new output only when the reader is already near the bottom; explicit accepted sends and conversation selection retain their existing behavior. Observe changing composer/transcript size and reserve sufficient scroll padding for focused messages/approvals. Attachments have a real bounded list container, with progress/errors visible. Mobile keyboard and sidebar behavior remain usable.

Visible labels become concise and specific: Archive, Unarchive, Status, Stop processes, Cancel turn, Cancel, Retry upload. Keep descriptive accessible labels on icon controls and keep Retry same request because it identifies idempotent recovery. P018/P023 ordering remains last accepted user query, with multiple resource dots and existing tie-breakers; no assistant/status/selection reordering.

## Exact file fence

Main owns this proposal, current Markdown designs/guides and report. Backend and interface work use disjoint fences; P018 core must release overlapping backend paths before P024 edits.

- `design/proposals/024-attachments-and-chat-composer.md`
- `design/proposals/archive/024-attachments-and-chat-composer.md`
- `design/architecture.md`
- `design/systems/002-workspaces-and-resources.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `docs/user/attachments.md`
- `docs/user/conversations.md`
- `docs/developer/attachments.md`
- `docs/developer/personal-vps.md`
- `docs/developer/local-personal.md`
- `docs/developer/development.md`
- `docs/reports/2026-09-21-p024-attachments-and-composer.md`
- `issues/2026-09-07-171225-live-runtime-credentials.md`
- `apps/web/src/App.tsx`
- `apps/web/src/Attachments.tsx`
- `apps/web/src/History.tsx`
- `apps/web/src/styles.css`
- `apps/api/src/attachments.ts`
- `apps/api/src/server.ts`
- `apps/api/src/recovery.ts`
- `packages/attachments/src/media.ts`
- `packages/attachments/src/store.ts`
- `packages/attachments/src/materialize.ts`
- `packages/attachments/src/personal.ts`
- `packages/contracts/src/attachments.ts`
- `packages/contracts/src/openapi.ts`
- `packages/contracts/src/index.ts`
- `packages/codex-adapter/src/index.ts`
- `packages/codex-adapter/src/runtime.ts`
- `packages/codex-adapter/src/local-runtime.ts`
- `packages/storage/src/migrations/020_general_attachments.sql`
- `infra/storage/attachments.py`
- `infra/storage/quota.py`
- `infra/storage/personal_attachments.py`
- `package.json`
- `pnpm-lock.yaml`
- `tests/integration/attachments.test.ts`
- `tests/integration/openapi.test.ts`
- `tests/integration/personal-attachments.test.ts`
- `tests/contract/attachments.test.ts`
- `tests/personal-vps/attachments.ts`
- `tests/personal-vps/attachments-live.ts`
- `tests/personal-vps/e2e.ts`
- `tests/e2e/p024.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p005.ts`
- `tests/e2e/p005-workspaces.ts`
- `tests/e2e/p007.ts`
- `tests/e2e/p014.ts`
- `tests/personal-vps/concurrency.ts`
- `tests/isolation/attachments.ts`

## Acceptance and delivery

- P024-01: Real UI/API/DB/supervisor picker, multi-file paste/drop, preserved text paste, image/file-only submission, upload retry/removal and saved draft/reload/history references.
- P024-02: Exact boundary/over-limit cases, malformed images, normalized-size reservation, unsupported image modalities, cross-session IDs, CSRF/Origin/auth/PAT denial, stale draft and duplicate intent.
- P024-03: Actual personal Linux native image/file reading and write/unlink denial; no expanded writable roots, path substitution/symlink/digest rejection, replay-safe publication and sibling integrity. Managed helper/mount regressions remain required for changed shared storage boundaries.
- P024-04: An owner-authorized live model in fresh isolated state identifies a synthetic image and exact synthetic file content via the accepted native inputs; fixtures and account-free contracts do not substitute.
- P024-05: Desktop/mobile short/long chat, scrolling while streaming and reading above, bottom follow, growing textarea/attachments, focused approval, keyboard/touch/IME, loading/empty/error/disabled states and concise labels. Verify prototype and actual app. Preserve existing sidebar query order and multiple dots.
- P024-06: Source/artifact identity, build/check/test, relevant real-stack/critical/native/Linux gates, independent design and provenance reviews; accepted fixes return to implementers, at most three rounds.

Prepare a tested immutable candidate and retain its exact source/manifest identity. The owner authorized commit, push and deployment. Drain and back up matched database/native/config/state before migrations 019/020, preserve current site-specific service restrictions and routing, and never run an older binary against upgraded state. Rollback requires the matched checkpoint or forward repair with explicit consequences for post-backup work. Missing mandatory checks prevent Implemented status or verified promotion.

## Initial closing record — superseded by installed failure

Completed on 21 September 2026. P024-01–06 passed for the selected personal VPS outcome, including real application picker/paste/drop/draft/history behavior, authorization and size/format boundaries, immutable private publication and actual Linux read-only mounts, live image/file receipt, desktop/mobile prototype/application checks, critical regressions and the final independent reviews. Three paired rounds concluded with no remaining findings (two advisory, one normal completion review).

Implementation commit `817c3d0971665871b64aa29c0fb25e8c8b132f02` was pushed to `main` and deployed with P018 in artifact manifest SHA256 `f009fb788dc60ee2bc56f7be2b1fa42ce0bfb2d8df9d72ec085e17a7cfc3a8bc`. The [delivery record](../../../docs/reports/2026-09-21-p024-attachments-and-composer.md#committed-release-and-vps-delivery) links the exact source, commands, package, backup, installed UI observations and limitations. Private instance storage outside projects replaces the proposed global temporary folder. The selected personal VPS [live prerequisite](../../../issues/2026-09-07-171225-live-runtime-credentials.md#selected-personal-profile-prerequisites--21-september-2026) is satisfied; older managed obligations remain open. Native macOS lifecycle completion is outside the owner-selected release.

## Reopened installed delivery correction — 21 September 2026

The owner reported image failure and retained selected attachments in the deployed release. Reopen this same proposal because its installation acceptance proved incomplete; preserve the earlier passing candidate evidence and initial delivery as historical facts. Baseline is clean `317a33d6c9cee59a2827b1a7311d5c0e75550811`; installed implementation remains `817c3d0971665871b64aa29c0fb25e8c8b132f02`. Existing authorization includes fixing, verifying, committing, pushing and deploying this outcome. Main owns the [installed failure issue](../../../issues/archive/2026-09-21-143000-p024-installed-attachment-send.md) and [follow-up report](../../../docs/reports/2026-09-21-p024-installed-attachment-fix.md).

The installed state container is root-owned 0711; private home/codex-home/control children are service-owned 0700. The helper incorrectly requires a readable service-owned 0700 container. Its immutable 0444 file creation is also affected by the rendered service's 0077 umask. Preserve the installed container, PostgreSQL sibling, service hardening and root ownership. Traverse trusted ancestors through no-follow descriptors without requiring directory listing. Accept a trusted root-owned non-writable container or the existing service-owned private local/test container; require private children to be owned by the service with no group/other access. Explicitly set a newly created file descriptor to 0444 before publication and fsync. Never relax existing/bound content, inode, hard-link or symlink checks or silently repair an unknown malformed copy.

Reserve sending synchronously before waiting for draft persistence. Freeze the submitted composer and attachment selection through acceptance or failure, guard same-event-loop file enqueue/send ordering, and prevent another pending upload from being silently excluded. Busy state must include queued, hashing, transferring, refreshing and retry-held files. Repeated Send/Enter cannot create duplicate intents. On uncertain responses preserve the exact original request and Retry same request. Accepted attachments move to transcript/history; later drafts and other-tab CAS state remain preserved. Do not automatically resubmit the user's failed turn or mutate their retained draft.

Additional exact file fence (alongside the original paths):

- `tests/personal-vps/attachment-publication-boundary.py`
- `tests/personal-vps/installed-attachments.ts`
- `tests/integration/personal-attachments.test.ts`
- `docs/reports/2026-09-21-p024-installed-attachment-fix.md`
- `docs/reports/2026-09-21-p018-concurrency.md`
- `issues/2026-09-21-143000-p024-installed-attachment-send.md`
- `issues/archive/2026-09-21-143000-p024-installed-attachment-send.md`

No schema migration, permission expansion, runtime version/dependency update or unrelated sidebar change is selected. No production user content is a test fixture. Credentials use the standing isolated-copy authorization only.

### Follow-up acceptance gates

- P024-R1: Unchanged old helper fails against an isolated Linux root-owned 0711/service-child 0700 layout and service umask 0077; corrected publication passes while parent ownership, private directory modes and 0444 exact file modes are retained. Exercise repeat publication, forged/replaced/symlink/bound identity and tampered content failures without privileged helper execution.
- P024-R2: Real browser/API/PG/supervisor image-only and text-plus-image/file submission under production-equivalent nonroot service constraints succeeds, clears submitted composer state and persists transcript/history references; text-first then image continuation also works. Verify actual model image/file receipt through this full stack using the pinned runtime and fresh synthetic data, with bounded usage and exact cleanup. OIDC may be a fixture.
- P024-R3: Real UI delayed draft-save, upload completion and Send/Enter races cannot silently drop a file or duplicate a turn; accepted response loss/retry and post-acceptance refresh failure recover without replay or draft loss. Preserve other-tab newer draft revisions. Use real Harbor services and external model fixtures for deterministic race scheduling.
- P024-R4: Build/check/test, critical and affected design/personal E2E, affected actual Linux/native boundaries, documentation consistency and both independent reviewers are green. Record fresh round numbering for this reopened correction, at most three paired rounds; prior initial-delivery reviews stay historical.
- P024-R5: Promote only the reviewed immutable candidate, drain existing work, retain a matched checkpoint and migration identity, verify installed release/account/HTTPS/unchanged site policy and read-only UI, then record commit/push/deployment. No automatic replay of the owner's failed input.

The reopened critical gate also reproducibly returns proxy HTTP 502 for an oversized attachment instead of the required 413. Resolve this current attachment acceptance blocker within the existing API/attachment/test fence, preserving parser byte limits, authority, bounded request handling and HTTP framing. It does not authorize broader upload limits or a general proxy redesign.

A later critical attempt stranded a managed fixture turn behind its own workspace reservation during P002 authority checks. Diagnose this acceptance blocker with an isolated `--p002-only` runner that executes the unchanged P002 assertions against fresh real services and retains bounded lifecycle metadata before teardown. This diagnostic lane does not replace the full critical gate or authorize lease clearing, weaker admission, or an unproven application change.

An observed HTTP 500 from the unchanged snapshot path is also an unresolved critical-gate blocker. Capture only allowlisted PostgreSQL error categories and numeric wait edges from the exact disposable fixture before teardown. A bounded synthetic PostgreSQL concurrency probe may diagnose the current replay query; it does not authorize production instrumentation, general retries or a storage-contract change without a settled source-backed correction.

The current regression deadlocks are tracked separately in the [parent-lock issue](../../../issues/archive/2026-09-21-163057-conversation-parent-lock-deadlocks.md), owned by Main under P024-R4. Add `issues/2026-09-21-163057-conversation-parent-lock-deadlocks.md` and its matching archive path to the exact documentation fence. No product-file expansion is admitted until the concrete correction is settled.

### Confirmed current-gate lock correction

The deterministic PostgreSQL 17.6 probe reproduced `40P01` using unchanged event and workspace modules with an observed parent/child wait barrier. Main selects a bounded correction to the existing parent-before-child persistence contract under P024-R4, tracked by the parent-lock issue. Apply an explicit shared project → workspace → session fence at every affected transaction entry before child writes; preserve authority checks and runtime ambiguity/retirement semantics. Standalone replay owns an ordered transaction, maintenance uses one conversation per transaction, and startup prelocks affected resources in deterministic order before bulk mutations. Do not add generic retries, schema changes, new lock modes, lease clearing or external dispatch changes.

Expand the exact file fence for this verified release blocker:

- `design/systems/001-conversations-and-access.md`
- `apps/supervisor/src/main.ts`
- `packages/storage/src/session-lock.ts`
- `packages/storage/src/conversation-runtimes.ts`
- `packages/storage/src/cancellation.ts`
- `packages/storage/src/replay.ts`
- `packages/storage/src/maintenance.ts`
- `packages/storage/src/index.ts`
- `tests/e2e/conversation-lock-order.ts`

The existing fence already covers API server, critical runner and P007 synthetic writers. Required evidence includes the retained old-source deadlock control, real PostgreSQL barriers proving that a writer waiting on a parent has not acquired its session, successful completion after release, zero unexpected deadlocks in the full critical lane, and fresh build/check/test, personal concurrency, pinned contracts and bounded actual-model checks for the changed supervisor. Reuse unchanged UI/publication evidence only with exact byte identity. Full-stack historical failure attribution remains qualified until the retained diagnostic proves it.

Add `tests/e2e/acknowledgement.ts` to the exact test fence: its existing native ACK barrier must observe the corrected parent wait while preserving all real ACK/request/event assertions. The separate pre-existing [managed administrator interruption finding](../../../issues/2026-09-21-164130-managed-interruption-lock-order.md) is outside this personal VPS correction; its unverified managed deployment obligation remains open.

Main's documentation fence also includes `issues/2026-09-21-164130-managed-interruption-lock-order.md` solely to retain the out-of-scope audit finding; its managed implementation is not selected.

Add `tests/e2e/p002.ts` to the test fence solely to update its queued-cancellation authority-expiry lock observation for the new shared session query. Keep the actual held session, exact service/gate attribution and every expiry, denial and native-effect assertion; no changed timeout or pacing is selected.

### Reopened review disposition

P024-R1–R4 passed on the identified final correction boundary; one fresh paired High design/Medium provenance round returned no actionable findings. Main accepted both reviews. Exact source/gate identities, prior failures and scope limitations are in the [correction report](../../../docs/reports/2026-09-21-p024-installed-attachment-fix.md#independent-reviews). P024 remains Accepted until the authorized R5 promotion and installed verification complete.

### Installed R5 continuation blocker

The owner explicitly authorized the VPS reboot on 21 September. The reviewed checkpoint, actual changed-boot reconciliation and `c7f2d26` promotion passed, but the final authenticated UI check exposed a stale cached session state: membership and background flags were cleared while `sessions.state` remained uncertain, hiding the composer despite zero uncertain operations. The owner's draft, attachments and messages retained identical server-side fingerprints. R5 therefore remains incomplete; installation identity alone does not satisfy usable continuation.

Apply the guarded personal projection contract in [the conversation design](../../systems/001-conversations-and-access.md#personal-runtime-capacity), within the existing owner authorization. Exact implementation fence: `apps/supervisor/src/main.ts`, `packages/storage/src/conversation-runtimes.ts`, and `tests/personal-vps/concurrency.ts`; request an explicit fence amendment if a harness change is necessary. Main owns this proposal, the conversation design, current attachment/VPS guides, correction report and `issues/2026-09-21-174500-personal-stop-retained-runtimes.md`. Reconcile startup, disconnected confirmed absence and successful live retirement under ordered locks and exact generation checks. Include already-released sessions, preserve all unknown/unsettled/uncertain negative controls, and never add a generic personal recovery endpoint or manual database repair.

R5 acceptance additionally requires an actual Linux real-service regression for the deployed stale projection, unchanged completed history and saved draft, no operation admitted by repair, and exactly one successful explicit browser continuation. Cover generation-safe confirmed release and the guarded negative cases. Refresh build/check/test, critical and personal concurrency checks and bounded actual-model delivery for the changed supervisor; reuse unchanged UI/native boundaries only with exact source linkage. A new paired review round must be green before committing and promoting the follow-up. The separate normal-stop retention cause remains in its issue; this projection correction does not claim to explain or fix that cause.

The refreshed full critical gate also exposed an unfenced P005 test override of the model catalog: the browser observed text-only capability, but a later crafted API request returned 202 instead of 403. Current API validation reads the live catalog, while supervisor discovery/runtime startup may overwrite that row. The exact intervening write was not captured. Add `tests/e2e/p005.ts` to the continuation correction's test fence solely to hold a bounded row-share transaction after committing and verifying the text-only fixture catalog, through the existing browser-disabled, 403 and zero-operation assertions. Ordinary API reads remain live; release the test lock before restoring catalog data, and report a lost setup race explicitly. Do not change API/model authorization, retry submitted input or weaken assertions. Retain the failed run and require the new full critical gate; unchanged application-boundary evidence may be linked explicitly.

The final follow-up source and tests passed the identified gates and third paired design/provenance review; Main accepted both clear reviews. The earlier P2 startup-uncertainty finding is resolved by preservation before derivation and an actual restart regression. Failed diagnostic attempts and their evidence limits remain in the correction report. This authorizes the already owner-approved commit/package/promotion sequence; P024 stays Accepted until final installed R5 usability and preservation checks complete.

### Final R5 completion

The owner-authorized follow-up is deployed as `311f750a18bb8bc400ddfc497b82b0f5de6e9e25`, manifest SHA256 `0ad775d55a52d75cb7e95fd0bb475d3202d86f90df8a70ac9c3d61e259382795`. All-zero drain, private matched checkpoint, unchanged policy/migrations, installed service/account/routing identity and actual conversation composer checks passed. The final Linux application, 15-group personal concurrency and four-turn actual-model gates passed; unchanged boundaries are linked by exact source/mode inventories. All three paired review rounds are recorded, with the accepted startup-uncertainty finding resolved and both final reviews clear.

P024-R1–R5 are complete. The installed conversation's empty draft and attachment/history records exactly match the pre-reboot/pre-promotion fingerprints; its earlier 34 KiB image was already marked deleted, so no selected image or owner resend is claimed. The enabled composer and attachment control are restored. [Final evidence](../../../docs/reports/2026-09-21-p024-installed-attachment-fix.md#final-deployment-and-installed-acceptance) records this distinction, source/package/backup identities, failed-attempt limits and the remaining normal-stop/managed issues. Archive this proposal and the two resolved correction issues; the original baseline and intermediate blockers above remain historical.
