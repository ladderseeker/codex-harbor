# Harbor interface prototype

[Open the standalone HTML](harbor-redesign.html). Download/open the file in a browser; no build, external assets, account or server is required.

The owner accepted this visual direction on 13 September 2026 as the baseline for future UI work, before application implementation. The [design tokens and UI guide](../design-tokens.html) owns its visual rules and extension workflow. Sample conversations and controls demonstrate the interface. They do not connect to Harbor or Codex, execute tasks, or establish application acceptance. Refreshing resets the demo.

The direction follows the owner's Codex sidebar references: a gray project rail, white conversation canvas, restrained black typography, and hierarchy through spacing and neutral shades. Navigation starts with the Harbor mark and New chat; project rows reveal session actions on hover or keyboard focus. The composer starts compact, grows with multiline input, and scrolls at its height limit.

Chat rows reveal Rename chat on hover or keyboard focus, with the action always available on touch screens. On desktop, drag the sidebar's right edge to resize it between 220 and 400px, with a tighter upper limit on narrow windows. Focus the divider and use the arrow keys or Home/End to resize with a keyboard. Mobile uses the overlay sidebar.

Folder selection uses the browser's local picker with a directory-input fallback. It adds a project label to the demo; it does not register a server workspace or upload files. Browser folder-selection capabilities vary.

The chat options menu also opens **Interface examples**, a native dialog with sample folder selection and loading, empty, access-denied/retry and partial-listing states. These demonstrate P014 supporting surfaces without accessing folders. The real application uses its own authenticated root browser and registration checks.

The prototype is separate from the accepted [architecture](../architecture.md) and existing [proposal delivery states](../proposals/README.md). P014 integrates this direction through the existing conversation, workspace and permission contracts with separately recorded real application verification.

## Prototype validation — 13 September 2026

Two independent review rounds resolved mobile keyboard navigation and stale composer text on folder selection; no prototype findings remain. On macOS, Node 24.11.1 and Playwright 1.56.1 Chromium checks passed for desktop (1440×1000) and mobile (390×844) rendering, new chats, per-project sessions, escaped message text, multiline submission, composer growth/shrink (24–160px), mobile focus restoration and folder-selection callback behavior. Screenshots were visually inspected. The native OS picker was not automated; its callback was supplied a test directory name. These are standalone prototype checks, not Harbor end-to-end acceptance.

`pnpm exec prettier --write design/prototypes/harbor-redesign.html`, `node scripts/check-docs.mjs` and `git diff --check` passed. Tested HTML SHA-256: `51abf54be223ae20628c8f917bcfe5b2bb2bda9c965e7475f5e8a032ff344703`.

### Sidebar revision — 13 September 2026

Moved rename to each chat row and added bounded desktop resizing. One independent delta review passed without findings. Chromium checks in the same environment passed active/inactive chat rename, preserved active chat and draft, hover visibility, drag and keyboard limits, the 760px viewport cap, and mobile overlay/focus behavior at 390px. The updated desktop screenshot was visually inspected. Documentation links and whitespace passed. Revised HTML SHA-256: `db509e08e4d99421f0b8565bdad0d7a6d4c1455ed91fa629f91c711d88148a2f`.

### Application integration specimens — 13 September 2026

P014 extends the guide and prototype with secondary tool surfaces and an interactive folder-state dialog. Chromium checks passed folder navigation, loading/empty/error/truncated specimens, retry and focus return; the dialog screenshot was visually inspected. These remain prototype checks. Application acceptance is recorded in the [frontend delivery report](../../docs/reports/2026-09-13-frontend-redesign.md). Current prototype SHA-256: `5a205538d19fad94dc5360fba2ffcf938395608567caea62518d33fb20b35611`; HTML guide SHA-256: `cf7baa656c344c3c3c9b6e28a8ecd933f98350917472a289e09aab1de0852444`. Earlier hashes above retain their historical scope.

P015 adds a personal VPS account specimen under Supporting interface patterns, using existing status/help semantics. It demonstrates readiness and SSH onboarding copy only; actual account and approved-folder behavior requires application acceptance.
