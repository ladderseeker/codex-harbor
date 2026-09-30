# P037 — Fresh VPS install guide for agents

## Metadata

- ID: P037
- Status: Accepted
- Priority: Not set by the owner. The owner asked for this on 30 September 2026, to follow the disk fix.
- Created: 2026-09-30
- Owner: Main conversation. A fresh-context implementer does the implementation in a separate checkout.
- Outcome: An agent running on the owner's computer, with an inexpensive model, can install Harbor's personal profile on the emptied VPS from `main` by following one guide. It stops at defined points for the owner, checks every step, and ends with a verified instance that the GitHub Actions workflow can update.
- Authorization: On 30 September 2026 the owner reported that they had uninstalled everything from the VPS. They asked for a clear deployment document, written after the disk fix, that a local agent running an inexpensive model could follow. Tracked records paraphrase that message, as the [workflow](../workflow.md#evidence-and-provenance) requires. This plan writes the guide and a first-release command. It changes no host: the owner, or an agent the owner runs, follows the guide on the VPS.
- Dependencies:
  - P035 reached `main` at `8cfa82f` on 30 September 2026, so a first install gets the bounded disk use. Satisfied.
  - P036, which changes `AGENTS.md` and the delivery rules. Execution waits until P036 is on `main`, because this plan also edits `AGENTS.md`. P036 reached `main` at `faa16ab` on 30 September 2026. Satisfied.
  - The VPS itself. The guide's run on the host cannot happen in a cloud session, so it blocks completion, not execution; see [Verification and acceptance](#verification-and-acceptance).
- Baseline: the implementer starts at the commit that accepts this plan, on top of `faa16ab`.
- Source issues: None. Related: the [personal VPS acceptance issue](../../issues/2026-09-13-130622-personal-vps-acceptance.md), whose gates a first install exercises again, and the [reconfiguration issue](../../issues/2026-09-26-074653-personal-vps-reconfiguration.md), which explains why every configuration value must be right before `render`.
- Design references:
  - [deployment and profiles](../systems/004-deployment-and-profiles.md);
  - [D011](../decisions/011-personal-vps-workspace.md) and [D012](../decisions/012-personal-vps-development.md);
  - the [personal VPS guide](../../docs/developer/personal-vps.md) and the [GitHub Actions deployment guide](../../docs/developer/github-actions-deploy.md);
  - [P035](035-bounded-disk-use.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P037-01 to P037-07.

## Problem, outcome and exclusions

The VPS is empty. Before 30 September it ran the owner's instance, installed by hand over several days. The [personal VPS guide](../../docs/developer/personal-vps.md) is reference prose for an administrator. It leaves out steps that this host needed, such as the project ACLs, the writable-path drop-ins, the enrollment service and its route, and the reverse proxy. Several values were never recorded. Building the first release has no tool: `deploy-release build` takes Node, pnpm and Codex from an installed release, so it can only update an existing instance. An agent with an inexpensive model needs exact commands, a check after each step and clear places to stop.

Main researched the open questions on 30 September 2026. This plan restates every fact it relies on, with its source.

After this change:

1. **A first-release command.** `deploy-release bootstrap --bundle PATH --revision SHA` builds and stages the first release without an installed instance. It downloads the pinned Node, Codex and pnpm packages and checks them against SHA-256 values pinned in the script. It then runs the same transient, unprivileged build and the same staging and manifest check as `build`.
2. **A guide for agents.** `docs/developer/fresh-vps-install.md` takes an emptied Ubuntu 24.04 VPS to a running, verified instance. Each step says where it runs, what it does, the exact commands, what to expect and when to stop. The owner's steps are marked. The guide covers:
   - checking the host;
   - host packages;
   - the reverse proxy;
   - DNS;
   - the first release;
   - the service account and project ACLs;
   - the Google client;
   - owner enrollment;
   - the configuration;
   - installing;
   - the drop-ins;
   - the Codex login;
   - starting;
   - verifying;
   - GitHub Actions deploys;
   - cleaning up.
3. **Aligned documents.** The personal VPS guide, the GitHub Actions guide, the documentation index, `AGENTS.md` and the deployment design point to the new guide. The design allows installing a pinned Traefik on a host that has none.

Excluded:

- running the guide on the VPS, which the owner does or has an agent do;
- changes to the installer (`harbor-personal`), the packager, the enrollment helper, the application or the deploy workflow;
- uninstall, reconfiguration and off-host backup tools, which existing issues track;
- scripts that set up the host, beyond the first-release command;
- a GitHub Actions path for first installs.

## Dependencies and current design

### What the tools already do

- **`harbor-personal`** (`infra/personal-vps/harbor-personal`) validates a configuration, renders a private bundle and installs a fresh instance without starting it. `login` runs `codex login --device-auth` as the service account. `install` refuses:
  - existing instance paths;
  - a release or ancestor that is not root-owned, or that is group- or world-writable;
  - a service account with supplementary groups or a login shell;
  - a browse root that the service account cannot read and traverse;
  - missing host tools: `git`, `python3`, `make` or `g++`.
- **`package-release.py`** builds a release from built source, the Node binary, the Codex vendor directory and the two pnpm packages. It checks the pinned versions.
- **`deploy-release build`** reconstructs those inputs from the installed release, builds in a transient `DynamicUser` unit, stages the result under `/opt/harbor-personal/releases/.staging-NAME`, sets root ownership, verifies it against its manifest and renames it into place.
- **`enroll-owner.ts`** runs as a nonroot Linux service. It reads a private configuration and Google client file, listens on `127.0.0.1:PORT`, writes a private start URL and, after the owner signs in, writes the owner's issuer, subject and email to a private result file.

### Pinned downloads

Main downloaded each file on 30 September 2026. Each SHA-256 below matches the npm registry's SHA-512 integrity value or the official checksum list. Each also matches an earlier record where one exists.

| Input | URL | SHA-256 | Earlier record |
| --- | --- | --- | --- |
| Node 24.11.1 | `https://nodejs.org/dist/v24.11.1/node-v24.11.1-linux-x64.tar.xz` | `60e3b0a8500819514aca603487c254298cd776de0698d3cd08f11dba5b8289a8` | the P036 session hook |
| Codex 0.153.4 for Linux x64 | `https://registry.npmjs.org/@openai/codex/-/codex-0.153.4-linux-x64.tgz` | `54818cb9fce3360cc6e44cfc5a96952cd5c1243efb43cbe488e11dda84663e08` | the [candidate report](../../docs/reports/2026-09-13-personal-vps-candidate.md) |
| pnpm 12.3.4 | `https://registry.npmjs.org/pnpm/-/pnpm-12.3.4.tgz` | `08a3d2d539b377a6b7ea2469b612672255ca71c30a62698530582cb9d35c268f` | the [development report](../../docs/reports/2026-09-14-personal-development.md) |
| pnpm 12.3.4 Linux executable | `https://registry.npmjs.org/@pnpm/exe.linux-x64/-/exe.linux-x64-12.3.4.tgz` | `9b1c95fc413600ca75a51ebe8332d7019dc3568fd4187f5a5f2df4a156efb65c` | the same report |

### Facts the guide relies on

These were checked on 30 September 2026:

- **Models.** Without a login, the pinned Codex lists its compiled-in catalog. `codex debug models --bundled` returns six listed IDs: `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` and `gpt-5.2`. After sign-in, the account's server list replaces it and may differ. The API shows only IDs that are both configured and discovered (`apps/api/src/server.ts`), so an extra configured ID stays hidden, while a missing one cannot be used. Reconfiguration is unsupported, so the guide configures the bundled list.
- **Drop-ins.** The previous `20-project-writes.conf` files had SHA-256 `f4cc28a6d4a95d94026bd3e35ae7325bb1856384127de9488339abb2a205871d`. Research found exactly one text with that hash. It is three lines and 185 bytes, with one trailing newline:
  - `[Service]`;
  - an empty `ReadWritePaths=`;
  - one `ReadWritePaths=` line listing the three state directories and `/root/Projects`.
- **Traefik.** The installer's routing carrier needs a host-network Traefik with the Docker provider, a `websecure` entrypoint and a `letsencrypt` resolver.
  - `traefik:v3.7.13` has index digest `sha256:24841fe2de7304c149343d877d2923b4c8800a38ba015dea9174c23b20e344a0`. It was released on 4 September 2026.
  - Traefik 3.6.1 or later negotiates the Docker API version, which Docker 29 needs.
  - A service built from the [Traefik reference](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/) parsed its flags, redirected port 80 and opened no dashboard port, in a loopback test with no Docker daemon.
- **Docker.** Ubuntu 24.04's `noble-updates` has `docker.io` 29.1.3 and `docker-compose-v2` 2.40.3. Both put the Compose plugin where `/usr/bin/docker compose` finds it. `docker.io` only suggests Compose, so the guide installs both packages. Docker's own repository ships `docker-ce` 29.8.1 with Compose 5.5.1; its `docker-ce`, `docker-ce-cli` and `containerd.io` packages conflict with Ubuntu's, and both Compose packages ship the same plugin file, so installing Ubuntu's packages on such a host removes Docker's and fails. P037's design reviewer found this in the package indexes on 30 September 2026.
- **Google.** Since November 2025, [Google shows a client secret only once](https://support.google.com/cloud/answer/15549257). A lost secret is replaced with **Add Secret**, and a client has at most two. Redirect URIs must match exactly. Harbor requests only `openid`, and enrollment only `openid email`. [Google exempts](https://support.google.com/cloud/answer/15549945) those scopes from the Testing status's test-user list.
- **Codex login.** Device code login is in beta. It must be enabled in ChatGPT's security settings for a personal account, or by a workspace admin in the workspace's permissions for a workspace account ([Codex authentication](https://learn.chatgpt.com/docs/auth)). The pinned Codex 0.153.4 binary says that the code expires in 15 minutes. That page and Codex's configuration reference name no default credential store. The guide infers that the default is a file, so that `harbor-personal login`, which chooses no store, writes `codex-home/auth.json`, and step 12 stops if that file is missing or empty.
- **Enrollment texts.** The earlier enrollment unit and its temporary route were never recorded; only prose describes them. This plan specifies both.

### Settled decisions

The owner can change any of these before running the guide. The guide lists them in its values table.

1. **Values.** Keep the previous installation's values:
   - instance `seekworld` at `https://harbor.seekworld.tech`;
   - service account `harbor-personal`;
   - API port 3348 and database port 5548;
   - one browse root, named `VPS root`, at `/root`, with writes under `/root/Projects`;
   - one preview, named `Development app`, from application port 3100 at `https://harbor-preview-187-77-140-226.sslip.io` through gateway port 3350;
   - Traefik routing and the AppArmor user-namespace profile on;
   - the default capacity limits.

   Sources: the personal VPS guide's installation history and the [candidate report](../../docs/reports/2026-09-13-personal-vps-candidate.md). The names of the browse root and the preview were not recorded; `VPS root` and `Development app` are new.
2. **Reverse proxy.** Keep a running Traefik. Otherwise install the pinned Traefik above under `/opt/traefik`, with the HTTP-01 challenge and persisted ACME storage. The deployment design currently says the host's Traefik must be preserved. This plan changes that sentence: an existing Traefik is preserved, and a host without one gets the pinned one.
3. **Docker.** On a host without Docker or with Ubuntu's `docker.io`, use Ubuntu's `docker.io` and `docker-compose-v2` packages, which need no extra package source. Keep a Docker Engine installed from Docker's own repository (`docker-ce`, `docker-ce-cli`, `containerd.io` and `docker-compose-plugin`), because Ubuntu's packages conflict with it: installing them would remove it and stop its containers. It must pass the same version checks. Stop for the owner on any other Docker installation, such as a snap or an incomplete set of packages. Main amended this decision after review round 1.
4. **First release.** Build it with `deploy-release bootstrap` from a Git bundle of the `origin/main` revision from which the agent saved the guide, made on the owner's computer and uploaded like the workflow's bundle. Main amended this decision after review round 1.
5. **Owner subject.** Run the existing enrollment helper from the new release, as a temporary system service with a temporary Traefik route. Remove both after enrollment.
6. **Codex login.** Use device login through `harbor-personal login`. It runs in a transient unit, so that the agent can read the code, pass it to the owner and wait. Reusing another Codex login is not part of the guide.
7. **Models.** Configure the bundled list from the release's own Codex. After login and before the first start, the guide compares it with the signed-in list and stops if a signed-in ID is missing.
8. **ACLs.** Use the owner's earlier choice:
   - `r-x` for the service account on `/root` itself;
   - `rwX`, with default ACLs, under `/root/Projects`;
   - `/root/.ssh` unchanged;
   - a backup first.

   Automatic approval once refused a broad ACL change until the owner confirmed its scope, so the guide shows the exact commands and waits for the owner's yes.
9. **Private paths.** All of these are outside `/root`:
   - `/var/lib/harbor-install`, root-only, for the install's work, its records and a scratch home;
   - `/etc/harbor-personal-oidc/seekworld.secret` for the client secret, which render reads and which `install`, every deploy and `preflight` read again;
   - `/etc/harbor-personal-onboarding`, holding `enrollment.json` and `google-client.json`, for the enrollment inputs;
   - `/var/lib/harbor-personal-onboarding`, created by the enrollment service, for its state.

   No file named `config.json` goes in any `/etc/harbor-personal-*` directory except the instance's own. `deploy-release` counts each such file as an installed instance, so a stray one would make `bootstrap` refuse, and `prune` would take the host for one with several instances and refuse.

   The source bundle goes under `/var/lib/harbor-deploy/incoming/`, which is readable by all local accounts, because the unprivileged build must read it. The workflow already does the same.

## Source issues

None. The related issues keep their owners and scope.

## User and API flows

No browser page or public API changes. The guide ends with the owner's own checks in the browser:
- sign in at `/auth/login`;
- add a project under `/root/Projects` with workspace-write;
- run a conversation that reads a canary file and edits a file in place.

The personal VPS guide already requires that conversation, because a version check or model list does not prove that tools work.

## Contracts, state and security

### `deploy-release bootstrap`

- **Arguments:** `--bundle` and `--revision`, as `build` takes them. It takes no `--instance`.
- **Refusals.** Before it writes anything, it refuses:
  - a caller that is not root;
  - a machine that is not Linux x86_64;
  - a revision that is not a full 40-character SHA;
  - any configured instance, found as `configured_instances()` finds them, telling the caller to use `build`;
  - an existing `.staging-bootstrap-<rev12>`;
  - too little free space on a filesystem it writes to.

  An existing `bootstrap-<rev12>` release is verified against the revision and reused, as `build` reuses a release.
- **Space check.** The check uses `build_locations()` and a fixed need: four times the size of the release built during verification, rounded up to a whole GiB, plus the usual reserve.
- **Downloads.**
  - Each pinned file is downloaded over HTTPS, with certificate checks, into the run's input directory under `/var/lib/harbor-deploy/inputs/`.
  - Each download is checked against its pinned SHA-256 before anything reads it.
  - A mismatch refuses with the file's name and deletes the run's inputs.
  - The URLs and hashes are constants in the script, named per input. Tests may replace them.
- **Extraction.**
  - Archives are read with Python's `tarfile` and its `data` filter, which refuses absolute paths, parent-directory escapes and links that leave the destination.
  - Only these members are used:
    - Node's `bin/node`;
    - Codex's `package/vendor/x86_64-unknown-linux-musl/` tree, with its links;
    - pnpm's `package/` tree;
    - the executable package's `package/pnpm`.
  - The result has the layout that `native_inputs` produces:
    - `node` and `bin/node`;
    - `vendor/`;
    - `pnpm/`;
    - `pnpm-native`;
    - a `bin/pnpm` wrapper;
    - the same modes.
  - `validate_native_distribution(vendor, require_root=False)` passes on `vendor/` before the build starts.
- **Build and staging.** `build` and `bootstrap` share one function that runs the transient build unit, stages the package, sets root ownership, verifies it against its manifest and renames it into place. It removes its inputs and build state on every exit, as `build` does now. The unit keeps `build`'s properties. `bootstrap`'s unit is `harbor-deploy-build-bootstrap-<rev12>`, and `build`'s keeps its name. The release is `bootstrap-<rev12>`.
- **Output.** One JSON line, as `build` prints: `release`, `revision`, `archiveSha256`, `fileCount`, `manifestSha256` and `reused`.
- **Unchanged.** `build`, `promote`, `preflight` and `prune` behave as before. Prune already treats a `bootstrap-*` release like any other: it keeps the installed release.

### The guide

- **Where commands run.** Every host command runs as root through the owner's `harbor-vps` SSH alias, as a quoted here-document to `bash -euo pipefail -s`, so that nothing expands locally. Commands for the owner's computer run in the owner's clone and never change its branch, index or working tree.
- **Which scripts run.** `bootstrap` runs from a `tools` clone of the uploaded bundle, as the workflow runs `deploy-release`. Every later `harbor-personal` and `deploy-release` command runs from the new release, whose files its manifest covers.
- **Homes.** Every command that may start Codex runs with `HOME` set to a root-only scratch home under `/var/lib/harbor-install`, which the step removes afterwards. That includes `install`, because it runs the release's `codex --version` with the caller's environment, and Codex may write into its home. The model listings also set `CODEX_HOME` and turn the plugins feature off, as Harbor's runtimes do. The exception is `deploy-release`'s release check, which sets `HOME=/nonexistent` itself and so leaves root-owned directories there; the guide names it, and the [release check issue](../../issues/2026-09-30-103816-release-check-home.md) tracks it.
- **Long steps.** The first-release build and the Codex login run as transient systemd units that write to a log under `/var/lib/harbor-install`. A dropped SSH connection therefore does not stop them. The agent polls with a bounded loop that prints a line at least once a minute. SSH keepalives end a dead connection, and the agent then runs the same block again.
- **Secrets.** The guide lists the files that hold secrets:
  - the Google client file and the secret file;
  - the rendered bundle;
  - `service.env` and `database.password`;
  - `codex-home/auth.json`;
  - the enrollment start URL;
  - the Codex login's log, which holds the device code until the step removes it;
  - SSH private keys.

  No command prints their contents. The agent copies the Google client file from the owner's computer to the host with `scp` and never displays it. The start URL and the device code go only to the owner.
- **Stop rules.** The agent stops and reports the step, the command and its output, with secrets removed, when:
  - any command exits nonzero;
  - an Expect line does not match;
  - a check fails;
  - the host differs from what the guide describes.

  A block that checks for an expected refusal, such as a denied write, exits 0 only when the refusal happened, so a nonzero exit always means stop. The agent never improvises a command that changes the host, never deletes a path the guide does not name, never changes a pinned version, hash or value to get past a failure, and never edits or commits to the repository.
- **Resuming.** The host keeps `/var/lib/harbor-install/progress`, with one line for each finished step. After an interruption, the agent reads it and continues at the first unfinished step, whose read-only check says whether that step was partly done. `install` and the enrollment are not repeatable, so for them the guide says what a partial result looks like and to stop for the owner.
- **Records.** The agent keeps a step-by-step log with no secrets outside the repository on the owner's computer. At the end, the host keeps a root-only record in `/var/lib/harbor-install/record.json` with the release, revision, manifest SHA-256, image digests and date.
- **Enrollment service.** The temporary unit `harbor-personal-enroll.service` runs `bin/node --import tsx infra/personal-vps/enroll-owner.ts %d/enrollment.json` from the release directory, as a dedicated `harbor-enroll` system account. It has:
  - `LoadCredential=` for `enrollment.json` and `google-client.json`. systemd gives the service read access to root-owned copies, which pass the helper's file checks;
  - `StateDirectory=harbor-personal-onboarding` with mode `0700`;
  - `Restart=no` and `RuntimeMaxSec=3600`;
  - `UMask=0077`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, `PrivateDevices=yes`, `ProtectSystem=strict` and `ProtectHome=yes`;
  - `ProtectKernelTunables=yes`, `ProtectKernelModules=yes` and `ProtectControlGroups=yes`.

  The configuration names the client file under `/run/credentials/harbor-personal-enroll.service/`, the result and start-URL files under `/var/lib/harbor-personal-onboarding/`, port 3347 and a TTL of 1800 seconds.
- **Enrollment route.** The temporary route copies the installer's routing carrier: the pinned PostgreSQL image running `sleep` as user 65534, host networking, read-only, all capabilities dropped, `no-new-privileges` and the same limits. Its Compose project is `harbor-enroll-seekworld`, and its router, for the same host with service port 3347, is `harbor-enroll-seekworld`. It is removed before the instance's own carrier starts, so only one route owns the host at a time.
- **Traefik.** The service is the tested one:
  - host networking and `no-new-privileges`;
  - `web` on :80 redirecting to `websecure` on :443;
  - the Docker provider with `exposedbydefault=false` and the socket mounted read-only;
  - the `letsencrypt` resolver with HTTP-01 and storage in `/opt/traefik/letsencrypt`;
  - no API, dashboard or access log;
  - bounded logs.

  The guide says that a read-only socket mount does not limit what Traefik can do through the Docker API, so Traefik stays trusted with host-level power, as the personal VPS guide already assumes. Leaving the access log off keeps the start URL and the callback out of proxy logs.
- **Unchanged.** Authentication, sandbox and isolation rules. The guide never disables the AppArmor user-namespace restriction globally or weakens the generated units.

## Guide specification

`docs/developer/fresh-vps-install.md` has these sections in this order.

1. **Who this is for.** The guide is for an agent on the owner's computer with the `harbor-vps` alias, and for the owner supervising it. It installs the revision of `origin/main` from which the agent saved the guide, so that its commands match the scripts. Main changed this after review round 1: step 5 builds the saved revision, not a later `origin/main`. After review round 2, the block that saves the guide also refuses to run a second time.
2. **Rules for the agent.** The stop rules, secrets list, homes, resuming rule and records from the contract above, as a short numbered list. Every step also has the same parts:
   - **Where:** your computer, the VPS or the owner;
   - **Check:** read-only; it says whether the step is already done;
   - **Run:** the change;
   - **Expect:** the exact lines or conditions;
   - **If not:** stop and report, unless the step names a fix.
3. **What the owner prepares.** A checklist the owner completes before or during the run, each with where to do it:
   - the values in the table, or changes to them;
   - a VPS running Ubuntu 24.04 with no Docker, Ubuntu's `docker.io` packages, or Docker's own Docker Engine packages;
   - a DNS A record for the host pointing at the VPS;
   - the hosting firewall allowing TCP 22, 80 and 443;
   - an email address for Let's Encrypt;
   - the Google web client with the exact redirect URI, and its client JSON saved on the owner's computer. A lost secret is replaced with Add Secret. A new client is created only if none exists;
   - the Google account email to enroll;
   - device code login enabled, in ChatGPT's security settings for a personal account or by a workspace admin for a workspace account;
   - time to approve the device code and to open the enrollment link, each within its expiry.
4. **Values.** One table: the name, value and source of every value used later. Each host step reads them from `/var/lib/harbor-install/values.env`, which step 1 writes. The file holds no secrets. A block on the owner's computer copies the file and reads each value that it needs from that value's one `KEY='value'` line, checked against a pattern, and never sources the file.
5. **Steps.** In this order:
   1. **Check the host.**
      - Run the SSH check from `AGENTS.md`. The checks in this step are read-only.
      - Report: OS, kernel, architecture, cgroup v2, systemd, the AppArmor user-namespace restriction, Docker and Compose versions, the installed Docker packages and the packages that supply `docker` and `dockerd`, running containers, listeners on ports 80, 443, 3347, 3348, 3350 and 5548, free disk space, `ufw` status and whether `/root/Projects` exists.
      - Also report leftovers:
        - the `harbor-personal` and `harbor-enroll` accounts;
        - `/etc/harbor-personal-*`, `/var/lib/harbor-personal-*`, `/opt/harbor-personal` and `/var/lib/harbor-deploy`;
        - `harbor-personal-*` units and drop-ins;
        - AppArmor profiles;
        - Harbor containers;
        - ACL entries on `/root` and under `/root/Projects`.
      - Stop if the host is not Ubuntu 24.04 on x86_64 with systemd and cgroup v2, or if Docker is installed other than as Ubuntu's `docker.io` or Docker's own Docker Engine packages, as decision 3 describes. Stop if any leftover exists and no progress file does; leftovers are the owner's decision.
      - Then create `/var/lib/harbor-install` with mode `0700`, and write `values.env` and the progress file.
   2. **DNS (your computer).** Both hosts resolve to the VPS address and have no AAAA record. Otherwise stop for the owner.
   3. **Host packages.** Install `git`, `python3`, `make`, `g++`, `acl`, `curl` and `ca-certificates`. On a host without Docker or with Ubuntu's `docker.io`, also install `docker.io` and `docker-compose-v2`; keep Docker's own packages; stop for any other Docker. Enable Docker. Expect Docker 29 or later, Compose 2.40 or later, and `apparmor_parser`.
   4. **Reverse proxy.**
      - If a Traefik container runs, keep it. Its route is proved in step 8.
      - If something else listens on 80 or 443, stop.
      - If no Traefik runs and `/opt/traefik` exists, start that Traefik again only when its `compose.yaml` is exactly the file that the guide writes; otherwise stop for the owner.
      - Otherwise:
        - write `/opt/traefik/compose.yaml` with the pinned image and the owner's email;
        - create the ACME directory with mode `0700`;
        - start Traefik;
        - expect listeners on 80 and 443, and, from your computer, an HTTP request to the host that redirects to HTTPS.
      - If `ufw` is active without rules for 80 and 443, stop for the owner.
   5. **First release.**
      - On your computer:
        - `git fetch origin main`;
        - check that the revision saved with the guide is `origin/main` or its ancestor;
        - make a bundle of that revision in a temporary directory outside the repository;
        - upload it to `/var/lib/harbor-deploy/incoming/bootstrap/` and clone `tools` from it there, with the workflow's modes and commands, replacing an incomplete earlier upload unless the build unit exists;
        - record the revision in `values.env` once the clean `tools` checkout matches it.
      - On the host:
        - check that the upload is complete, then run `tools/infra/personal-vps/deploy-release bootstrap` in a transient unit that writes to a log under `/var/lib/harbor-install`;
        - poll until the unit ends;
        - expect the JSON line, and record the release path in `values.env`.
   6. **Service account.** `useradd --system --no-create-home --user-group --shell /usr/sbin/nologin harbor-personal`. Expect no supplementary groups.
   7. **Project folder and ACLs.**
      - Show the owner the exact commands, and wait for the owner's yes.
      - Create `/root/Projects` if it is missing, as `root:root` with mode `0700`.
      - Back up the ACLs of `/root` with `getfacl -R -p` into `/var/lib/harbor-install`.
      - Apply:
        - `setfacl -m u:harbor-personal:r-x /root`;
        - `setfacl -R -m u:harbor-personal:rwX /root/Projects`;
        - `find /root/Projects -type d -exec setfacl -m d:u:harbor-personal:rwX {} +`, because only directories take default ACLs.
      - Verify as the service account:
        - it can read and traverse `/root`;
        - a canary file can be created and removed under `/root/Projects`;
        - creating a file at the top of `/root` fails;
        - the ACLs of `/root/.ssh` and its contents match the backup.
      - The guide says how to restore the backup with `setfacl --restore`.
   8. **Google client and owner enrollment.**
      - Create `/etc/harbor-personal-onboarding` and `/etc/harbor-personal-oidc` with mode `0700`.
      - The owner names the client JSON on your computer. Copy it to `/etc/harbor-personal-onboarding/google-client.json` with `scp`, set mode `0600`, and check that it holds `web.client_id` and `web.client_secret` without printing them.
      - Write the client secret alone, as one line, to `/etc/harbor-personal-oidc/seekworld.secret` with mode `0600`, without printing it.
      - Pull `postgres:17.6-bookworm` and record its digest.
      - Create `harbor-enroll`, `enrollment.json`, the unit and the route. Start the route, then the service.
      - Poll for up to three minutes until an HTTPS request for `/enroll/invalid` returns the enrollment helper's own 404, with the body `Not found`, over a verified certificate. Traefik's own 404 does not count.
      - Give the start URL only to the owner, who signs in with the enrolled email. The helper stops 1800 seconds after its service starts, and each sign-in attempt lasts 10 minutes, so the owner opens the link within about 25 minutes and finishes signing in within 10 minutes of opening it.
      - Poll until the result file exists and the service has stopped. Expect the Google issuer and the enrolled email in the result.
      - Copy the result to `/var/lib/harbor-install/owner.json` with mode `0600`. Then remove the route, the unit, the `harbor-enroll` account, `/var/lib/harbor-personal-onboarding` and `/etc/harbor-personal-onboarding`. The secret file keeps the only other copy of the secret.
   9. **Configuration.**
      - List the bundled models with the release's Codex, in a scratch home that is removed afterwards.
      - Write `/var/lib/harbor-install/seekworld.json` with mode `0600`, using a short Python block. It reads:
        - `values.env`;
        - the release path;
        - the client ID;
        - the owner's subject from `owner.json`;
        - the image digest;
        - the model list;
        - a new UUID for the browse root.
      - Run `harbor-personal validate`. Expect its success line.
   10. **Render and install.** Render to `/var/lib/harbor-install/bundle`, then install. Expect each command's success line. After a failed install, stop: its paths are left for the owner.
   11. **Drop-ins.**
       - Write both files with the exact 185 bytes.
       - For instance `seekworld` with `/root/Projects`, stop unless both have SHA-256 `f4cc28a6…871d`. For other values, report their hashes.
       - Run `systemctl daemon-reload`.
       - Expect `systemctl show -p ReadWritePaths` to list the four paths.
   12. **Codex login.**
       - Run `harbor-personal login` in a transient unit that writes to a log.
       - Give the owner the URL and code within 15 minutes.
       - Poll until the unit ends. Expect a successful login line and a nonempty `auth.json`, never printed. Then remove the log, which holds the used code.
       - List the signed-in models as the service account, with the instance's homes. Stop if an ID there is missing from the configuration. Before the first start, the fix is a teardown and reinstall, which is the owner's decision.
       - List `codex-home/.tmp`. Remove only `plugins`, `plugins-clone-*` and `git-*` entries there, which the Codex login may leave and Harbor's runtimes never use, because they turn the plugins feature off. Report the home's size before and after.
   13. **Start.** Enable and start the three units. Expect all three active.
   14. **Verify.**
       - Public `/health` returns 200 with a verified certificate.
       - `/auth/login` redirects to Google with the exact callback.
       - An anonymous `/` returns 401.
       - The preview host returns 403 to an anonymous request, with a verified certificate.
       - Ports 3348, 3350 and 5548 listen on loopback only.
       - The API and supervisor run as the service account.
       - The effective unit properties include the drop-ins.
       - `deploy-release preflight --instance seekworld` passes.
       - Then the owner's browser checks from [User and API flows](#user-and-api-flows).
   15. **GitHub Actions deploys.**
       - Follow the [one-time setup](../../docs/developer/github-actions-deploy.md#one-time-setup).
       - If the host key changed with the reinstall, compare it with the owner's `known_hosts` before trusting it.
       - The owner stores the secrets and variables.
       - The agent may then run the read-only `preflight` workflow.
   16. **Clean up and record.**
       - Remove the rendered bundle, `/var/lib/harbor-deploy/incoming/bootstrap` and any scratch home left behind. Report the `/nonexistent` tree that the release check leaves, and keep it.
       - Keep the ACL backup, `owner.json`, the configuration, `values.env` and the progress file.
       - Write `record.json`.
       - Give the owner a summary to share in the project thread, so that this plan can record the first run.
6. **Recovery.** What to do when a step fails partway:
   - the enrollment link expired: start the enrollment service again, which writes a new link;
   - the device code expired: run the login unit again;
   - the build failed: when its process exits, `bootstrap` removes its staging directory, inputs and build state, or names a staging directory it could not remove, which is the owner's to inspect. A reboot or a killed process leaves the inputs and build state, which step 5's Check and step 16 list for the owner;
   - the install failed partway;
   - Let's Encrypt refused a certificate: read Traefik's log, fix the cause, and wait out its rate limits instead of retrying in a loop.

   Each says what state remains and that removing instance paths is the owner's decision.

Commands must match the scripts at the revision the guide ships with. Every shell block must be complete for its step and valid Bash.

## Implementation brief

Read first:
- this plan;
- `AGENTS.md`;
- the workflow's [execution brief](../workflow.md#mains-execution-brief) and [gate](../workflow.md#implementation-and-verification-gate) sections;
- the [implementer role](../../docs/developer/agents/implementer.md);
- the personal VPS and GitHub Actions guides;
- `infra/personal-vps/harbor-personal`, `deploy-release`, `package-release.py` and `enroll-owner.ts`;
- `tests/deployment/deploy_release_test.py`.

Work only in the checkout that main assigns. Do not commit.

1. Refactor `build` into the shared build-and-stage function, add `bootstrap` and its pinned inputs, and extend the tests. Existing tests must pass unchanged, except where they name the moved function.
2. Run the real input and packaging checks in [Verification and acceptance](#verification-and-acceptance) in scratch. Set the space constant from the measured release.
3. Write the guide, then the aligned edits below.
4. Run the gate, and report the changed paths, deviations, command results and evidence paths.

Aligned edits, applied verbatim:

- `docs/developer/personal-vps.md`: at the start of Prerequisites and package, add:

  ```markdown
  For a first installation on an empty host, follow the [fresh VPS install guide](fresh-vps-install.md), which covers every step below with checks.
  ```

- `docs/developer/github-actions-deploy.md`: after its first paragraph, add:

  ```markdown
  The workflow updates an installed instance only. A first installation follows the [fresh VPS install guide](fresh-vps-install.md), whose `deploy-release bootstrap` builds the first release.
  ```

- `docs/README.md`: after the Personal VPS setup line, add:

  ```markdown
  - [Fresh VPS installation](developer/fresh-vps-install.md): the step-by-step guide an agent follows to install the personal profile on an empty VPS.
  ```

- `AGENTS.md`: in VPS SSH handoff, in the bullet that begins "For diagnosis and deployment", replace "for this instance;" with the text below. Change nothing else.

  ```markdown
  for this instance; for a first installation on an empty host, follow the [fresh VPS install guide](docs/developer/fresh-vps-install.md);
  ```

- `design/systems/004-deployment-and-profiles.md`: replace "The current host's Traefik must be preserved." with:

  ```markdown
  An existing Traefik on the host must be preserved. A host without one gets the pinned Traefik that the [fresh VPS install guide](../../docs/developer/fresh-vps-install.md) installs, with the Docker provider, the `websecure` entrypoint and the `letsencrypt` resolver. `deploy-release bootstrap` builds the first release on an empty host from pinned downloads.
  ```

Return any needed change to these texts, or any path outside the fence, to main before depending on it.

## Exact file fence

- `infra/personal-vps/deploy-release`
- `tests/deployment/deploy_release_test.py`
- `docs/developer/fresh-vps-install.md` (new)
- `docs/developer/personal-vps.md`
- `docs/developer/github-actions-deploy.md`
- `docs/README.md`
- `AGENTS.md`
- `design/systems/004-deployment-and-profiles.md`
- `design/proposals/037-fresh-vps-install-guide.md` (main only)
- one new issue under `issues/` for the gates that cannot run here (main only)
- new issues under `issues/` for unrelated findings that the reviews raise (main only)

Run-owned scratch, which main creates and removes:

- the implementer's checkout, made with `git worktree add` under this session's scratch directory;
- a sibling `p037-run` directory for downloads, builds, homes and logs.

## Verification and acceptance

- **P037-01, command contract.** Unit tests cover:
  - every refusal, including an installed instance;
  - a pinned hash mismatch that deletes the inputs;
  - an archive member that escapes, which is refused;
  - the input layout built from small fake archives;
  - the shared build path's unit properties;
  - reuse of a verified release.

  `build`'s existing tests still pass.
- **P037-02, real inputs.** In the cloud container, `bootstrap`'s input step downloads the four pinned files, their hashes match, and the layout passes `validate_native_distribution`. `node`, `codex` and `pnpm` report v24.11.1, `codex-cli 0.153.4` and 12.3.4 from a run-owned home.
- **P037-03, real release.**
  - With those inputs, the build script runs on a bundle of the implementer's baseline commit, because implementers do not commit, with `sh` in place of the transient unit, which the container cannot start.
  - Its output is staged in a scratch release directory, set to root ownership and passes `verify_release`.
  - The release's Codex, run in a run-owned home, lists the six bundled IDs with the guide's command.
  - The guide's configuration block, pointed at that release and at scratch paths, passes `harbor-personal validate` and `render`. `install` needs systemd and is not run.
- **P037-04, guide checks.**
  - The headings and step parts match this plan.
  - Every Bash block passes `bash -n`.
  - Embedded JSON parses.
  - The Traefik and route Compose files pass `docker compose config`.
  - The drop-in block reproduces SHA-256 `f4cc28a6…871d`.
  - The enrollment unit passes `systemd-analyze verify` against the scratch release, or the report says why it could not run.
  - The commands match the scripts' arguments and outputs.
- **P037-05, alignment.** The five aligned edits read as specified. No current document still says that the host's Traefik must be preserved without the new alternative.
- **P037-06, gates.**
  - `pnpm build`, `pnpm check` and `pnpm test` pass.
  - `pnpm test:deployment:contract` passes, apart from the recorded capture-limit baseline failure.
  - `node scripts/check-docs.mjs` and `git diff --check` pass, with new files added as intent-to-add.
- **P037-07, the host.** The guide runs on the VPS to a verified instance, including the owner's browser checks. This gate cannot run in a cloud session. It is recorded as unverified with an issue, together with the transient-unit build and the Linux lanes that need Docker or systemd:
  - `pnpm test:e2e`;
  - the personal VPS lanes.

  The result may reach `main` with a dated delivery entry. The plan becomes Implemented after the owner's first run is recorded.

No application behavior changes.

## Rollout and recovery

- The guide and the command take effect on `main`. Nothing runs until the owner starts the guide.
- Reverting the commit removes the command and the guide. Hosts are unaffected until someone runs them.
- On the host, every step says what it leaves behind. The guide never removes instance state; the owner decides on partial installs.

## Review and findings

### Implementation, 30 September 2026

A fresh-context implementer worked in a separate checkout at `9ba6d53` and did not commit. Its result:

- `deploy-release bootstrap`, with `build`'s steps moved into a shared `build_and_stage`, nine new unit tests and the 25 existing tests unchanged;
- the guide, `docs/developer/fresh-vps-install.md`, and the five aligned edits.

It reported these results:

- **Gate.** 34 unit tests passed. `pnpm build`, `pnpm check` and `pnpm test` (56 tests) passed. `pnpm test:deployment:contract` ran 79 Python tests, and its only failure was the recorded baseline in the [capture-limit issue](../../issues/2026-09-30-032022-deploy-run-capture-limit.md); its Node half then passed its 3 tests on its own. `check-docs` passed over 201 files, and `git diff --check` passed.
- **P037-02.** The four pinned downloads matched their hashes, the layout passed `validate_native_distribution`, and the tools reported their pinned versions from a run-owned home.
- **P037-03.** A release built from a bundle of `9ba6d53`, with `sh` in place of the transient unit, was staged, verified and then reused. It allocates 830,058,496 bytes in 14,305 files. Four times that is 3.09 GiB, so `BOOTSTRAP_NEED` is 4 GiB. The release's Codex listed the six bundled IDs, and `validate` and `render` passed.
- **P037-04 and P037-05.** A harness of 411 checks passed, and the five aligned texts are verbatim.

Main copied the result into checkpoint `38cf0b4` on the working branch before the reviews. Main then reran the unit tests, `check-docs` and `git diff --check` in the checkout.

Main's dispositions of the items that the implementer returned:

- **Accepted:**
  - Step 5 fetches `origin/main` into a temporary bare repository before it bundles, because a bundle of a remote-tracking ref alone clones as an empty repository.
  - `values.env` keeps `OIDC_CLIENT_ID`, because a client ID is not a secret and step 8 removes the client file before step 9 needs the ID.
  - `bootstrap` also refuses a missing bundle.
  - Step 12 passes the model list through a root-only file, because the list exceeds the size limit for one argument.
  - The smaller refinements the report lists, such as `RemainAfterExit=yes` on the transient units and a lowercase `OWNER_EMAIL`, which the enrollment helper compares exactly.
- **Recorded as an issue:** pnpm 12.3.4 ignores `npm_config_store_dir`, so every build downloads its packages again. Main confirmed it with `pnpm store path`. See the [pnpm store issue](../../issues/2026-09-30-103815-deploy-build-pnpm-store.md).
- **Corrected outside the repository:** a research note that attributed the Traefik rule to D011.

### Round 1, 30 September 2026

Both reviewers read the checkout at `9ba6d53`, whose tracked diff has SHA-256 `4dd63dff…a3b`, with the guide at `740e76c5…96d`. Neither reported a blocker.

- The design reviewer confirmed that `bootstrap` matches its contract, that the tests only add coverage, that the aligned edits are verbatim and that every change is inside the fence. It reported one major finding, five minor findings, eight nits and four unrelated observations.
- The provenance reviewer rechecked every identity, hash, count, exit status and the space arithmetic that it could. It also:
  - reran the unit tests with Python 3.11.15 and with 3.12.3, which Ubuntu 24.04 ships;
  - verified both scratch releases against their manifests;
  - checked the pinned hashes, the Traefik digest, the Ubuntu packages and the Google and ChatGPT facts at their sources.

  It reported one major finding, three minor findings and seven nits.

Main's dispositions:

- **Accepted, for the implementer to fix in the guide:**
  - Step 3 would remove a Docker Engine installed from Docker's own repository, and stop its containers, because Ubuntu's packages conflict with it. Decision 3 and step 3 now keep such a Docker when it passes the version checks, and stop for any other Docker.
  - `deploy-release`'s release check runs the release's tools with `HOME=/nonexistent`, which creates root-owned directories there. The guide's rule about homes now names this exception. Changing `verify_release` would change `build`, `promote` and `preflight`, which this plan leaves unchanged, so the [release check issue](../../issues/2026-09-30-103816-release-check-home.md) records it.
  - Step 2 allowed an AAAA record that its block refuses. It now requires removing any AAAA record, as the owner's checklist does.
  - Step 4 could not resume its own partial Traefik installation, and step 5 could not resume an interrupted upload. Both now can.
  - Step 8's route check accepted any 404 with a valid certificate, which a kept Traefik can return by itself. It now requires the enrollment helper's own 404 body.
  - Step 5 builds the revision saved with the guide, so that the guide always matches the scripts it runs.
  - The guide gets a dated status line that links the [unverified gates issue](../../issues/2026-09-30-103814-p037-unverified-gates.md), and its Let's Encrypt limits now say that they apply per account.
  - The nits: keepalives and heartbeats in the wait blocks; the enrollment link's real time limits; reading values from the VPS without sourcing them on the owner's computer; missing Expect lines and STOP messages; device code login for workspace accounts; the drop-in hash compared inside its block; and step 3's timeout.
- **Accepted, and recorded here by main:**
  - At 08:23:51 UTC the implementer ran the pinned Codex once, for `debug models --help`, with the container's default home, against its brief. Codex created a helper directory under `/root/.codex/tmp/arg0` with links to the scratch binary. `--help` exits while Codex parses its arguments, so the credential there was probably not read, and no `.env` file exists there. Main removed exactly that directory.
  - The report overstated P037-04. Its harness ran some blocks whole and others in fragments, with fake `ssh`, `scp`, `docker`, `systemctl` and `ss`. It checked steps 2, 6, 7, 13 and 15, the Check blocks, the Recovery blocks and the blocks that start the build, the enrollment service and the login only for syntax and strings. Its inline-JSON check matched nothing, and its "transient properties" check verified a unit file that the harness wrote, not the guide's `systemd-run` arguments. The fix round restates the coverage block by block.
  - The checks ran with Ubuntu 24.04.4's Python 3.11.15, Docker Compose 5.1.1, systemd 255, Bash 5.2.21 and Git 2.43.0. The VPS has Python 3.12.3, under which the provenance reviewer also passed the unit tests. The guide's Compose target is 2.40.3.
  - The blocks for the owner's computer ran only on Linux with GNU tools, not on macOS. The unverified gates issue lists this.
  - The implementer did not keep the two package archives, whose hashes only its logs record. Its first build ran a script that differed from the final one only in the space constant and its comment.
  - The guide's Let's Encrypt limits come from https://letsencrypt.org/docs/rate-limits/, read on 30 September 2026.
  - The implementer also created a probe test outside the fence and deleted it at once, and it made two synthetic commits, with its own identity, in a scratch fixture repository under its run directory.
- **Unrelated, recorded outside this plan:** a research note that said the owner must be a Google test user was corrected in the project's notes.

Evidence limits:

- The implementer's and reviewers' raw logs, the scratch releases and the research copies exist only in this cloud container.
- `/nonexistent`, which this container's release checks created from 03:37 UTC onwards, remains in the container, because a safety check blocked its removal. It disappears with the container.

### Fix round 1, 30 September 2026

The implementer changed only the guide, in the same checkout. The guide now has SHA-256 `93552179…550` and 1,698 lines. The tracked diff against `9ba6d53` is still `4dd63dff…a3b`, so `deploy-release`, its tests and the aligned edits are the ones that round 1 reviewed.

The fixes:

- **Docker.** Step 1 reports the installed Docker packages and the packages that supply `docker` and `dockerd`, and names one of four cases. Step 3 repeats the test. With no Docker or with Ubuntu's `docker.io`, it installs `docker.io` and `docker-compose-v2`. With Docker's own Docker Engine, it installs only the other tools. Any other installation, such as a snap, a mix of both or an incomplete set, stops both steps before `apt-get` runs.
- **Homes.** Rule 5 names the release check's `/nonexistent` exception. Step 16 reports that tree and keeps it.
- **DNS.** Step 2 requires removing any AAAA record.
- **Resuming.** Step 4 starts its own stopped Traefik again only when `compose.yaml` is exactly the file that it writes. Step 5 reports an absent, complete or incomplete upload, replaces an incomplete one unless the build unit exists, and records the revision only after the clean checkout matches it.
- **Enrollment route.** Step 8 requires the helper's own `404` with the body `Not found`.
- **Revision.** Step 5 builds the revision saved before step 1, and stops unless that revision is `origin/main` or one of its ancestors.
- **Nits.**
  - Every `ssh` and `scp` sets `ServerAliveInterval=30` and `ServerAliveCountMax=4`. Every waiting loop prints a line at least once a minute, and a dropped connection means running the block again.
  - The owner's checklist gives the enrollment link's real limits and the workspace admin's setting for device code login.
  - Blocks on the owner's computer read three values from a copy of `values.env` without sourcing it.
  - Step 11 compares the drop-in hash inside its block. Step 3 names a 20-minute timeout.
  - The guide has a dated status line and cites its Let's Encrypt limits.

Main accepted three changes beyond its list:
- a heartbeat in step 8's wait for the enrollment service to stop;
- a heartbeat in step 15's wait for the preflight run to appear;
- a Recovery listing that no longer prints paths that do not exist, which the new harness found.

The implementer reported these results:

- **P037-04.** A harness of 623 checks passed. It ran 40 of the guide's 42 Bash blocks whole: their exact text, with only `CHANGE-ME` values filled in and host paths moved under a scratch directory. Fakes stood in for `ssh`, `scp`, `docker`, `systemctl`, `apt-get`, `dpkg-query`, `curl`, `systemd-run`, `useradd`, `runuser` and the other host commands.
  - Step 9 ran the pinned Codex and `harbor-personal validate` from the P037-03 release, in fresh homes, with the plugins feature off.
  - Step 7's block 2, which sets the ACLs, and step 10's `install` were checked only for syntax and strings.
  - The Docker test also ran against the container's real package database and reported `docker-ce`.
  - `systemd-analyze` verified units built from the guide's two `systemd-run` lines, and the guide's one inline JSON object parsed.
- **Gate.** `check-docs` passed over 204 files. `git diff --check` and `pnpm check` passed. The 34 unit tests passed.

Main then:

- recomputed the guide's and the tracked diff's SHA-256 values, and compared every fence file with the checkout;
- reproduced the drop-in text's 185 bytes and its SHA-256;
- checked in the source four limits: the helper answers an unknown enrollment path with `404` and `Not found`; its 1800 seconds start with the service; a sign-in attempt lasts 10 minutes; and a Harbor login state expires after 10 minutes;
- checked the implementer's copies of the Let's Encrypt and `docker.io` package pages, and the Codex authentication page;
- amended this plan to match the fixed guide: decision 4, the Codex login fact, the contracts for long steps and values, and the specification of the owner's checklist and steps 1, 2, 4, 5, 8, 11 and 16;
- updated the [unverified gates issue](../../issues/2026-09-30-103814-p037-unverified-gates.md) with the blocks that still ran only as text;
- reran `check-docs` over 204 files, `git diff --check`, the 34 unit tests and `pnpm check` on the result, with these records, and all passed.

Corrections to the round 1 record:

- Only the failed-validation limit applies per account and host name. The duplicate-certificate limit counts certificates from all accounts. The guide says so.
- The implementer's round 0 report said that "no host" was touched. Its P037-03 builds' release checks added `.local/share/pnpm` and a `.codex/tmp/arg0` entry under this container's `/nonexistent`, as the release check issue records.

In this round the pinned Codex ran only with fresh `HOME` and `CODEX_HOME` directories. The harness, its fixtures and logs, and the fetched pages exist only in this cloud container.

### Round 2, 30 September 2026

Two new reviewers, with fresh context, read commit `9ab88c6`, whose diff from `9ba6d53` has SHA-256 `bdac2b37…29e`. Neither reported a blocker or a major finding.

- **Design review.** The design reviewer found every round 1 fix resolved. It also:
  - reran the Docker test in 15 cases;
  - reran the values parser with 13 inputs;
  - followed step 5's block 1 through each point where it can be interrupted.

  It reported two minor findings, five nits and one unrelated observation.
- **Provenance review.** The provenance reviewer rechecked the identities and reran `check-docs`, `git diff --check` and the unit tests under Python 3.11.15 and 3.12.3. It also reran the P037-04 harness from a copy, with `systemd-analyze` replaced by a failing stub. 620 of the 623 checks passed, and the other three were the stubbed ones. It reported one minor finding and four nits.

Main's dispositions:

- **Accepted, for the implementer to fix in the guide:**
  - The block before step 1 could run a second time and silently save a newer guide.
  - A rerun of step 5's or step 12's wait block after a dropped connection could race the earlier remote run, which may keep going for minutes, and print a false STOP.
  - The enrollment link can arrive up to about seven minutes into the helper's 30 minutes, so the advice to open it within about 25 minutes could run out.
  - Two Expect lines left out outputs that the guide itself routes the agent through: step 4's line that says to run block 2, and step 9's line for a rerun.
  - The owner's checklist left out Ubuntu's `docker.io`, which steps 1 and 3 accept. Main's round 1 fix brief had narrowed it. Main also corrected decision 3 and the checklist specification.
  - Single `curl` calls had no time limit.
  - Recovery said that `bootstrap` removes its inputs and build state on every exit. A reboot or a killed process prevents that.
- **Recorded as an issue:** `build` leaves the same directories after a reboot or a kill. See the [interrupted build issue](../../issues/2026-09-30-125456-interrupted-build-leftovers.md).
- **Accepted, and recorded here by main:**
  - **Container changes.** The records of what the checks changed in this container were incomplete.
    - `systemd-analyze verify` creates and updates the empty marker file `/run/systemd/systemd-units-load`. The implementer's round 0 probe created it at 08:24 UTC, and later harness and review runs updated it.
    - The harness also wrote bytecode into the implementer's scratch checkout.
    - The gate script staged the guide there as intent-to-add, then removed it from the index again.
  - **Main's gate rerun.** Main's rerun of the gate after fix round 1 is only partly backed by kept logs. Main kept only the `pnpm check` log, and that run came before main's last edit of this plan. `pnpm check`'s TypeScript, OpenAPI and Prettier parts do not read that file. The provenance reviewer reran `check-docs`, `git diff --check` and the unit tests at `9ab88c6`, and all passed. From now on, main keeps each gate command's log with its exit code and revision.
  - **The Codex login fact.** It cited a page for two claims that the page does not make. It now says that the 15-minute expiry comes from the pinned binary, whose text says so. It also marks the file credential store as an inference, which step 12 checks.
  - **Python version.** The container's Python 3.11.15 is an alternatives-selected `python3.11`, not Ubuntu 24.04's default `python3`, which is 3.12.3. The round 1 record called it Ubuntu 24.04.4's.
  - **Compile checks.** The implementer's round 1 report undercounted the harness's compile checks: all 10 Python here-documents compiled, not 8. No tracked record repeated the number.
  - **Transcript search.** The implementer searched main's session transcript, read-only, for the text of four round 1 findings that its brief already quoted. Nothing from it reached a tracked file. The round 2 brief forbids such searches.
  - **Mount attempts.** The provenance reviewer tried to run `systemd-analyze` without touching the real `/run/systemd`.
    - It ran `unshare` with a private mount namespace. The tmpfs mount attempt created an empty directory, `/run/mount`, in this container.
    - The session's permission checks denied the reviewer's removal of that directory and a later bind mount. The reviewer then used a stub.
    - Main left the directory in place because the reviewer's removal had been denied. It disappears with the container.

## Closing record

Pending until the [completion conditions](../workflow.md#proposal-completion-and-archive) pass.
