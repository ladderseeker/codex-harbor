# Deployment development commands

P009 is **In progress and unverified**. These commands exist in the feature implementation; they are not a production-readiness claim. The [development checkpoint](../reports/2026-09-08-p009-development.md) records the tested subset. Actual protected backup transfer, fresh-host restoration, promotion/rollback and dedicated live-account acceptance remain blocked or unverified. The [transfer approval issue](../../issues/2026-09-07-231526-p009-backup-transfer-approval.md) records the automatic-review rejection; no transfer was performed or retried indirectly.

## Build and authenticate a package

Use a matching Linux arm64 or x86_64 build host with Node 24.11.1, pnpm 12.3.4, Python 3 and pinned Restic 0.19.1. Install the locked JavaScript dependencies and run `pnpm build`. Build the fixed runner, gateway, Git and file-helper images from their repository Dockerfiles; PostgreSQL 17.6-bookworm and Caddy 2.10.2-alpine must also be present. The builder captures their actual immutable image IDs, migration hashes, base and terminal seccomp hashes, built `apps/web/dist/` assets and complete release file inventory.

```sh
python3 infra/deploy/package.py --node /opt/node/bin/node --restic /opt/restic/restic --output /var/lib/harbor-build/releases
```

The JSON result identifies the archive SHA256, logical artifact ID and standalone administrator executable SHA256. Authenticate both expected hashes through the administrator's release channel before running the executable or installing the archive. The installer verifies the archive before extracting it, rejects unsafe archive entries and publishes an immutable directory under `/opt/codex-harbor/releases/<artifact>`. The installed executable is `bin/harborctl` inside that directory. Never modify a selected release in place.

An explicit lower-ID migration addition needs `--predecessor-manifest` naming the exact supported predecessor artifact/applied map, plus matching acceptance evidence. The builder records the declaration; it does not prove compatibility.

## Host configuration and services

The current JSON contract is implemented in [config.py](../../infra/deploy/config.py). Configuration and credential input files must be canonical, root-owned and protected. It selects the instance ID, HTTPS origin, OIDC issuer/client/owner, dedicated API UID, loopback API port, reserved denied database TCP port, registered roots, XFS profile, TLS certificate files or ACME, and fixed SFTP restore-source credentials (the `backup` field is retained for configuration compatibility). It accepts no arbitrary launcher flags or project executable paths.

Prepare dedicated XFS project-quota units according to [D003](../../design/decisions/003-quota-backed-project-storage.md). Each allowed-root/pool pair shares one trusted administrator parent. The initial installed profile requires a quota-enabled XFS fstab entry; `RequiresMountsFor` orders services after those mounts. A transient mount is insufficient. The API cannot traverse project roots or read the model encryption key; its authenticated private storage IPC creates and validates managed projects.

The installed roles are root storage, root supervisor and a dedicated unprivileged API account. PostgreSQL runs without networking and authenticates over a private Unix socket using SCRAM. Caddy is the only public listener; the API binds loopback. Readiness checks actual process UIDs, IPC ownership, listener confinement, quota/image prerequisites, schema identity and certificate-verified HTTPS. The fixed health probe ignores ambient HTTP proxy variables. An unconfigured runtime account is reported separately from service readiness.

```sh
sudo ./harborctl --config /etc/harbor-install.json install --archive /var/lib/harbor-build/candidate.tar --sha256 EXPECTED_ARCHIVE_SHA256
sudo /opt/codex-harbor/releases/ARTIFACT/bin/harborctl --config /etc/harbor-install.json status
sudo /opt/codex-harbor/releases/ARTIFACT/bin/harborctl --config /etc/harbor-install.json preflight
```

An incomplete installation can be resumed with the same configuration and authenticated archive using `install --resume`. It stays disabled until readiness passes. `status` reports unavailable roles without requiring the browser or healthy API. Read-only status/preflight/inventory calls do not consume mutation-history capacity.

## Maintenance, inventory and SSH recovery

`drain` closes new-work admission and waits for active effects, pending storage/recovery reconciliation and file inspections. Queued file operations and terminals stay retained while their dispatch is frozen; they do not block drain. Active terminals, including surviving background processes, and unacknowledged uncertain file effects do block it. Bounded file inspection/release and terminal termination remain available during maintenance. `drain --interrupt` records uncertainty, stops services and confirms owned runtime retirement. It does not invent completion or replay uncertain work. Failure leaves maintenance active. `resume` keeps maintenance active while it starts services and waits for bounded readiness, then releases admission and reports the current deployment state. A startup or readiness failure leaves admission disabled; repeating the command also works for already-running services. It refuses a restored installation awaiting activation.

`inventory` reports unregistered managed allocations with exact device/inode identity and the existing-project registration path. A real deferred database COMMIT failure can leave a successfully provisioned directory without its project row. Checkpointing refuses such an omission. After inspecting that exact managed directory, the owner may register it through the existing-project UI/API path; this preserves its inode and does not copy, delete or silently adopt another directory.

`recover-runtime` requires the exact project/session, ledger generation and stale lock inode, plus `--acknowledge-unknown-effects`. It stops the selected instance's control services, preserves uncertainty, validates the recorded runner, confirms its retirement and recovers only the matching private lock. It never broadly removes containers or lock files and leaves admission in maintenance. For a terminal, use the native identity `terminal-<terminal UUID>` and its exact generation; successful recovery preserves the original uncertain record, revokes controller authority and releases only the matching terminal reservation. The [installed module report](../reports/2026-09-08-installed-module-integration.md) separates actual recovery evidence from remaining release gates.

Use SSH and `systemctl status codex-harbor-INSTANCE-{dependencies,storage,supervisor,api}.service` when Harbor is unavailable. Preserve protected configuration, release manifests and operation records. Do not format a missing filesystem or substitute another directory when stored identities differ.

## Backup, restore and release switching

The fixed `repository-init`, `backup`, `restore`, `activate`, `promote` and `rollback` paths are implemented but their actual protected transfer/restore acceptance is **not verified**. Do not infer a working backup from repository initialization or a successful SFTP connectivity probe.

Checkpointing drains work, stops application writers and Caddy, verifies the installed-module/physical inventory and selected schema, records a PostgreSQL dump, encrypts with pinned Restic and requires full repository data verification plus snapshot node/content equality with the authenticated Harbor registry before publishing a completed checkpoint. Native `auth.json` copies and live locks are excluded. Source configuration/model encryption material and historical receipts remain protected backup data. SFTP keys and repository passwords are supplied out of band. Current bounds are 32 GiB aggregate restore data, 512 MiB per regular file/database dump, 200,000 entries, an 8 MiB authenticated registry and bounded deadlines; oversize states fail explicitly before being labelled restorable.

Restore requires a fresh instance and disabled database, an authenticated archive, exact snapshot and registry hashes, matching schema/native compatibility and complete destination root mapping. It reconstructs only authenticated ordinary files/symlinks in private staging, claims only known-empty quota slots under the storage lock, moves them into private inode-bound staging outside the allocation pool, publishes those units and rebinds identities. It revokes old cookies/PATs/receipt retry authority, file inspection releases and terminal controller/input authority, preserves uncertainty and re-encrypts model credentials under the new instance key. File and terminal reservation fences change. Queued file effects and PTYs never replay. Unresolved file effects need fresh destination inspection and acknowledgement; terminal ownership needs explicit destination termination or administrator recovery. It does not contact source-host runtimes. `restore --resume` reconciles the same recorded operation; changing the owner also requires `--acknowledge-owner-rebind`.

Activation is a separate `activate --restore-id` command. It revalidates publication, retires possible interrupted probes, records native pre/post fingerprints and performs bounded read-only metadata inspection without a model/turn/resume request. Native initialization may update caches; original snapshot evidence is retained. A legitimately removed derived checkout remains removed; its native-history read uses the same project’s registered Local checkout as an explicitly read-only inspection mount, without changing the historical binding or resuming execution. Failed validation keeps the destination disabled.

Promotion requires a verified checkpoint before migration. A pending switch resumes only the same candidate/checkpoint with `--resume`. Rollback requires equal applied migration maps; an incompatible downgrade is refused and requires deliberate fresh restore or forward repair. A repository hosted on restored B is not B's own off-host backup destination. Future backups require separate off-host destination enrollment. Full restore fault tests and final release evidence remain outstanding.

## Verification entry points

`pnpm test:deployment:contract` runs the extraction/lifecycle and real Unix-response truncation/deadline contracts. It is not a deployment E2E substitute. The run-owned Linux fixtures are in `tests/deployment/`; they exercise actual installed services, owner API allocation, privilege checks, identity preservation and the installed native/runner boundary. Reboot only explicitly disposable test hosts. Preserve source/artifact identities and distinguish partial checks from the mandatory P009-01–07 outcomes.

## Future backup destination enrollment

Use a root-owned mode-0600 JSON profile with exactly `destination`, `targetHostId`, and `hostKeySha256`. `destination` has the restricted SFTP fields from `config.py`; `targetHostId` is SHA256 of the intended remote `/etc/machine-id` bytes without the trailing newline, and `hostKeySha256` is SHA256 of the decoded Ed25519 SSH public-key blob. Supply these through the administrator's authenticated channel. The known-host file must contain one matching Ed25519 pin for that authority. The local host identity/key is refused; administrator identity binding is not a claim to automatically prove physical provider separation.

```sh
sudo ./harborctl --config /etc/harbor-install.json backup-destination-status
sudo ./harborctl --config /etc/harbor-install.json backup-destination-enroll --profile /etc/harbor-destination.json --expected-current none
```

For an update, replace `none` with the exact current destination ID. Failed probes preserve the old record; identical retries reconcile the same admission. Enrollment sends only a public nonce and confirms its exact cleanup. It does not initialize Restic or send Harbor data. An empty destination remains explicitly not initialized/verified. After separately authorized initialization, `repository-init --expected-destination ID` initializes that enrolled destination; `backup-destination-verify --expected-destination ID` authenticates existing repository metadata and reconciles a lost initialization acknowledgement. These later commands are not permission to bypass the recorded blocked transfer. Changed SSH/password/known-host files require explicit re-enrollment. History is bounded to sixteen destination versions.

`backup` uses only the admitted future destination and verifies its repository identity. `restore` uses the original configuration source, whose endpoint and protected-file fingerprints are pinned into its restore journal. Updating future backups cannot redirect a pending restore. Restored historical destination records do not regain authority.

## Personal VPS profile

[P015](../../design/proposals/015-personal-vps-workspace.md) adds a separate subscription/existing-folder profile. See the [personal VPS guide](personal-vps.md) for implemented tooling and explicit acceptance limits. This does not complete P009 managed installation or its restore gates.
