# Conversation-first interface — 15 September 2026

## Scope and state

[P016](../../design/proposals/016-conversation-first-interface.md) owns the selected UI refinement, content actions and model effort correction. The owner authorized implementation, commit/push and VPS deployment. Implementation and verification are underway; no deployment or completed proposal is claimed in this checkpoint.

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
