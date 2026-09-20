# Attachments and saved drafts

## Design and evidence ownership — 20 September 2026

[Current subsystem designs](../../design/systems/) own behavior and limits; the [issue inbox](../../issues/) owns unfinished acceptance. Historical proposal IDs below identify feature lineage and evidence, not active execution. Future changes follow a newly selected proposal under the [workflow](../../design/workflow.md); baseline reconciliation did not rerun application gates.

Use the plus button (**Attach file**) to choose an attachment, drop a file anywhere in the message composer, or paste an image into the message box. Open **Attachment limits** for supported types and sizes. A selected file appears below your message. Harbor saves the message and selection for 24 hours; wait for **Draft saved for 24 hours** before closing the page.

Supported files are UTF-8 plain text (`.txt`, at most 64 KiB) and non-interlaced 8-bit RGB/RGBA PNG images (at most 256 KiB and 2048 × 2048 pixels). Other image encodings, SVG, HTML, PDFs, archives and automatic conversion are unsupported. A message accepts up to four files totaling 512 KiB. Each conversation retains at most 32 attachment records and reserves at most 4 MiB; the instance reserves at most 100 MiB. Deleted and expired records may count until their bounded cleanup completes.

The selected model must advertise the appropriate text or image input. If it does not, select a compatible model or remove the unsupported file. Uploading alone does not send a file to Codex: **Send** associates the selected files with that message. Submitted files remain visible with their original message after reload. Use **Download** to retrieve a file; validated PNG previews have metadata stripped. Names are display labels and do not select server paths.

**Pause upload** stops the current upload attempt, including preparation before the binary transfer. **Retry same upload** continues using the same file identity. After reloading an incomplete upload, choose the same file again. Harbor verifies its size and hash, so different bytes cannot replace that upload. If the message response is lost, use **Retry same request** to recover the accepted result without sending another turn.

**Remove** discards an unsubmitted file and removes it from the saved selection. Submitted attachments remain with their conversation and cannot be removed through the staging controls. Expired, unreferenced uploads are collected; a fresh draft protects its selected files from collection. Draft revisions detect edits from another tab, and sending an older saved draft does not erase a newer one. If a draft conflict is shown, reload the saved draft before editing again.

Attachment routes require the browser owner's authenticated session. API tokens do not grant attachment upload, download or draft access. Avoid putting credentials in messages or files; use the protected account setup controls.

Attachment implementation has three recorded feature review rounds; required real-account and protected restore evidence remains in the inbox. Dedicated real-account image/text response verification is blocked by the [live credential gate](../../issues/2026-09-07-171225-live-runtime-credentials.md).
