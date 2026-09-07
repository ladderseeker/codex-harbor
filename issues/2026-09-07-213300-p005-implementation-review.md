# P005 implementation review findings

- Severity: Medium
- Status: In progress
- Owner: [P005](../design/proposals/005-attachments-and-rich-input.md)
- Recorded: 2026-09-07
- Affected files: packages/attachments/src/store.ts; packages/attachments/src/media.ts; apps/web/src/Attachments.tsx
- Acceptance: P005-02/04/05

## Round 1 evidence

A separate agent reviewed the in-progress P005 implementation based on `fb6127a`. Production work and acceptance coverage were still changing, so this is a bounded finding batch rather than a frozen-source completion review. The reviewer read the API, draft/attachment store, parser, publication/mount, adapter and upload UI paths without modifying them or repeating tests.

| Finding | Impact and required correction |
| --- | --- |
| Draft cleanup selects sessions only from expired attachment records. | Text-only drafts and drafts referencing only already-attached files can retain their text indefinitely after the promised expiry. Select expired nonempty drafts independently, clear their private payload/references under the same coordination, and prove that referenced submitted content remains intact. |
| Pause during asynchronous hashing or upload-record creation does not stop the later binary transfer. | The UI can show a paused attempt which subsequently starts sending bytes. Give the whole attempt a cancellation identity, check it after asynchronous boundaries, and reconcile any already-accepted metadata under the same upload identity. Exercise pause before hashing finishes and while metadata creation is pending. |
| PNG chunk names are decoded with ASCII before their exact bytes are validated. | High-bit byte aliases can be interpreted as known critical chunk names when CRC is recomputed. Reject invalid chunk-type bytes before decoding/classification and add a malformed-CRC-valid regression alongside valid PNG acceptance. |

These are source-review findings; their real API/UI/parser reproductions and corrected-source results belong in the closing evidence. No additional actionable publication/mount/adapter defect was reported in this bounded read. That observation does not close acceptance coverage or the later combined-feature authority review.

## Disposition

The P005 implementer is correcting this batch while completing negative upload/capability/retry and actual Linux acceptance. Preserve the same attachment and turn identities across ambiguous responses, keep expired draft cleanup separate from referenced-content deletion, and retain explicit supported-media limits. Record the frozen source, commands, environment, results and independent corrective review before resolution and archival. The [dedicated live-account gate](2026-09-07-171225-live-runtime-credentials.md) remains separate.
