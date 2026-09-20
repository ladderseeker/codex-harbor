# Downloadable reports from conversations

- Created: 2026-09-20
- Severity: Product capability gap
- Owner: Awaiting owner selection of a resource-delivery proposal
- Source: Owner UI request; separated from [P023](../design/proposals/archive/023-sidebar-and-transcript-refinement.md).

The owner wants generated report files attached in a conversation, downloadable on click, particularly Markdown and HTML. Assess a browser preview if it can be safely delivered with the same bounded outcome; a complete file explorer is not required.

At source `58c8accfea66ef2852b86bbea7e9b614674aad55`, Markdown links do not create authenticated artifact attachments. The [personal VPS profile](../docs/developer/personal-vps.md#use-and-recover) excludes managed files and attachments. The existing [managed file contract](../design/systems/002-workspaces-and-resources.md#files-and-git-review) does not authorize exposing native paths in that profile.

A receiving proposal must cover discoverable conversation artifact references, authenticated session/project-scoped resolution, bounded file identity/bytes, safe filenames, traversal/symlink/control-path denial, missing/changed-file behavior, download UI/API and reload persistence. HTML preview must not execute with Harbor's origin/credentials; select safe isolation or retain download-only. Preserve Markdown as a useful downloadable source. Do not merely turn model-supplied absolute paths into public links.

Recheck through the real Harbor browser/API and fresh run-owned project, including unauthenticated and wrong-project denial, hostile paths/content, download bytes, expired/missing/changed artifacts and mobile behavior. P023 neither implements nor closes this obligation.
