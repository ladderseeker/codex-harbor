# Installed personal VPS image delivery and composer admission fail

- Severity: High; selected attachment delivery does not work on the installed VPS.
- Owner: Main, reopened [P024](../design/proposals/024-attachments-and-chat-composer.md#reopened-installed-delivery-correction--21-september-2026), P024-R1–R5.
- Recorded: 21 September 2026, Asia/Shanghai.
- Baseline: `317a33d`; installed implementation `817c3d0`.

The owner supplied an affected conversation and screenshot. Read-only metadata inspection confirmed that the first image was accepted and associated with a turn, but dispatch failed before any native request and before publication recorded an inode. A second image remained staged in a saved draft while a later text-only turn succeeded. No image bytes, prompts or credentials were exported into this record; bounded private receipts are `.test-runs/p024-send-fix/production-readonly/`.

The installed container is root-owned 0711, with service-owned private 0700 children. The installed personal publisher opens all ancestors for reading and then incorrectly requires that container to be service-owned 0700. Separately its file creation requests 0444 under the installed service's umask 0077 and then rejects the resulting 0400 file. Prior test fixtures used a recursively service-owned 0700 container and did not reproduce the service umask; their passing results did not prove installed publication.

Source inspection also identified a browser race: Send checks upload busy state, waits for a draft save without reserving submission, then submits without rechecking new uploads. An image selected during that interval can arrive in the next empty draft after the text-only request. The production timestamps are compatible but do not prove that exact browser ordering; an isolated deterministic reproduction is required. Do not relabel the older [selection issue](2026-09-08-044009-p005-selection-regression.md) as the same cause without evidence.

Resolve by preserving the trusted installed layout and service restrictions, fixing no-follow traversal and exact descriptor modes, reserving complete composer submission, and passing P024-R1–R5 through production-equivalent isolated Linux and actual browser/model delivery. Preserve user drafts and failed operation history; do not replay their input. No automatic migration or live permission change is authorized by this fix.

## Verification progress

Controlled old-helper Linux tests reproduce both installed permission failures, and the fixed publisher passes without changing production modes. An old-UI control reproduces the missing submission reservation; fixed real application races and four actual-model turns under installed-equivalent constraints pass, including image-only and text-first image continuation, composer clearing and draft reload. The exact owner browser ordering remains unproven. Source, gates, historical failed attempts and cleanup are in the [correction report](../docs/reports/2026-09-21-p024-installed-attachment-fix.md). Full critical completion, independent reviews and reviewed deployment are still required before resolution.

The complete correction gate and one fresh independent design/provenance review round passed. Reviewed personal VPS packaging, promotion and installed verification remain pending; this record stays open until that delivery is confirmed.
