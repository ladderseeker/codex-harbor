# P005 — Attachments and rich input

- Decision: Accepted
- Delivery: Implemented
- Dependencies: [P001](001-secure-persistent-conversations.md)
- Outcome: The owner attaches a file or pastes an image into a conversation and can confirm what was sent to the selected runtime.

## Scope and user/API flow

Add file selection, drag/drop, clipboard image paste, upload progress, attachment previews/removal, and submission of text with validated attachment references. Preserve a bounded draft across an ordinary page reload without storing credentials. Display effective model modalities and reject unsupported combinations before dispatch. P001 already owns basic model, reasoning, and permission controls.

Provide authenticated staging/upload/read/delete operations and allow the turn API to reference staged attachment IDs. An attachment is not sent to Codex until submission accepts its validated references. Partial/cancelled uploads are distinguishable from attached content. Full document conversion/OCR, automatic archive extraction, public sharing, voice, and arbitrary URL imports are excluded.

## Contracts and security

Store opaque attachment ID, ownership/session binding, staged/attached lifecycle, detected media type, size/hash, safe display name, storage reference, and expiry. Atomically validate attachment availability and associate it with accepted turn intent. A submitted attachment cannot be garbage-collected as an abandoned upload.

Use the [upload and rendering boundary](../architecture.md#execution-and-filesystem-isolation): private bounded storage, generated storage names, type/signature checks, no trusted user MIME/paths, no automatic executable HTML/SVG rendering, and per-upload/count/quota limits. Expose files to the runtime through scoped references or controlled workspace copies only. The browser/API cannot choose a host path or fetch a secret file by impersonating an attachment reference.

Discover and capability-test the pinned runtime's accepted input types. A UI fixture showing an image bubble does not prove the real model received an image. Keep ordinary prompts, attachment metadata, and credentials separate; do not echo sensitive upload bytes into operational logs.

## Independent acceptance

Use P001 with synthetic images, text files, malformed/spoofed media, and a deliberately oversized payload. No file-editor UI or project preview is required.

1. **P005-01:** Select a file and paste an image in the browser, submit text with both, and reload the conversation. Assert persisted attachment association and the exact references delivered through the adapter.
2. **P005-02:** Cancel, interrupt, and retry an upload. Assert visible incomplete state, bounded cleanup, and no duplicate attachment or turn caused by retry.
3. **P005-03:** Switch to a capability fixture without image input. Assert the UI explains the unsupported combination and the server rejects a crafted bypass request.
4. **P005-04:** Try spoofed type/name, malformed media, oversized/count-exceeding content, wrong-session IDs, and unauthenticated reads/deletes. Assert no unauthorized storage or dispatch.
5. **P005-05:** Reopen a draft, remove a staged item, expire unreferenced uploads, and retain a submitted one. Assert garbage collection respects ownership, references, and current leases.
6. **P005-06:** Submit a small synthetic image/file to a real supported Codex configuration. Verify actual protocol input and a bounded observable response, with separate Linux tests for attachment-path confinement.

## Delivery and verification

Use planned `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live`, and relevant `pnpm test:isolation`. Follow the [shared evidence/cleanup contract](README.md#shared-verification-contract); no real personal photos or private documents in fixtures. Keep browser clipboard tests deterministic and exercise at least one real paste path in the supported browser.

Add attachment migrations and registration for backup, restore, quota accounting, and retention. Before verified delivery, test the existing deployment integration if P009 is delivered; otherwise make attachment persistence independently testable and define its registry entry for P009. Rollback preserves attached content and denies unsupported new writes rather than exposing storage publicly. Document supported types and limits after implementation.

## Recorded implementation decisions — 7 September 2026

The initial supported file profile is non-interlaced 8-bit RGB/RGBA PNG and UTF-8 plain text. PNG signature, chunk CRC/order, image dimensions, bounded decompression and scanline filters are validated; ancillary chunks are removed. Active formats, archives and document conversion are not supported. Limits are 256 KiB per PNG, 64 KiB per text file, four references and 512 KiB per turn, 32 retained attachment records / 4 MiB per session and 100 MiB across the instance. Quota admission reserves declared bytes before accepting an upload. Names are bounded display metadata and never storage paths.

Uploads are private PostgreSQL blobs, alongside opaque session/project identity, declared size/hash, detected media, expiry and lifecycle. Creating an upload record is idempotent; its single bounded binary PUT validates the complete body and atomically commits it as staged. An interrupted PUT publishes no partial bytes and can retry against the same upload ID/hash. Lost committed responses reconcile by reading the record or repeating the identical request. Stage-to-attached association and draft clearing occur in the same transaction as accepted turn intent. GC marks expired unreferenced records under the same session lock and clears only their blobs; referenced content is retained. Bounded tombstones preserve the supported retry window. No upload filesystem publication occurs before commit.

After dispatch admission, the supervisor resolves only that operation's committed attachment IDs and publishes immutable copies under the managed project quota, at `attachments/<session-id>/<attachment-id>`. A narrow trusted helper checks the root and exact names, creates root-owned directories and read-only files, verifies existing content by digest for replay-safe publication, and fsyncs publication. A committed blob remains authoritative across failed filesystem/DB acknowledgements. Only the selected session directory is mounted read-only at `/attachments`; it is absent from writable sandbox roots. Retrying publication cannot resend a turn. Native input uses the pinned `localImage` form for PNG and a text item naming the fixed path for plain-text files. Physical copies remain with referenced native conversation history; staged GC never touches them. With P003, the supervisor resolves the registered project identity separately from the selected checkout through the session/workspace/project database binding. The quota helper checks that project canonical path and inode under its storage lock; the launcher checks the same project identity and verifies that the selected Local or derived checkout belongs to it before mounting the session attachments. P003 remains an optional delivered integration, not a dependency for the independent P005 outcome.

Model modalities are taken from pinned runtime discovery; missing image modality fails closed for image dispatch. The browser shows the same capability decision and preserves attached reference identities in history. These are protocol support decisions, not evidence of a real image-aware response. The [official app-server documentation](https://learn.chatgpt.com/docs/app-server) documents `text`, `image` and `localImage` input and model discovery; pinned 0.153.4 generated schemas remain the exact transport contract. Dedicated live-account evidence remains blocked by the [existing live-test credential issue](../../issues/2026-09-07-171225-live-runtime-credentials.md).

Draft text and selected attachment IDs are stored in a bounded owner/session database draft with revision CAS and a 24-hour expiry, never in browser persistent storage. Credentials belong exclusively in the existing credential setup UI. Submission clears only the exact accepted draft revision; another tab's newer draft is not silently erased. Failed or ambiguous turn submission preserves its exact intent and draft. Upload UI reports progress, permits abort, and requires reselecting an incomplete file after reload before retrying its immutable size/hash identity. Previews render only validated PNG or escaped text; every download has attachment disposition, nosniff, no-store and owner authorization. New attachment/draft routes are browser-owner-only unless an explicit future PAT descriptor grants them.

The P009 backup registry entry is the attachment/draft metadata and blobs in PostgreSQL plus materialized per-session attachment directories within each complete project quota unit. A restore must revalidate directory/file identities before admitting a runtime. No source folder, native history or attachment is deleted by archive. Permanent attached-content deletion is excluded.

## Current delivery checkpoint

The [7 September implementation report](../../docs/reports/2026-09-07-p005-attachments.md) records final UI/application source `3bc9345e363d6d614da725da402492f51c06d68a21fba9c83a5a111db37f85c5`, matching-source real-stack acceptance and the unchanged Linux boundary checkpoint, three completed independent review rounds, and the separate blocked P005-06 live-account gate. The subsequent [workspace/history integration report](../../docs/reports/2026-09-07-p005-integration.md) records the cumulative authority, workspace publication and recovery acceptance checkpoint separately. Current behavior is documented in the [user guide](../../docs/user/attachments.md) and [developer guide](../../docs/developer/attachments.md). P005 remains active and is not Verified or archived.

## Source issues

- [P005 implementation review](../../issues/archive/2026-09-07-213300-p005-implementation-review.md): Resolved Medium draft expiry, preflight pause, malformed PNG and stale completion findings; owned by P005-02/P005-04/P005-05. Three feature review rounds and the report above retain their validation; the separate cumulative integration report retains its review and acceptance evidence.
- [Upload-recovery visibility timeout](../../issues/archive/2026-09-07-224419-p005-reload-visibility.md): Low, Resolved and archived on 2026-09-08. A new captured reproduction identified test-request pressure; bounded phase pacing and diagnostics passed the full Node 24 regression on source `69193104…c01644` and one independent review. Earlier uncaptured failures remain unattributed. No production behavior changed and the live-account gate remains separate.
