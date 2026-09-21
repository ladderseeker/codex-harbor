# P024 — Attachments and the chat composer

## Metadata

- ID: P024
- Status: Implemented
- Archive disposition: Completed
- Archived: 2026-09-21
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

## Closing record

Completed on 21 September 2026. P024-01–06 passed for the selected personal VPS outcome, including real application picker/paste/drop/draft/history behavior, authorization and size/format boundaries, immutable private publication and actual Linux read-only mounts, live image/file receipt, desktop/mobile prototype/application checks, critical regressions and the final independent reviews. Three paired rounds concluded with no remaining findings (two advisory, one normal completion review).

Implementation commit `817c3d0971665871b64aa29c0fb25e8c8b132f02` was pushed to `main` and deployed with P018 in artifact manifest SHA256 `f009fb788dc60ee2bc56f7be2b1fa42ce0bfb2d8df9d72ec085e17a7cfc3a8bc`. The [delivery record](../../../docs/reports/2026-09-21-p024-attachments-and-composer.md#committed-release-and-vps-delivery) links the exact source, commands, package, backup, installed UI observations and limitations. Private instance storage outside projects replaces the proposed global temporary folder. The selected personal VPS [live prerequisite](../../../issues/2026-09-07-171225-live-runtime-credentials.md#selected-personal-profile-prerequisites--21-september-2026) is satisfied; older managed obligations remain open. Native macOS lifecycle completion is outside the owner-selected release.
