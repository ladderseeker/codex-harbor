# Frontend redesign delivery

Owner: P014. Status: Verified on 13 September 2026; P014 archived as Completed.

The owner approved the [HTML visual guide](../../design/design-tokens.html) and [prototype](../../design/prototypes/harbor-redesign.html), committed in `0431814`, then authorized the real frontend implementation and final commit. [P014](../../design/proposals/archive/014-consistent-frontend.md) owns this outcome. Work is on `codex/frontend-redesign`; the baseline workspace was clean with no stashes.

## Delivered design and scope

The application uses the approved neutral palette, spacing and typography throughout its project rail, conversations, compact composer and supporting dialogs. Project rows expose targeted new chats; chat rows expose durable inline rename. Sidebar resizing enforces pointer/keyboard bounds, with a dismissible mobile overlay and focus restoration. The composer grows from 24 to 160px, then scrolls; Enter sends, Shift+Enter inserts a newline and IME composition does not submit. File drops work across the textarea and composer padding.

Project tools and Account & settings reveal existing secondary workflows. Local/private-fixture project browsing lists bounded relative directories under configured roots with no-follow traversal, owner-only authority and generic failure states. Managed installations retain typed-path registration and explicitly deny this browsing capability. The guide and prototype now cover secondary dialogs, tool surfaces and folder states; AGENTS.md retains the synchronized-design requirement from the baseline commit.

No database schema, runtime adapter, launcher, sandbox, mount, network-policy or managed-storage boundary changed. The stable installation was not promoted or modified. Existing live-account, installed-release, Linux and protected-restore obligations remain with their owning proposals; this scoped redesign does not close those proposals.

## Environment and source identity

macOS, Node 24.11.1, pnpm 12.3.4, Docker 28.2.2, Playwright 1.56.1 / Chromium 1194. Disposable stacks use pinned PostgreSQL `17.6-bookworm`, Caddy `2.10.2-alpine`, fresh roots, databases, ports, credentials and runtime state. Only external OIDC/Codex boundaries are fixtures; Harbor browser/API/PostgreSQL/supervisor components are real. Run-owned resources are cleaned by the harness; redacted evidence remains in ignored `.test-runs/`.

Source digests use `sha256-path-and-content-v1` over 1,057 source/configuration/test files; documentation and built assets are excluded:

- **A:** `b37e0cddff1d06efe57554ee7a8322e5f1a2ce9fe19f11b9fe7f37c7348f9a1c` — final application code and initial drop assertions.
- **B:** `9edea343237543c013862ce86f6f9f55ce5d327b39f1cfaef5e18f126bb84904` — same application, corrected P005 inline-text assertion.

- **C:** `0e4750995ddbea078e3d6d06286126b6ec71993bf07d90aef0f3bcb61d31ebb6` — same application and critical lane, final terminal/workspace navigation helper ordering.

The final build completed after all application changes. Subsequent changes only corrected test navigation/assertions and documentation; passed evidence for unchanged application and executed test boundaries is retained rather than mislabeled as a fresh whole-tree run.

## Acceptance evidence

| Command | Result / artifact under `.test-runs/` | Acceptance and limits |
| --- | --- | --- |
| `pnpm check` | Passed | TypeScript, documentation structure/links/whitespace, OpenAPI and formatting |
| `pnpm build` | Passed | Production web build; existing Monaco chunk-size advisory remains |
| `pnpm test` | 16/16 passed | Integration and directory security/profile checks; initial restricted-sandbox attempt could not create IPC, authorized isolated rerun passed |
| `pnpm test:e2e --design` | Passed, `harbor-e2e-cc6381fa9a`, A→A | P014-01–04: folders/authority, project creation, persisted rename/drafts, compact composer, pointer/keyboard/mobile navigation and screenshots |
| `pnpm test:e2e` | Passed, `harbor-e2e-a8116c0385`, B→B | P014-01/02/05/06: full P001/P002/P003/P005/P007 critical outcomes, including approval/failure/recovery, attachment/paste/drop, history, tokens, retention/replay-gap and authority |
| `pnpm test:e2e --terminals` | Passed, `harbor-e2e-707e1cea28`, C→C | P014-05: complete terminal application acceptance; external PTY fixture, Linux separate |
| `pnpm test:e2e --workspaces` | Passed, `harbor-workspaces-b08338d346`, A→A | P014-05: workspace creation/selection/lifecycle and conversation ownership |
| `pnpm test:e2e --files --render-only` | Passed, `harbor-files-202fcd5370`, A→A | P014-05: real authenticated file UI/CSP rendering; no new save/Git/Linux acceptance claim |
| `pnpm test:e2e --previews` | Passed, `harbor-previews-80e4c38ad1`, A→B | P014-05: UI/API/PG/supervisor/relay lifecycle and authority; only unrelated P005 test changed during this run |
| `pnpm test:e2e --schedules` | Passed, `harbor-e2e-ba039792dd`, A→B | P014-05: real scheduling/lifecycle/fault/authority flow; only unrelated P005 test changed during this run; DST/live/restore evidence remains separately owned |
| `node --import tsx tests/local/e2e.ts` | Passed, `local-e2e-PMz5l8` | P014-05: local-profile account/conversation flow; simulated external runtime. This lane prints its result and retains a screenshot without a digest receipt; same frozen application |

Final visible-workspace navigation passed in `harbor-workspaces-ac56d4759f` (C→C), with Project tools opened before the final assertion and screenshot. Complete terminal acceptance passed in `harbor-e2e-707e1cea28` (C→C), with desktop/mobile screenshots visually inspected. File save/Git and Linux isolation mechanisms are unchanged; their prior evidence and limitations remain in the [P004 report](2026-09-08-p004-files.md) and [installed module report](2026-09-08-installed-module-integration.md). No file-write or isolation contract is newly claimed by render-only coverage.

Desktop/mobile conversation, navigation, folder/error/truncation, account, token, workspace, schedule and preview screenshots were visually inspected. The prototype Interface examples dialog passed folder navigation/state selection, retry and focus-return checks and visual inspection; its hashes and historical evidence are in the [prototype notes](../../design/prototypes/README.md).

## Review rounds and corrected findings

Three implementation → independent review → fix rounds covered the UI and bounded folder endpoint with separate implementer/reviewer ownership. Corrections addressed explicit-workspace fallback, duplicate creation during an asynchronous lookup, mobile selection focus restoration and the composer drop hit area after compacting the attachment layout. Backend authority/path/resource review found no remaining actionable findings. Final source review confirmed composer-scoped capture, cleanup, validation, single upload and unchanged paste behavior.

A bounded fourth review addressed a mandatory acceptance-test correction: the fixture records paths only for local images, while text attachments are inline text inputs. The replacement asserts one stored attached file, the same operation as the image, one dispatch and exact native input counts. Independent review confirmed no weakened outcome. Full critical acceptance passed after this correction. Supporting tests open Project tools before checking its controls; existing outcome assertions remain intact.

## Failed attempts and evidence limits

- `harbor-e2e-3c041fa691` design run captured HTTP 429 on `/api/v1/me`; bounded phase pacing fixed test request pressure without changing server limits. A late application edit also made that initial build/source mismatched, so it is not final acceptance. Later design runs `e0449ef19b`, `68e08abeee` and final `cc6381fa9a` passed.
- `harbor-e2e-d8a683f6dd` critical run stopped at an old title selector matching both the chat and new Rename button. Scoping selectors to chat links preserved the intended checks.
- `harbor-e2e-ad0d573ac9` stopped at the incorrect new text-path assertion described above; upload persistence itself passed.
- `harbor-e2e-fd2340dba2` terminal run checked a button before opening its new disclosure. The navigation helper order was corrected without changing application behavior.

The [P013 critical regression issue](../../issues/archive/2026-09-13-143001-local-critical-regression-gate.md) is resolved by current instrumented full-suite evidence, including retained conversation and replay gap. The original uncaptured failure remains unattributed; later test failures do not establish its cause. P013 overall closure remains a separate lifecycle action.

## Completion

P014-01–06 passed within the declared UI/local-folder scope. Three implementation review rounds plus one bounded acceptance-test correction review have no unresolved critical findings. The independent delivery-document review corrected schema wording and historical issue labeling; links, consistency, whitespace and final source checks passed before commit. P014 is archived as Completed; its commit contains this report and current guide/prototype/user documentation. Existing unrelated proposal obligations remain visible in the active indexes.

## Navigation and ownership addendum — 20 September 2026

P017 reconciled legacy planning records into the [proposal archive](../../design/proposals/archive/). [Current subsystem designs](../../design/systems/) now own requirements, and unfinished acceptance belongs to the [issue inbox](../../issues/) until a new proposal is selected. Historical statements here about active proposal states, queues, permissions and recovery locations describe the recorded date. This addendum changes navigation/ownership only: original tested sources, commands, results, review rounds and limitations above remain historical evidence. No application gate was rerun for the documentation migration. Historical raw artifacts or worktrees not present in this checkout were not newly verified.
