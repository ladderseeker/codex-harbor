# Personal VPS deployment

## Design and evidence ownership — 20 September 2026

[Current subsystem designs](../../design/systems/) own behavior and limits; the [issue inbox](../../issues/) owns unfinished acceptance. Historical proposal IDs below identify feature lineage and evidence, not active execution. Future changes follow a newly selected proposal under the [workflow](../../design/workflow.md); baseline reconciliation did not rerun application gates.

The personal VPS development workflow is implemented; the historical deployment report identifies source `13204d7`. The [current subsystem design](../../design/systems/004-deployment-and-profiles.md) owns current behavior and links retained acceptance; the [decision](../../design/decisions/011-personal-vps-workspace.md) defines its personal trust model. Commands below exist in the current implementation. The [14 September report](../reports/2026-09-14-personal-development.md) records real installed account/development/preview/continuation acceptance and the remaining verification gates; the required rendered-prototype check remains in the inbox.

This profile serves owner-authenticated HTTPS and runs native Codex under a dedicated nonroot Unix account. Codex can develop in the selected existing repository through conversations using D012's Git/network/temp policy and configured private preview. Browser closure and SSH disconnection do not stop systemd services; approval requests can still pause work. Native read access is broader than the selected workspace, and native processes share the service account's trust domain. This is not cross-project read isolation, XFS quota enforcement or the managed model-egress boundary. Do not use it for mutually untrusted projects.

## Prerequisites and package

Require Linux/systemd, Docker Compose for the private PostgreSQL service, Python 3, Git, make, a C++ compiler, Node 24.11.1, pnpm 12.3.4, Codex 0.153.4 and locked application dependencies. Build with `pnpm install --frozen-lockfile` and `pnpm build`. Assemble a root-owned release outside every editable project containing application packages, migrations, infra helpers, `apps/web/dist`, complete `node_modules`, and the pinned Node executable plus the complete official Codex vendor target layout. `bin/codex` alone is insufficient: preserve its sibling `bin/codex-code-mode-host`, `codex-package.json`, `codex-resources/` (including bwrap and zsh), and `codex-path/` (including rg). Preserve internal dependency links, and reject links outside the release. Record the source and artifact SHA256 before deployment. Do not serve a mutable source checkout as the installed release.

Use the persistent packaging command after building, with the complete verified npm vendor target directory as input:

```sh
python3 infra/personal-vps/package-release.py --source . --node /absolute/pinned/node --vendor /absolute/pinned/vendor/x86_64-unknown-linux-musl --pnpm-package /absolute/pnpm/package --pnpm-binary /absolute/pnpm-native/package/pnpm --output /absolute/fresh/candidate
```

The pnpm inputs are the complete official `pnpm@12.3.4` wrapper package and matching `@pnpm/exe.linux-x64@12.3.4` native executable, each checked against npm integrity metadata. The packager installs a direct executable wrapper and adjacent distribution resources, avoiding a runtime downloader. The output must not exist. The command preserves the vendor layout and records a file manifest and archive SHA256. Installer preflight rejects missing helper/resources, version/platform mismatch, symlinks for required native executables, and non-executable or writable native assets. Verify npm package provenance/integrity and the full candidate digest before promotion. A CLI version check, model listing or text-only model response does not prove model tools work: require a real conversation to read a disposable canary and edit a file at that same original path.

Choose an existing root-owned installation parent such as `/opt/harbor-personal/releases`, a unique instance name, and a dedicated nologin service account with no supplementary groups or Docker/sudo access. The administrator configures the directories Harbor may browse; the owner chooses actual projects in the browser after deployment. The owner's final access choice preserves SSH: grant the service account `r-x` on `/root` itself, leave `/root/.ssh` unchanged, and grant `rwX` access to existing project content under `/root/Projects`, with directory default ACLs for future content there. Preserve ownership and record exact ACLs for reversal. Do not make `/root` publicly traversable. The installer requires read/traverse access to browse ceilings, not write access; it does not grant ACLs or register projects.

The owner has authorized all current and future projects under `/root/Projects`. Other folders beneath `/root` are browsable only where existing Unix permissions allow it; editing them needs a separate administrator write grant. Browser project selection and workspace-write permission do not grant Unix access. Registering `/root` itself permits reads subject to Unix permissions, but cannot write at its top level under the chosen ACLs. No write grant is made to `/root/.ssh`, root startup files or unrelated root-home state. Such writes could break SSH StrictModes checks or influence later root sessions; a nonroot UID would not protect explicitly shared files. Keep Harbor's immutable release, private instance state, native account home, administrator configuration and candidate bundles outside `/root`.

Obtain a canonical HTTPS domain and a real OIDC issuer, client ID, optional private client-secret file, and exact owner subject. Configure the callback as `https://YOUR_DOMAIN/auth/callback`. Browser sign-in to Harbor and subscription sign-in to Codex are separate identities. Secrets belong in private administrator files, never in prompts or version control.

## Configuration and rendering

The complete JSON schema is validated by [harbor-personal](../../infra/personal-vps/harbor-personal). Required fields are:

| Field | Value |
| --- | --- |
| `instance`, `user` | Unique short instance and existing dedicated nologin account names |
| `origin` | Canonical HTTPS browser origin |
| `oidcIssuer`, `oidcClientId`, `ownerSubject` | HTTPS provider and exact owner identity |
| `oidcSecretFile` | Canonical private secret file, or null for a provider supporting a public client |
| `release` | Canonical existing immutable application release directory |
| `apiPort`, `databasePort` | Distinct unused loopback ports, 1024–65535 |
| `roots` | Nonempty array of `{id,name,path}` defining administrator-approved browse ceilings, not preselected projects; `/root` is supported when explicitly configured. UUIDs and canonical existing directories must be disjoint from release/private state and each other |
| `postgresImage` | `postgres:17.6-bookworm@sha256:...` with the actual pulled image digest |
| `models` | Nonempty explicit model IDs available to the subscription account |
| `apparmorUserns` | Explicit opt-in to an exact immutable Codex executable AppArmor user-namespace profile on hosts that require it |
| `traefik` | Whether to render the existing-Traefik routing carrier |
| `maxActiveTurns`, `maxConversationRuntimes` | Optional positive integers, both default 4; active range 1–16, runtime range 1–32 and runtime must be at least active. These are conversation admission limits, not host process limits |
| `previews`, `previewPort` | Optional configured `{name,port,origin}` entries and loopback gateway port (default 3350); unique HTTPS hosts and ports distinct from Harbor services |

Store the concrete configuration privately. Example command paths below are administrator-selected placeholders, not provisioned defaults:

```sh
python3 infra/personal-vps/harbor-personal validate --config /etc/harbor-personal-candidate.json
python3 infra/personal-vps/harbor-personal render --config /etc/harbor-personal-candidate.json --output /var/lib/harbor-personal-candidate
```

Rendering creates private database credentials, service environment, Compose and systemd unit files. It does not alter host services. It refuses an existing output directory. Inspect the exact bundle privately; do not paste its environment or password into logs. Install validates that generated contents still match configuration and refuses existing installation paths.

## Install, account and start

```sh
sudo python3 infra/personal-vps/harbor-personal install --bundle /var/lib/harbor-personal-candidate
sudo python3 infra/personal-vps/harbor-personal login --config /etc/harbor-personal-INSTANCE/config.json
sudo systemctl enable --now harbor-personal-INSTANCE-dependencies.service harbor-personal-INSTANCE-api.service harbor-personal-INSTANCE-supervisor.service
```

Replace `INSTANCE` with the chosen instance name. Installation prepares `/etc/harbor-personal-INSTANCE` and `/var/lib/harbor-personal-INSTANCE` and installs units without starting them. Native device login refuses an active API/supervisor; the owner completes the official device authentication page. Login uses the service account's independent private Codex home. The login command imports no API key or ordinary host account cache. A separate trusted one-time subscription credential import is permitted only when the owner explicitly requests reuse, as described below. Device authentication may need enabling in the account's security settings. See [official Codex authentication](https://learn.chatgpt.com/docs/auth).

On Ubuntu with restricted unprivileged user namespaces, native Codex may require an exact-executable AppArmor profile before its sandbox can run. The actual Linux acceptance lane must pass; disabling the native sandbox or globally disabling namespace restrictions is not a supported remedy. The [Ubuntu release notes](https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions) describe per-application `userns` profiles. Set `apparmorUserns: true` only for this host prerequisite. The renderer emits a profile matching the exact immutable `bin/codex`; install requires a regular executable and loads that named profile. It does not change a global sysctl or grant host capabilities.

The API is loopback-only. Traefik integration assumes an already trusted host-network Traefik with its Docker provider, `websecure` entrypoint and `letsencrypt` resolver. The routing carrier uses the private backend port; it does not replace or restart Traefik. Verify the actual route and certificate before real login. Other proxy setups require an equivalent reviewed route to the loopback API. Never publish fixture authentication or native app-server ports.

## Use and recover

Sign into Harbor after deployment, open Add project, choose the configured browse root and use Browse folders to select an existing project. With `/root` configured, choose a descendant folder or select `/root` itself, represented as `.` in the registration request. Configuration alone does not register a project. No files are moved or uploaded. Register multiple disjoint descendants or `/root` itself; the existing overlap rule prevents registering `/root` together with any of its descendants. Set workspace-write permission for Codex edits; read-only turns must not edit files. Browser choices stay within the administrator ceiling, and `/` and other broad system directories remain forbidden.

Check services through SSH:

```sh
systemctl status harbor-personal-INSTANCE-api.service harbor-personal-INSTANCE-supervisor.service harbor-personal-INSTANCE-dependencies.service
```

Stopping/restarting the supervisor interrupts active work and can leave unknown effects. Prefer waiting for work to finish; inspect retained conversation and project changes before starting a new operation after uncertainty. Do not delete locks, replay old operations or clear another instance's state. Native history and PostgreSQL metadata persist outside the release. Reopening a completed conversation can continue its native thread; a server crash is not equivalent to a browser disconnect.

Managed worktrees/copies, file-editor tools, standalone terminals, schedules, managed previews, API tokens and explicit uncertain-work recovery are unavailable in this profile. Personal attached previews use the configured separate-origin gateway. Conversation tools remain the file-editing path. Account settings explain SSH onboarding and show native readiness.

No automatic update/rollback or verified off-host backup is promised by this installer. Preserve PostgreSQL and private native state before migrations; an older release must not open incompatible state. P009's separate managed restore gates remain open. Keep SSH administration available independently of Harbor.

## Verification

`python3 -m unittest discover -s tests/deployment -p '*_test.py'` exercises renderer/installer contracts. `python3 tests/personal-vps/native-boundary.py --binary /absolute/path/to/pinned/codex` uses an owned nonroot systemd instance and disposable files to check actual native write restrictions without credentials or model requests. It needs administrator capabilities and cleans only its own resources. The exact results and outstanding browser/account/deployment gates belong in P015's report; a successful render or contract suite is not deployment acceptance.

A failed fresh installation may leave owned provisioning paths for inspection. The installer refuses to overwrite them on retry; inspect its exact instance paths and complete explicit administrator recovery rather than deleting or adopting unknown state. Releases and project roots under `/tmp` or `/var/tmp` are refused at installation.

The [candidate verification report](../reports/2026-09-13-personal-vps-candidate.md) records passing focused browser, critical and actual nonroot systemd/native checks, three review rounds, package identity and the remaining public installed/subscription gates. `node --import tsx tests/personal-vps/e2e.ts` is the implemented trusted Linux administrator lane for deterministic browser acceptance; it creates and removes an owned service account, private PostgreSQL, copied candidate and loopback TLS fixtures. It uses no real account credentials.

The `/root` authorization is covered by renderer/admission contracts and the exact-root browser/runtime behavior. Installed ACLs and the owner account/development loop were verified in the 13–14 September reports. Candidate tests remain confined to their owned fixtures and independent runtime state.

## Obtain a Google owner subject

When the intended Google account is known by email but its subject is not, the trusted administrator can use `node --import tsx infra/personal-vps/enroll-owner.ts /private/enrollment-config.json`. This separate temporary helper never starts Harbor or grants project access. Run a reviewed immutable copy as a dedicated nonroot account with no project ACLs; use `Restart=no`, a one-hour service lifetime limit, a private writable state directory and a loopback reverse-proxy route with a verified certificate. Keep proxy access logging disabled for the private start URL and OAuth callback.

The strict configuration contains `origin`, literal `issuer: "https://accounts.google.com"`, `expectedEmail`, `clientFile` (downloaded Google web-client JSON), `resultFile`, `startTokenFile`, `port`, and optional `ttlSeconds` (60–3600, default 1800). Input files must be canonical regular files with no access for others or group-write permission. Output files must not already exist; their parent must be canonical, private and owned by the service user. Keep all these paths outside editable roots. Systemd `LoadCredential` can provide root-private configuration/client JSON to the service without granting access to their source directory.

The helper writes a private start URL to `startTokenFile`. Give that URL only to the owner, who selects the configured Google account. It verifies Google issuer/signature and state/nonce/PKCE/browser binding, plus exact email and `email_verified`. Success stores only issuer, subject and email in the create-only 0600 `resultFile`, then gracefully stops and removes the start URL. Expiry also stops the helper. Existing output on restart requires administrator inspection, not automatic overwrite.

After successful enrollment, configure Harbor's exact owner subject from the private result, stop the temporary routing/service and hand the hostname to the ordinary authenticated API. Email is only an enrollment admission check. Do not weaken ordinary issuer/subject authentication or use enrollment to issue an application session. `node --import tsx --test tests/integration/personal-vps-enrollment.test.ts` exercises the actual helper with an external OIDC fixture; public Google interaction remains a separate gate.

## Reuse an explicitly authorized existing Codex login

For the owner's later reuse request, an administrator can copy only a verified ChatGPT-mode `auth.json` into the stopped instance's empty private Codex home. Keep the original unchanged, set the destination to service ownership and 0600, and refuse an existing destination. Do not copy history or config, link homes, or display credentials. This is a trusted administrator operation, not a browser credential-upload feature or an automatic installer behavior. Verify the pinned runtime reads the imported account, then exercise a bounded subscription turn before claiming success. Separate homes may refresh the imported credentials independently; continued concurrent refresh compatibility is not established by the copy. If reuse fails, complete device authentication for the separate home.

## Current owner installation

On 21 September 2026, the installed P018/P024 release is `/opt/harbor-personal/releases/p024-sendfix-311f750a18bb`, source commit `311f750a18bb8bc400ddfc497b82b0f5de6e9e25`, manifest SHA256 `0ad775d55a52d75cb7e95fd0bb475d3202d86f90df8a70ac9c3d61e259382795`. The [installed correction record](../reports/2026-09-21-p024-installed-attachment-fix.md#final-deployment-and-installed-acceptance) identifies its immutable package, all-zero drain, matched checkpoint, unchanged 18 migrations, service/account/HTTPS policy and usable conversation composer. Its immediate predecessor is `p024-sendfix-c7f2d26a552b`. The [initial P018/P024 release](../reports/2026-09-21-p018-concurrency.md#committed-release-and-vps-delivery), `p018-p024-817c3d097166`, introduced migrations 019/020; its attachment claim was subsequently corrected. Retained releases require deliberate compatibility and matched-state assessment before rollback; never restore over newer work without assessing it.

The owner's instance is running at `https://harbor.seekworld.tech/auth/login`; use this as the sign-in/bookmark URL. The current API returns JSON401 for signed-out requests to `/`, so the bare domain is not a logged-out sign-in page. After Google authentication, the callback opens the application at `/`. The supervisor reports the reused ChatGPT subscription as authenticated. Instance units are `harbor-personal-seekworld-{dependencies,api,supervisor}.service` and are enabled at boot. Browser/SSH closure does not control these systemd services.

Browse `/root`, and add an existing project under `/root/Projects`; this deployment grants the dedicated account rwX and inherited directory ACLs under that parent. `/root` itself has only read/traverse access, and `.ssh` remains unchanged. New private files created with restrictive explicit modes can still deny access; browser selection never changes Unix permissions. Installed live owner authentication, edit/reconnect and development acceptance are recorded in the [current report](../reports/2026-09-14-personal-development.md); the [P015 issue](../../issues/2026-09-13-130622-personal-vps-acceptance.md) retains the remaining verification gates. Service health alone is not that evidence.

This instance also uses reviewed `20-project-writes.conf` drop-ins for both API/supervisor. They reset `ReadWritePaths` to the three private state subdirectories and exact `/root/Projects`, while retaining `ProtectHome=read-only`. The initial broad `/root` allowance left the project submount read-only on this host. Browse roots do not alone establish writable mounts: validate actual service-namespace and native writes after any path change. Keep the drop-ins with the installation configuration and backup; do not remove them during an update.

The 14 September historical release was `/opt/harbor-personal/releases/markdown-4f085c8fef26`, promoted then for the [scoped Markdown rendering fix](../reports/2026-09-14-markdown-rendering.md) with no migration or runtime-policy change. Its predecessor `/opt/harbor-personal/releases/development-13204d7` introduced migrations 017/018 and the development toolchain earlier that day. The earlier `/opt/harbor-personal/releases/full-runtime-01534-20260913` was the 13 September native-package correction; its evidence remains historical. Earlier entrypoint-only archives omitted required native companions and must not be redeployed. The complete-runtime report records the corrected archive and successful actual model tool read/write/resume checks before and after promotion. The installer in the corrected immutable release enforces the complete package contract. Preserve the site writable-path drop-ins during updates.

## Development policy and upgrade compatibility

[D012](../../design/decisions/012-personal-vps-development.md) specifies the personal development grants. Only this VPS profile enables development network access and private temporary/cache writes; local and managed profiles retain their policies. Existing canonical `.git` directories receive an explicit native write grant. Linked or external metadata and `commondir` references are rejected. New `git init` inside a turn is not supported. The launcher resets Git trust to the exact selected project and supplies per-project XDG/npm/pnpm paths without inheriting root's shell or Git configuration.

[D014](../../design/decisions/014-personal-conversation-concurrency.md) permits independent conversations in the same registered directory, with one active turn per conversation. Migration 019 records per-session/generation runtime membership independently from managed exclusive writer fields. Successful turns can retain a runtime for continuation. Ordinary idle resources are reclaimed oldest execution activity first when capacity is needed, or after a 30-minute maximum retention target. Background commands, preview processes and unknown inspection have no automatic expiry. Viewing or polling does not refresh execution activity.

`maxActiveTurns` and `maxConversationRuntimes` render `HARBOR_MAX_ACTIVE_TURNS` and `HARBOR_MAX_CONVERSATION_RUNTIMES` into both services. Defaults are four each. Startup, active, approval/input waiting, idle, protected, retiring and unknown generations consume the runtime budget. Lowering limits stops excess admission without killing accepted work. Targeted stop and graceful shutdown release only the exact member after confirmed owned-process absence. A failed stop or ambiguous restart remains counted and visible; unrelated conversations can use remaining confirmed capacity. Never clear membership simply because the browser disconnected.

Before migration 019 promotion, stop admission, drain work, retire all retained runtimes and confirm that no legacy exclusive conversation reservation remains. Preserve a matching database/native/home/control/config checkpoint and site drop-ins. Older binaries must not open the upgraded database. Rollback requires that matched checkpoint or forward repair, with explicit assessment of work accepted after the backup. The private candidate and live/native verification evidence is recorded in the [P018 report](../reports/2026-09-21-p018-concurrency.md); incomplete gates remain explicit there.

Migrations 017 and 018 add title provenance/backfill and retained-process state. New command diagnostics introduce the `tool` message role. Back up the database and native state before promotion; use the matching pre-upgrade database/native/config checkpoint when reverting to older binaries, since older clients do not implement the new output and lifecycle contract. Do not roll back over new accepted work without assessing the lost state.

The owner's configured preview origin is `https://harbor-preview-187-77-140-226.sslip.io`, routed by existing Traefik to loopback gateway 3350 and then the declared application endpoint 3100. This DNS name is a deployment choice, not a portable application default. The primary domain has no configured preview subdomain; use verified TLS for the separate preview origin. No Harbor authentication cookie or authorization header reaches the development app.

P024 adds authenticated image/general-file attachments backed by private instance state outside project and development-cache write grants. See [attachment storage and verification](attachments.md). The [installed correction](../reports/2026-09-21-p024-installed-attachment-fix.md#final-deployment-and-installed-acceptance) passed hardened Linux, actual-model image/file delivery, independent reviews and installed acceptance. Confirmed retirement also repairs eligible stale conversation state without replaying input. The separately recorded [normal-stop retention cause](../../issues/2026-09-21-174500-personal-stop-retained-runtimes.md) remains unresolved. P018's native ownership probes invalidated group-only retirement for ordinary detached commands. Linux now requires a cgroup-v2 subtree delegated only to the supervisor, with fixed generation leaves and confirmed empty state before capacity release. The owner selected VPS-only release support; native macOS lifecycle completion is not planned for this release and no group-only absence is claimed.
