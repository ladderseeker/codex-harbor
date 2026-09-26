# P031 — Project file downloads

## Metadata

- ID: P031
- Status: Draft
- Priority: Medium, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: In the personal VPS profile the owner can find, preview and download files in a conversation's project folder, including reports that Codex wrote, without SSH.
- Authorization: Proposal writing only. Implementation, commits to `main` and deployment need the owner's separate go-ahead.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529`.
- Dependencies: None required. Linking [P029](029-complete-conversation-transcript.md)'s file-change rows to this plan's route belongs to whichever of the two plans executes second: if P029 is already Implemented, this plan adds the links (P031-09); otherwise P029 does.
- Source issues: [Conversation report downloads](../../issues/2026-09-20-120000-conversation-report-downloads.md), every obligation except artifact discoverability in the transcript, which P029 owns.
- Design references: [D011](../decisions/011-personal-vps-workspace.md), [D012](../decisions/012-personal-vps-development.md), [workspaces and resources](../systems/002-workspaces-and-resources.md), [deployment and profiles](../systems/004-deployment-and-profiles.md#personal-vps-profile), [interface](../systems/006-interface.md), [API route table](../architecture.md#api-events-and-state-transitions).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P031-01–P031-11.

## Problem, outcome and exclusions

The owner asked on 20 September to download reports that Codex generates, particularly Markdown and HTML. [P024](archive/024-attachments-and-chat-composer.md) added files going to Codex, but nothing comes back: the personal VPS profile blocks every managed file route and has no read-only alternative, so a generated report can only be read as model text or command output, or fetched over SSH.

After this change, a **Files** panel opened from the conversation or project menu lists the project folder one directory at a time. Selecting a file previews text, Markdown and images inside Harbor and offers **Download** for every regular file. The panel is read-only.

Excluded: editing, uploading into the project, deleting or renaming files; rendering HTML inside Harbor's origin; archives of whole folders; the managed file editor; and any change to what Codex may read or write.

## Dependencies and current design

The [profile design](../systems/004-deployment-and-profiles.md#personal-vps-profile) excludes the interactive file editor from the personal VPS profile, D011 disables unsupported managed capabilities in the UI and API, and the API refuses every managed file route in the personal profiles. This plan keeps those exclusions and adds a narrower capability, recorded in the profile design and as a dated D011 amendment: authenticated, read-only listing, preview and download within a registered project folder. The managed files module stays unchanged and unused by this profile.

The architecture's `/api/v1/workspaces/{id}/files` contract belongs to managed workspaces, with revision-checked writes and managed Git review. This plan uses project-scoped read-only routes instead, because a personal project has exactly one Local workspace bound to its original folder and needs none of the managed write contract; the architecture's route table gains them.

## Source issues

The source issue's obligations map as follows: authenticated session and project scoped resolution and path denial to P031-02, P031-03 and P031-05; bounded identity and bytes and safe filenames to P031-10; missing or changed files to P031-06; download UI and API with reload persistence to P031-01 and P031-07; HTML isolation to P031-04; mobile behavior to P031-08. Discoverable references in the conversation belong to P029; linking them to downloads belongs to whichever plan executes second, covered by P031-09 when that is this plan. The plan that executes second archives the issue once both plans are Implemented; if only this plan completes, the issue stays open for the P029 part with a dated note.

## User and API flows

1. The owner opens **Files** for the current project. The panel shows the project root's entries, sorted with folders first, and navigates into folders with a breadcrumb.
2. Selecting a Markdown file shows it rendered with the existing reply renderer, with raw HTML shown as text and no remote images loaded. Plain text and code show literally; PNG, JPEG, GIF and WebP images display inline. Other files show metadata only.
3. **Download** saves the file with its own name.
4. HTML files are offered as download only, with a note that they can be viewed through a personal development preview if the project serves them.
5. The API provides `GET /api/v1/projects/{id}/files?path=` for listing and `GET /api/v1/projects/{id}/files/content?path=` for content, both owner-only.

The panel is a new interface state and must appear in the UI guide and prototype before application use.

## Contracts, state and security

- **Confinement.** Every request resolves the registered project directory's real path and the requested relative path, rejects absolute paths, `..` segments, NUL and control characters, and refuses any result whose real path leaves the project directory. Symbolic links are listed as links and never followed for content. Only regular files are served; devices, sockets and FIFOs are refused. After opening, the API confirms through the open descriptor that the file is still a regular file whose real path lies inside the project, so a path component swapped for a link between the check and the open cannot redirect the read.
- **Bounds.** Listings return at most 1,000 entries per directory with an explicit truncation notice. Previews read at most 1 MiB; a larger file shows its metadata and **Download** instead. Downloads stream files up to 50 MiB; a larger file is refused with a message that names the limit. Hidden files are listed; `.git` internals are listed but not previewed.
- **Headers.** Downloads use `Content-Disposition: attachment` with an RFC 6266 encoded filename, `X-Content-Type-Options: nosniff` and `application/octet-stream` for types outside the preview allowlist. Harbor's existing Content Security Policy applies to previews.
- **Identity.** Responses include size and modification time. If the file changes between listing and download, the download serves the current content and the panel shows the new metadata.
- **Authority.** Owner session and CSRF rules match other read routes; rate limits apply. The API reads with the service account's existing access and gains no new filesystem permission. The personal-profile request filter, which today refuses every path containing `/files`, gains an exception for exactly these two routes; the managed file routes stay refused.

## Implementation brief

Write the D011 amendment and interface specification first. Implement the confinement function once, with unit tests for hostile paths, and use it for both routes. Verify confinement on actual Linux under the real service account, including symbolic links that point outside the project and files the account cannot read.

## Exact file fence

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

`TranscriptItems.tsx`, P029's transcript component, changes only when P029 is already Implemented.

## Verification and acceptance

- **P031-01:** Through the real browser, API and a run-owned project, the owner lists folders, previews Markdown, text and an image, and downloads a file whose bytes match the source.
- **P031-02:** Signed-out and wrong-project requests are denied for both routes.
- **P031-03:** Absolute paths, `..`, encoded traversal, NUL, control characters and very long paths are refused.
- **P031-04:** An HTML file downloads as an attachment and never renders in Harbor's origin; a Markdown file with raw HTML and remote images renders them as text.
- **P031-05:** A symbolic link to a file outside the project, a symbolic link loop, a FIFO and an unreadable file are refused or listed without content, on actual Linux under the service account.
- **P031-06:** A file deleted or changed after listing gives a clear not-found or updated result.
- **P031-07:** Listing and download state survives a page reload, and the panel works with the keyboard.
- **P031-08:** The panel works on a phone-sized viewport with touch.
- **P031-09:** If P029 is Implemented when this plan executes, each file-change row for an existing file inside the project links to its download, and a row for a deleted file shows the missing-file state.
- **P031-10:** A directory with more than 1,000 entries lists 1,000 with the truncation notice. A file over 1 MiB shows metadata and **Download** without a preview, and a file over 50 MiB is refused with the limit named. Filenames with quotes, semicolons, non-ASCII characters and a newline download under an RFC 6266 encoded name that the browser saves safely. On actual Linux, a path component swapped for a symbolic link between the check and the open is refused.
- **P031-11:** `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e --design` with P031's scenarios, the full critical `pnpm test:e2e`, the personal VPS Linux lane and the P024 attachment lane pass.

Gate: behavioral, plus actual Linux verification for the filesystem confinement boundary.

## Rollout and recovery

No migration. Rolling back removes the panel and routes.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
