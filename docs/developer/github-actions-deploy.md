# GitHub Actions deployment to the personal VPS

Added 25 September 2026. Cloud coding sessions have no SSH egress, so personal VPS updates run from GitHub-hosted runners through [deploy-vps.yml](../../.github/workflows/deploy-vps.yml). The runner uploads a Git bundle of the selected commit and runs [deploy-release](../../infra/personal-vps/deploy-release) as root on the VPS. The script codifies the build, stage and promotion procedure recorded in the [personal VPS guide](personal-vps.md#current-owner-installation) and the [P024 installed report](../reports/2026-09-21-p024-installed-attachment-fix.md#final-deployment-and-installed-acceptance). The earlier promotion helpers lived only in ignored run storage. This workflow has not yet run against the live host; its first run is its first live evidence.

## One-time setup

1. On a trusted machine, create a dedicated deploy key with no passphrase: `ssh-keygen -t ed25519 -N '' -C harbor-github-deploy -f harbor_github_deploy`.
2. On the VPS, append the public key to `/root/.ssh/authorized_keys` with the `restrict` option, which disables forwarding and terminals: `restrict ssh-ed25519 AAAA... harbor-github-deploy`. Leave the owner's existing key unchanged.
3. Print the pinned host key line from the owner's existing `known_hosts`, for example `ssh-keygen -F 187.77.140.226`, and copy every non-comment line. Do not trust a fresh `ssh-keyscan` result without comparing it with that pin.
4. In the repository settings under **Secrets and variables → Actions**, add:

| Name | Kind | Value |
| --- | --- | --- |
| `VPS_SSH_KEY` | Secret | Entire private key file `harbor_github_deploy` |
| `VPS_KNOWN_HOSTS` | Secret | The pinned host key line(s) from step 3 |
| `VPS_HOST` | Variable | VPS address, currently `187.77.140.226` |
| `HARBOR_INSTANCE` | Variable | Instance name, currently `seekworld` |
| `VPS_PORT`, `VPS_USER` | Variable, optional | Default to `22` and `root` |

5. Delete the local private key file after storing it. Optionally add required reviewers to the `vps-production` environment, which the first run creates.

Revoking access means removing the `authorized_keys` line and the secret. The key has root access; the workflow is its only intended user.

## Actions

Run **Deploy personal VPS** from the Actions tab and pick the branch to deploy, normally `main`.

- `preflight` is read-only. It reports the installed release and its manifest verification, service states, active work counts, free space, public health, site drop-ins and any drift between installed unit/environment files and their generated form.
- `build` runs `pnpm install --frozen-lockfile` and `pnpm build` in a transient `DynamicUser` systemd unit with no persistent account. It reuses the pinned Node, pnpm and complete Codex vendor layout reconstructed byte-for-byte from the installed release manifest, then packages with `package-release.py`. The root-owned result is verified against its manifest and staged as `/opt/harbor-personal/releases/gha-<commit12>`. No service changes.
- `deploy` builds, then promotes. Promotion refuses when an existing migration changed, the applied migration map differs from the installed release, installed generated files drifted, or work is active. It stops the API, rechecks, stops the supervisor, and requires zero runtime, background and busy-operation ownership plus no process left from the old release. If any remains, it restarts the old release and stops. It then writes a private checkpoint under `/var/lib/harbor-personal-backups/`: a verified PostgreSQL custom dump, instance configuration, units and drop-ins, the AppArmor profile, and private state except the PostgreSQL data directory. It rewrites only the release path, starts both services and verifies the new executables, `/health` 200 and anonymous 401 responses.

A release adding migrations needs the `allow_new_migrations` input after reviewing them. If such a release fails to start, services stay stopped and recovery uses the checkpoint over SSH, because older binaries must not open the upgraded database. Without new migrations, a failed start restores the previous release automatically.

## Limits

The workflow does not run `pnpm check`, `pnpm test` or E2E lanes, and it does not replace the development and review gates in the [workflow](../../design/workflow.md). A normal supervisor stop can still leave unknown runtime membership, as recorded in the [retained-runtime issue](../../issues/2026-09-21-174500-personal-stop-retained-runtimes.md); promotion then stops safely without switching, and recovery remains a manual decision. Staged releases and checkpoints accumulate and need deliberate pruning. Checkpoints are same-host copies, not off-host backups.

## Switching to automatic deployment

After a manual `deploy` succeeds, add a `push: branches: [main]` trigger to the workflow. Runs without inputs default to `deploy` without new migrations, so a migration-adding change still needs a manual run.
