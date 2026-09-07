# P004 — Files and change review

- Decision: Draft
- Delivery: Planned
- Dependencies: [P003](003-parallel-project-workspaces.md)
- Outcome: The owner inspects workspace files and changes, edits a file safely, and deliberately applies a reviewed Git action.

## Scope and user/API flow

Add a workspace file tree, bounded filename/text search, text editor, authenticated downloads, Git status, and code/diff views. Show unsaved edits, stale revisions, unavailable/binary/oversized files, and external changes. Provide explicit stage/unstage and commit actions, with exact selected changes visible before mutation. Each action has an authenticated API equivalent and an observable result.

Changing a file does not automatically stage, commit, push, or publish it. Hosted pull requests, automatic merge conflict resolution, full IDE language services, and browser previews are excluded. User permission and existing session authorization govern requested Git effects; UI selection and server authority must agree.

## Contracts and security

The workspace service owns file operations and uses project-relative paths or opaque file references. Resolve access using the [filesystem boundary](../architecture.md#execution-and-filesystem-isolation), including race-resistant operations and actual mount confinement. File saves carry an expected content revision and fail on a stale revision rather than overwriting newer contents silently.

Revision checks coordinate Harbor editor writes; arbitrary shell writes can still race unless covered by the actual operation's locking/confinement strategy. Use workspace admission for managed Git mutations, structured argv instead of interpolated shell command text, and idempotency for consequential actions. Git hooks are executable project code and must remain in the runner boundary. Record the resulting commit/object identity so uncertain command delivery is reconciled rather than replayed blindly.

Render names, file contents, search results, and diffs as untrusted content. Downloads require current authorization, bounded size, safe content disposition, and no executable application-origin preview. Limit watch/search scope and output volume. Path denial must not leak secret contents through errors.

## Independent acceptance

Seed delivered P003 with a small Git fixture containing text, binary, large, Unicode, hostile-name, and symlink cases; no upload, terminal, preview, or external Git host is required.

1. **P004-01:** Navigate and search a workspace, edit/save a text file, reload, and download it. Assert disk bytes, returned revision, and rendered state agree.
2. **P004-02:** Change the file from a second managed client before saving the first client's draft. Assert a conflict with the draft preserved and a deliberate reload/reapply path.
3. **P004-03:** Inspect a diff, stage selected changes, and commit. Assert exactly the selected files/hunks and recorded commit identity; a repeated idempotency key cannot create an additional commit.
4. **P004-04:** Exercise missing, binary, oversized, renamed, and deleted files. Assert clear bounded results, correct watcher invalidation, and no broad filesystem scan.
5. **P004-05:** Attempt unauthorized paths, symlink replacement during access, malicious names/diff text, and unauthenticated downloads. Assert denial or escaped rendering and no control-plane execution/data leak.
6. **P004-06:** Restart the API during a read/save or uncertain Git operation. Assert reconciled outcome/revision, preserved user draft, and no automatic repeated commit; run actual Linux path-isolation probes.

## Delivery and verification

Run planned `pnpm check`, `pnpm test`, `pnpm test:e2e`, and `pnpm test:isolation`; use real Codex contract/live lanes if reuse of its filesystem APIs changes adapter behavior. Follow [shared fixture/evidence rules](README.md#shared-verification-contract). Successful screen rendering alone is insufficient: assert actual file and Git outcomes.

Persist only necessary revision/audit metadata; never duplicate all repository contents into the application database. Extend backup registration for any new durable state and test it when the deployment feature exists. Rollback preserves files and commits already changed; it cannot undo them merely by changing the Harbor binary. Add actual file/Git usage documentation and independent-review evidence before verification.
