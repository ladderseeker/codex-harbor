# D002 — Keep project mount ancestry under trusted administration

- Decision: Accepted
- Recorded: 2026-09-07
- Scope: [P001](../proposals/001-secure-persistent-conversations.md), extended by P003/P004
- Supersedes: None; this defines the authority assumed by the existing filesystem boundary
- Delivery evidence: [Implemented; actual Linux mount/root replacement checks passed](../../docs/reports/2026-09-07-p001-foundation.md)

## Context

Holding a directory descriptor while performing later operations through an absolute pathname does not make those operations race-resistant. The Docker daemon also accepts a bind-mount pathname, not a descriptor held by the Harbor API. A runner must not be able to replace that mount point between validation and launch.

## Decision

The trusted administrator controls configured roots and every ancestor of each registered project mount point. Those ancestors must not be writable by a runner or another untrusted host principal. Project mounts are disjoint: Harbor rejects registration that would overlap an existing project as its ancestor or descendant. A project process can modify its granted workspace children, but receives no mount exposing the parent of its own or another project's mount point.

Record a registered root's canonical path and filesystem identity, and revalidate its identity before launching. A missing or replaced root is a lifecycle conflict; do not silently map its conversation to a replacement path. Mount policy and registry checks are the same in local and deployed profiles. The real Linux tests must exercise this policy rather than bypass it through a permissive test-only launcher.

Inside a project, use actual descriptor-relative operations with no-follow semantics for traversal and mutation. Validate every directory component and operate relative to the validated descriptor; a repository-controlled symlink or rename must not redirect a file operation outside the granted tree. The mount ancestry assumption does not exempt project-controlled children from race checks.

External administrators remain trusted and may intentionally relocate a project through the supported lifecycle. Their authority is not granted to coding processes. Detected identity changes fail explicitly and require deliberate registration/recovery; they are never an automatic fallback to a different project.

## Consequences and verification

The launcher can rely on trusted mount ancestry while file operations inside the writable project remain race-resistant. Installation must establish and check the necessary ownership/mode policy, and disjoint registration may reject nested project arrangements. Test overlapping registrations, mutable mount ancestry, replaced root identities, and repeated symlink/rename races in repository-controlled child paths. Do not report `realpath` checks alone as containment evidence.

P001 owns the initial registration/launch controls; P003 extends workspace lifecycle and P004 extends file/Git operations. This records an implementation boundary under the owner's delegated authority and does not establish verified delivery.
