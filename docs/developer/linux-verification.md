# Linux execution verification

## Design and evidence ownership — 20 September 2026

[Current subsystem designs](../../design/systems/) own behavior and limits; the [issue inbox](../../issues/) owns unfinished acceptance. Historical proposal IDs below identify feature lineage and evidence, not active execution. Future changes follow a newly selected proposal under the [workflow](../../design/workflow.md); baseline reconciliation did not rerun application gates.

The full `pnpm test:isolation` lane exercises the supported local Linux launcher and real XFS project quotas. It is separate from deterministic browser E2E and authenticated `pnpm test:live`. A Docker Desktop run without the XFS profile returns an unverified result even when its namespace and network probes pass.

Use a disposable Linux VM with no personal project mounts, account state, or production services. The current verification environment uses Ubuntu 24.04, Linux 6.8, Node 24.11.1, pnpm 12.3.4, Docker Engine 29.1.3, Compose 2.40.3, and xfsprogs 6.6.0. The lane also requires Python 3, a C compiler, `iproute2`, and the repository's installed dependencies and frontend build. The launcher and Docker daemon must run on the same Linux host.

Disable automatic application port forwarding in the VM manager and verify the effective behavior. For Lima 2.2.0, the [tested preparation](../reports/2026-09-08-feature-verification-host.md#forwarding-and-scoped-cleanup) uses the following rule in addition to `mounts: []` and `ssh.forwardAgent: false`. An omitted `guestIP` does not suppress every wildcard listener. Explicit SSH administration and any test-owned forwarding must be tracked separately.

```yaml
portForwards:
  - guestIP: 0.0.0.0
    guestIPMustBeZero: false
    guestPortRange: [1, 65535]
    ignore: true
    proto: any
```

## Prepare isolated storage

Provision a dedicated XFS filesystem with project accounting and enforcement enabled by the `prjquota` mount option. Keep its control directory outside the mounted project storage and inaccessible to other users. [D003](../../design/decisions/003-quota-backed-project-storage.md) explains the enforced boundary.

For example, these commands create a fresh 2 GiB loop filesystem inside an otherwise disposable VM. Run them from an administrator shell; the exclusive directory creation deliberately fails if this verification directory already exists.

```sh
(
set -eu
HARBOR_VERIFY_ROOT=/var/lib/harbor-verification
mkdir -m 0700 "$HARBOR_VERIFY_ROOT"
mkdir -m 0700 "$HARBOR_VERIFY_ROOT/control" "$HARBOR_VERIFY_ROOT/mount"
fallocate -l 2G "$HARBOR_VERIFY_ROOT/quota.img"
mkfs.xfs -q -K "$HARBOR_VERIFY_ROOT/quota.img"
mount -o loop,prjquota,nosuid,nodev "$HARBOR_VERIFY_ROOT/quota.img" "$HARBOR_VERIFY_ROOT/mount"
xfs_quota -x -c state "$HARBOR_VERIFY_ROOT/mount"
)
```

Check that project accounting and enforcement are both on, the backing image is physically allocated, and enough free host disk remains for the run. Do not substitute a personal filesystem or disable a failed admission check. The harness allocates fresh project IDs and two bounded storage slots beneath this dedicated mount; it does not configure quotas for existing projects.

## Run the lane

Copy the repository into the VM and use the [ordinary dependency and build workflow](development.md#run-the-deterministic-application-locally). Build the pinned images there or transfer previously built images and record their digests:

```sh
docker build -f infra/runner/Dockerfile -t codex-harbor-runner:0.153.4 .
docker build -f infra/egress/Dockerfile -t codex-harbor-egress:1 .
```

From the repository root in the VM's administrator shell, with the pinned Node and pnpm binaries on `PATH`:

```sh
HARBOR_TEST_XFS_MOUNT=/var/lib/harbor-verification/mount \
HARBOR_TEST_CONTROL_ROOT=/var/lib/harbor-verification/control \
pnpm test:isolation
```

Administrator authority is limited to this disposable verification environment and the trusted launcher/storage services. Runners still use UID 10001, restricted mounts, resource limits, and the fixed network gateway. The test does not grant a coding runner the host Docker socket or host networking. The Linux Compose override binds only the trusted HTTPS proxy to host loopback.

The lane uses real owner OIDC login, the project API, PostgreSQL, trusted storage allocation, and the pinned Codex runtime. It probes workspace access, persistent byte/inode limits, project-ID mutation denial, native-state reopening, process inspection, generation retirement, and network boundaries. Its account-free runtime operations cannot establish a successful model conversation or authenticated approval/cancellation.

The isolated fixture selects the fixed authenticated DNS-over-HTTPS profile for its model gateway. The network check expects an unauthenticated 401 from the approved upstream endpoint; that proves connectivity only. It never sends a model credential. A DNS, TLS, or upstream failure is reported as a failure rather than accepted as an isolation pass.

## Evidence and cleanup

Record the source digest, image digests, host/kernel/tool versions, command, exit status, and actual assertions. Failed setup or unavailable prerequisites cannot establish the full profile. Keep the [current subsystem design](../../design/systems/001-conversations-and-access.md) and [issue index](../../issues/README.md) consistent with the result.

The harness removes its own services, containers, quotas, and directories. If cleanup cannot be confirmed, it fails and retains a private run manifest under the configured control directory. Use that manifest to inspect and clean only the named resources before rerunning or discarding the VM. Do not broadly prune Docker resources or delete a mounted filesystem to hide a failed test.

After all owned test resources are confirmed stopped, the administrator can unmount the dedicated verification filesystem and discard the disposable VM. Keep a separately provisioned environment for any later deployment or stable installation.
