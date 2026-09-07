# P005 — Attachments and rich input

- Decision: Draft
- Delivery: Planned
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
