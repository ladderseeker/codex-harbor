# Feature verification host preparation

The fresh disposable Linux host for P011/P012 passed storage, public-tool availability and automatic-port-forwarding checks on 8 September 2026. This is environment preparation; feature, installed-release, model-account and protected restore acceptance remain owned by their proposals.

## Environment and public tools

The host uses Lima 2.2.0 with VZ, Ubuntu 24.04 ARM64, Linux `6.8.0-134-generic`, 2 CPUs, 4 GiB memory and a 32 GiB disk. The pinned Ubuntu image SHA-256 is `7df0201546f75b8bcc1044594c806c35749421ad3c9bc1be2a3ab806cfae39cc`. Host project mounts and SSH agent forwarding are disabled; the mount inventory and absent agent socket were checked.

The dedicated 4 GiB XFS image has 4,294,971,392 allocated bytes for its 4,294,967,296-byte logical size. Its mount uses `prjquota,nosuid,nodev`; actual `xfs_quota state` showed project accounting and enforcement ON. Root-owned control state is outside project storage. At completion of the public-tool checks, root had 13,025,579,008 available bytes. A separate handoff inventory confirmed no running containers.

The public-only tool bundle SHA-256 is `b6a3ff53f8e473ced0fa2350de44ab88a0fa5b9c6df1a3ed081d72e88ac5c58a` (3,162,255,360 bytes). Archive membership, file checksums and all six image identities were checked. Node 24.11.1, pnpm 12.3.4, Codex 0.153.4 and Compose `2.40.3+ds1-0ubuntu1~24.04.1` passed version checks. Chromium revision 1194, version `141.0.7390.37`, opened a fixed data URL in a fresh profile and closed. This browser availability check does not establish candidate browser confinement.

The bundle's dependency lock SHA-256 `d6bdfd9cc688e8d2f7dcba83bf01b9c51f6f6eb1d3cb8ea2c7436639b76ab855` predates the P008/P012 additions. Each feature must restore its own current frozen lock; copied cache availability is not dependency verification. No application database, native account state, model credential or protected backup was transferred.

## Forwarding and scoped cleanup

An initial ignore rule omitted `guestIP`; the host log still showed automatic wildcard UDP forwarding. Lima 2.2.0 defaults the omitted address to loopback, and its ignore-rule matcher distinguishes wildcard addresses. The corrected rule explicitly uses `guestIP: 0.0.0.0`, `guestIPMustBeZero: false`, all ports and protocol `any`. The [versioned default implementation](https://github.com/lima-vm/lima/blob/v2.2.0/pkg/limayaml/defaults.go#L943) and [forwarding matcher](https://github.com/lima-vm/lima/blob/v2.2.0/pkg/portfwd/forward.go#L95) support this interpretation.

After restarting the still-idle host, its configuration SHA-256 was `d41c635f4d1ecc6f0c11aa11075bf5780f13fec2547169ca502c58256fce22d9`. Eight actual TCP/UDP listeners covered IPv4/IPv6 loopback and wildcard bindings. All eight guest-local positive checks passed. Across three rounds, none of 48 probes from host loopback reached the public canary. Each listener recorded only its one guest-local request; explicit stop, process exit and listener cleanup passed. Lima's explicit SSH administration remains separate. Earlier hosts retain their original configurations; this result does not establish their automatic-forwarding behavior.

## Retained limitations and handoff

The first browser dependency installation encountered two public package-mirror HTTP 502 errors. A bounded stage resume succeeded. Python's direct execution of pnpm's intentional shebang-less launcher then failed; invoking that same launcher through `/bin/sh` passed without changing package bytes. The first canary driver passed a macOS address-family enum to Linux and exited before readiness; using portable family names fixed the driver. Original scripts and failure logs were preserved.

Main retained `tools-result-20260908.json`, `storage-result-20260908.json`, `preparation-inventory-20260908.json` and `forwarding-20260908.json` under `.test-runs/feature-host/`, with corresponding root-owned guest setup records. The inventory includes the actual VM configuration and the independently rechecked public bundle size/digest. P011 received the first fresh application namespace; P012 follows an explicit ownership handoff. Existing verification hosts, installed data and protected transfer fixtures were preserved. The [Linux workflow](../developer/linux-verification.md) records the reusable storage and VM configuration guidance.

## Navigation and ownership addendum — 20 September 2026

P017 reconciled legacy planning records into the [proposal archive](../../design/proposals/archive/). [Current subsystem designs](../../design/systems/) now own requirements, and unfinished acceptance belongs to the [issue inbox](../../issues/) until a new proposal is selected. Historical statements here about active proposal states, queues, permissions and recovery locations describe the recorded date. This addendum changes navigation/ownership only: original tested sources, commands, results, review rounds and limitations above remain historical evidence. No application gate was rerun for the documentation migration. Historical raw artifacts or worktrees not present in this checkout were not newly verified.
