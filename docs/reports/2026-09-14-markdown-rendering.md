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

Independent review found and corrected a missing visible Mermaid label and insufficient wide-content acceptance. All three independent rounds completed with no actionable finding remaining. The final correction keeps footnotes in the same page and scopes both destination and accessibility IDs per reply; its five focused tests, TypeScript, formatting and whitespace checks passed. Final `pnpm build` and `pnpm check` also passed. The critical evidence above is reused for unchanged server/runtime boundaries; final focused browser acceptance covers the later renderer-only footnote correction. Deployment evidence follows after execution.

Existing unrelated release obligations remain in the [active issue index](../../issues/README.md). No runtime or isolation change is claimed by this frontend evidence.

Final `pnpm test:e2e --design` passed with exit 0 in `harbor-e2e-a8e49ace94` after the footnote correction. Its unchanged source digest is `b258767f32896817616dd7fa75e48a35175dd1d403e2565b9e9409274db2df27` (1084 files).
