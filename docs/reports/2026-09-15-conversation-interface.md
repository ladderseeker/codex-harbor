# Conversation-first interface — 15 September 2026

## Scope and state

[P016](../../design/proposals/archive/016-conversation-first-interface.md) owns the selected UI refinement, content actions and model effort correction. The owner authorized implementation, commit/push and VPS deployment. The dated checkpoints below preserve the work history; the final installed acceptance section supersedes their pending state. P016 is now verified and deployed.

The initial working tree was source `0d3a99e` with an unrelated owner edit to `AGENTS.md`. That edit is preserved and excluded from task commits. No stash was created. The installed baseline was independently observed as `/opt/harbor-personal/releases/markdown-4f085c8fef26/bin/node`, with API and supervisor active. SSH connectivity returned the expected root/srv1464935 identity. One read-only inspection approval timed out; a permitted single retry succeeded.

## Verification so far

macOS Node 24.11.1 and pnpm 12.3.4. Run-owned evidence is retained under ignored `.test-runs/ui-20260915`.

- Focused message/Markdown checks passed 10/10 before UI integration.
- Integration `TMPDIR=/private/tmp pnpm test` passed 36/36 with loopback execution allowed. The initial sandbox run failed with local-listener EPERM; it is not counted as an application failure or pass.
- Actual pinned Codex 0.153.4 contracts passed 23 tests with one existing opt-in native-policy skip, zero failures. Process-group/PTY checks required execution outside the local sandbox. The discovered default CLI was 0.154.0, so evidence was rerun with the explicit pinned executable; the initial version mismatch is not pinned evidence.
- Fresh-home pinned model discovery advertised Astra low, medium, high, xhigh, max and ultra. Harbor intentionally exposes the five requested public modes, retains per-model server validation and distinct xhigh/max wire values. This discovery does not establish account-backed generation.
- Documentation links and whitespace passed during implementation; final checks remain pending.

## Independent review

Round 1 identified menu/dialog focus restoration, stale nonselected resource indicators and missing-effort guidance unavailable before conversation creation. It also identified an archive documentation contradiction: existing personal VPS archiving retires idle retained processes. The proposal now preserves and states that behavior; interface disclosure and other fixes are underway. No additional blocker was found in response grouping, temporary reactions, capability validation or the existing candidate/deployment script boundaries.

The staged deployment script design validates the exact manifest/inventory, complete runtime, predecessor, drain, private matched checkpoint and post-start executable identity. Actual candidate testing and promotion remain pending. Existing broader release/restore issues in the [active index](../../issues/README.md) are unchanged.

## Remaining acceptance

Finish the rendered prototype and real desktop/mobile browser tests, critical regression, final build/check, independent follow-up review, identified source push, immutable candidate build, drained promotion and installed verification. Record final source/artifact identities, commands, results and actual limitations before closing P016.

## Final interface acceptance — 16 September continuation

The real `pnpm test:e2e --design` lane passed in `harbor-e2e-02102ec5c2`, with identical start/end digest `be104b0b470384704fc2b1e7f3764e327f7101663012f6ec8fcf596a40ed6ec5` (1089 source files). It covers menu/status keyboard focus, current-project search, exact message/source clipboard and failure retry, reaction toggles without requests and reset on reload, all five Astra choices, distinct xhigh/max real Harbor API/supervisor turns, model switching and unsupported-mode API denial, rename persistence and desktop/mobile dialogs. Only external Codex/OIDC use fixtures; these results do not imply a live model call.

The standalone prototype passed desktop 1440×1000, mobile 390×844 and true touch/no-hover interaction checks. Root and implementer inspected screenshots. HTML SHA256 `f03ccfa482f7d017de14ec7c06c4c8f4c5c9aafdf39738cbfd4ba58ac20f336a`. This is separate from real application acceptance.

Three independent review rounds completed. All findings were corrected: explicit menu trigger focus restoration; bounded active and archived/all history refresh preserving pages; pre-create model compatibility help; consistent resource token; accurate archive idle-retirement semantics and prototype filters. Round 3 reported no actionable finding remaining. Final `pnpm check` passed.

The first critical run passed earlier attachment/programmatic phases but failed at retained-conversation reload with a blank root and a failed asset request; the snapshot endpoint returned 200. Concurrent rebuilding changed shared dist assets during that run, so that run cannot establish final acceptance and the exact cause remains unproven. Application/dist were subsequently frozen and the complete critical suite was restarted. No production data was involved.

The final critical `pnpm test:e2e` run passed with exit 0 in `harbor-e2e-597303bdfa`. Source digest changed from `c713c5ee64c0c4fd7fd62b2c82343d1f1b4aac5e76c5e51ba8180f3c705d7d26` to `0789c0113b0ccb3e262419fe91729c83099e41796eec4cc8febf3e7b66a3f4e1` only because an extra P014 design-lane archive/restore test was added during the run; application, backend and dist remained unchanged. The injected supervisor failure message is expected fault-path evidence. A preceding run reached the P007 archive UI but failed due to an exact-label test locator; the corrected scoped selector and real archive/restore flow then passed both critical and separate design acceptance (`harbor-e2e-af3df7085d`, unchanged `0789c011…f4e1`).

Final pinned contracts again passed 23 with the one existing opt-in skip. The implementation was committed and pushed as `78fbf74502c6a98c674289a7c9258f86cfe38002`; a subsequent bounded presentation correction replaces an undefined hover variable with the canonical selected token and skips inert mobile controls during dialog focus restoration. These do not change runtime/API behavior; matching final UI checks cover them while retaining the critical evidence above. Build/check passed after those corrections. The owner identified Clash Verge TUN interference and restored SSH connectivity; no authentication/security weakening was applied.

## Final candidate checkpoint — 16 September

Source `a7cb2f2bf96a551ab1d111ff57a55e959d26f3e3` was pushed and built on the VPS as an isolated non-root candidate. The complete 12,660-file archive SHA256 is `9e3f5eebcca5e81b864d9bb571fb766e97ed37321c40a1450149d6624ed64193`; manifest SHA256 is `7acf0e7c236f26443a2edafd31e428453de7d024af406d3f3988d72d347121fe`. Inventory and ownership validation staged `/opt/harbor-personal/releases/ui-a7cb2f2bf96a`; this candidate was not promoted.

The final design retry `harbor-e2e-665a12d390` timed out during Docker Compose dependency startup, before UI acceptance. A permitted retry `harbor-e2e-f1e4945126` started successfully and exercised the interface, then found that a desktop-opened workspace dialog did not return focus to mobile navigation after resizing and dismissal. This is an outstanding final acceptance correction; neither run is counted as a pass. The installed predecessor remains `/opt/harbor-personal/releases/markdown-4f085c8fef26` while this correction is verified.

The focus correction passed the complete design lane in `harbor-e2e-a5644451b1`, with identical start/end digest `d85ea90cce35e2b89bb9c1dea21608e92413b22740d02b5065ce512761928c33` (1089 files). The final mobile focus assertion passed for account, tokens and workspaces. The removed workspace launcher had left `body` as the apparent opener; restoration now uses an explicit project trigger and verifies a usable control actually receives focus, without interrupting another open dialog. Build, check and whitespace validation passed. The final application source was committed and pushed as `180bdabc2e4400fa612421c0d23d3392b63547e1`. This bounded fix followed the three completed review rounds and was checked by the root reviewer against the failing acceptance case.

## Installed acceptance and completion — 16 September 2026

Final application source: `180bdabc2e4400fa612421c0d23d3392b63547e1`, pushed to `origin/main`. The immutable Linux package contains 12,660 files (243,549,095 archive bytes). Archive SHA256: `f7625e1df641258095ed56ce6bf240e0d4bf1abb5d7c799ada15837eccf75519`. Manifest SHA256: `5c7afe0d6292e5449981342880a4bfa3534dd0d7e7e38d8eec5cccb47c993402`. Build, inventory staging and promotion exited successfully. Installed release: `/opt/harbor-personal/releases/ui-180bdabc2e44`.

Promotion stopped admission, drained operations, stopped supervisor children, retained a root-private matched database/native/config/unit checkpoint at `/var/lib/harbor-personal-backups/ui-180bdabc2e44-20260916`, and started the exact validated release. API PID 3608965 and supervisor PID 3608958 were active with the candidate executable identity. Public HTTPS health returned 200; no executable from the predecessor remained. One preview route was preserved and its anonymous access remained denied. The previous release and checkpoint remain available for deliberate recovery; do not restore over newly accepted work without assessing data loss. There was no schema migration or isolation-policy change.

Signed-in installed browser acceptance used an empty run-owned project, `Harbor UI acceptance 20260916`, and conversation `e8f87224-adfe-4af5-a443-49c5d99afee2`. All five Astra efforts appeared. A read-only GPT-6 Astra Max turn returned `UI acceptance complete.`. Copy response yielded that exact text; like/dislike selection was mutually exclusive and both returned to unselected after refresh. Conversation status showed retained resources, and Stop background processes removed the retention and writer reservation. The resource indicator ceased reporting occupancy. Desktop 1440×1000 and mobile 390×844 layouts were inspected; current-project search, gear/account dialog, contextual session actions and uncluttered conversation were usable. The temporary viewport was reset afterward.

P016-01–06 are complete with the scoped evidence above: real-stack fixture acceptance, critical regression, integration/contracts, actual pinned runtime discovery, three independent review rounds and the bounded final focus correction, and real installed Max generation/resource release. Test assets remain under ignored run-specific directories; automated suites used isolated fixtures and did not target live data. The installed check used only the new empty acceptance project. The owner’s unrelated `AGENTS.md` change remains uncommitted; no stashes were created.

Broader P009 protected off-host restore and P015 verification obligations in the [issue index](../../issues/README.md) remain with their existing owners. This UI completion does not establish those unrelated gates or claim a new Linux isolation certification. The existing contract opt-in skip remains explicitly recorded above.
