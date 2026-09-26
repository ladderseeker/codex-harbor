# P031 — Project file downloads

## Metadata

- ID: P031
- Status: Draft
- Priority: Medium, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: In the personal VPS profile the owner can find, preview and download files in a conversation's project folder, including reports that Codex wrote, without SSH.
- Authorization: On 27 September 2026 the owner authorized evaluation and revision of the open proposals, followed by commit and push of these document changes to `main`. Feature implementation, live experiments and deployment are outside this audit.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529`.
- Dependencies: None required. Linking [P029](029-complete-conversation-transcript.md)'s file-change rows to this plan's route belongs to whichever of the two plans executes second: if P029 is already Implemented, this plan adds the links (P031-09); otherwise P029 does.
- Source issues: [Conversation report downloads](../../issues/2026-09-20-120000-conversation-report-downloads.md), bounded project-file access and fallback Files-panel obligations. P029 covers observed patch references only; complete conversational discovery of command-created reports remains with the existing issue.
- Design references: [D011](../decisions/011-personal-vps-workspace.md), [D012](../decisions/012-personal-vps-development.md), [workspaces and resources](../systems/002-workspaces-and-resources.md), [deployment and profiles](../systems/004-deployment-and-profiles.md#personal-vps-profile), [interface](../systems/006-interface.md), [API route table](../architecture.md#api-events-and-state-transitions).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P031-01–P031-11.

## Review note — 27 September 2026

Read-only source review against `e6c2a138563139650af46fe51af44c6eb6c28743`; the original baseline in Metadata and dated evidence remain historical. The proposed file boundary now requires descriptor-bound root identity and no-follow traversal, bounded work/transfers and explicit HTTP/profile rules. The exact Linux helper, limits and control-path policy must be settled before acceptance. This audit runs documentation checks only and adopts no canonical feature contract, performs no application/runtime/Linux acceptance and closes no issue.

## Problem, outcome and exclusions

The owner asked on 20 September to download reports that Codex generates, particularly Markdown and HTML. [P024](archive/024-attachments-and-chat-composer.md) added files going to Codex, but nothing comes back: the personal VPS profile blocks every managed file route and has no read-only alternative, so a generated report can only be read as model text or command output, or fetched over SSH.

After this change, a **Files** panel opened from the conversation or project menu lists the project folder one directory at a time. Selecting an eligible file previews text, Markdown and validated images inside Harbor and offers **Download** for allowed regular files. The panel is read-only.

Excluded: editing, uploading into the project, deleting or renaming files; rendering HTML inside Harbor's origin; archives of whole folders; the managed file editor; and any change to what Codex may read or write.

## Dependencies and current design

The [profile design](../systems/004-deployment-and-profiles.md#personal-vps-profile) excludes the interactive file editor from the personal VPS profile, D011 disables unsupported managed capabilities in the UI and API, and the API refuses every managed file route in the personal profiles. This plan keeps those exclusions and adds a narrower capability, recorded in the profile design and as a dated D011 amendment: authenticated, read-only listing, preview and download within a registered project folder. The managed files module stays unchanged and unused by this profile.

The architecture's `/api/v1/workspaces/{id}/files` contract belongs to managed workspaces, with revision-checked writes and managed Git review. This plan uses project-scoped read-only routes instead, because a personal project has exactly one Local workspace bound to its original folder and needs none of the managed write contract; the architecture's route table gains them.

## Source issues

The source issue's obligations map as follows: authenticated session and project scoped resolution and path denial to P031-02, P031-03 and P031-05; bounded identity and bytes and safe filenames to P031-10; missing or changed files to P031-06; download UI and API with reload persistence to P031-01 and P031-07; HTML isolation to P031-04; mobile behavior to P031-08. Observed patch references in the conversation belong to P029; command-created report discovery remains unassigned in the source issue; linking them to downloads belongs to whichever plan executes second, covered by P031-09 when that is this plan. The issue stays open for any unverified obligation, including command-created conversational artifact discovery. P029/P031 both becoming Implemented is insufficient to archive it. Add dated partial coverage evidence on completion; the Files panel is fallback project access, not proof that every report has a conversation reference.

## User and API flows

1. The owner opens **Files** for the current project. The panel shows the project root's allowed entries, sorted with folders first, and navigates into folders with a breadcrumb.
2. Selecting a Markdown file shows it rendered with the existing reply renderer, with raw HTML shown as text and no remote images loaded. Plain text and code show literally; PNG, JPEG, GIF and WebP images display inline. Other files show metadata only.
3. **Download** saves the file with its own name.
4. HTML files are offered as download only, with a note that they can be viewed through a personal development preview if the project serves them.
5. The API provides `GET /api/v1/projects/{id}/files?path=` for listing and `GET /api/v1/projects/{id}/files/content?path=` for content, both owner-only. The content route has explicit preview versus attachment-download mode; unsupported Range requests, including multipart ranges, are rejected consistently. HEAD uses the same policy and bounded metadata acquisition without reading the whole file. Set exact query/error schemas before acceptance.

The panel is a new interface state and must appear in the UI guide and prototype before application use.

## Contracts, state and security

- **Confinement.** Acquire listing/content through a descriptor bound to the registered project root's stored device/inode identity; reject replaced roots. Use no-follow traversal of every directory/file component, rejecting symlinks, magic links and special files/FIFOs/devices before reading or blocking. Reject absolute/traversal/ambiguous encoded paths, NUL/control characters and overlong paths. Symlinks may be labelled in listings but never followed; unsafe names are escaped and not served. Detect ancestor rename/replacement and return no bytes before descriptor validation. Before acceptance main selects the supported-Linux helper/API, exact helper path and test seam; realpath-before/after strings alone are not confinement evidence. `.git` and known Harbor credential/state paths are excluded from listing/preview/download under an explicit registered-root/deny policy settled before acceptance; this is not a promise to identify arbitrary secrets by glob.
- **Bounds.** Listings return at most 1,000 allowed entries with a truncation notice; main must additionally settle finite scanned-entry, serialized-byte, elapsed-time and concurrent-request limits before acceptance. Previews read at most 1 MiB; larger files show metadata and Download. Download admission refuses files over 50 MiB; the stream enforces its accepted byte cap even if the file grows. Bound backpressure and close the owned descriptor on cancellation/error; expiry/revocation ends a long transfer. Image preview requires validated content and a settled decoded-dimension/pixel limit, not extension trust.
- **Headers.** Explicit downloads use safe `Content-Disposition: attachment` with encoded filename and safe fallback, `X-Content-Type-Options: nosniff` and private/no-store caching. HTML, SVG and unknown types are download-only with `application/octet-stream`; preview MIME follows validated content. Emit Content-Length only when consistent with the actual bounded descriptor bytes; premature truncation/transfer failure cannot report a completed download. Harbor's CSP and literal/Markdown rendering rules remain in force.
- **Identity and change.** Responses include current descriptor size/modification metadata. A replaced pathname cannot redirect an already authorized open descriptor; concurrent in-place writes do not provide an immutable snapshot. Changed/deleted/truncated files produce truthful updated metadata, missing state or incomplete-transfer failure, with no automatic retry/replay. Reload restores selected project/path/preview state only, never restarts a download.
- **Authority and profiles.** The feature targets personal VPS, with explicit personal-local/private-fixture test availability and denial in managed mode; it grants no new filesystem permission. Owner-browser authentication and read-route Origin/CSRF policy/rate limits apply, with no bearer-token grant. Only exact supported method/route exceptions pass the personal filter; managed file routes stay refused. A transcript reference binds to its conversation's project and server path validation; native reported paths are never authority. The owner may independently select any legitimately registered project; wrong-project denial means traversal/reference mismatch cannot serve another project's bytes, not denying a legitimate project selection.

## Implementation brief

Write the D011 amendment and interface specification first. Before acceptance settle exact helper/API and path, root/control-path policy, listing/image/transfer concurrency bounds and HTTP mode/error schemas. Implement the descriptor confinement once for both routes with hostile-path and race tests; these decisions are not delegated to the worker. Verify confinement on actual Linux under the real service account, including symbolic links that point outside the project and files the account cannot read.

## Exact file fence

The paths below are a prospective feature-implementation fence, not authorization to edit them during this audit. The current audit edits only the fourteen selected Draft proposals. Main must settle any missing new paths and check provisional decision/migration numbering before acceptance.

- `design/proposals/031-project-file-downloads.md`
- `design/architecture.md`
- `design/decisions/011-personal-vps-workspace.md`
- `design/systems/002-workspaces-and-resources.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/systems/006-interface.md`
- `design/design-tokens.html`
- `design/prototypes/harbor-redesign.html`
- `apps/api/src/server.ts`
- `apps/api/src/project-files.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/ProjectFiles.tsx`
- `apps/web/src/TranscriptItems.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/styles.css`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `tests/integration/project-files.test.ts`
- `tests/e2e/run.ts`
- `tests/e2e/p031.ts`
- `tests/personal-vps/e2e.ts`
- `docs/user/conversations.md`
- `issues/2026-09-20-120000-conversation-report-downloads.md`
- `issues/archive/2026-09-20-120000-conversation-report-downloads.md`

`TranscriptItems.tsx`, P029's transcript component, changes only when P029 is already Implemented. The exact supported-Linux helper and any image-validation helper/test paths must be allocated in this fence before acceptance; this prospective list is not yet an executable file fence.

## Verification and acceptance

- **P031-01:** Through the real browser, API and a run-owned project, the owner lists folders, previews Markdown, text and an image, and downloads a file whose bytes match the source.
- **P031-02:** Signed-out/bearer requests, managed-profile access and cross-project traversal/reference mismatch are denied for both routes; legitimate owner selection of another registered project remains allowed. Exact personal route exceptions do not enable managed file routes.
- **P031-03:** Absolute paths, `..`, encoded traversal, NUL, control characters and very long paths are refused.
- **P031-04:** HTML/SVG/unknown content downloads as an attachment and never renders as active Harbor-origin content; disguised/oversized-dimension image previews fail closed; a Markdown file with raw HTML and remote images renders them as text.
- **P031-05:** A symbolic link to a file outside the project, a symbolic link loop, a FIFO and an unreadable file are refused or listed without content, on actual Linux under the service account.
- **P031-06:** A file deleted/replaced/changed after listing gives a clear missing/updated result; in-place shrink/growth cannot exceed accepted bytes or falsely report a complete snapshot. Test aborted/backpressured transfers and authority expiry/revocation, with owned descriptors closed.
- **P031-07:** Selection/path/preview state survives reload without replaying downloads, and the panel works with the keyboard.
- **P031-08:** The panel works on a phone-sized viewport with touch.
- **P031-09:** If P029 is Implemented when this plan executes, each eligible file-change row for an allowed existing file links to its download in a profile exposing this capability, while control paths remain unlinked, and a row for a deleted file shows the missing-file state. A shell-written report without a native file-change row remains available through Files but does not claim complete conversational discovery.
- **P031-10:** A directory with 1,001 small allowed entries within the other scan/byte budgets lists 1,000 with a truncation notice; separate fixtures hit each earlier work/byte/time cap honestly. A file over 1 MiB shows metadata and **Download** without a preview, and a file over 50 MiB is refused with the limit named. Filenames with quotes, semicolons and non-ASCII characters download under an RFC 6266 encoded name that the browser saves safely, and a name containing a control character is listed escaped and not served. On actual Linux, swapped symlink/FIFO leaves, renamed/replaced ancestors and replaced root identities yield no unauthorized bytes or blocking special-file open. `.git`/known control paths are denied throughout. Enforce scanned work/time/serialized-byte/concurrency caps, safe HEAD, explicit mode/range errors and header rules as well as returned count.
- **P031-11:** `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e --design` with P031's scenarios, the full critical `pnpm test:e2e`, the personal VPS Linux lane and the P024 attachment lane pass.

Gate: behavioral, plus actual Linux verification for the filesystem confinement boundary.

## Rollout and recovery

No migration. Rolling back removes the panel and routes.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
