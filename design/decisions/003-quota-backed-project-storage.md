# D003 — Use quota-backed Linux project storage

- Decision: Accepted
- Recorded: 2026-09-07
- Scope: [P001](../proposals/001-secure-persistent-conversations.md), extending [D002](002-registered-mount-authority.md)
- Supersedes: Unbounded Docker local volumes as a production native-history store
- Delivery evidence: [Implemented; actual XFS enforcement checks passed](../../docs/reports/2026-09-07-p001-foundation.md)

## Context and options

Container memory, process, and temporary-filesystem limits do not cap persistent bind mounts or Docker local volumes. A workspace and native history must survive runtime replacement while having enforceable disk bounds. The Mac's Docker Desktop profile cannot establish an XFS host-filesystem quota merely by passing an environment flag. A memory filesystem would lose durable history on shutdown.

## Decision

The initial supported production profile runs the trusted launcher and Docker daemon on the same Linux host. Administrators prepare an XFS project-storage filesystem with both project accounting and hard-limit enforcement, separate from control-plane state. Each project receives a nonzero, unique filesystem project ID, a hard byte limit, and a hard inode limit. XFS distinguishes accounting from enforcement; startup must inspect both. Exceeding a hard limit must produce a real allocation failure. [XFS quota administration](https://man7.org/linux/man-pages/man8/xfs_quota.8.html)

An administrator-owned pool contains prepared project slots. A slot has a trusted parent with a `workspace` child and separate `native` children, all subject to the same project quota and inheritance policy. The runner may access its workspace and its own session's native directory only; it never mounts the pool or project parent. A restricted storage service atomically assigns an unused slot to an owner-requested single-component project name. The service creates new per-session native directories automatically, so conversation creation needs no per-session administrator action. The initial profile may reject an existing directory that lacks the required quota, identity, or access policy; it must explain the incompatibility without changing that directory's ownership.

The storage service is trusted and uses fixed operations on configured roots. The application supplies registered root/project/session identifiers, not shell commands, mount flags, arbitrary administrative paths, or quota increases. Its private socket and ownership ledger remain outside all project roots. Validate canonical paths, device/inode identity, trusted ancestry, unique project IDs, project inheritance, and current hard limits before allocation or dispatch. Existing descendants must satisfy the quota assignment before admission. Unknown or cross-host Docker contexts fail closed.

Provision new workspace access for the fixed nonroot runner UID 10001 using restricted ownership or ACLs. Verify that the real runner can traverse the workspace and write only under the granted profile. Do not make directories world-writable or silently change existing personal repositories to accommodate the runner.

Project-controlled processes must not disable inheritance or move new data to an unbounded quota ID. Extend the pinned Docker default seccomp policy by denying filesystem attribute/flag mutations that could change this boundary and quota administration calls, including supported compatibility forms. Keep the baseline default-deny policy; do not replace it with a permissive profile. Verify these denials with actual kernel calls and new descendant allocations. [Pinned Docker seccomp baseline](https://raw.githubusercontent.com/moby/moby/v28.2.2/profiles/seccomp/default.json)

## Consequences and verification

Persistent workspace and native data have a shared enforceable project budget. Exhaustion may interrupt runtime persistence; Harbor must preserve uncertainty and cancellation authority in its separate control storage. Admission reserves filesystem headroom before starting work, and the owner sees configured limits and usage. A full pool returns a capacity result, never an unbounded fallback. Increasing limits or adding slots is an administrator operation.

On macOS, run the same supported profile inside a dedicated Linux VM. A VM used for verification gets fresh storage, credentials, ports, and identities, with no personal host mounts. Normal Docker Desktop namespace tests remain useful but do not substitute for XFS evidence.

The Linux lane must exercise allocation through the real project API/storage service, writable and read-only runner access, hard byte and inode exhaustion, inheritance escape attempts, disjoint project access, and native history reopening across runtime generations. Record actual filesystem, kernel, Docker, quota, and artifact versions. Missing evidence keeps P001 active and unverified.

On the tested Linux 6.8 kernel, XFS project-quota denial returns `ENOSPC`; it is not evidence that the whole filesystem is full. The exhaustion test must also check the configured hard limit and remaining filesystem capacity. This differs from the generic `EDQUOT` expectation for other quota types. [Linux 6.8 XFS quota error handling](https://raw.githubusercontent.com/torvalds/linux/v6.8/fs/xfs/xfs_trans_dquot.c)
