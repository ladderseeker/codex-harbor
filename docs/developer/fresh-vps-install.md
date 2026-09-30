# Fresh VPS installation

This guide takes an emptied Ubuntu 24.04 VPS to a running, verified instance of Harbor's personal profile, built from `main`. An agent on the owner's computer follows it one step at a time, and the owner does the parts marked for the owner. Once the instance runs, updates use [GitHub Actions deployment](github-actions-deploy.md) instead. The [personal VPS guide](personal-vps.md) explains the profile, its trust limits and the reasons behind these steps.

Status, 30 September 2026: this guide has not yet run on a real host. Its first run is tracked in the [unverified gates issue](../../issues/2026-09-30-103814-p037-unverified-gates.md). Stop at the first mismatch.

## Who this is for

- **The agent.** You run on the owner's computer, in the owner's clone of this repository. The owner's SSH alias `harbor-vps` reaches the VPS as root, as the [VPS SSH handoff](../../AGENTS.md#vps-ssh-handoff) describes.
- **The owner.** The owner supervises the run, answers the questions in [What the owner prepares](#what-the-owner-prepares), and does every part that names the owner.
- **The revision.** The guide installs the revision of `origin/main` that the block below saves, and you read the guide from that same revision, so that its commands match the scripts they run.

Before step 1, run this block once, from the root of the owner's clone. It saves the guide and its revision in your log directory, `~/harbor-install-log`. It changes nothing in the clone except the remote-tracking branch `origin/main`:

```bash
bash -euo pipefail -s <<'LOCAL'
mkdir -p "$HOME/harbor-install-log"
git fetch -q origin main </dev/null
revision=$(git rev-parse origin/main)
git show "$revision:docs/developer/fresh-vps-install.md" > "$HOME/harbor-install-log/guide.md"
echo "$revision" > "$HOME/harbor-install-log/guide-revision.txt"
echo "saved the guide from revision $revision"
LOCAL
```

Then follow `~/harbor-install-log/guide.md`. When you resume later, read that saved copy again, and do not run this block a second time. Step 5 builds the saved revision, even when `origin/main` has moved on since then, and stops if the saved revision is no longer `origin/main` or one of its ancestors.

## Rules for the agent

1. **Where commands run.** Every block runs in Bash on your computer, from the root of the owner's clone. A command for the VPS goes through `ssh harbor-vps` to `bash -euo pipefail -s`, as a quoted here-document, so nothing in it expands on your computer, and it runs as root on the VPS. The options `ServerAliveInterval=30` and `ServerAliveCountMax=4` on `ssh` and `scp` end a dead connection within about two minutes. Run each block exactly as written, as one command, with a timeout of at least 10 minutes, or the longer timeout that a step names. Change only a value marked `CHANGE-ME`, and only where a step says so.
2. **Stop rules.** Stop and report the step, the block and its output, with secrets removed, when:
   - a block exits nonzero or prints a line that starts with `STOP`;
   - an Expect line does not match;
   - a check fails;
   - the host differs from what this guide describes.

   A block that checks for an expected refusal, such as a denied write, exits 0 only when the refusal happened, so a nonzero exit always means stop. A block that prints a line starting with `WAIT` is waiting for something that has not finished: run the same block again. While such a block waits, it prints a `still waiting` line at least once a minute. When the `ssh` of such a waiting block exits with status 255, the connection dropped: run the same block again, and stop if it cannot connect.
3. **Never** improvise a command that changes the host, delete a path that this guide does not name, change a pinned version, hash or value to get past a failure, or edit or commit to the repository.
4. **Secrets.** These files and texts hold secrets:
   - the Google client file and the client secret file;
   - the rendered bundle;
   - `service.env` and `database.password`;
   - `codex-home/auth.json`;
   - the enrollment start URL;
   - the Codex login's log, which holds the device code until step 12 removes it;
   - SSH private keys.

   No block prints their contents, with two exceptions: step 8 prints the start URL and step 12 prints the device code, and you pass each only to the owner. Copy the Google client file to the VPS only with step 8's `scp`, and never display it. Keep secrets out of your log and your reports.
5. **Homes.** Every command in this guide that may start Codex runs with `HOME` set to a root-only scratch home under `/var/lib/harbor-install`, which the step removes afterwards. The exceptions are:
   - the Codex login and the signed-in model list in step 12, which use the instance's own homes;
   - the release check in `deploy-release`, which runs the release's `node`, `codex` and `pnpm` with `HOME=/nonexistent`, whenever `bootstrap` in step 5 or `preflight` in steps 14 and 15 runs. It creates a root-owned `/nonexistent` with `.codex` and `.local` in it, as the [release check issue](../../issues/2026-09-30-103816-release-check-home.md) records. Step 16 reports that tree and leaves it in place.

   The model listings also set `CODEX_HOME` and turn the plugins feature off, as Harbor's runtimes do.
6. **Long steps.** The first-release build and the Codex login run as transient systemd units that write to a log under `/var/lib/harbor-install`, so a dropped SSH connection does not stop them. Their wait blocks poll for at most eight minutes; run them again until they finish.
7. **Resuming.** The VPS keeps `/var/lib/harbor-install/progress`, with one line for each finished step, such as `step 3 done 2026-10-01T09:30:00Z`. After an interruption, run the progress block below and continue at the first step that has no line. That step's Check says whether it was partly done. `install` and the owner enrollment cannot simply be repeated, so their steps say what a partial result looks like and when to stop for the owner.
8. **Records.** Keep a step-by-step log in `~/harbor-install-log/log.md`, outside the repository. For each block, write the time, the step, the exit status and the output, with secrets removed. At the end, the VPS keeps a root-only record in `/var/lib/harbor-install/record.json`.

The progress block is read-only:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
if [ -f /var/lib/harbor-install/progress ]; then cat /var/lib/harbor-install/progress; else echo "no progress file"; fi
REMOTE
```

Every step has the same parts:

- **Where:** your computer, the VPS or the owner.
- **Check:** read-only; it says whether the step is already done.
- **Run:** the change. A step with several blocks numbers them, and runs them in order.
- **Expect:** the exact lines or conditions.
- **If not:** stop and report, unless the step names a fix.

## What the owner prepares

The owner completes this checklist before the run, or when the named step reaches it:

1. **Host.** The VPS runs Ubuntu 24.04 on x86_64, with either no Docker or the Docker Engine packages from Docker's own repository: `docker-ce`, `docker-ce-cli`, `containerd.io` and `docker-compose-plugin`. Step 1 checks it, and stops for any other Docker installation, such as a snap or an incomplete set of packages.
2. **Values.** Confirm the [values](#values), or tell the agent what to change, before step 1.
3. **DNS record.** At the DNS provider for `seekworld.tech`, an A record for `harbor.seekworld.tech` that points at the VPS address `187.77.140.226`, and no AAAA record for that name. Step 2 checks it. The preview host is a `sslip.io` name, which resolves to the address it contains without any record.
4. **Firewall.** In the hosting provider's panel, if it has a firewall for the VPS, allow inbound TCP 22, 80 and 443, before step 4.
5. **Let's Encrypt email.** An email address for certificate notices, before step 1.
6. **Google client.** In the Google Cloud console, under APIs & Services, then Credentials: an OAuth client of type Web application, whose authorized redirect URIs include exactly `https://harbor.seekworld.tech/auth/callback`. Save its client JSON on this computer, and give the agent the file's full path in step 8.
   - Reuse the existing client if there is one. Create a new client only if none exists.
   - Google shows a client secret only once. If the secret is lost, use **Add Secret** on the client page and download the JSON it offers. A client holds at most two secrets.
   - Harbor asks only for `openid`, and the enrollment only for `openid email`, so the consent screen can stay in Testing without a test-user list.
7. **Owner email.** The Google account email that becomes Harbor's owner, before step 1.
8. **Device code login.** Before step 12, turn on device code login for the ChatGPT account that Harbor will use. For a personal account, the owner turns it on in ChatGPT's security settings. For a ChatGPT workspace account, a workspace admin turns on device code login in the workspace's permissions.
9. **Time.** In step 8, open the enrollment link within about 25 minutes of receiving it, and finish signing in within 10 minutes of opening it. In step 12, enter the Codex device code within 15 minutes of receiving it.

## Values

Step 1 writes these values to `/var/lib/harbor-install/values.env`, and every later step reads them from there. The file holds no secrets. The owner may change any value before step 1; changing one later is not supported.

| Name | Value | Source |
| --- | --- | --- |
| `INSTANCE` | `seekworld` | The previous installation ([personal VPS guide](personal-vps.md#current-owner-installation)) |
| `ORIGIN` | `https://harbor.seekworld.tech` | The previous installation |
| `HOST` | `harbor.seekworld.tech` | The host of `ORIGIN` |
| `VPS_ADDRESS` | `187.77.140.226` | [VPS SSH handoff](../../AGENTS.md#vps-ssh-handoff) |
| `SERVICE_USER` | `harbor-personal` | The previous installation ([candidate report](../reports/2026-09-13-personal-vps-candidate.md)) |
| `API_PORT` | `3348` | The previous installation |
| `DATABASE_PORT` | `5548` | The previous installation |
| `ROOT_NAME` | `VPS root` | New; the earlier name was not recorded |
| `ROOT_PATH` | `/root` | The owner's browse root ([personal VPS guide](personal-vps.md#prerequisites-and-package)) |
| `PROJECTS` | `/root/Projects` | The owner's writable project folder (same) |
| `PREVIEW_NAME` | `Development app` | New; the earlier name was not recorded |
| `PREVIEW_PORT` | `3100` | The previous preview ([personal VPS guide](personal-vps.md#development-policy-and-upgrade-compatibility)) |
| `PREVIEW_ORIGIN` | `https://harbor-preview-187-77-140-226.sslip.io` | The previous preview |
| `PREVIEW_HOST` | `harbor-preview-187-77-140-226.sslip.io` | The host of `PREVIEW_ORIGIN` |
| `GATEWAY_PORT` | `3350` | The previous preview gateway |
| `ENROLL_PORT` | `3347` | This guide's temporary enrollment service |
| `OIDC_ISSUER` | `https://accounts.google.com` | Google |
| `OIDC_SECRET_FILE` | `/etc/harbor-personal-oidc/seekworld.secret` | This guide |
| `ACME_EMAIL` | `CHANGE-ME` | The owner: the Let's Encrypt email |
| `OWNER_EMAIL` | `CHANGE-ME` | The owner: the Google account to enroll |
| `TRAEFIK_IMAGE` | `traefik:v3.7.13@sha256:24841fe2de7304c149343d877d2923b4c8800a38ba015dea9174c23b20e344a0` | Pinned; Traefik 3.6.1 or later negotiates the Docker 29 API version |
| `POSTGRES_TAG` | `postgres:17.6-bookworm` | The installer's pinned PostgreSQL version |

Later steps add these values:

- step 5: `REVISION`, `RELEASE` and `MANIFEST_SHA256`;
- step 8: `OIDC_CLIENT_ID`, and `POSTGRES_IMAGE`, which is the pulled image with its digest;
- step 9: `MODELS`, the model IDs that the release's Codex lists.

Step 9's configuration also turns on the Traefik routing carrier and the AppArmor user-namespace profile, and keeps the default capacity limits of four active turns and four conversation runtimes.

## Steps

### Step 1. Check the host

**Where:** the VPS.

**Check:** Run the progress block. If it lists `step 1 done`, go to the first step that it does not list.

**Run:**

**Block 1.** Check SSH, with the command from the [VPS SSH handoff](../../AGENTS.md#vps-ssh-handoff):

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes harbor-vps 'whoami; hostname'
```

**Block 2.** Report the host. This block is read-only:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
shopt -s nullglob
. /etc/os-release
init=$(ps -p 1 -o comm=)
cgroup=$(stat -fc %T /sys/fs/cgroup)
echo "os: $PRETTY_NAME"
echo "kernel: $(uname -r)"
echo "architecture: $(uname -m)"
echo "init: $init"
echo "systemd: $(systemctl --version | sed -n 1p)"
echo "cgroup filesystem: $cgroup"
echo "user namespace restriction: $(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo absent)"
if command -v docker >/dev/null; then
  echo "docker: $(docker --version)"
  echo "compose: $(docker compose version 2>&1 || true)"
  echo "running containers:"
  docker ps --format '  {{.Names}} {{.Image}}' || echo "  the Docker daemon is not reachable"
else
  echo "docker: absent"
fi
owner() {
  local path
  path=$(command -v "$1" || true)
  if [ -z "$path" ]; then echo none; return; fi
  dpkg-query -S "$(readlink -f "$path")" 2>/dev/null | sed -n 's/^\([a-z0-9][a-z0-9+.-]*\)\(:[a-z0-9]*\)\{0,1\}: .*/\1/p' | sed -n 1p | grep . || echo "unowned:$path"
}
has() { [[ " $packages " == *" $1 "* ]]; }
only() { local name; for name in $packages; do [[ " $* " == *" $name "* ]] || return 1; done; }
packages=$(dpkg-query -W -f='${db:Status-Abbrev} ${Package}\n' | awk 'substr($1, 2, 1) !~ /[nc]/ && $2 ~ /^(docker|moby-|containerd\.io$|podman-docker$)/ {print $2}' | sort | paste -sd ' ' -)
docker_from=$(owner docker)
dockerd_from=$(owner dockerd)
if [ -e /snap/bin/docker ]; then
  docker_case=other
elif [ -z "$packages" ] && [ "$docker_from $dockerd_from" = "none none" ]; then
  docker_case=none
elif has docker.io && only docker.io docker-compose-v2 docker-buildx docker-doc && [ "$docker_from $dockerd_from" = "docker.io docker.io" ]; then
  docker_case=ubuntu
elif has docker-ce && has docker-ce-cli && has containerd.io && has docker-compose-plugin && only docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin docker-ce-rootless-extras docker-model-plugin && [ "$docker_from $dockerd_from" = "docker-ce-cli docker-ce" ]; then
  docker_case=docker-ce
else
  docker_case=other
fi
echo "Docker packages: ${packages:-none}"
echo "docker from: $docker_from; dockerd from: $dockerd_from"
echo "Docker case: $docker_case"
echo "listeners on 80, 443, 3347, 3348, 3350 and 5548:"
ss -Hltnp '( sport = :80 or sport = :443 or sport = :3347 or sport = :3348 or sport = :3350 or sport = :5548 )'
echo "free space:"
df -h / /opt /var/lib
if command -v ufw >/dev/null; then echo "ufw: $(ufw status | sed -n 1p)"; else echo "ufw: absent"; fi
echo "/root/Projects: $([ -d /root/Projects ] && echo exists || echo missing)"
leftovers=()
for account in harbor-personal harbor-enroll; do
  if getent passwd "$account" >/dev/null; then leftovers+=("account $account"); fi
done
for path in /etc/harbor-personal-* /var/lib/harbor-personal-* /opt/harbor-personal /var/lib/harbor-deploy /etc/systemd/system/harbor-personal-* /etc/apparmor.d/harbor-personal-*; do
  if [ -e "$path" ]; then leftovers+=("path $path"); fi
done
while read -r unit; do leftovers+=("unit $unit"); done < <(systemctl list-units --all --plain --no-legend 'harbor-personal-*' | awk '{print $1}')
while read -r profile; do leftovers+=("AppArmor profile $profile"); done < <(grep -h 'harbor-personal' /sys/kernel/security/apparmor/profiles 2>/dev/null || true)
if command -v docker >/dev/null; then
  while read -r container; do leftovers+=("container $container"); done < <(docker ps -a --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -i harbor || true)
fi
acl=$(python3 - <<'PY'
import os
def has_acl(path):
    try:
        names = os.listxattr(path, follow_symlinks=False)
    except OSError:
        return False
    return 'system.posix_acl_access' in names or 'system.posix_acl_default' in names
found = ['/root'] if has_acl('/root') else []
for directory, dirs, files in os.walk('/root/Projects'):
    found += [p for p in [directory] + [os.path.join(directory, f) for f in files] if has_acl(p)]
print(len(found), ' '.join(found[:3]))
PY
)
if [ "${acl%% *}" != 0 ]; then leftovers+=("ACL entries on ${acl%% *} paths, first: ${acl#* }"); fi
if [ "${#leftovers[@]}" -gt 0 ]; then echo "leftovers:"; printf '  %s\n' "${leftovers[@]}"; else echo "leftovers: none"; fi
problems=()
[ "$ID $VERSION_ID" = "ubuntu 24.04" ] || problems+=("the OS is not Ubuntu 24.04")
[ "$(uname -m)" = x86_64 ] || problems+=("the architecture is not x86_64")
[ "$init" = systemd ] || problems+=("PID 1 is not systemd")
[ "$cgroup" = cgroup2fs ] || problems+=("the host does not use cgroup v2")
[ "$docker_case" != other ] || problems+=("Docker is installed in a way that this guide does not handle")
if [ "${#leftovers[@]}" -gt 0 ] && [ ! -f /var/lib/harbor-install/progress ]; then problems+=("leftovers exist and no progress file does"); fi
if [ "${#problems[@]}" -gt 0 ]; then printf 'STOP: %s\n' "${problems[@]}"; exit 1; fi
echo "HOST OK"
REMOTE
```

**Block 3.** In this block, replace the two `CHANGE-ME` values with the owner's email addresses, and change any value the owner changed. Then run it. It creates `/var/lib/harbor-install` with mode `0700`, and writes the values and the progress file:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
if [ -e /var/lib/harbor-install/values.env ]; then echo "STOP: /var/lib/harbor-install/values.env already exists"; exit 1; fi
install -d -m 0700 /var/lib/harbor-install
cat > /var/lib/harbor-install/values.env.new <<'VALUES'
INSTANCE='seekworld'
ORIGIN='https://harbor.seekworld.tech'
HOST='harbor.seekworld.tech'
VPS_ADDRESS='187.77.140.226'
SERVICE_USER='harbor-personal'
API_PORT='3348'
DATABASE_PORT='5548'
ROOT_NAME='VPS root'
ROOT_PATH='/root'
PROJECTS='/root/Projects'
PREVIEW_NAME='Development app'
PREVIEW_PORT='3100'
PREVIEW_ORIGIN='https://harbor-preview-187-77-140-226.sslip.io'
PREVIEW_HOST='harbor-preview-187-77-140-226.sslip.io'
GATEWAY_PORT='3350'
ENROLL_PORT='3347'
OIDC_ISSUER='https://accounts.google.com'
OIDC_SECRET_FILE='/etc/harbor-personal-oidc/seekworld.secret'
ACME_EMAIL='CHANGE-ME'
OWNER_EMAIL='CHANGE-ME'
TRAEFIK_IMAGE='traefik:v3.7.13@sha256:24841fe2de7304c149343d877d2923b4c8800a38ba015dea9174c23b20e344a0'
POSTGRES_TAG='postgres:17.6-bookworm'
VALUES
set -a; . /var/lib/harbor-install/values.env.new; set +a
for name in ACME_EMAIL OWNER_EMAIL; do
  if [[ ! "${!name}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then echo "STOP: set $name to an email address"; exit 1; fi
done
[ "$OWNER_EMAIL" = "${OWNER_EMAIL,,}" ] || { echo "STOP: write OWNER_EMAIL in lowercase; the enrollment compares it exactly with the email that Google reports"; exit 1; }
[ "$ORIGIN" = "https://$HOST" ] || { echo "STOP: ORIGIN must be https:// followed by HOST"; exit 1; }
[ "$PREVIEW_ORIGIN" = "https://$PREVIEW_HOST" ] || { echo "STOP: PREVIEW_ORIGIN must be https:// followed by PREVIEW_HOST"; exit 1; }
[ "$OIDC_SECRET_FILE" = "/etc/harbor-personal-oidc/$INSTANCE.secret" ] || { echo "STOP: OIDC_SECRET_FILE must be /etc/harbor-personal-oidc/INSTANCE.secret"; exit 1; }
chmod 0600 /var/lib/harbor-install/values.env.new
mv /var/lib/harbor-install/values.env.new /var/lib/harbor-install/values.env
echo "step 1 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
chmod 0600 /var/lib/harbor-install/progress
cat /var/lib/harbor-install/values.env
REMOTE
```

**Expect:**

- Block 1 prints `root` and `srv1464935`.
- Block 2 shows Ubuntu 24.04 on `x86_64`, `init: systemd` and `cgroup filesystem: cgroup2fs`, and ends with `HOST OK`. Copy the whole report into your log: the kernel, the Docker and Compose versions or `absent`, the running containers, the Docker packages, where `docker` and `dockerd` come from, the listeners, the free space, `ufw`, and whether `/root/Projects` exists.
- Block 2's `Docker case:` line is one of these, and step 3 acts on it:
  - `none`: no Docker package is installed, and there is no `docker` or `dockerd` command;
  - `ubuntu`: Ubuntu's `docker.io` supplies `docker` and `dockerd`, and the only other Docker packages are Ubuntu's `docker-compose-v2`, `docker-buildx` and `docker-doc`;
  - `docker-ce`: Docker's own `docker-ce`, `docker-ce-cli`, `containerd.io` and `docker-compose-plugin` are all installed and supply `docker` and `dockerd`, and the only other Docker packages are Docker's `docker-buildx-plugin`, `docker-ce-rootless-extras` and `docker-model-plugin`.
- Block 3 prints the values, with both email addresses filled in.

**If not:**

- If block 1 prints another hostname, stop: the owner confirms that the alias reaches the right VPS.
- If SSH reports a changed host key, the VPS was probably reinstalled. Stop: the owner compares the new key with the one that the hosting provider's console shows, before updating `known_hosts`.
- If block 2 prints `STOP`, stop. Leftovers from an earlier installation are the owner's decision, and this guide removes none of them. So is a Docker installation of any other kind, such as a snap, an incomplete set of Docker's packages, or a mix of Ubuntu's and Docker's packages.

### Step 2. DNS

**Where:** your computer.

**Check:** Run the progress block. If it lists `step 2 done`, go to step 3. This step changes nothing but the progress file, so it is safe to run again.

**Run:**

```bash
bash -euo pipefail -s <<'LOCAL'
vps() { ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s'; }
command -v dig >/dev/null || { echo "STOP: dig is not installed on this computer"; exit 1; }
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
vps > "$work/values.env" <<'REMOTE'
cat /var/lib/harbor-install/values.env
REMOTE
value() {
  [ "$(grep -c "^$1=" "$work/values.env")" = 1 ] || { echo "STOP: values.env must set $1 exactly once" >&2; return 1; }
  found=$(sed -n "s/^$1='\(.*\)'\$/\1/p" "$work/values.env")
  printf '%s\n' "$found" | grep -Eqx -e "$2" || { echo "STOP: $1 in values.env is not $3" >&2; return 1; }
  printf '%s\n' "$found"
}
host='[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+'
HOST=$(value HOST "$host" 'a host name') || exit 1
PREVIEW_HOST=$(value PREVIEW_HOST "$host" 'a host name') || exit 1
VPS_ADDRESS=$(value VPS_ADDRESS '([0-9]{1,3}\.){3}[0-9]{1,3}' 'an IPv4 address') || exit 1
status=0
for name in "$HOST" "$PREVIEW_HOST"; do
  a=$(dig +short A "$name" | grep -E '^[0-9.]+$' | sort -u | tr '\n' ' ' || true)
  aaaa=$(dig +short AAAA "$name" | grep -E '^[0-9a-fA-F:]+$' | sort -u | tr '\n' ' ' || true)
  echo "$name: A ${a:-none}; AAAA ${aaaa:-none}"
  if [ "$a" != "$VPS_ADDRESS " ]; then echo "STOP: $name must have exactly one A record, $VPS_ADDRESS"; status=1; fi
  if [ -n "$aaaa" ]; then echo "STOP: $name has an AAAA record"; status=1; fi
done
[ "$status" = 0 ] || exit 1
vps <<'REMOTE'
echo "step 2 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
echo "DNS OK"
LOCAL
```

**Expect:** `harbor.seekworld.tech: A 187.77.140.226 ; AAAA none`, the same line for the preview host, and `DNS OK`.

**If not:** Stop for the owner, who fixes the DNS record. Any AAAA record for the host must be removed, as the owner's checklist says, because Let's Encrypt may validate over IPv6. DNS changes can take time to spread; run the block again after the owner says the record is fixed.

### Step 3. Host packages

**Where:** the VPS.

**Check:** Run the progress block. If it lists `step 3 done`, go to step 4. The Run block is safe to run again.

**Run:** Run this block with a timeout of at least 20 minutes; its two package lock waits take at most three minutes each. The block finds out how Docker is installed, with the same test as step 1, and then installs the packages that the host lacks:

- `none` or `ubuntu`: Ubuntu's `docker.io` and `docker-compose-v2`, with `git`, `python3`, `make`, `g++`, `acl`, `curl` and `ca-certificates`.
- `docker-ce`: only `git`, `python3`, `make`, `g++`, `acl`, `curl` and `ca-certificates`. The block keeps Docker's own Docker Engine, because Ubuntu's Docker packages conflict with it: installing them would remove it and stop its containers.
- `other`: nothing. The block stops for the owner.

Ubuntu's Docker and Docker's own Docker Engine must pass the same version checks:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
export DEBIAN_FRONTEND=noninteractive
owner() {
  local path
  path=$(command -v "$1" || true)
  if [ -z "$path" ]; then echo none; return; fi
  dpkg-query -S "$(readlink -f "$path")" 2>/dev/null | sed -n 's/^\([a-z0-9][a-z0-9+.-]*\)\(:[a-z0-9]*\)\{0,1\}: .*/\1/p' | sed -n 1p | grep . || echo "unowned:$path"
}
has() { [[ " $packages " == *" $1 "* ]]; }
only() { local name; for name in $packages; do [[ " $* " == *" $name "* ]] || return 1; done; }
packages=$(dpkg-query -W -f='${db:Status-Abbrev} ${Package}\n' | awk 'substr($1, 2, 1) !~ /[nc]/ && $2 ~ /^(docker|moby-|containerd\.io$|podman-docker$)/ {print $2}' | sort | paste -sd ' ' -)
docker_from=$(owner docker)
dockerd_from=$(owner dockerd)
if [ -e /snap/bin/docker ]; then
  docker_case=other
elif [ -z "$packages" ] && [ "$docker_from $dockerd_from" = "none none" ]; then
  docker_case=none
elif has docker.io && only docker.io docker-compose-v2 docker-buildx docker-doc && [ "$docker_from $dockerd_from" = "docker.io docker.io" ]; then
  docker_case=ubuntu
elif has docker-ce && has docker-ce-cli && has containerd.io && has docker-compose-plugin && only docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin docker-ce-rootless-extras docker-model-plugin && [ "$docker_from $dockerd_from" = "docker-ce-cli docker-ce" ]; then
  docker_case=docker-ce
else
  docker_case=other
fi
echo "Docker packages: ${packages:-none}"
echo "docker from: $docker_from; dockerd from: $dockerd_from"
echo "Docker case: $docker_case"
case "$docker_case" in
  none|ubuntu) docker_packages='docker.io docker-compose-v2' ;;
  docker-ce) docker_packages= ;;
  *) echo "STOP: Docker is installed in a way that this guide does not handle"; exit 1 ;;
esac
apt-get -q -o DPkg::Lock::Timeout=180 update </dev/null
apt-get -q -o DPkg::Lock::Timeout=180 install -y $docker_packages git python3 make g++ acl curl ca-certificates </dev/null
systemctl enable --now docker.service
server=$(docker version --format '{{.Server.Version}}')
compose=$(docker compose version --short)
compose=${compose#v}
minor=${compose#*.}
minor=${minor%%.*}
echo "docker $server, compose $compose, apparmor_parser $(command -v apparmor_parser || echo missing)"
[ "${server%%.*}" -ge 29 ] || { echo "STOP: Docker $server is older than 29"; exit 1; }
if [ "${compose%%.*}" -lt 2 ] || { [ "${compose%%.*}" -eq 2 ] && [ "$minor" -lt 40 ]; }; then echo "STOP: Compose $compose is older than 2.40"; exit 1; fi
command -v apparmor_parser >/dev/null || { echo "STOP: apparmor_parser is missing"; exit 1; }
echo "step 3 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:** `Docker case: none`, `ubuntu` or `docker-ce`, as step 1 described them. After `none`, a rerun of the block reports `ubuntu`. Then a line such as `docker 29.1.3, compose 2.40.3, apparmor_parser /usr/sbin/apparmor_parser`, with Docker 29 or later and Compose 2.40 or later. On 30 September 2026, Ubuntu's `noble-updates` had Docker 29.1.3 and Compose 2.40.3.

**If not:** If `apt-get` reports that another process holds its lock, such as the automatic updates of a newly started VPS, wait five minutes and run the block again. If the block stops for the Docker case, or if Docker's own Docker Engine fails a version check, stop for the owner: this guide changes no other Docker installation. Otherwise stop. Do not add another package source.

### Step 4. Reverse proxy

**Where:** the VPS, then your computer.

**Check:** Run the progress block. If it lists `step 4 done`, go to step 5. Otherwise, this read-only block shows what serves ports 80 and 443:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
echo "Traefik containers: $(docker ps --format '{{.Names}} {{.Image}}' | grep -i traefik || echo none)"
echo "listeners on 80 and 443:"
ss -Hltnp '( sport = :80 or sport = :443 )'
echo "/opt/traefik: $([ -e /opt/traefik ] && echo exists || echo absent)"
if [ -e /opt/traefik ]; then ls -la /opt/traefik; fi
if command -v ufw >/dev/null; then ufw status; else echo "ufw: absent"; fi
REMOTE
```

- A Traefik container runs: block 1 keeps it and records the step, or, when it is the Traefik that this guide installed, says to run block 2.
- No Traefik runs and `/opt/traefik` is absent: block 1 installs Traefik.
- No Traefik runs and `/opt/traefik` exists: an earlier run of block 1 probably stopped before Traefik listened. When `/opt/traefik/compose.yaml` holds exactly the file that block 1 writes, with the pinned image and the owner's email, block 1 starts that Traefik again. In any other state, block 1 stops and describes what it found.

**Run:**

**Block 1.** Keep a running Traefik, or install the pinned one. The block keeps any running Traefik container and changes nothing else; step 8 proves that Traefik's route. When the running Traefik is the one that this guide installed, from an interrupted earlier run, the block says to run block 2. Otherwise it stops if something else listens on port 80 or 443, or if `ufw` is active without rules for ports 80 and 443. When `/opt/traefik` exists, the block starts Traefik again only if `/opt/traefik/compose.yaml` holds exactly the file that it writes, and stops otherwise. Else it writes `/opt/traefik/compose.yaml` with the pinned image and the owner's email, creates the certificate directory with mode `0700`, and starts Traefik:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
traefik_file() {
  cat <<YAML
name: traefik
services:
  traefik:
    image: ${TRAEFIK_IMAGE}
    network_mode: host
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    command:
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --entrypoints.websecure.address=:443
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /opt/traefik/letsencrypt:/letsencrypt
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
YAML
}
traefik=$(docker ps --format '{{.Names}} {{.Image}}' | grep -i traefik || true)
listeners=$(ss -Hltnp '( sport = :80 or sport = :443 )')
ufw=$(ufw status 2>/dev/null || true)
if grep -q '^Status: active' <<<"$ufw"; then
  if ! grep -Eq '^80(/tcp)? .*ALLOW' <<<"$ufw" || ! grep -Eq '^443(/tcp)? .*ALLOW' <<<"$ufw"; then
    echo "$ufw"
    echo "STOP: ufw is active without rules that allow ports 80 and 443"
    exit 1
  fi
fi
if [ -n "$traefik" ]; then
  if [ -f /opt/traefik/compose.yaml ] && cmp -s /opt/traefik/compose.yaml <(traefik_file); then
    echo "the Traefik that this guide installed runs; run block 2"
    exit 0
  fi
  echo "keeping the running Traefik: $traefik"
  echo "step 4 done $(date -u +%FT%TZ) existing Traefik kept" >> /var/lib/harbor-install/progress
  exit 0
fi
if [ -n "$listeners" ]; then echo "$listeners"; echo "STOP: something other than Traefik listens on port 80 or 443"; exit 1; fi
if [ -e /opt/traefik ]; then
  if [ ! -f /opt/traefik/compose.yaml ] || ! cmp -s /opt/traefik/compose.yaml <(traefik_file); then
    ls -la /opt/traefik
    if [ -f /opt/traefik/compose.yaml ]; then
      echo "STOP: no Traefik runs, and /opt/traefik/compose.yaml differs from the file that this block writes"
    else
      echo "STOP: no Traefik runs, and /opt/traefik has no compose.yaml"
    fi
    exit 1
  fi
  echo "no Traefik runs; starting the Traefik that an earlier run of this block wrote to /opt/traefik"
  install -d -m 0700 /opt/traefik/letsencrypt
else
  install -d -m 0755 /opt/traefik
  install -d -m 0700 /opt/traefik/letsencrypt
  traefik_file > /opt/traefik/compose.yaml
  chmod 0644 /opt/traefik/compose.yaml
fi
docker compose -f /opt/traefik/compose.yaml config --quiet </dev/null
docker compose -f /opt/traefik/compose.yaml up -d </dev/null
ready=no
for attempt in $(seq 1 30); do
  if grep -q traefik <<<"$(ss -Hltnp '( sport = :80 )')" && grep -q traefik <<<"$(ss -Hltnp '( sport = :443 )')"; then ready=yes; break; fi
  sleep 2
done
if [ "$ready" != yes ]; then docker compose -f /opt/traefik/compose.yaml logs --tail 20 </dev/null; echo "STOP: Traefik does not listen on ports 80 and 443"; exit 1; fi
echo "Traefik listens on ports 80 and 443"
REMOTE
```

**Block 2.** Run this block only if block 1 installed Traefik or printed `run block 2`, and skip it if block 1 printed `keeping the running Traefik`. It checks from your computer that HTTP redirects to HTTPS:

```bash
bash -euo pipefail -s <<'LOCAL'
vps() { ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s'; }
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
vps > "$work/values.env" <<'REMOTE'
cat /var/lib/harbor-install/values.env
REMOTE
value() {
  [ "$(grep -c "^$1=" "$work/values.env")" = 1 ] || { echo "STOP: values.env must set $1 exactly once" >&2; return 1; }
  found=$(sed -n "s/^$1='\(.*\)'\$/\1/p" "$work/values.env")
  printf '%s\n' "$found" | grep -Eqx -e "$2" || { echo "STOP: $1 in values.env is not $3" >&2; return 1; }
  printf '%s\n' "$found"
}
HOST=$(value HOST '[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+' 'a host name') || exit 1
answer=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "http://$HOST/")
echo "http://$HOST/ answers: $answer"
case "$answer" in
  "301 https://$HOST/"|"308 https://$HOST/") ;;
  *) echo "STOP: expected a redirect to https://$HOST/"; exit 1 ;;
esac
vps <<'REMOTE'
echo "step 4 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
echo "REDIRECT OK"
LOCAL
```

The installed Traefik remains trusted with host-level power: a read-only mount of the Docker socket does not limit what Traefik can do through the Docker API, as the personal VPS guide already assumes. It has no API, dashboard or access log. With the access log off, the enrollment start URL and the sign-in callback stay out of the proxy's logs.

**Expect:** Either `keeping the running Traefik:` with the container, or `Traefik listens on ports 80 and 443` followed by `http://harbor.seekworld.tech/ answers: 301 https://harbor.seekworld.tech/` (308 is also correct) and `REDIRECT OK`. When block 1 resumes an earlier run, it first prints `no Traefik runs; starting the Traefik that an earlier run of this block wrote to /opt/traefik`.

**If not:** Stop. If `ufw` blocks the ports, the owner decides whether to allow them. If block 1 stops because `/opt/traefik` exists, it lists the directory and says whether `compose.yaml` is missing or differs; what happens to that directory is the owner's decision. If block 2 cannot connect, the owner checks the hosting firewall.

### Step 5. First release

**Where:** your computer, then the VPS.

**Check:** Run the progress block. If it lists `step 5 done`, go to step 6. Otherwise, run this read-only block:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
incoming=/var/lib/harbor-deploy/incoming/bootstrap
if [ ! -e "$incoming" ]; then
  echo "upload: absent"
elif [ -n "${REVISION:-}" ] && [ -s "$incoming/harbor.bundle" ] && [ "$(git -C "$incoming/tools" rev-parse HEAD 2>/dev/null)" = "$REVISION" ] && [ -z "$(git -C "$incoming/tools" --no-optional-locks status --porcelain 2>/dev/null || echo unknown)" ]; then
  echo "upload: complete, revision $REVISION"
else
  echo "upload: incomplete"
fi
echo "build unit: $(systemctl show -p LoadState -p SubState -p ExecMainStatus harbor-install-bootstrap.service | tr '\n' ' ')"
echo "releases: $(ls -A /opt/harbor-personal/releases 2>/dev/null | tr '\n' ' ')"
REMOTE
```

- `upload: absent` or `upload: incomplete`, and `LoadState=not-found`: run blocks 1, 2 and 3. Block 1 replaces an incomplete upload.
- `upload: complete` and `LoadState=not-found`: run blocks 2 and 3.
- `LoadState=loaded`: run block 3.
- A `.staging-` entry under releases: stop for the owner.

**Run:**

**Block 1.** On your computer: read the saved revision from `~/harbor-install-log/guide-revision.txt`, fetch `origin/main`, and stop unless the saved revision is `origin/main` or one of its ancestors. Then make a Git bundle of the saved revision in a temporary directory outside the repository. The bundle comes from a temporary bare repository whose `main` branch points at the saved revision, so the clone's branch, index and working tree stay as they are. On the VPS, the block stops if the build unit exists, and otherwise replaces any upload that an earlier run of this block left behind. It then uploads the bundle, clones `tools` from it with the deploy workflow's modes and commands, and records the revision in `values.env`:

```bash
bash -euo pipefail -s <<'LOCAL'
vps() { ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s'; }
clone=$(git rev-parse --show-toplevel)
saved="$HOME/harbor-install-log/guide-revision.txt"
[ -f "$saved" ] || { echo "STOP: $saved is missing; the block before step 1 saves it"; exit 1; }
revision=$(cat "$saved")
printf '%s\n' "$revision" | grep -Eqx '[0-9a-f]{40}' || { echo "STOP: $saved does not hold a full commit SHA"; exit 1; }
echo "saved revision: $revision"
git -C "$clone" fetch -q origin main </dev/null
git -C "$clone" merge-base --is-ancestor "$revision" origin/main || { echo "STOP: the saved revision is not origin/main or one of its ancestors"; exit 1; }
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
git init -q --bare "$work/source.git"
git -C "$work/source.git" fetch -q --no-tags "$clone" "+refs/remotes/origin/main:refs/heads/main" </dev/null
git -C "$work/source.git" update-ref refs/heads/main "$revision"
git -C "$work/source.git" symbolic-ref HEAD refs/heads/main
[ "$(git -C "$work/source.git" rev-parse HEAD)" = "$revision" ] || { echo "STOP: the bundle source is not $revision"; exit 1; }
git -C "$work/source.git" bundle create "$work/harbor.bundle" HEAD main
vps <<'REMOTE'
unit=harbor-install-bootstrap.service
incoming=/var/lib/harbor-deploy/incoming/bootstrap
if [ "$(systemctl show -p LoadState --value "$unit")" != not-found ]; then echo "STOP: $unit exists, so the build has started; run block 3"; exit 1; fi
sed -i '/^REVISION=/d' /var/lib/harbor-install/values.env
if [ -e "$incoming" ]; then
  echo "replacing the upload that an earlier run of this block left in $incoming"
  rm -rf -- "$incoming"
fi
install -d -m 0755 /var/lib/harbor-deploy /var/lib/harbor-deploy/incoming && install -d -m 0755 /var/lib/harbor-deploy/incoming/bootstrap
REMOTE
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'cat > /var/lib/harbor-deploy/incoming/bootstrap/harbor.bundle && chmod 0644 /var/lib/harbor-deploy/incoming/bootstrap/harbor.bundle' < "$work/harbor.bundle"
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps bash -euo pipefail -s "$revision" <<'REMOTE'
cd /var/lib/harbor-deploy/incoming/bootstrap
git clone -q --no-checkout harbor.bundle tools
git -C tools checkout -q --detach "$1"
test "$(git -C tools rev-parse HEAD)" = "$1"
[ -z "$(git -C tools status --porcelain)" ] || { echo "STOP: the tools checkout is not clean"; exit 1; }
printf "REVISION='%s'\n" "$1" >> /var/lib/harbor-install/values.env
REMOTE
echo "UPLOADED $revision"
LOCAL
```

**Block 2.** On the VPS: check that the upload is complete, at the revision that block 1 recorded, and start `deploy-release bootstrap` from the uploaded `tools` clone, in a transient unit that writes to `/var/lib/harbor-install/bootstrap.log`. `bootstrap` downloads the pinned Node, Codex and pnpm files, checks their SHA-256 values, builds the release as a transient unprivileged user, and stages it under `/opt/harbor-personal/releases`:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
unit=harbor-install-bootstrap.service
incoming=/var/lib/harbor-deploy/incoming/bootstrap
if [ "$(systemctl show -p LoadState --value "$unit")" != not-found ]; then echo "STOP: $unit already exists; run block 3"; exit 1; fi
revision=${REVISION:-}
if [ -z "$revision" ] || [ ! -s "$incoming/harbor.bundle" ] || [ "$(git -C "$incoming/tools" rev-parse HEAD 2>/dev/null)" != "$revision" ] || [ -n "$(git -C "$incoming/tools" --no-optional-locks status --porcelain 2>/dev/null || echo unknown)" ]; then
  echo "STOP: the upload is incomplete; run block 1 again"
  exit 1
fi
systemd-run --unit="$unit" -p RemainAfterExit=yes -p StandardOutput=truncate:/var/lib/harbor-install/bootstrap.log /usr/bin/python3 "$incoming/tools/infra/personal-vps/deploy-release" bootstrap --bundle "$incoming/harbor.bundle" --revision "$revision"
echo "started $unit for revision $revision"
REMOTE
```

**Block 3.** Wait for the build, which takes several minutes. Run this block again while it prints `WAIT`:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
unit=harbor-install-bootstrap.service
log=/var/lib/harbor-install/bootstrap.log
end=$((SECONDS + 480))
beat=$((SECONDS + 40))
while [ "$(systemctl show -p SubState --value "$unit")" = running ] && [ "$SECONDS" -lt "$end" ]; do
  sleep 15
  if [ "$SECONDS" -ge "$beat" ]; then echo "still waiting after $SECONDS seconds: the build is running"; beat=$((SECONDS + 40)); fi
done
load=$(systemctl show -p LoadState --value "$unit")
state=$(systemctl show -p SubState --value "$unit")
status=$(systemctl show -p ExecMainStatus --value "$unit")
echo "$unit: $load, $state, exit status $status"
if [ "$load" = not-found ]; then echo "STOP: the build unit does not exist; run block 2 first"; exit 1; fi
if [ "$state" = running ]; then tail -n 3 "$log"; echo "WAIT: the build is still running; run this block again"; exit 0; fi
if [ "$state" != exited ] || [ "$status" != 0 ]; then tail -n 40 "$log"; echo "STOP: the build failed; see Recovery"; exit 1; fi
grep '^\[deploy\]' "$log" || true
python3 - <<'PY'
import hashlib
import json
from pathlib import Path
values = Path('/var/lib/harbor-install/values.env')
lines = values.read_text().splitlines()
revision = [line.split('=', 1)[1].strip("'") for line in lines if line.startswith('REVISION=')][0]
result = json.loads(Path('/var/lib/harbor-install/bootstrap.log').read_text().splitlines()[-1])
release = '/opt/harbor-personal/releases/bootstrap-' + revision[:12]
if result.get('release') != release:
    raise SystemExit('STOP: the build reported ' + str(result.get('release')) + ', not ' + release)
manifest = hashlib.sha256(Path(release, 'artifact.json').read_bytes()).hexdigest()
if result.get('manifestSha256', manifest) != manifest:
    raise SystemExit('STOP: the manifest SHA-256 differs from the build result')
lines = [line for line in lines if not line.startswith(('RELEASE=', 'MANIFEST_SHA256='))]
lines += ["RELEASE='%s'" % release, "MANIFEST_SHA256='%s'" % manifest]
values.write_text('\n'.join(lines) + '\n')
print(json.dumps(result))
print('release', release, 'manifest SHA-256', manifest)
PY
systemctl stop "$unit"
echo "step 5 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:**

- Block 1 prints `saved revision:` with the revision in `~/harbor-install-log/guide-revision.txt`, and ends with `UPLOADED` and the same revision, even when `origin/main` has moved on since you saved the guide. When it finds an earlier upload, it also prints `replacing the upload that an earlier run of this block left`. Block 2 prints `started harbor-install-bootstrap.service for revision` with the same revision.
- For a new build, block 3 prints four `Downloading` lines and four `Verified` lines, one each for `node-v24.11.1-linux-x64.tar.xz`, `codex-0.153.4-linux-x64.tgz`, `pnpm-12.3.4.tgz` and `exe.linux-x64-12.3.4.tgz`. Then it prints `Building` with the revision, and `Staged /opt/harbor-personal/releases/bootstrap-` followed by the first 12 characters of the revision. The JSON line has `release`, `revision`, `archiveSha256`, `fileCount`, `manifestSha256` and `"reused": false`.
- When an earlier attempt already staged the release, `bootstrap` verifies it against the revision and reuses it, without downloading or building. Block 3 then prints one `[deploy]` line, `Release already staged and verified:` with the path, and the JSON line has only `release` and `"reused": true`.
- The last line is `release /opt/harbor-personal/releases/bootstrap-` with the revision's first 12 characters, and the manifest SHA-256.

**If not:** Stop. If block 1 stops because the saved revision is not `origin/main` or one of its ancestors, `main` was rewritten after you saved the guide; the owner decides how to continue. `bootstrap` refuses before it writes anything when the host has an instance configuration, when its staging directory exists, or when a filesystem that it writes to lacks space. [Recovery](#recovery) covers a refusal or a failed build.

### Step 6. Service account

**Where:** the VPS.

**Check:** Run the progress block. If it lists `step 6 done`, go to step 7. The Run block is safe to run again.

**Run:**

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
getent passwd "$SERVICE_USER" >/dev/null || useradd --system --no-create-home --user-group --shell /usr/sbin/nologin "$SERVICE_USER"
id "$SERVICE_USER"
entry=$(getent passwd "$SERVICE_USER")
[ "${entry##*:}" = /usr/sbin/nologin ] || { echo "STOP: the login shell is ${entry##*:}"; exit 1; }
[ "$(id -u "$SERVICE_USER")" != 0 ] || { echo "STOP: the account is root"; exit 1; }
[ "$(id -G "$SERVICE_USER")" = "$(id -g "$SERVICE_USER")" ] || { echo "STOP: the account has supplementary groups"; exit 1; }
echo "step 6 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:** `id` prints one group, the account's own, as in `uid=999(harbor-personal) gid=999(harbor-personal) groups=999(harbor-personal)`. The numbers may differ.

**If not:** Stop.

### Step 7. Project folder and ACLs

**Where:** the owner, then the VPS.

**Check:** Run the progress block. If it lists `step 7 done`, go to step 8. Otherwise, run this read-only block. It also prints the exact commands that the Run block runs:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
echo "$PROJECTS: $([ -d "$PROJECTS" ] && echo exists || echo missing)"
echo "ACL backup: $([ -e /var/lib/harbor-install/root-acl-before.txt ] && echo exists || echo missing)"
echo "directories under $PROJECTS: $(find "$PROJECTS" -type d 2>/dev/null | wc -l)"
echo "The Run block runs these commands as root, then checks the result as $SERVICE_USER:"
[ -d "$PROJECTS" ] || echo "  install -d -o root -g root -m 0700 $PROJECTS"
echo "  getfacl -R -p /root/.ssh > /var/lib/harbor-install/ssh-acl-before.txt"
echo "  getfacl -R -p /root > /var/lib/harbor-install/root-acl-before.txt"
echo "  setfacl -m u:$SERVICE_USER:r-x /root"
echo "  setfacl -R -m u:$SERVICE_USER:rwX $PROJECTS"
echo "  find $PROJECTS -type d -exec setfacl -m d:u:$SERVICE_USER:rwX {} +"
REMOTE
```

**Run:**

**Block 1, the owner.** Show the owner the commands that the Check block printed, and what they do. The service account may read and traverse `/root` itself, and may read and write everything under `/root/Projects`. Default ACLs on the directories there cover new content too. `/root/.ssh` and the rest of `/root` keep their ACLs, and the backup is taken first. Wait for the owner's yes. Automatic approval once refused this change until the owner confirmed its exact scope.

**Block 2.** After the owner's yes, apply the ACLs and check them as the service account:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
backup=/var/lib/harbor-install/root-acl-before.txt
[ -d "$PROJECTS" ] || install -d -o root -g root -m 0700 "$PROJECTS"
if [ ! -e "$backup" ]; then
  getfacl -R -p /root/.ssh > /var/lib/harbor-install/ssh-acl-before.txt
  getfacl -R -p /root > "$backup.new"
  mv "$backup.new" "$backup"
fi
setfacl -m "u:$SERVICE_USER:r-x" /root
setfacl -R -m "u:$SERVICE_USER:rwX" "$PROJECTS"
find "$PROJECTS" -type d -exec setfacl -m "d:u:$SERVICE_USER:rwX" {} +
runuser -u "$SERVICE_USER" -- test -r /root
runuser -u "$SERVICE_USER" -- test -x /root
echo "the service account can read and traverse /root"
runuser -u "$SERVICE_USER" -- touch "$PROJECTS/.harbor-acl-canary"
runuser -u "$SERVICE_USER" -- rm "$PROJECTS/.harbor-acl-canary"
echo "the service account can create and remove a file in $PROJECTS"
if runuser -u "$SERVICE_USER" -- touch /root/.harbor-acl-canary 2>/dev/null; then
  rm -f /root/.harbor-acl-canary
  echo "STOP: the service account can create a file at the top of /root"
  exit 1
fi
echo "the service account cannot create a file at the top of /root"
if ! diff -q <(getfacl -R -p /root/.ssh) /var/lib/harbor-install/ssh-acl-before.txt >/dev/null; then echo "STOP: the ACLs under /root/.ssh changed"; exit 1; fi
echo "the ACLs under /root/.ssh match the backup"
echo "step 7 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

To undo the ACL change later, the owner can run `setfacl --restore=/var/lib/harbor-install/root-acl-before.txt` as root on the VPS. It restores every path that the backup lists; paths created after the backup keep the ACLs that they inherited.

**Expect:** the three `the service account` lines, and `the ACLs under /root/.ssh match the backup`.

**If not:** Stop. Do not change other ACLs or modes to make a check pass.

### Step 8. Google client and owner enrollment

**Where:** your computer, the VPS and the owner.

**Check:** Run the progress block. If it lists `step 8 done`, go to step 9. Otherwise, run this read-only block:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
for path in /etc/harbor-personal-onboarding/google-client.json "$OIDC_SECRET_FILE" /etc/systemd/system/harbor-personal-enroll.service /var/lib/harbor-install/enroll-route.json /var/lib/harbor-personal-onboarding/owner.json /var/lib/harbor-install/owner.json; do
  echo "$path: $([ -e "$path" ] && echo present || echo absent)"
done
echo "enrollment service: $(systemctl show -p SubState --value harbor-personal-enroll.service)"
echo "client ID: ${OIDC_CLIENT_ID:+recorded}; image: ${POSTGRES_IMAGE:+recorded}"
REMOTE
```

- Nothing present: start at block 1.
- The client file present, and either no secret file or a value not recorded: start at block 2.
- The secret file present and both values recorded, but no unit: start at block 3.
- The unit present and the service `running`, without either `owner.json`: run block 3 again, which prints the same link, or block 5 to wait.
- The unit present and the service not `running`, without either `owner.json`: the link expired or the service stopped. Run block 3 again, which starts the service with a new link.
- `/var/lib/harbor-personal-onboarding/owner.json` present: run blocks 5 and 6.
- Of the two `owner.json` files, only `/var/lib/harbor-install/owner.json` present: run block 6.

**Run:**

**Block 1.** Ask the owner for the full path of the Google client JSON on this computer. In this block, replace `CHANGE-ME` with that path, then run it. It copies the file to the VPS without displaying it:

```bash
bash -euo pipefail -s <<'LOCAL'
CLIENT_JSON='CHANGE-ME'
vps() { ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s'; }
[ "$CLIENT_JSON" != CHANGE-ME ] || { echo "STOP: set CLIENT_JSON to the path that the owner gave"; exit 1; }
case "$CLIENT_JSON" in "~/"*) CLIENT_JSON="$HOME/${CLIENT_JSON#"~/"}" ;; esac
[ -f "$CLIENT_JSON" ] || { echo "STOP: $CLIENT_JSON is not a file"; exit 1; }
vps <<'REMOTE'
install -d -m 0700 /etc/harbor-personal-onboarding /etc/harbor-personal-oidc
REMOTE
scp -q -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 "$CLIENT_JSON" harbor-vps:/etc/harbor-personal-onboarding/google-client.json </dev/null
vps <<'REMOTE'
chmod 0600 /etc/harbor-personal-onboarding/google-client.json
stat -c '%n %U %a %s bytes' /etc/harbor-personal-onboarding/google-client.json
REMOTE
LOCAL
```

**Block 2.** On the VPS: check the client file without printing its secret, write the secret alone to the secret file, record the client ID, then pull PostgreSQL and record the image with its digest:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
python3 - <<'PY'
import json
import os
import re
env = os.environ
web = json.load(open('/etc/harbor-personal-onboarding/google-client.json')).get('web')
if not isinstance(web, dict) or not all(isinstance(web.get(key), str) and web[key] for key in ('client_id', 'client_secret')):
    raise SystemExit('STOP: the client file has no web.client_id and web.client_secret')
client_id, secret = web['client_id'], web['client_secret']
if not re.fullmatch(r'[A-Za-z0-9._-]+', client_id):
    raise SystemExit('STOP: unexpected characters in the client ID')
if any(ord(ch) < 32 for ch in secret):
    raise SystemExit('STOP: the client secret is not one line of text')
callback = env['ORIGIN'] + '/auth/callback'
listed = callback in (web.get('redirect_uris') or [])
print('redirect URI', callback, 'is listed in the file' if listed else 'is NOT listed in the file')
path = env['OIDC_SECRET_FILE']
if os.path.exists(path):
    if open(path).read().strip() != secret:
        raise SystemExit('STOP: ' + path + ' exists and holds a different secret')
else:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(secret + '\n')
print('secret file', path, 'mode', oct(os.stat(path).st_mode & 0o777))
values = '/var/lib/harbor-install/values.env'
lines = [line for line in open(values).read().splitlines() if not line.startswith('OIDC_CLIENT_ID=')]
lines.append("OIDC_CLIENT_ID='%s'" % client_id)
open(values, 'w').write('\n'.join(lines) + '\n')
print('client ID', client_id)
PY
docker pull -q "$POSTGRES_TAG" </dev/null
digests=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$POSTGRES_TAG")
digest=$(sed -n 's|^\(docker\.io/library/\)\{0,1\}postgres@\(sha256:[0-9a-f]\{64\}\)$|\2|p' <<<"$digests" | sed -n 1p)
[ -n "$digest" ] || { echo "STOP: no postgres digest in: $digests"; exit 1; }
sed -i '/^POSTGRES_IMAGE=/d' /var/lib/harbor-install/values.env
printf "POSTGRES_IMAGE='%s@%s'\n" "$POSTGRES_TAG" "$digest" >> /var/lib/harbor-install/values.env
echo "postgres image $POSTGRES_TAG@$digest"
REMOTE
```

**Block 3.** Create the `harbor-enroll` account, the enrollment configuration, the temporary unit `harbor-personal-enroll.service` and the temporary route. Start the route, then the service, and wait about three minutes, 36 attempts, for the route to answer over a verified certificate with the enrollment helper's own `404` and body `Not found`. Traefik's own `404 page not found` means that the route is not in place yet. When the service is not running, the block first removes a start URL that an earlier, stopped run left behind. The service runs the enrollment helper from the new release. Through `LoadCredential=`, systemd gives it read access to root-owned copies of its configuration and the client file, and it writes only to its private state directory. The route copies the installer's routing carrier, with its own Compose project and router, `harbor-enroll-seekworld`:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
[ ! -e /var/lib/harbor-personal-onboarding/owner.json ] || { echo "STOP: the enrollment already has a result; run block 5"; exit 1; }
if [ "$(systemctl show -p SubState --value harbor-personal-enroll.service)" != running ]; then rm -f /var/lib/harbor-personal-onboarding/start-url; fi
getent passwd harbor-enroll >/dev/null || useradd --system --no-create-home --user-group --shell /usr/sbin/nologin harbor-enroll
python3 - <<'PY'
import json
import os
env = os.environ
def write(path, data):
    fd = os.open(path + '.new', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(json.dumps(data, indent=2) + '\n')
    os.replace(path + '.new', path)
state = '/var/lib/harbor-personal-onboarding'
write('/etc/harbor-personal-onboarding/enrollment.json', {
    'origin': env['ORIGIN'], 'issuer': env['OIDC_ISSUER'], 'expectedEmail': env['OWNER_EMAIL'],
    'clientFile': '/run/credentials/harbor-personal-enroll.service/google-client.json',
    'resultFile': state + '/owner.json', 'startTokenFile': state + '/start-url',
    'port': int(env['ENROLL_PORT']), 'ttlSeconds': 1800})
name = 'harbor-enroll-' + env['INSTANCE']
router = 'traefik.http.routers.' + name
write('/var/lib/harbor-install/enroll-route.json', {'name': name, 'services': {'routing': {
    'image': env['POSTGRES_IMAGE'], 'entrypoint': ['/bin/sleep', 'infinity'],
    'user': '65534:65534', 'network_mode': 'host', 'restart': 'no',
    'read_only': True, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
    'mem_limit': '32m', 'cpus': 0.1, 'pids_limit': 16,
    'labels': {'traefik.enable': 'true', router + '.rule': 'Host(`' + env['HOST'] + '`)',
               router + '.entrypoints': 'websecure', router + '.tls.certresolver': 'letsencrypt',
               router + '.service': name,
               'traefik.http.services.' + name + '.loadbalancer.server.port': env['ENROLL_PORT']}}}})
PY
cat > /etc/systemd/system/harbor-personal-enroll.service <<UNIT
[Unit]
Description=Harbor one-time owner enrollment
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=harbor-enroll
Group=harbor-enroll
WorkingDirectory=${RELEASE}
ExecStart=${RELEASE}/bin/node --import tsx ${RELEASE}/infra/personal-vps/enroll-owner.ts %d/enrollment.json
LoadCredential=enrollment.json:/etc/harbor-personal-onboarding/enrollment.json
LoadCredential=google-client.json:/etc/harbor-personal-onboarding/google-client.json
StateDirectory=harbor-personal-onboarding
StateDirectoryMode=0700
Restart=no
RuntimeMaxSec=3600
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
UNIT
chmod 0644 /etc/systemd/system/harbor-personal-enroll.service
systemctl daemon-reload
docker compose -f /var/lib/harbor-install/enroll-route.json config --quiet </dev/null
docker compose -f /var/lib/harbor-install/enroll-route.json up -d </dev/null
systemctl start harbor-personal-enroll.service
answer=none
beat=$((SECONDS + 40))
for attempt in $(seq 1 36); do
  answer=$(curl -sS --max-time 5 -w ' %{http_code}' "$ORIGIN/enroll/invalid" 2>/dev/null || true)
  [ "$answer" = 'Not found 404' ] && break
  if [ "$(systemctl show -p SubState --value harbor-personal-enroll.service)" != running ]; then
    journalctl -u harbor-personal-enroll.service -n 20 --no-pager || true
    echo "STOP: the enrollment service is not running"
    exit 1
  fi
  if [ "$SECONDS" -ge "$beat" ]; then echo "still waiting after $SECONDS seconds: the route answered '${answer:0:80}'"; beat=$((SECONDS + 40)); fi
  sleep 5
done
[ "$answer" = 'Not found 404' ] || { echo "STOP: $ORIGIN/enroll/invalid did not answer 404 Not found over a verified certificate (last answer: '${answer:0:200}')"; exit 1; }
echo "the enrollment route answers 404 Not found over a verified certificate"
for attempt in $(seq 1 30); do [ -f /var/lib/harbor-personal-onboarding/start-url ] && break; sleep 2; done
[ -f /var/lib/harbor-personal-onboarding/start-url ] || { echo "STOP: the enrollment service wrote no start URL"; exit 1; }
echo "START URL, FOR THE OWNER ONLY: $(cat /var/lib/harbor-personal-onboarding/start-url)"
REMOTE
```

**Block 4, the owner.** Give the start URL only to the owner, and keep it out of your log. The owner opens it within about 25 minutes of receiving it, signs in with the Google account of `OWNER_EMAIL`, and finishes signing in within 10 minutes of opening it. The limits come from `infra/personal-vps/enroll-owner.ts`: the service's limit of 1800 seconds starts when the service starts, a few minutes before block 3 prints the link, and each sign-in attempt lasts 10 minutes. The page then says "Your account is verified. You can close this page; Harbor setup will continue."

**Block 5.** Wait for the result. Run this block again while it prints `WAIT`:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
result=/var/lib/harbor-personal-onboarding/owner.json
state() { systemctl show -p SubState --value harbor-personal-enroll.service; }
end=$((SECONDS + 480))
beat=$((SECONDS + 40))
while [ ! -f "$result" ] && [ "$(state)" = running ] && [ "$SECONDS" -lt "$end" ]; do
  sleep 10
  if [ "$SECONDS" -ge "$beat" ]; then echo "still waiting after $SECONDS seconds: the owner has not signed in yet"; beat=$((SECONDS + 40)); fi
done
if [ ! -f "$result" ]; then
  if [ "$(state)" = running ]; then echo "WAIT: the owner has not signed in yet; run this block again"; exit 0; fi
  echo "STOP: the enrollment service ended ($(state)) without a result; see Recovery"
  exit 1
fi
for attempt in $(seq 1 30); do
  [ "$(state)" != running ] && break
  if [ "$SECONDS" -ge "$beat" ]; then echo "still waiting after $SECONDS seconds: the enrollment service is stopping after writing its result"; beat=$((SECONDS + 40)); fi
  sleep 2
done
[ "$(state)" != running ] || { echo "STOP: the enrollment service still runs after writing its result"; exit 1; }
python3 - <<'PY'
import json
import os
owner = json.load(open('/var/lib/harbor-personal-onboarding/owner.json'))
if owner.get('issuer') != os.environ['OIDC_ISSUER'] or owner.get('email') != os.environ['OWNER_EMAIL'] or not owner.get('subject'):
    raise SystemExit('STOP: the result holds no subject for ' + os.environ['OWNER_EMAIL'] + ' from ' + os.environ['OIDC_ISSUER'])
print('enrolled', owner['email'], 'from', owner['issuer'])
PY
install -m 0600 "$result" /var/lib/harbor-install/owner.json
echo "copied the result to /var/lib/harbor-install/owner.json"
REMOTE
```

**Block 6.** Remove the temporary route, the unit, the `harbor-enroll` account and the enrollment files. The secret file keeps the only other copy of the client secret:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
[ -s /var/lib/harbor-install/owner.json ] || { echo "STOP: /var/lib/harbor-install/owner.json is missing or empty; run block 5"; exit 1; }
[ -s "$OIDC_SECRET_FILE" ] || { echo "STOP: $OIDC_SECRET_FILE is missing or empty"; exit 1; }
[ -n "${OIDC_CLIENT_ID:-}" ] || { echo "STOP: the client ID is not recorded"; exit 1; }
[ "$(systemctl show -p SubState --value harbor-personal-enroll.service)" != running ] || { echo "STOP: the enrollment service is running"; exit 1; }
if [ -f /var/lib/harbor-install/enroll-route.json ]; then
  docker compose -f /var/lib/harbor-install/enroll-route.json down </dev/null
  rm -f /var/lib/harbor-install/enroll-route.json
fi
rm -f /etc/systemd/system/harbor-personal-enroll.service
systemctl daemon-reload
systemctl reset-failed harbor-personal-enroll.service 2>/dev/null || true
if getent passwd harbor-enroll >/dev/null; then userdel harbor-enroll; fi
rm -rf -- /var/lib/harbor-personal-onboarding /etc/harbor-personal-onboarding
echo "removed the enrollment service, its route, its account and its files"
echo "step 8 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:**

- Block 1 prints `/etc/harbor-personal-onboarding/google-client.json root 600` and the file's size.
- Block 2 prints `redirect URI https://harbor.seekworld.tech/auth/callback is listed in the file`, `secret file /etc/harbor-personal-oidc/seekworld.secret mode 0o600`, the client ID, and `postgres image postgres:17.6-bookworm@sha256:` followed by 64 hexadecimal characters. If the redirect URI is not listed, the file may be older than the URI: ask the owner to confirm that the client's authorized redirect URIs contain it exactly, then continue.
- Block 3 prints `the enrollment route answers 404 Not found over a verified certificate` and the start URL. While it waits, a last answer of `000` means that no verified HTTPS connection was made yet.
- Block 5 prints `enrolled`, the owner's email and `https://accounts.google.com`, then the copy line.
- Block 6 prints the removal line.

**If not:** Stop. If the certificate check fails, see the Let's Encrypt case in [Recovery](#recovery). If the link expired, or the owner saw an error page, see the enrollment case there.

### Step 9. Configuration

**Where:** the VPS.

**Check:** Run the progress block. If it lists `step 9 done`, go to step 10. The Run block keeps an existing `/var/lib/harbor-install/seekworld.json` and only validates it again, so it is safe to run again.

**Run:** List the release's bundled models in a scratch home, record them, write the configuration with a short Python block, and validate it:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
cd /
config=/var/lib/harbor-install/$INSTANCE.json
scratch=/var/lib/harbor-install/scratch-home
rm -rf -- "$scratch"
install -d -m 0700 "$scratch" "$scratch/home" "$scratch/codex-home"
env -i PATH=/usr/bin:/bin HOME="$scratch/home" CODEX_HOME="$scratch/codex-home" "$RELEASE/bin/codex" -c 'cli_auth_credentials_store="file"' -c features.plugins=false debug models --bundled </dev/null > "$scratch/models.json"
models=$(python3 -c 'import json, sys; print(",".join(m["slug"] for m in json.load(open(sys.argv[1]))["models"] if m.get("visibility") == "list"))' "$scratch/models.json")
rm -rf -- "$scratch"
[ -n "$models" ] || { echo "STOP: the release's Codex listed no models"; exit 1; }
echo "bundled models: $models"
sed -i '/^MODELS=/d' /var/lib/harbor-install/values.env
printf "MODELS='%s'\n" "$models" >> /var/lib/harbor-install/values.env
export MODELS="$models"
if [ -e "$config" ]; then
  echo "keeping the existing $config"
else
  python3 - <<'PY'
import json
import os
import uuid
env = os.environ
owner = json.load(open('/var/lib/harbor-install/owner.json'))
if owner.get('issuer') != env['OIDC_ISSUER'] or not owner.get('subject'):
    raise SystemExit('STOP: owner.json holds no subject from ' + env['OIDC_ISSUER'])
config = {
    'instance': env['INSTANCE'],
    'origin': env['ORIGIN'],
    'oidcIssuer': env['OIDC_ISSUER'],
    'oidcClientId': env['OIDC_CLIENT_ID'],
    'ownerSubject': owner['subject'],
    'oidcSecretFile': env['OIDC_SECRET_FILE'],
    'release': env['RELEASE'],
    'user': env['SERVICE_USER'],
    'apiPort': int(env['API_PORT']),
    'databasePort': int(env['DATABASE_PORT']),
    'roots': [{'id': str(uuid.uuid4()), 'name': env['ROOT_NAME'], 'path': env['ROOT_PATH']}],
    'postgresImage': env['POSTGRES_IMAGE'],
    'models': env['MODELS'].split(','),
    'traefik': True,
    'apparmorUserns': True,
    'previews': [{'name': env['PREVIEW_NAME'], 'port': int(env['PREVIEW_PORT']), 'origin': env['PREVIEW_ORIGIN']}],
    'previewPort': int(env['GATEWAY_PORT']),
}
path = '/var/lib/harbor-install/' + env['INSTANCE'] + '.json'
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(json.dumps(config, indent=2) + '\n')
print('wrote', path)
PY
fi
python3 "$RELEASE/infra/personal-vps/harbor-personal" validate --config "$config"
echo "step 9 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:**

- `bundled models: gpt-6-astra,gpt-5.6-sol,gpt-5.6-terra,gpt-5.6-luna,gpt-5.5,gpt-5.2`, the list that Codex 0.153.4 printed on 30 September 2026.
- `wrote /var/lib/harbor-install/seekworld.json`.
- `Configuration valid; installation and native sandbox acceptance still required.`

**If not:** Stop. Every value must be right before step 10, because an installed instance cannot be reconfigured.

### Step 10. Render and install

**Where:** the VPS.

**Check:** Run the progress block. If it lists `step 10 done`, go to step 11. Otherwise, if `/etc/harbor-personal-seekworld` or `/var/lib/harbor-personal-seekworld` exists, an earlier install ran at least partly: stop for the owner, as [Recovery](#recovery) describes. The Run block checks this first.

**Run:** Render the private bundle to `/var/lib/harbor-install/bundle`, unless an earlier attempt already rendered it. Then install, with a scratch home:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
cd /
config=/var/lib/harbor-install/$INSTANCE.json
bundle=/var/lib/harbor-install/bundle
scratch=/var/lib/harbor-install/scratch-home
for path in "/etc/harbor-personal-$INSTANCE" "/var/lib/harbor-personal-$INSTANCE"; do
  [ ! -e "$path" ] || { echo "STOP: $path exists, so install already ran; see Recovery"; exit 1; }
done
if [ -e "$bundle" ]; then echo "keeping the bundle that an earlier attempt rendered"; else python3 "$RELEASE/infra/personal-vps/harbor-personal" render --config "$config" --output "$bundle"; fi
rm -rf -- "$scratch"
install -d -m 0700 "$scratch"
env -u CODEX_HOME HOME="$scratch" python3 "$RELEASE/infra/personal-vps/harbor-personal" install --bundle "$bundle" </dev/null
rm -rf -- "$scratch"
echo "step 10 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:** `Rendered private candidate bundle. No host services changed.`, or, when an earlier attempt already rendered the bundle, `keeping the bundle that an earlier attempt rendered`. Then `Fresh instance installed but not started. Complete native device login, then enable/start the three generated units.`

**If not:** Stop, and do not run the block again. A failed install leaves its paths for the owner; see [Recovery](#recovery).

### Step 11. Drop-ins

**Where:** the VPS.

**Check:** Run the progress block. If it lists `step 11 done`, go to step 12. The Run block writes the same bytes each time, so it is safe to run again.

**Run:** Write the two `20-project-writes.conf` drop-ins. They reset the writable paths of the API and the supervisor to the three private state directories and exactly `/root/Projects`. `ProtectHome=read-only` still comes from the generated units. With the previous installation's values, instance `seekworld` and `/root/Projects`, the block stops unless both files have that installation's SHA-256; no hash is recorded for other values:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
state=/var/lib/harbor-personal-$INSTANCE
paths="$state/home $state/codex-home $state/control $PROJECTS"
recorded=
if [ "$INSTANCE" = seekworld ] && [ "$PROJECTS" = /root/Projects ]; then recorded=f4cc28a6d4a95d94026bd3e35ae7325bb1856384127de9488339abb2a205871d; fi
for role in api supervisor; do
  directory=/etc/systemd/system/harbor-personal-$INSTANCE-$role.service.d
  install -d -m 0755 "$directory"
  printf '[Service]\nReadWritePaths=\nReadWritePaths=%s\n' "$paths" > "$directory/20-project-writes.conf"
  chmod 0644 "$directory/20-project-writes.conf"
  hash=$(sha256sum < "$directory/20-project-writes.conf" | cut -d ' ' -f 1)
  echo "$hash $(wc -c < "$directory/20-project-writes.conf") bytes $directory/20-project-writes.conf"
  if [ -n "$recorded" ] && [ "$hash" != "$recorded" ]; then echo "STOP: the $role drop-in does not have the recorded SHA-256 $recorded"; exit 1; fi
done
if [ -n "$recorded" ]; then
  echo "both drop-ins have the recorded SHA-256"
else
  echo "no SHA-256 is recorded for INSTANCE=$INSTANCE and PROJECTS=$PROJECTS; keep the hashes above in your log"
fi
systemctl daemon-reload
for role in api supervisor; do
  shown=$(systemctl show -p ReadWritePaths "harbor-personal-$INSTANCE-$role.service")
  echo "$role: $shown"
  [ "$shown" = "ReadWritePaths=$paths" ] || { echo "STOP: the $role unit does not have exactly the four writable paths"; exit 1; }
done
echo "step 11 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:** Both files are 185 bytes, with SHA-256 `f4cc28a6d4a95d94026bd3e35ae7325bb1856384127de9488339abb2a205871d`, the hash of the previous installation's drop-ins, and the block prints `both drop-ins have the recorded SHA-256`. That hash holds only for instance `seekworld` with `/root/Projects`; with other values, the block prints `no SHA-256 is recorded` and the new hashes instead. Both units show `ReadWritePaths=/var/lib/harbor-personal-seekworld/home /var/lib/harbor-personal-seekworld/codex-home /var/lib/harbor-personal-seekworld/control /root/Projects`.

**If not:** Stop.

### Step 12. Codex login

**Where:** the VPS and the owner.

**Check:** Run the progress block. If it lists `step 12 done`, go to step 13. Otherwise, run this read-only block:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
echo "auth.json: $([ -s "/var/lib/harbor-personal-$INSTANCE/codex-home/auth.json" ] && echo present || echo absent)"
echo "login unit: $(systemctl show -p LoadState -p SubState -p ExecMainStatus harbor-install-login.service | tr '\n' ' ')"
REMOTE
```

- `auth.json: absent` and `LoadState=not-found`: start at block 1.
- `LoadState=loaded`: run block 3.
- `auth.json: present` and `LoadState=not-found`: run block 4.

**Run:**

**Block 1.** Start `harbor-personal login` in a transient unit that writes to `/var/lib/harbor-install/login.log`, and print the device code:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
unit=harbor-install-login.service
log=/var/lib/harbor-install/login.log
[ ! -s "/var/lib/harbor-personal-$INSTANCE/codex-home/auth.json" ] || { echo "STOP: auth.json already exists; run block 4"; exit 1; }
[ "$(systemctl show -p LoadState --value "$unit")" = not-found ] || { echo "STOP: $unit already exists; run block 3"; exit 1; }
systemd-run --unit="$unit" -p RemainAfterExit=yes -p StandardOutput=truncate:"$log" /usr/bin/python3 "$RELEASE/infra/personal-vps/harbor-personal" login --config "/etc/harbor-personal-$INSTANCE/config.json"
for attempt in $(seq 1 30); do
  if grep -q 'one-time code' "$log" 2>/dev/null || [ "$(systemctl show -p SubState --value "$unit")" != running ]; then break; fi
  sleep 2
done
sleep 2
echo "FOR THE OWNER ONLY:"
sed 's/\x1b\[[0-9;]*m//g' "$log"
REMOTE
```

**Block 2, the owner.** Give the owner the link and the one-time code, and keep the code out of your log. The code expires 15 minutes after Codex printed it. The owner opens `https://auth.openai.com/codex/device`, signs in to the ChatGPT account that Harbor will use, and enters the code. The owner cancels if anyone other than this agent supplied a code.

**Block 3.** Wait for the login. Run this block again while it prints `WAIT`:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
unit=harbor-install-login.service
log=/var/lib/harbor-install/login.log
auth=/var/lib/harbor-personal-$INSTANCE/codex-home/auth.json
end=$((SECONDS + 480))
beat=$((SECONDS + 40))
while [ "$(systemctl show -p SubState --value "$unit")" = running ] && [ "$SECONDS" -lt "$end" ]; do
  sleep 10
  if [ "$SECONDS" -ge "$beat" ]; then echo "still waiting after $SECONDS seconds: the owner has not finished the login"; beat=$((SECONDS + 40)); fi
done
load=$(systemctl show -p LoadState --value "$unit")
state=$(systemctl show -p SubState --value "$unit")
status=$(systemctl show -p ExecMainStatus --value "$unit")
echo "$unit: $load, $state, exit status $status"
if [ "$load" = not-found ]; then echo "STOP: the login unit does not exist; run block 1"; exit 1; fi
if [ "$state" = running ]; then echo "WAIT: the owner has not finished the login; run this block again"; exit 0; fi
if [ -f "$log" ]; then clean=$(sed 's/\x1b\[[0-9;]*m//g' "$log"); else clean='no log'; fi
rm -f -- "$log"
if [ "$state" != exited ] || [ "$status" != 0 ]; then
  grep -i -E 'error|fail|timed out|not enabled|denied' <<<"$clean" || true
  echo "STOP: the login failed; see Recovery"
  exit 1
fi
if [ "$clean" != 'no log' ]; then grep -q 'Successfully logged in' <<<"$clean" || { echo "STOP: the login printed no success line"; exit 1; }; fi
[ -s "$auth" ] || { echo "STOP: $auth is missing or empty"; exit 1; }
echo "Successfully logged in; auth.json: $(stat -c '%U, mode %a, %s bytes' "$auth")"
systemctl stop "$unit"
REMOTE
```

**Block 4.** List the signed-in models as the service account, with the instance's homes, and stop if one of them is missing from the configuration. Then remove only the `plugins`, `plugins-clone-*` and `git-*` entries in `codex-home/.tmp`. The Codex login may leave them, and Harbor's runtimes never use them, because they turn the plugins feature off:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
cd /
state=/var/lib/harbor-personal-$INSTANCE
runuser -u "$SERVICE_USER" -- /usr/bin/env -i PATH="$RELEASE/bin:/usr/bin:/bin" HOME="$state/home" CODEX_HOME="$state/codex-home" "$RELEASE/bin/codex" -c 'cli_auth_credentials_store="file"' -c features.plugins=false debug models </dev/null > /var/lib/harbor-install/signed-models.json
python3 - <<'PY'
import json
import os
signed = [m['slug'] for m in json.load(open('/var/lib/harbor-install/signed-models.json'))['models'] if m.get('visibility') == 'list']
configured = json.load(open('/etc/harbor-personal-' + os.environ['INSTANCE'] + '/config.json'))['models']
print('signed-in models:', ', '.join(signed))
print('configured models:', ', '.join(configured))
print('configured but not signed in, so hidden in Harbor:', ', '.join(m for m in configured if m not in signed) or 'none')
missing = [m for m in signed if m not in configured]
if missing:
    raise SystemExit('STOP: signed-in models missing from the configuration: ' + ', '.join(missing))
PY
rm -f /var/lib/harbor-install/signed-models.json
tmp=$state/codex-home/.tmp
echo "codex-home before: $(du -sh "$state/codex-home" | cut -f 1)"
if [ -d "$tmp" ]; then
  ls -la "$tmp"
  find "$tmp" -mindepth 1 -maxdepth 1 \( -name plugins -o -name 'plugins-clone-*' -o -name 'git-*' \) -print -exec rm -rf -- {} +
fi
echo "codex-home after: $(du -sh "$state/codex-home" | cut -f 1)"
echo "step 12 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:**

- Block 1 prints Codex's instructions, with `https://auth.openai.com/codex/device` and a one-time code.
- Block 3 prints `Successfully logged in; auth.json: harbor-personal, mode 600,` and a size.
- Block 4 prints the model lists without `STOP`, and the size of `codex-home` before and after.

**If not:** Stop. If a signed-in model is missing from the configuration, the fix before the first start is a teardown and reinstall, which is the owner's decision. For an expired code, see [Recovery](#recovery). If Codex says that device code login is not enabled, it must be turned on: for a personal account, the owner turns it on in ChatGPT's security settings; for a ChatGPT workspace account, a workspace admin turns on device code login in the workspace's permissions. Then follow the Recovery case for an expired code.

### Step 13. Start

**Where:** the VPS.

**Check:** Run the progress block. If it lists `step 13 done`, go to step 14. The Run block is safe to run again.

**Run:**

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
name=harbor-personal-$INSTANCE
systemctl enable --now "$name-dependencies.service" "$name-api.service" "$name-supervisor.service"
sleep 20
failed=0
for role in dependencies api supervisor; do
  echo "$name-$role.service: $(systemctl is-active "$name-$role.service" || true), restarts $(systemctl show -p NRestarts --value "$name-$role.service")"
  [ "$(systemctl is-active "$name-$role.service" || true)" = active ] || failed=1
done
[ "$failed" = 0 ] || { echo "STOP: a unit is not active"; exit 1; }
echo "step 13 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:** All three units `active`, with `restarts 0`.

**If not:** Stop, and report `systemctl status --no-pager` for the unit that is not active. Do not change the units.

### Step 14. Verify

**Where:** the VPS, then the owner.

**Check:** Run the progress block. If it lists `step 14 done`, go to step 15. The checks are not strictly read-only:

- block 1 creates the canary folder once;
- its `/auth/login` request adds a login state row to Harbor's database, which expires after 10 minutes;
- `preflight` writes under `/nonexistent`, as rule 5 says.

**Run:**

**Block 1.** Check the instance, run `preflight`, and create a canary project folder:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
cd /
name=harbor-personal-$INSTANCE
health=$(curl -sS -w ' %{http_code}' "$ORIGIN/health") || { echo "STOP: no verified HTTPS answer from $ORIGIN/health"; exit 1; }
echo "health: $health"
[ "$health" = '{"status":"ready"} 200' ] || { echo "STOP: unexpected health answer"; exit 1; }
login=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "$ORIGIN/auth/login")
python3 - "$login" <<'PY'
import os
import sys
import urllib.parse
code, _, location = sys.argv[1].partition(' ')
url = urllib.parse.urlsplit(location)
query = urllib.parse.parse_qs(url.query)
callback = os.environ['ORIGIN'] + '/auth/callback'
if code != '302' or url.hostname != 'accounts.google.com' or query.get('redirect_uri') != [callback] or query.get('client_id') != [os.environ['OIDC_CLIENT_ID']]:
    raise SystemExit('STOP: /auth/login answered ' + code + ' to ' + str(url.hostname) + url.path)
print('login: 302 to', url.hostname + url.path, 'with redirect_uri', callback)
PY
anonymous=$(curl -sS -o /dev/null -w '%{http_code}' "$ORIGIN/")
echo "anonymous /: $anonymous"
[ "$anonymous" = 401 ] || { echo "STOP: an anonymous request was not refused with 401"; exit 1; }
preview=none
beat=$((SECONDS + 40))
for attempt in $(seq 1 36); do
  preview=$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$PREVIEW_ORIGIN/" 2>/dev/null || true)
  [ "$preview" = 403 ] && break
  if [ "$SECONDS" -ge "$beat" ]; then echo "still waiting after $SECONDS seconds: the preview host answered $preview"; beat=$((SECONDS + 40)); fi
  sleep 5
done
echo "anonymous preview: $preview"
[ "$preview" = 403 ] || { echo "STOP: the preview host did not answer 403 with a verified certificate"; exit 1; }
for port in "$API_PORT" "$GATEWAY_PORT" "$DATABASE_PORT"; do
  lines=$(ss -Hltn "( sport = :$port )")
  [ -n "$lines" ] || { echo "STOP: nothing listens on port $port"; exit 1; }
  beyond=$(awk '{print $4}' <<<"$lines" | grep -v '^127\.0\.0\.1:' || true)
  [ -z "$beyond" ] || { echo "STOP: port $port listens beyond loopback: $beyond"; exit 1; }
  echo "port $port: loopback only"
done
for role in api supervisor; do
  pid=$(systemctl show -p MainPID --value "$name-$role.service")
  user=$(ps -o user:32= -p "$pid" | awk '{print $1}')
  exe=$(readlink "/proc/$pid/exe")
  echo "$role: user $user, executable $exe"
  [ "$user" = "$SERVICE_USER" ] && [ "$exe" = "$RELEASE/bin/node" ] || { echo "STOP: $role does not run as $SERVICE_USER from the release"; exit 1; }
  systemctl show -p DropInPaths -p ReadWritePaths -p ProtectHome -p ProtectSystem -p NoNewPrivileges -p PrivateTmp -p UMask -p Delegate "$name-$role.service"
  grep -q '20-project-writes.conf' <<<"$(systemctl show -p DropInPaths --value "$name-$role.service")" || { echo "STOP: the $role drop-in is not in effect"; exit 1; }
done
python3 "$RELEASE/infra/personal-vps/deploy-release" preflight --instance "$INSTANCE" </dev/null > /var/lib/harbor-install/preflight.json
python3 - <<'PY'
import json
import os
report = json.load(open('/var/lib/harbor-install/preflight.json'))
services = report['services']
print('preflight: release', report['release'], 'verified', report.get('releaseVerified'), 'services', services,
      'health', report['health'], 'drop-ins', len(report['dropIns']), 'drift', report['generatedFileDrift'])
if (report.get('releaseVerified') is not True or report['release'] != os.environ['RELEASE']
        or set(services.values()) != {'active'} or report['health'] != 200
        or report['generatedFileDrift'] or len(report['dropIns']) != 2):
    raise SystemExit('STOP: preflight does not match the expected installation')
PY
canary=$PROJECTS/harbor-install-check
if [ ! -e "$canary" ]; then
  mkdir "$canary"
  printf 'canary token: %s\n' "$(python3 -c 'import secrets; print(secrets.token_hex(8))')" > "$canary/canary.txt"
  printf 'status: BEFORE\n' > "$canary/edit-me.txt"
fi
echo "canary folder: $canary"
echo "VERIFIED"
REMOTE
```

**Block 2, the owner.** The owner checks Harbor in a browser. A version check or a model list does not prove that Codex's tools work; this conversation does. The owner:

1. opens `https://harbor.seekworld.tech/auth/login` and signs in with the enrolled Google account;
2. opens **Add project**, chooses the `VPS root` approved root, uses **Browse folders** to select `Projects/harbor-install-check`, and adds the project;
3. starts a **New conversation** in that project, sets **Permissions** to **Edit project files**, which is workspace-write, and sends: "Read canary.txt and tell me the canary token. Then change BEFORE to AFTER in edit-me.txt, editing that file in place.";
4. tells you the token that Codex replied with.

**Block 3.** Check the canary. In this block, replace `CHANGE-ME` with the token that the owner reported, then run it:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
REPORTED='CHANGE-ME'
canary=$PROJECTS/harbor-install-check
[ "$(cat "$canary/canary.txt")" = "canary token: $REPORTED" ] || { echo "STOP: the reported token does not match canary.txt"; exit 1; }
echo "edit-me.txt: $(cat "$canary/edit-me.txt")"
grep -q 'AFTER' "$canary/edit-me.txt" && ! grep -q 'BEFORE' "$canary/edit-me.txt" || { echo "STOP: edit-me.txt was not edited"; exit 1; }
echo "the conversation read the canary and edited the file in place"
echo "step 14 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:**

- Block 1 prints:
  - `health: {"status":"ready"} 200`;
  - `login: 302 to accounts.google.com/o/oauth2/v2/auth with redirect_uri https://harbor.seekworld.tech/auth/callback`;
  - `anonymous /: 401` and `anonymous preview: 403`;
  - `loopback only` for ports 3348, 3350 and 5548;
  - both services running as `harbor-personal` from the release's `bin/node`, with the drop-in in `DropInPaths`;
  - a `preflight` line with `verified True`, three `active` services, health 200, two drop-ins and no drift;
  - `VERIFIED`.
- The owner signs in, adds the project and gets a reply with the token.
- Block 3 prints `edit-me.txt: status: AFTER` and the conversation line.

**If not:** Stop. The canary folder stays either way: it is a registered project now, so the owner decides whether to archive the project and remove the folder.

### Step 15. GitHub Actions deploys

**Where:** the owner, your computer and the VPS.

**Check:** Run the progress block. If it lists `step 15 done`, go to step 16.

**Run:**

**Block 1.** Print the host key lines that the workflow needs, from the owner's `known_hosts`, and check that their fingerprints belong to the VPS's current host keys:

```bash
bash -euo pipefail -s <<'LOCAL'
vps() { ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s'; }
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
vps > "$work/values.env" <<'REMOTE'
cat /var/lib/harbor-install/values.env
REMOTE
value() {
  [ "$(grep -c "^$1=" "$work/values.env")" = 1 ] || { echo "STOP: values.env must set $1 exactly once" >&2; return 1; }
  found=$(sed -n "s/^$1='\(.*\)'\$/\1/p" "$work/values.env")
  printf '%s\n' "$found" | grep -Eqx -e "$2" || { echo "STOP: $1 in values.env is not $3" >&2; return 1; }
  printf '%s\n' "$found"
}
VPS_ADDRESS=$(value VPS_ADDRESS '([0-9]{1,3}\.){3}[0-9]{1,3}' 'an IPv4 address') || exit 1
ssh-keygen -F "$VPS_ADDRESS" > "$work/known" || { echo "STOP: known_hosts has no line for $VPS_ADDRESS"; exit 1; }
echo "known_hosts lines for $VPS_ADDRESS, for the VPS_KNOWN_HOSTS secret:"
grep -v '^#' "$work/known"
vps > "$work/current" <<'REMOTE'
for key in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -l -f "$key"; done
REMOTE
ssh-keygen -l -F "$VPS_ADDRESS" | grep -Eo 'SHA256:[A-Za-z0-9+/]+' | sort -u > "$work/known-fingerprints"
grep -Eo 'SHA256:[A-Za-z0-9+/]+' "$work/current" | sort -u > "$work/current-fingerprints"
while read -r fingerprint; do
  grep -qx "$fingerprint" "$work/current-fingerprints" || { echo "STOP: $fingerprint in known_hosts is not a current host key"; exit 1; }
done < "$work/known-fingerprints"
echo "KNOWN HOSTS OK"
LOCAL
```

**Block 2, the owner.** The owner follows the [one-time setup](github-actions-deploy.md#one-time-setup) of the GitHub Actions guide: a new deploy key, its `restrict` line in `/root/.ssh/authorized_keys`, the secrets `VPS_SSH_KEY` and `VPS_KNOWN_HOSTS`, the variables `VPS_HOST` and `HARBOR_INSTANCE`, and deleting the local private key. `VPS_KNOWN_HOSTS` holds the lines that block 1 printed. If the VPS was reinstalled, its host key changed, so an older `VPS_KNOWN_HOSTS` value must be replaced; block 1 compared the new key with the owner's `known_hosts`. You never handle the private key.

**Block 3.** Check the deploy key's line on the VPS without printing keys:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
keys=/root/.ssh/authorized_keys
deploy=$(grep -c 'harbor-github-deploy' "$keys" || true)
restricted=$(grep -c '^restrict .*harbor-github-deploy' "$keys" || true)
total=$(grep -c -v -e '^#' -e '^$' "$keys" || true)
echo "deploy key lines: $deploy, with restrict: $restricted, key lines in total: $total"
[ "$deploy" = 1 ] && [ "$restricted" = 1 ] && [ "$total" -ge 2 ] || { echo "STOP: expected one restricted deploy key line beside the owner's key"; exit 1; }
echo "DEPLOY KEY OK"
REMOTE
```

**Block 4.** Run the `preflight` workflow, if the GitHub CLI is installed and signed in. Otherwise the block prints `OWNER`: ask the owner to run **Deploy personal VPS** with `preflight` from the Actions tab and to tell you the run's link and result, then record them in your log and run block 5. The workflow uploads its own copy of the source and removes it afterwards; apart from that and the `/nonexistent` tree that rule 5 names, `preflight` changes nothing. The block starts one run, keeps its ID in `~/harbor-install-log/preflight-run.txt`, and waits for it. Run the block again while it prints `WAIT`; it does not start a second run. A run whose status is `waiting` needs a reviewer: ask the owner to approve it.

```bash
bash -euo pipefail -s <<'LOCAL'
vps() { ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s'; }
record="$HOME/harbor-install-log/preflight-run.txt"
if ! command -v gh >/dev/null || ! gh auth status >/dev/null 2>&1 </dev/null; then echo "OWNER: run the preflight action from the Actions tab"; exit 0; fi
end=$((SECONDS + 480))
beat=$((SECONDS + 40))
if [ ! -s "$record" ]; then
  before=$(gh run list --workflow deploy-vps.yml --limit 1 --json databaseId --jq '.[0].databaseId // 0' </dev/null)
  gh workflow run deploy-vps.yml --ref main -f action=preflight </dev/null
  run=
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    sleep 5
    run=$(gh run list --workflow deploy-vps.yml --event workflow_dispatch --limit 10 --json databaseId --jq "[.[] | select(.databaseId > $before)] | last | .databaseId // empty" </dev/null)
    [ -z "$run" ] || break
    if [ "$SECONDS" -ge "$beat" ]; then echo "still waiting after $SECONDS seconds: the preflight run has not appeared yet"; beat=$((SECONDS + 40)); fi
  done
  [ -n "$run" ] || { echo "STOP: the preflight run did not appear within a minute"; exit 1; }
  echo "$run" > "$record"
fi
run=$(cat "$record")
url=$(gh run view "$run" --json url --jq .url </dev/null)
status=$(gh run view "$run" --json status --jq .status </dev/null)
while [ "$status" != completed ] && [ "$SECONDS" -lt "$end" ]; do
  sleep 15
  status=$(gh run view "$run" --json status --jq .status </dev/null)
  if [ "$SECONDS" -ge "$beat" ]; then echo "still waiting after $SECONDS seconds: the preflight run is $status"; beat=$((SECONDS + 40)); fi
done
if [ "$status" != completed ]; then echo "WAIT: the preflight run $url is $status; run this block again"; exit 0; fi
conclusion=$(gh run view "$run" --json conclusion --jq .conclusion </dev/null)
echo "preflight run $url: $conclusion"
[ "$conclusion" = success ] || { echo "STOP: the preflight run did not succeed"; exit 1; }
vps <<'REMOTE'
echo "step 15 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
LOCAL
```

**Block 5.** Only after the owner reported a successful preflight run from the Actions tab, record the step:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
echo "step 15 done $(date -u +%FT%TZ) preflight run by the owner" >> /var/lib/harbor-install/progress
REMOTE
```

**Expect:** `KNOWN HOSTS OK`, `DEPLOY KEY OK`, and a preflight run whose conclusion is `success`.

**If not:** Stop. This guide never runs the workflow's `build`, `deploy` or `prune`; each run of those needs the owner's go-ahead.

### Step 16. Clean up and record

**Where:** the VPS, then your computer.

**Check:** Run the progress block. If it lists `step 16 done`, the installation is finished.

**Run:**

**Block 1.** Remove the rendered bundle, the uploaded source and any scratch home left behind, report the `/nonexistent` tree that stays, and write the record:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
set -a; . /var/lib/harbor-install/values.env; set +a
rm -rf -- /var/lib/harbor-install/bundle /var/lib/harbor-deploy/incoming/bootstrap /var/lib/harbor-install/scratch-home
if [ -e /nonexistent ]; then
  echo "left in place: /nonexistent, which the release check of deploy-release created:"
  find /nonexistent -maxdepth 3 -printf '%M %u %p\n' | sort -k 3
else
  echo "no /nonexistent tree"
fi
python3 - <<'PY'
import datetime
import json
import os
import subprocess
env = os.environ
def docker(*args):
    return subprocess.run(['docker', *args], check=True, capture_output=True, text=True).stdout
traefik = [image for image in docker('ps', '--format', '{{.Image}}').split() if 'traefik' in image.lower()]
record = {
    'date': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'instance': env['INSTANCE'],
    'origin': env['ORIGIN'],
    'revision': env['REVISION'],
    'release': env['RELEASE'],
    'manifestSha256': env['MANIFEST_SHA256'],
    'images': {
        'postgres': env['POSTGRES_IMAGE'],
        'traefik': [{'image': image, 'repoDigests': json.loads(docker('image', 'inspect', '--format', '{{json .RepoDigests}}', image))}
                    for image in traefik],
    },
    'models': env['MODELS'].split(','),
}
fd = os.open('/var/lib/harbor-install/record.json', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
PY
ls -la /var/lib/harbor-install
echo "step 16 done $(date -u +%FT%TZ)" >> /var/lib/harbor-install/progress
REMOTE
```

**Block 2.** Give the owner a summary to share in the project thread, so that the installation plan can record this first run. Fill it in from your log and the record:

```text
Fresh VPS install finished on DATE (UTC), from the guide at REVISION.
- Release: RELEASE, manifest SHA-256 MANIFEST_SHA256.
- Images: POSTGRES_IMAGE; Traefik TRAEFIK_IMAGE, installed or kept.
- Steps 13 and 14: all checks passed, and preflight verified the release.
- Owner checks: sign-in, project registration and the canary conversation passed.
- GitHub Actions: the preflight run's link and result, or not run.
- Left in place: /nonexistent, from the release check of deploy-release, as block 1 listed it.
- Stops, deviations and anything left for the owner: none, or each one.
```

**Expect:** `left in place: /nonexistent` with its entries, root-owned, such as `.codex/tmp/arg0` and `.local/share/pnpm`; the guide does not remove this tree, as rule 5 says. Then the record, then a listing of `/var/lib/harbor-install` with `values.env`, `progress`, `record.json`, `seekworld.json`, `owner.json`, `root-acl-before.txt`, `ssh-acl-before.txt`, `preflight.json` and `bootstrap.log`, and no `bundle` or `scratch-home`. Keep these files: the ACL backup reverses step 7, and the rest records the installation.

**If not:** Stop.

## Recovery

A failed step leaves state behind. Removing an instance's paths is always the owner's decision, and this guide never removes instance state. Report what remains, and continue only after the owner decides.

**The enrollment link expired.** The helper stops 30 minutes after its service started, and removes the start URL. Its unit, route and configuration remain, and no result exists. Run step 8's block 3 again: it starts the service, which writes a new link. If the owner took more than 10 minutes to sign in, or signed in with another Google account, the page says that the sign-in could not be verified; while the service runs, the owner opens the same link again and signs in with the enrolled account.

**The device code expired, or the login failed.** The code expires 15 minutes after Codex printed it. The failed login unit remains, and no `auth.json` exists. Clear the unit with this block, then run step 12's block 1 again for a new code:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
unit=harbor-install-login.service
systemctl stop "$unit" 2>/dev/null || true
systemctl reset-failed "$unit" 2>/dev/null || true
rm -f /var/lib/harbor-install/login.log
systemctl show -p LoadState "$unit"
REMOTE
```

Expect `LoadState=not-found`.

**The build failed.** `bootstrap` removes its staging directory, its inputs and its build state on every exit. If it could not remove the staging directory, its log names that directory after `Could not remove the partial staging directory`, and the directory is the owner's to inspect. A refusal before the build changes nothing. After the owner fixes the cause, such as free space or network access, clear the unit with this block, then run step 5's blocks 2 and 3 again:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
unit=harbor-install-bootstrap.service
[ "$(systemctl show -p SubState --value "$unit")" != running ] || { echo "STOP: the build is still running; run step 5's block 3"; exit 1; }
systemctl stop "$unit" 2>/dev/null || true
systemctl reset-failed "$unit" 2>/dev/null || true
systemctl show -p LoadState "$unit"
echo "releases: $(ls -A /opt/harbor-personal/releases 2>/dev/null | tr '\n' ' ')"
REMOTE
```

Expect `LoadState=not-found`, and no `.staging-` entry.

**The install failed partway.** The installer refuses to overwrite its own paths, so a second attempt cannot repair a partial install. What remains may include `/etc/harbor-personal-seekworld`, `/var/lib/harbor-personal-seekworld`, the three unit files in `/etc/systemd/system`, and the AppArmor profile file in `/etc/apparmor.d` with its loaded profile. This read-only block lists them for the owner:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
shopt -s nullglob
for path in /etc/harbor-personal-seekworld /var/lib/harbor-personal-seekworld /etc/systemd/system/harbor-personal-seekworld* /etc/apparmor.d/harbor-personal-seekworld*; do if [ -e "$path" ]; then echo "remains: $path"; fi; done
grep -h 'harbor-personal' /sys/kernel/security/apparmor/profiles || echo "no loaded Harbor AppArmor profile"
REMOTE
```

Stop there. Whether to remove these paths is the owner's decision.

**Let's Encrypt refused a certificate.** A route's HTTPS check fails because Traefik has no valid certificate for the host. Read the reason in Traefik's log. For the Traefik that step 4 installed:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 harbor-vps 'bash -euo pipefail -s' <<'REMOTE'
docker compose -f /opt/traefik/compose.yaml logs --tail 100 traefik </dev/null | grep -i -E 'acme|certificate|error' || echo "no certificate messages in the last 100 lines"
REMOTE
```

A kept Traefik that this guide did not install has its own log; ask the owner. Common causes are a DNS record that points elsewhere, an AAAA record, and a firewall that blocks port 80. After the owner fixes the cause, run the failed block again, once. Let's Encrypt's [rate limits](https://letsencrypt.org/docs/rate-limits/) allow five failed validations per host name per account per hour, and five certificates for the same set of names every seven days, counted across all accounts, so wait out a limit instead of retrying in a loop. `/opt/traefik/letsencrypt` keeps issued certificates across retries.
