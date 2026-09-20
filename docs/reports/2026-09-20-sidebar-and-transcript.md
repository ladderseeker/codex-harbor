# P023 sidebar and transcript refinement

## Scope and authorization

[P023](../../design/proposals/023-sidebar-and-transcript-refinement.md) selects five-item history pages, modal current-project search, aligned discoverable actions, outside-bubble user copy, code headers/syntax coloring and compact collapsed command activity. The owner explicitly authorized implementation, commit, push and VPS deployment for final review afterward. Downloadable Markdown/HTML reports remain a separate [resource-delivery issue](../../issues/2026-09-20-120000-conversation-report-downloads.md).

Baseline: `58c8accfea66ef2852b86bbea7e9b614674aad55`, clean `main` checkout. No stash was created. Main owns planning, evidence and deployment; `ui_implementer` is a fresh-context GPT-6 Astra High worker with the exact proposal fence. Independent design and provenance reviews will start only after the application gate is green.

## Environment and deployment preparation

On 20 September, observed local Node `v24.11.1`, pnpm `12.3.4` and Docker `28.2.2`. Docker and SSH initially failed inside the ordinary sandbox; scoped escalation succeeded. The prescribed SSH check returned `root` and `srv1464935` with BatchMode and strict host-key checking retained.

Read-only VPS inspection found `/opt/harbor-personal/releases/ui-180bdabc2e44`, manifest SHA256 `5c7afe0d6292e5449981342880a4bfa3534dd0d7e7e38d8eec5cccb47c993402`, base revision `180bdabc2e4400fa612421c0d23d3392b63547e1`, 12,660 manifest entries, active API/supervisor/dependencies and zero active operations at inspection. This is prerequisite evidence only. The existing nonroot builder, complete pinned native packages and free candidate disk space are available.

The private `.test-runs/p023-ui-refinement/` folder retains checkpoint, command receipts and deployment scripts. Candidate scripts derive from the inspected P016 scripts, use a distinct `p023-<revision>` directory and add a Linux unit-test gate. Promotion additionally refuses changes to backend/runtime/migration files or native executables relative to the inspected predecessor. It validates the complete candidate manifest, drains active work, creates a matched root-private checkpoint, preserves site drop-ins and verifies service/executable identity. Script syntax checks passed; the first Python bytecode-cache check was blocked by the local cache sandbox, then in-memory compilation succeeded without writing there. No candidate or live services were changed by preparation.

The VPS lacked `codex-harbor-git:2.39.5-p003`, required by the Linux fixture workspace inspector. Main built the unchanged fixed `infra/git/Dockerfile` and helper in run-owned `/var/lib/harbor-dev-20260914/p023-git-helper`. Build exited 0, image `sha256:1133d499decc8d0b45e5caaa8a9515fb7a70ba5c6dd9b318e61fc0d04cc48e49`; local evidence is `.test-runs/p023-ui-refinement/git-helper-build.log`. Context archive SHA256 `cc4150723341c05f914631d79a0fbceb24d309bfe1ad7cb4b4028f0b8f46f470` matched remotely. SCP closed the connection before transfer; the same archive was sent over the verified strict-host-key SSH stream. The unused macOS archive metadata produced harmless extraction warnings. This adds a test prerequisite and does not modify the installed Harbor release. `git ls-remote origin refs/heads/main` returned the expected baseline, confirming push-channel access without changing the remote.

## Application gate

The local implementation gate is green; independent review and candidate/installed acceptance remain pending. Initial `pnpm build` and `pnpm check` passed; receipts are `implementer-build-01.json` and `implementer-check-01.json` under the private evidence root. Their different digests reflect a later correction to P007 test selectors for the new activity disclosure; application assets were unchanged between those initial commands. These initial passes are not final acceptance.

Main inspected first desktop, search and mobile prototype screenshots. The search dialog still resembled stacked form fields, so main requested the compact search-first layout now specified in P023 and broader mobile screenshots. This is pre-review implementation feedback. Final code and built assets must remain frozen while E2E runs; the in-progress initial design run is allowed to finish and clean up before the visual revision.

The first `pnpm test` attempt hit sandbox socket denial and the existing macOS `/var` versus `/private/var` temporary-path assumptions. Scoped reruns with canonical `TMPDIR=/private/tmp` passed (`implementer-test-02.json`, `implementer-test-03.json`); those tests were not weakened or skipped. Build-02 caught a duplicate JSX attribute during the layout edit, corrected before Build-03 passed. Check-02 subsequently found only a formatting issue in the new touch test, queued for correction.

Design-01 and Design-02 failed at the new stale-search assertion because the expected title omitted the preserved `Local` workspace label. The first attempted test edit did not match the formatted source, so the second run repeated the same failure. Neither is a pass; both retain receipts and raw logs. Each reached that assertion after the existing P014 UI flows and earlier P023 pagination, depth, draft and transport-failure cases. The final correction must retain the one-result and stale-query checks. The initial prototype screenshots were overwritten by the first rerender; main's tool observations remain, but that first image set is not separately retained on disk. Final-prefixed prototype and guide screenshots are preserved separately.

`main-critical-01.json` records full `pnpm test:e2e` exit 0 from 11:21:42 to 11:25:42 UTC at unchanged application/test digest `24a428299bfc7de2307d6f6bc7dd670dec6d50461aed315913a24af4933cff8a` (1,093 files). Harness evidence: `.test-runs/harbor-e2e-7ac17fbc4f/`. It includes real browser/Caddy/API/PostgreSQL/supervisor, attachment association/isolation, programmatic access and history/critical behavior; only external Codex/OIDC are fixtures. The supervisor failure line is the expected injected failure path in this passing run. A later small menu-size/focus correction requires final validation before this report can claim completion.

All attempts retain command receipts/output. Rendered prototype evidence is separate from real application acceptance.

Design-03 subsequently caught a real keyboard-focus race when an acknowledged rename removed the only matching search result. The mutation's `/sessions` refresh superseded the history read, allowing the callback to focus a row just before it disappeared. The implementer is correcting restoration to wait for the current committed rows, retaining the regression assertion. Build-04 and Check-03 passed at `733e9ee4aabf07406696288add71c917c8209dba6f719e48dabbf97f182d50f1`; they do not close the failed browser gate. Main did not start the second critical run on that source.

Build-05, Check-04 and Test-05 passed at `96a462a92c05d9ccd684b84eb5e6386fec70d90c4ecaa7d65fa0a20c459edbfd`. Design-04 passed the retained rename regression, then found native reverse-Tab could focus browser chrome rather than a dialog descendant. Main authorized explicit keyboard wrapping only for search under the existing focus-trap contract. That browser attempt remains failed; the final gate must include both traversal directions.

Build-07, Check-05 and Test-06 passed at `32ba61238d29b14c9300c5467bfcd15f82f7096f37d8d26b5802cbcaa75d7d7c`. Design-05 then passed search focus/traversal and persisted command grouping, but the test's clipboard-denial setup threw `ReferenceError: __name is not defined` when tsx serialized a nested async function into the browser. This is a test setup failure, not acceptance of the remaining assertions. The correction must preserve real clipboard denial and visible failure checks. Earlier Build-06 also passed; Build-07 followed a test-only traversal assertion change.

Design-06 passed the complete P014/P023 browser lane from 11:37:20 to 11:39:06 UTC at unchanged digest `62a82b046e425ce6d3dbd5fdce72d197c1bcba0255623b866d45b431da5a97a8`, after the test-only serialization correction. Check-06 passed on that source. Build-07/Test-06 cover the identical application code; the only subsequent code-digest difference is the browser test setup. Harness evidence is `.test-runs/harbor-e2e-fe73364177/`, with desktop/mobile/touch application images. Main and implementer inspected those and the final3 prototype images; `visual-document-manifest-final3.json` identifies guide/prototype/docs/images separately from the code digest. The earlier final2 manifest is retained.

Visual inspection found the new activity style lost to an older, more-specific selector (10 px rather than the guide's 12 px), plus browser-default cyan touch feedback. Main queued the two scoped styling corrections under the existing neutral presentation contract, with fresh build/check/focused visual acceptance after the frozen critical run. Functional acceptance from Design-06 does not alone close those visual corrections.

Full critical `main-critical-02.json` passed from 11:37:54 to 11:41:52 UTC at the same unchanged `62a82b…a97a8` digest. Raw-log SHA256: `d49875beec07dba0ae17d06b409dae3f3bbb8f0101f503aa279914ac34d67dbb`; harness `.test-runs/harbor-e2e-2137e1586c/`. The expected supervisor fault injection is not a failed suite. Main verified completion before thawing source. The subsequent changes are limited to styling, corresponding visual assertions and the design lane's result-scope label, so this identified critical evidence is retained for the unchanged behavioral boundaries.

Final local source digest is `f9bca5e9723400277dc04de7ef2b838b7568ff2b23d042f0bea188ef8a38a020` (1,093 files). Build-08, Check-07 and Design-07 passed with unchanged start/end digests. Final application images and result are in `.test-runs/harbor-e2e-a05d7c6175/`; the browser checks include the actual 12 px activity text, 16 px spacing, neutral touch feedback and loaded touch search results. Main subsequently ran `main-unit-final` at this exact digest from 11:47:10 to 11:47:12 UTC: all 39 tests passed, no failures or skips. This removes the need to infer unit-test source equivalence from Test-06. Raw log SHA256: `11c98d79e9237eb1c0342e1a0c33077cc88319a3db4b3caa18a8d03ca74022e1`.

The implementer's `critical02-to-final.patch`, prior file copies and `prove-critical-delta.py` reconstruct the earlier critical digest exactly in memory and independently match final source. Its proof names only stylesheet, P023 test assertions/result capture, harness label and synchronized guide/prototype changes. `visual-document-manifest-final4.json` identifies final design/docs/screenshots; prior manifests remain historical. Main retains a pre-review diff/file archive and inventory, explicitly excluding later report updates.

| Acceptance | Local evidence |
| --- | --- |
| P023-01 | P023 real API history pagination, refresh depth, draft/selection, failure/retry and stale-query assertions |
| P023-02 | P014 archive/restore plus P023 modal search, filtering, selection, rename focus, bidirectional Tab/Escape/backdrop and touch |
| P023-03 | P023 target-size/touch checks; guide/prototype and application menu/settings renders; existing rename/status regressions |
| P023-04 | Markdown integration safety/grammar/fallback checks, P014 code/source clipboard and P023 outside-bubble hover/focus/touch/failure |
| P023-05 | Grouping integration checks and P023 persisted three-command streaming/expansion/reload with literal diagnostics; critical approval/error paths |
| P023-06 | Final4 guide/prototype plus Design-07 desktop/mobile/touch application renders and computed neutral/overflow checks |
| P023-07 | Build/check/unit/design/critical and docs gates above; independent reviews, Linux candidate and installed acceptance still pending |

## Independent reviews

Round one is running with fresh-context High-effort design and provenance reviewers after the green local gate. Candidate and installed acceptance remain pending; this round does not establish final deployment completion. Review messages are evidence of each reviewer's assessment; a complete exported agent session log is not available. At most three rounds, with main's dispositions and fixes by the original implementer.

The design reviewer found no actionable scoped or unrelated findings after inspecting all 27 changed/untracked files, actual desktop/mobile/touch images and current contracts. The reviewer independently reproduced final source identity, matched all 12 final4 manifest entries, and passed docs/whitespace checks. This clears the local design review only.

The provenance reviewer independently matched local source/reconstructed-critical digests, raw-log hashes and final4 artifacts. One deployment evidence finding was accepted: the Linux lane exercises the builder source while staging uses its packaged copy, so candidate acceptance needs explicit source/dependency/dist-to-package inventory equality before and after the lane. Main gave the original implementer a settled, exact private-script fence for this verification plumbing. The package manifest, complete copied source scopes and symlink targets must match; live state is unaffected. Candidate execution remains pending that recheck.

## Candidate and installed verification

Pending. No successful new candidate build, promotion, commit or push is claimed yet.

## Limits and follow-up

No runtime protocol, sandbox, network policy, API authorization or schema change is selected. The earlier P016 installed runtime evidence remains historical at `180bdabc…547e1`; the current change does not recertify managed Linux confinement or protected off-host restore. Existing [live and release obligations](../../issues/) remain unchanged. Report downloads and safe browser previews are explicitly deferred to their linked issue, not counted as delivered.
