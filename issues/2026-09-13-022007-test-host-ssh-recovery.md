# Persistent verification-host SSH recovery requires authorization

- Severity: Medium
- Status: Blocked
- Owner: Repository maintainer; verification infrastructure
- Affected resources: The four owned Linux verification VMs, their missing host-side Lima configuration/key files, and persistent local recovery material
- Related evidence: [Interrupted-work recovery](../docs/reports/2026-09-13-interrupted-work-recovery.md)

## Observation and available access

On 13 September, the old temporary worktrees contained no regular source files. The temporary Lima binary, configuration and private-key files were also absent. The cause of that loss has not been established. All four VM disks remain open by their live virtualization processes, and all four existing SSH masters passed explicit control checks. Fixed commands through those authenticated connections reached the expected owned hosts. No VM was restarted or reinitialized.

The missing persistent access material makes future reconnection and ordinary Lima management unverified. Existing connections can continue the authorized tests while they remain live; their availability does not establish recovery after those connections or the host stop. The P009 protected backup-transfer rejection is a [separate blocker](2026-09-07-231526-p009-backup-transfer-approval.md).

## Prepared action and automatic rejection

Main prepared four new local Ed25519 key pairs, one per test VM, under ignored mode-restricted recovery storage. Public host keys and the existing administrator account/key-file identities were read through the authenticated connections. The proposed enrollment script would append one public key to each existing test account, require its exact prior inode and SHA-256, preserve every prior byte, disable agent/X11 forwarding and PTY for the new key, and verify a fresh connection against the pinned host key. Private keys would remain local. The targets are `harbor-quota-20260907`, `harbor-restore-20260907`, `harbor-self-20260908`, and `harbor-features-20260908`.

Automatic approval review rejected process creation because adding persistent administrative access to four VMs was a broad security-boundary change without explicit authorization. The enrollment command did not execute; no new key was enrolled. Do not retry enrollment through another agent, tool or indirect command. Existing VM connections and unrelated source/cache/test work remain available.

## Next steps

Finish unaffected implementation and verification. Obtain explicit authorization for the prepared, bounded public-key enrollment before executing it, then verify independent connections and restore the missing management configuration without weakening the recorded mount, forwarding or resource policies. Preserve the old keys and fixture state. Record exact results and independent review before resolving this infrastructure issue; do not treat its recovery as a protected backup or application acceptance result.
