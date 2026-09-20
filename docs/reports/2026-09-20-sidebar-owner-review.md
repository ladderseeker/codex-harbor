# P023 owner-review corrections

## Scope and authorization

[P023](../../design/proposals/archive/023-sidebar-and-transcript-refinement.md#owner-review-correction-cycle--20-september-2026) reopened after the owner reviewed the first deployment. This cycle covers aligned history states and trailing sidebar controls, removal of two redundant settings labels, display-only user-message thumb icons, and selected-first recent-update session ordering. The owner explicitly authorized implementation, commit, push and VPS deployment.

Baseline `4b438a954c0db071b9e2ccd8cb9839da02dcfe15` was clean across staged, unstaged and untracked files. No stash was created. The [initial delivery report](2026-09-20-sidebar-and-transcript.md) preserves its earlier gates and three rounds; those are not new checks for this correction. Main owns planning/evidence/deployment and uses a fresh-context Medium-effort implementer plus independent reviewers for this bounded UI correction.

## Verification and release record

Completed and deployed on 20 September 2026. All five correction acceptance IDs, local/Linux gates and both independent review roles are clear. Private evidence is retained separately under `.test-runs/p023-owner-review-20260920/`. Earlier script and runtime evidence may cover unchanged boundaries only with identified source and limits. Report downloads, schema changes and runtime-policy work remain excluded. R5 extends only the history read-query mode, as detailed below.

## Deployment prerequisites

The first strict-host-key SSH check closed before command output; the unchanged retry returned `root` and `srv1464935`. Read-only inspection then confirmed installed release `/opt/harbor-personal/releases/p023-606d6cc75baa`, manifest `1af0c3fd1d8f5433c56ad9262fdb1e1b6cf4c3267fa094d9155eda7cb4ae251f`, all three services active and approximately 69.2 GB free. This is prerequisite evidence, not acceptance of the correction.

The six private fixed build/test/linkage/stage/promotion/installed-verification helpers match their previously reviewed hashes. Fresh candidate directories are keyed by the new full committed revision; previous evidence, releases and backups remain untouched. The earlier bounded live canary at `606d6cc` supports only unchanged native execution. This cycle requires read-only installed UI acceptance on the previously approved disposable conversation and creates no new live model operation.

## Implementation and verification attempts

The application diff is confined to project action DOM order, row-end padding, sidebar-only history-state inset, two settings text removals and two decorative spans beside user Copy. User reactions have no handler/state or interactive semantics; assistant temporary reactions are unchanged. Current design, guide/prototype and user documentation specify this distinction. The prototype adds selectable history-state specimens for alignment inspection.

Baseline renders are retained separately. The first browser launch needed scoped sandbox access after Mach-port denial. `impl-after-render01` failed while measuring the mobile slide animation; `impl-after-render02` waits for the visible settled layout and passes desktop/mobile ready/loading/loading-more/empty/error geometry. Main inspected the final mobile loading-more image and `toolbar2-touch.png`, which visibly shows copy/thumb-up/thumb-down under the user bubble. `impl-toolbar-render01` retained its partial images and failed only at a later mobile Settings click while navigation was closed; the separate second render passes. These prototype checks do not substitute for application acceptance.

Build-01/Check-01 passed at `f566b8db61faff475901d9c1b8b9af019613f1fefd0d30751c588e62821a8757`. Unit-01 omitted the canonical temporary-directory setting; Unit-02 added it but still hit sandbox-denied Unix/loopback listeners. Scoped Unit-03 passed all 39 tests at `e0d786b2e44646826e37bbe4f904a8b32b9b4177ce54a51d12d9740ca829c6da`. No test was skipped or weakened. Subsequent source drift is one E2E screenshot capture; application and unit-test inputs are unchanged.

Design-01 passed application assertions but remains interim: a build of identical application source overlapped its early phase, and a later touch-screenshot line changed the test source during that run. Its receipt preserves start `e0d786…c6da` and end `9809dd…b779`; it is not frozen final acceptance. Main held critical execution until cleanup and a final build/check. Final Build-03 and Check-03 pass at `9809dd453d886c93621f3f1a00042c28fc1692d0dc03b9df3e57d87b9755b779`. Design-02 and Main-critical01 now run concurrently on that frozen source and built assets. All earlier receipts and partial render images remain retained; the nine-file and visual manifests identify final inputs separately.

## Additional owner ordering request

During verification, the owner added selected-first, descending-update sidebar ordering. Main extended R5 and the same implementer's fence for a backward-compatible history read-query mode and its current API/interface documentation. Search's default immutable creation order remains unchanged. This supersedes the earlier presentation-only scope statement; it adds no durable write or runtime/schema/policy change.

Design-02 failed a touch geometry read during the sidebar slide animation at frozen `9809dd…b779`; the visible application screenshot is retained. The same implementer changed only geometry synchronization, polling the original less-than-0.6px coordinate tolerance. Main-critical01 independently failed the existing P007 credential-removal no-op check (expected 200, observed 409); its frozen receipt/log and owned failure diagnostics are retained. Main assigned a separate read-only diagnosis; the existing [credential-cleanup regression observation](../../issues/2026-09-08-020429-p007-regression-evidence.md) remains open and a later pass does not establish this failure’s cause. Neither failure is counted as a pass. Both lanes cleaned before source work resumed. Final gates will run again after R5.

The owner also requested that the Projects heading plus align with the project/session trailing controls. Main added this to R2 and its shared geometry checks before final gates.

Read-only failure diagnosis found initial credential removal and exact-key replay passed before a fresh-key no-op returned 409. Existing native cleanup is fenced during discovery/recovery processing; cleanup separately recorded `CREDENTIAL_IN_USE` with zero active database operations. The original failed response and supervisor log are unavailable, so the exact cause remains unverified. Main authorized sanitized failure code/index capture in the existing P007 assertion for the next full run, preserving the 200 requirement and no-growth assertions without retries or credential/runtime changes.

## Scoped promotion verifier

R5 changes one API source file. Main retained the six original helpers and prepared `promote-owner-review.py` (SHA256 `253c8bf83dbc60f92f5314914268aa6cea3fd0fc6397709adc1aa18eb948393a`). Its only promotion-contract change permits `apps/api/src/history.ts` when the installed predecessor hash is exactly `039635ace50455039ce85f641c693a4981983fca5916a9e6a1446661103c5525` and the candidate hash matches an explicit reviewed-source argument. Every other API path and the complete adapter/supervisor/migration/installer inventories still require equality. Full artifact verification, native equality, root ownership, draining, matched checkpoint and recovery behavior are unchanged. The candidate hash and release identities must be settled before execution; no promotion has occurred in this cycle yet.

## Final local gate candidate

The settled application/API and tests are frozen at source digest `e8443af14feaf1c43842b59daa101f4360f517f351443775e849336b4c1882a5` (1,093 files). Build-06, Check-06 and Unit-05 all exit 0 with identical start/end identities; all 39 unit tests pass. Main independently verifies their log hashes. Design-03 and Main-critical02 run concurrently against this frozen source and built assets; no source edit or rebuild is allowed until they clean up. Earlier Build/Check-04 and -05 and Unit-04 passed interim test revisions; they are retained separately, not substituted for these final receipts.

Main caught two fixture assumptions before browser acceptance: oldest-session selection can move that row beyond ten visible rows, and precision fixtures can create more than three pages. The same implementer corrected the test to return through search, preserve each draft and depth, drain a bounded number of five-row pages, then compare complete visible order with the real API. It also waits for settled sidebar geometry without changing the 0.6px tolerance. No product workaround, weakened assertion, skipped test or accepted 409 was introduced.

The targeted R5 prototype render passes selected-first ordering without timestamp mutation and exact plus/project/session center equality at sidebar widths 220 and 400 and on touch. Main inspected `r5-order-touch.png`; the new active row and aligned controls are visible. Its private log records centers `[189,189,189]`, `[369,369,369]`, and `[226,226,226]`. Prototype file hashes and screenshots are retained separately from application-source digest.

## Visual glyph correction after the green combined gate

Design-03 and Main-critical02 both passed with frozen `e8443…82a5`; their real-stack results are `harbor-e2e-4d2999952a` and `harbor-e2e-d8e340ad81`. Main inspected the desktop/touch application screenshots and found the session dots offset inside their aligned target. A read-only DOM audit with actual CSS confirmed 3px desktop and 6px touch offsets: the native summary retained list-item layout while project buttons centered their SVGs. This visible R2 failure was not covered by the earlier target-box-only assertion, so main did not accept it as completed design.

After both lanes cleaned, main authorized the same implementer to center the session summary, match the existing 16px project glyph, and check actual SVG/plus-text centers as well as targets. The exact pre-correction 15-file snapshot is retained in `pre-glyph-source/`. Only CSS, prototype/guide and geometry test inputs may change. The green critical lane is reused for unchanged application/runtime behavior under the canonical evidence rule; final build/check/unit/design and rendered glyph checks must pass, and both independent reviewers must assess the exact delta and limits. The successful critical run does not diagnose or close the earlier credential-test 409.

Final glyph-corrected build/check/unit gates (Build-07, Check-07, Unit-06; 39 tests) pass at identical start/end digest `8afe1f6e2eb260a4cd71d121c0f4f7b75e87c9a064c680dbc46d99896f7eaa79`. Main independently checked the final delta: only `styles.css`, the visual guide, prototype and strengthened P023 geometry assertions differ from the green critical source. `critical-reuse-delta.json` and its diff bind both versions; no API, TSX, runtime or critical-suite source changed. Design-04 supplies final actual-application visual acceptance.

Design-04 passed on the final `8afe1…aa79` source, with identical start/end identity and owned cleanup. Its real-stack result and desktop/touch screenshots are retained in `.test-runs/harbor-e2e-b0a80722ce/`; actual glyph-center assertions pass at narrow/wide/touch sizes. Main rechecked final build/check/unit/design and reused critical log hashes. The VPS preflight still identifies predecessor `606d6cc`, all three services active and zero active operations. The first origin fetch closed at SSH connection setup; the unchanged strict retry succeeded and confirms origin/main remains baseline `4b438a9`. No remote state was overwritten.

## Independent review — round one

Fresh Medium-effort design and provenance reviewers separately cleared the local candidate with no actionable findings. Design inspected R1–R5 contracts/source/tests and actual rendered artifacts. Provenance recomputed final and pre-glyph source digests, checked all 15 implementation files, the 20-entry review inventory, seven helpers, all 35 receipt/log hashes and the visual manifest. Both accepted critical02 reuse for the exact four-file visual/test delta and independently passed documentation/whitespace checks. They did not edit files or run infrastructure/live gates. Their messages record these assessments; complete raw review-session exports are unavailable.

Main accepts both reviews and proceeds under the owner's existing commit/push/deploy authorization. The Linux candidate, installed acceptance and final closure remain a separate review step.

## Linux candidate

Implementation and reviewed plan were committed and pushed as `a94f4c1f8bed550efe010caf346a66db5c45b123`. Origin/main acknowledges that revision and the source checkout was clean. The Git bundle SHA256 is `4c21f863d18156820a7952e13fc6690f4cc32c481963f6fc320931f78fe95ef6`; all eight uploaded input hashes match locally. The push completed after a slow SSH connection; no retry, credential change or host-key relaxation was needed.

The fresh nonroot Linux locked install/build and 39 unit tests passed. Package manifest SHA256 is `e153ca89e91d4abc203e161d56fd6cddf9a0fbe1c07cf81c2976d1292a9cbc7d`; archive SHA256 is `dce8086070737c02d5804e6868bb9929bc37d1d34b244d5f11a3f040f93db62d` (244,807,067 bytes, 14,221 manifest files). The fixed Linux browser/API/PostgreSQL/supervisor lane passed at identical final source digest, and the complete before/after source/package verification receipts are byte-identical. This is not yet an installed-release claim.

Main retrieved the bounded logs, full manifest and fixture screenshots as evidence archive SHA256 `7db58c91b642a3b8c054f911726c2448308b0fcd77f95290c1f2d3323dd212e0`. Local extraction rejects nonregular/escaping/oversize entries. Main rechecked the manifest, source revision, package linkage, exact start/end source, and final Linux desktop screenshot. The real-stack instance is `harbor-e2e-0b20ee9946`; `linux-verification-record.json` identifies all retrieved file hashes. The tested package was staged as `/opt/harbor-personal/releases/p023-a94f4c1f8bed`, with full content/root-ownership verification.

## Promotion and installed acceptance

The reviewed promotion helper verified the exact predecessor, candidate history-file hash, unchanged remaining API/runtime/migration/native inputs and complete staged artifact. It drained admission/work, retained matched private backup `/var/lib/harbor-personal-backups/p023-a94f4c1f8bed-20260920`, preserved site drop-ins and the configured preview, and promoted `/opt/harbor-personal/releases/p023-a94f4c1f8bed`. The prior `p023-606d6cc75baa` release remains available. Recovery requires stopping writers and assessing subsequent work before any matched restore; no automatic database rollback is implied.

Installed verification passes: API/supervisor processes execute the new release's Node binary, no process executes the prior release, HTTPS health returns 200, and anonymous root/index/API/actual JS/CSS requests all return 401. The signed-in Chrome page loads exactly the JS/CSS asset names identified by this installed check.

Main's read-only installed UI check reused the previously approved disposable conversation. Add-project, project ellipsis and session ellipsis target/glyph centers are all x=229. Settings contains only Codex account, Emergency stop and Sign out. User Copy remains the sole button; two aria-hidden, nonfocusable 30×30 decorative spans match the answer icons. The outside-bubble row changes opacity from 0 at rest to 1 on hover. The displayed page shows neutral surfaces, folded existing commands and code headers. No new model turn, project, file mutation or credential action occurred. This single-row live check does not replace the local/Linux multi-page ordering tests.

`remote-stage01.json`, `remote-promote01.json`, `remote-installed01.json`, and `installed-ui-observation.json` retain the narrower evidence. CUA observations/displayed screenshot are not a complete exported browser session; that raw export remains unavailable. An initial DOM probe used a nonexistent root selector and failed before returning measurements; the corrected read succeeded. No computed-white claim is drawn from transparent root/body elements, and no installed clipboard-byte claim is made.

## Independent review — round two

Both reviewers cleared the completed Linux candidate, promotion, installed evidence and closing claims without actionable findings. Design confirmed the unchanged implementation and inspected the Linux screenshot. Provenance independently matched all eight uploaded input hashes, the evidence archive and all 29 extracted artifact hashes, complete before/after linkage receipts, packaged implementation, manifest and installed identities. Both passed documentation/whitespace checks and accepted the explicitly limited installed browser observations. Neither edited source nor reran infrastructure gates. Main accepts both assessments.

Main restored P023 to Implemented/Completed and moved the same proposal into the archive, preserving initial history and repairing inbound/outbound links. The closing changes are documentation only; the tested and deployed application remains commit `a94f4c1f8bed550efe010caf346a66db5c45b123`.

## Independent review — round three

Both reviewers cleared the final documentation-only archive and link changes with no findings. They matched all four closing document hashes and verified metadata, preserved history, artifact claims and limitations against round-two evidence. Documentation validation passed for 161 files, together with diff whitespace and explicit new-file whitespace/final-newline checks. Main accepts these assessments; this correction cycle closes within its three-round cap. No application changes or infrastructure reruns followed deployment.

## Closing scope and limitations

R1–R5 are implemented and deployed, with local and immutable Linux verification. Report downloads/previews remain separately tracked by the original P023 follow-up; no runtime/isolation/restore gate is newly claimed. The historical credential no-op 409 remains open and unexplained. All scoped findings and completion gates are clear. The documentation closing commit and push follow the already deployed application commit; no further application deployment is needed for those documentation changes.
