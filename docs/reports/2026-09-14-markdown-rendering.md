# Conversation Markdown rendering — 14 September 2026

Scope: the owner requested a focused frontend rendering fix, push and deployment. This changes assistant presentation under P001; it does not change message storage, API, runtime, permissions, migrations or P015's remaining broader acceptance gates.

## Delivered behavior

Assistant replies use pinned react-markdown 10.1.0 and remark-gfm 4.0.1 for CommonMark/GFM headings, emphasis, lists, quotes, links, tables, task lists and fenced code. Longer outer Markdown fences preserve inner code fences literally. Accumulated streaming source is reparsed, with the same rendering on persisted-history reload. Wide code and tables have keyboard-focusable horizontal scrollers. User input and tool output stay literal.

Raw HTML remains escaped and the parser's default URL sanitizer stays enabled. Images become explicit links without automatic requests. Table alignment uses classes under the existing CSP. Mermaid has a visible source label and code fallback; diagram rendering and syntax coloring are outside this small patch.

## Verification and review

macOS Node 24.11.1, pnpm 12.3.4, Docker Desktop and fresh external Codex/OIDC fixtures. All Harbor UI/API/PostgreSQL/supervisor components are real in browser acceptance. No personal credentials or production projects were used by automated tests.

- `pnpm build` and `pnpm check` passed.
- `TMPDIR=/private/tmp pnpm test` passed 29/29 integration checks, including parser/security and incomplete-prefix cases.
- Initial `pnpm test:e2e --design` passed in `harbor-e2e-0123de9a55`, source digest `2944d38b19fe5f29de1276f9683e88b81a28b450c8f098f40178855cef1998e4` (1084 files, unchanged start/end). It covers streamed open fences, completion, persisted reload, safe HTML/URLs/images, GFM alignment and desktop/mobile internal scrolling. Screenshots were inspected.
- The canonical standalone prototype was rendered in the in-app browser. The Markdown table and nested code specimen were inspected and keyboard focus moved from table to code.

The critical `pnpm test:e2e` suite passed with exit 0 in `harbor-e2e-7aed37cc44` at the same unchanged digest above. This covers P001/P002/P003/P005/P007 browser, API, persistence, authority and recovery boundaries. Its injected supervisor-settlement failures are expected fault-path diagnostics, not a failed suite.

Independent review found and corrected a missing visible Mermaid label and insufficient wide-content acceptance. All three independent rounds completed with no actionable finding remaining. The final correction keeps footnotes in the same page and scopes both destination and accessibility IDs per reply; its five focused tests, TypeScript, formatting and whitespace checks passed. Final `pnpm build` and `pnpm check` also passed. The critical evidence above is reused for unchanged server/runtime boundaries; final focused browser acceptance covers the later renderer-only footnote correction. Deployment evidence is recorded below.

Existing unrelated release obligations remain in the [active issue index](../../issues/README.md). No runtime or isolation change is claimed by this frontend evidence.

Final `pnpm test:e2e --design` passed with exit 0 in `harbor-e2e-a8e49ace94` after the footnote correction. Its unchanged source digest is `b258767f32896817616dd7fa75e48a35175dd1d403e2565b9e9409274db2df27` (1084 files).

## Push and installed verification

Application commit `4f085c8fef26e47f7457f75b249accaf2cc448e0` was pushed to `origin/main`. The separate pre-existing owner edit to `AGENTS.md` was left uncommitted and unchanged. No stashes were created.

The VPS built that exact commit from a fresh Git bundle checkout using the existing nonroot candidate builder, frozen pnpm lockfile and complete pinned native distribution. Durable build unit `harbor-markdown-build-4f085c8` completed with Result=success, ExecMainStatus=0. Release inventory: 12,658 files; archive SHA256 `ef7b156efe965f0243f24b6f9c567e14a013c40c56655e74054a35af2f420ab3`; manifest SHA256 `61eed15d9185965ce39e1025d54d4b0a3fe78c215ab38e270c8499499f0059d5`. Staging checked every manifest entry, ownership, modes and symlink containment.

The active-operation count was zero immediately before promotion. Durable unit `harbor-markdown-promote-4f085c8` completed with Result=success, ExecMainStatus=0 and selected `/opt/harbor-personal/releases/markdown-4f085c8fef26`. A private matched recovery checkpoint is retained at `/var/lib/harbor-personal-backups/markdown-4f085c8fef26-20260914`. Existing previews, configuration, project-write drop-ins, identities and native state were preserved. No migration was introduced. Recovery retains the documented requirement to assess newly accepted work before restoring a checkpoint; do not overwrite new state blindly.

Promotion verified stable API/supervisor executable identities, readiness and anonymous preview denial. Public HTTPS `/health` returned 200 with certificate verification result 0. Reloading the existing signed-in owner conversation preserved its history and displayed its formerly raw table as real table cells, fenced text as code blocks, and lists/emphasis as formatted content. The deployed narrow-screen table was visually inspected and keyboard-focusable. No production test conversation or model call was created for this verification.

The isolated candidate and reviewed task scripts remain in ignored `.test-runs/markdown-20260914` locally and `/var/lib/harbor-dev-20260914/markdown-4f085c8fef26e47f7457f75b249accaf2cc448e0` on the VPS for recovery/audit. This report closes only the selected rendering correction; Mermaid diagram rendering remains an explicit source fallback and broader release issues remain unchanged.

## Navigation and ownership addendum — 20 September 2026

P017 reconciled legacy planning records into the [proposal archive](../../design/proposals/archive/). [Current subsystem designs](../../design/systems/) now own requirements, and unfinished acceptance belongs to the [issue inbox](../../issues/) until a new proposal is selected. Historical statements here about active proposal states, queues, permissions and recovery locations describe the recorded date. This addendum changes navigation/ownership only: original tested sources, commands, results, review rounds and limitations above remain historical evidence. No application gate was rerun for the documentation migration. Historical raw artifacts or worktrees not present in this checkout were not newly verified.
