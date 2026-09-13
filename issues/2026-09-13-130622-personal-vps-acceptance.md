# Personal VPS deployment acceptance is incomplete

- Severity: High
- Status: Blocked
- Owner: P015 implementation and verification
- Recorded: 2026-09-13 13:06 UTC
- Affected files: `infra/personal-vps/harbor-personal`, native runtime adapter/config, `tests/personal-vps/`, P015 deployment.
- Gate: [P015-01–06](../design/proposals/015-personal-vps-workspace.md#verification-and-acceptance-criteria) and [P015-07–10](../design/proposals/015-personal-vps-workspace.md#complete-development-acceptance).

## Current status — 14 September 2026

The selected outcome is implemented and source `13204d7` is pushed and deployed. The [current report](../docs/reports/2026-09-14-personal-development.md) records verified package/TLS/migrations, passing native/browser/critical gates, four scoped reviews, and actual installed owner development: Git commits, locked pnpm dependencies, tests/build, real Vite private preview, complete parent final text, child-event isolation, persisted title and continuation. Existing authentication and project data remain available.

Remaining verification: the mandatory rendered-prototype check is unavailable under browser security policy. Actual rendered application inspection passed but does not waive that gate. P015 remains Implemented and this issue is Blocked by that explicit verification obligation; unrelated dedicated-account and managed-restore gates remain with their existing owners.

The isolated preview-security run `harbor-p015-24078e9b83` passed with durable systemd exit 0, including actual 31-second ticket expiry, one-time replay denial, logout revocation, actual 15-minute viewer expiry, fresh-grant positive controls, mobile preview and stopped-server feedback. Its source digest is `1aaeb7a2dee4c2d4138067feb824e68670405a6aed92dc92f795746f79c30071` (application unchanged from `13204d7`; test-only additions), with a measured 869432 ms final expiry wait and no clock override. Installed background stop also passed independent process, listener and writer-release checks. See the current report for full evidence and limits.

## Initial evidence and impact — 13 September 2026 (historical)

Implementation began at `59cfd3f` on this Ubuntu 24.04 VPS. The original managed profile could not fulfill subscription authentication or ordinary ext4 original-folder registration; P015/D011 explicitly define the new profile. Two independent source review rounds found and fixed generated environment incompatibility, exact-root registration, missing resource limits and empty model configuration. Build/check and host integration checks passed within their recorded intermediate source scope.

Actual nonroot systemd/native positive write initially failed because Ubuntu AppArmor denied user-namespace capabilities. A reviewed exact-binary userns allowance removed that denial; the next run failed because the boundary test started native Codex with a different working directory than the real launcher. Correction and positive/negative Linux acceptance remain in progress. Failed tests do not establish sandbox success.

At this checkpoint, the critical browser suite failed twice at second-turn admission with HTTP409; its cause remains under investigation. No full current critical pass is claimed. Dedicated personal VPS browser acceptance is being executed separately, without replacing the regression gate.

At this checkpoint, the owner had not yet supplied the domain, Harbor OIDC provider/client/subject and exact project path. No real subscription login has been performed for this instance. Public route, verified certificate, installed service/disconnect/continuation and bounded subscription acceptance remain unverified. No production installation was started.

## Initial next action — 13 September 2026 (historical)

Finish current candidate tests and fixes, obtain independent final delta review, record source/artifact identity and actual results, then configure the exact owner-provided deployment inputs and perform provider-assisted subscription login and installed acceptance. Preserve existing Traefik and ordinary Codex state. Keep P015 In progress until its complete outcome exists and Verified only after all mandatory gates pass.

## Review and closing record

Pending. Test assets remain in ignored run-owned storage; temporary service accounts/profiles/containers are cleaned only by their owning harness. No transferred P001/P009 obligation is resolved by this issue.

## 2026-09-13 verification update

The [candidate report](../docs/reports/2026-09-13-personal-vps-candidate.md) records three independent review rounds, passing actual nonroot systemd/native positive and negative checks, final personal browser acceptance with cleanup, and a full critical pass after building the missing pinned Git helper image. Earlier failed attempts remain historical above. Build/check, integration and installer contracts passed. The remaining blocker is concrete owner domain/OIDC/project configuration plus provider-assisted subscription login and installed acceptance; no public deployment is claimed.

## 2026-09-13 owner folder-scope clarification

The owner explicitly authorized access to all of `/root`, with project selection performed in Harbor after deployment. A specific project path is no longer missing: configure `/root` as the administrator-approved browsing root, then register the root itself or non-overlapping descendants through the existing UI. This authorization includes sensitive root-home files; it does not select `/` as a project or change the native service UID. No host ACLs or owner files have been modified. The installer admission adjustment and scoped verification are recorded in the candidate report. Domain/OIDC configuration, subscription login and actual installed acceptance still block delivery.

## 2026-09-13 identity-provider selection

The owner selected Google for Harbor browser sign-in and supplied the intended account in the deployment conversation. Do not copy the personal email into tracked deployment records or treat it as the OIDC subject. The provider choice is resolved; the public domain, Google OAuth client configuration and verified owner subject remain required. Codex subscription authorization remains a separate provider interaction. No live identity configuration has been provisioned.

## 2026-09-13 public DNS verification

The owner configured `harbor.seekworld.tech`. Host-level `getent ahostsv4 harbor.seekworld.tech` returned `187.77.140.226`, matching the VPS eth0 IPv4 address. Existing Traefik remains the only running container and listens on 80/443. Verified-TLS curl failed with certificate verification result 18 (self-signed certificate); no trusted Harbor route/certificate has yet been installed. Do not treat DNS success as HTTPS or application acceptance.

The domain and provider choices are now resolved. Remaining owner inputs are the Google web OAuth client credentials and verified subject for the account supplied in conversation. The callback is `https://harbor.seekworld.tech/auth/callback`. Provider-assisted Codex subscription login and installed acceptance remain required. Continue fresh artifact preparation without inventing OAuth credentials or exposing fixture login.

## 2026-09-13 credential validation and enrollment preparation

The owner uploaded the Google web-client JSON to a root-private onboarding directory outside `/root`. Client ID and callback matched supplied values and a secret was present; file permissions were restricted to 0600 without emitting credential contents. The refreshed archive was extracted and all manifest hashes verified under `/opt/harbor-personal/releases/bade5e977607f9e4`. This is prepared immutable source, not a running Harbor installation.

A dedicated `harbor-enroll` nonroot user and private `/var/lib/harbor-personal-onboarding` state were prepared without project ACLs. An exact-host temporary routing carrier, `harbor-enroll-seekworld-routing`, asks existing Traefik for the Harbor certificate and forwards only to loopback port 3347. Verified TLS now succeeds (`ssl_verify_result=0`); backend HTTP502 at preparation time is expected while the enrollment helper remains stopped pending tests/review. Existing Traefik was not replaced or restarted.

The remaining identity prerequisite is the owner's real Google interaction to capture a verified subject using [D011's temporary enrollment contract](../design/decisions/011-personal-vps-workspace.md#trusted-owner-identity-enrollment). Normal Harbor authentication remains unchanged and no Harbor session/project access is granted by enrollment. Root owns eventual exact-helper shutdown and routing handoff; no broad cleanup is authorized. Subscription login, project ACL provisioning and full installed acceptance remain outstanding.

## 2026-09-13 owner interaction pending

The [candidate report](../docs/reports/2026-09-13-personal-vps-candidate.md#2026-09-13-live-temporary-google-enrollment) records four passing enrollment tests, independent review, the separate helper digest, and actual nonroot systemd/TLS/invalid-link checks. The temporary owner enrollment service is now running with a one-hour lifetime and no project access; the private login link was given to the owner. Google subject verification still requires that interaction. Main Harbor installation, native subscription login and original-folder/persistence acceptance remain incomplete.

## 2026-09-13 final deployment inputs and SSH-preserving grants

Real Google enrollment succeeded with the configured issuer/email and a private nonempty subject. Its temporary service became inactive/dead after success. The verified identity was copied into root-private deployment inputs. The owner's requested existing ChatGPT login was imported into an isolated preflight home; the source file was preserved. The pinned runtime reported ChatGPT authentication and completed a bounded read-only, no-tools `HARBOR_READY` turn with exit 0. No personal project was used by that smoke test.

The owner selected SSH preservation and explicitly confirmed all current and future projects under `/root/Projects`. Automatic review initially rejected the broad ACL operation for missing exact-scope confirmation; it made no changes. After the explicit confirmation, automatic review accepted the exact operation. A physical recursive ACL backup recorded 64,282 entries with no existing masks/default/named ACLs. Applied `/root` read/traverse only and recursive rwX plus directory-default ACLs only under `/root/Projects` (8,080 directories). `/root` remains root-owned without group/other write; `.ssh` ACLs were byte-for-byte unchanged. Actual service-user read/traverse, project-write and root-top-level write denial passed. Recovery records remain root-private under `/etc/harbor-personal-onboarding`.

The installer was corrected to require read/traverse rather than write on browse ceilings. Its separately snapshotted SHA256 is `cb773546b804eebd92c9ef77ef94600baa739871736b81f094add23df43dc0e1`; the application release remains unchanged. Thirty-six Python deployment contracts and documentation checks passed. A concrete private bundle for the verified Google owner and six runtime-reported models was rendered at `/var/lib/harbor-personal-seekworld-candidate`; bundle SHA256 is `f25015b985ed28ecc5d1013a4c881d1c11cc7662c1162957824f8907625280f3`. Actual installation and browser/disconnect/original-folder acceptance remain pending at this checkpoint.

## 2026-09-13 services live; final owner acceptance pending

The reviewed bundle was installed, verified reused credentials copied to final private state, and API/supervisor/dependencies enabled and started. Real service health, trusted public TLS, correct Google redirect/cookie, unauthenticated API denial, loopback bindings and production supervisor ChatGPT/model discovery passed. The [report](../docs/reports/2026-09-13-personal-vps-candidate.md#2026-09-13-running-owner-installation) records artifact identity and actual limits. Sign in at `https://harbor.seekworld.tech/auth/login`; signed-out `/` returns JSON401 in this release. The remaining gate is owner login through the main callback and installed original-folder edit/disconnect/reopen acceptance. Services are running; this issue no longer means the instance has not been deployed.

The final installed write probe found and corrected a read-only project submount using exact approved-path service drop-ins. Independent effective-configuration review, actual API/supervisor namespace project writes/root denials, and actual pinned native workspace/outside/read-only checks all passed afterward; disposable fixtures were removed. The report retains the initial failure, fix identity and verification. The remaining open gate is final owner UI conversation/edit/reconnect acceptance, not the repaired mount defect.

## 2026-09-13 live model-tool blocker: incomplete native package

The owner reported that deployed Codex could not use its tools. Inspection found the release had `bin/codex` and Node but omitted the official sibling `codex-code-mode-host`. The pinned npm vendor manifest also declares `codex-resources` and `codex-path`, which earlier ad hoc packaging omitted. This is a critical blocker to the selected read/edit outcome, not merely a missing final owner check. Existing account/model discovery, text-only subscription smoke and standalone sandbox commands did not exercise that boundary and do not establish working model tools.

Owner: P015 packaging/installation. Source correction adds persistent `infra/personal-vps/package-release.py` to copy the complete vendor target layout and installer preflight to require pinned version/platform/layout plus every required native executable. A fresh complete candidate, independent review and an actual model-invoked canary read/file edit at the original host path are required before closing this blocker. Preserve the existing release and failed live evidence; no in-place binary or account/config mutation is authorized by the source correction.

## 2026-09-13 missing native tool component repaired

A complete official pinned native distribution was packaged and independently reviewed, then promoted after a private state/config/database backup and zero-active-work check. The [complete-runtime report](../docs/reports/2026-09-13-personal-vps-candidate.md#2026-09-13-complete-runtime-promoted-and-tool-acceptance-passed) records official package integrity, archive/manifest identities, 38 contract checks, two promotion-review rounds and successful actual model-driven random-file read/write plus retired-runtime thread-resume edits both before and after promotion. The actual native sandbox denial checks also passed. Original conversations and credentials remain, services are healthy, and disposable test resources were cleaned. The missing component defect is repaired; remaining P015 owner browser/edit/disconnect acceptance is still open.

## 2026-09-13 owner confirms new-conversation recovery

The owner confirmed tools work after opening a new Harbor conversation. The preceding response quoting the old helper path contained no fresh tool call. No further deployment change was required. See the [owner confirmation and evidence limits](../docs/reports/2026-09-13-personal-vps-candidate.md#2026-09-13-owner-confirms-tools-work-in-a-new-conversation). Old-conversation recovery and complete browser-disconnect/reopen acceptance remain unverified; the planned cross-release disposable-thread test was not run and its unused resources were cleaned.

## 2026-09-14 complete development workflow

Owner browser inspection confirms the task remains titled New conversation after substantial dialogue and its last visible checklist ends mid-sentence. Current source hardcodes command network denial and exclusion of temporary write roots, disables native sandbox escalation and does not package pnpm. Live SSH confirms the full-runtime release, separate harbor-personal UID, root-owned project and protected service filesystem. Historical model reports are not independent fresh tool acceptance.

The owner approved [D012](../design/decisions/012-personal-vps-development.md), implementation on main, push and VPS deployment. P015 owns all remaining development environment, Git, preview, title, reply completeness and installed reconnect obligations through P015-07–10; severity remains High until the complete outcome passes. Root directs implementation with separate runtime, conversation and preview implementers, followed by independent review and candidate verification. No completion is claimed at this checkpoint.

### Parent/child event investigation — 14 September initial checkpoint (historical)

Read-only inspection of the owner-reported native history found that two latest persisted assistant item IDs were absent from the parent native transcript, whose linked subagent activity is being checked. This is a potential core lifecycle/projection blocker: child events must not finish the parent operation or replace its messages. The conversation owner is implementing thread-scoped event handling and an interleaved-child completion regression; no historical live data mutation has been made. Earlier passing ordinary/fixture development tests do not cover this newly identified boundary.

### 14 September parent/child correction and installed stop evidence

The routing correction is implemented at `13204d7`; the 300-child-event, early-parent-output and rejected foreign approval regression passed, followed by real installed child review and parent final-text comparison. The parent completed after its child and retained its own complete final response. Same-conversation continuation reused the retained runtime; explicit **Stop background processes** removed the process, closed port 3100 and released both session and workspace background ownership. See the [current report](../docs/reports/2026-09-14-personal-development.md#installed-browser-development-acceptance) for exact identities and evidence. These defects are corrected; this record stays active for its remaining verification gate.
