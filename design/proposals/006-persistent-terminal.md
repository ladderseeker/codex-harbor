# P006 — Persistent terminal

- Decision: Draft
- Delivery: Planned
- Dependencies: [P003](003-parallel-project-workspaces.md)
- Outcome: The owner opens a shell in the selected workspace, leaves the page, and reconnects to its bounded output and running process.

## Scope and user/API flow

Add terminal creation, input, resize, output, reconnect, exit status, and explicit termination. The UI shows workspace identity, whether a process is still alive, and whether older output has expired. Closing the panel or browser detaches; it does not terminate the shell. Expose the same create/control lifecycle through authenticated HTTP and terminal WebSocket operations.

Prefer the tested sandboxed PTY capability behind the Codex adapter, as described in the architecture. The feature excludes a host-root terminal, SSH credential manager, terminal persistence through a process death/reboot, and arbitrary process/RPC forwarding. A runtime generation change invalidates old terminal handles.

## Contracts and security

Persist terminal identity, project/workspace, owning runtime generation, process handle, status, granted profile, writer reservation, output sequence, and retention window. Keep binary/encoded terminal output separate from chat markup. Reconnect uses the last sequence or a bounded snapshot with an explicit gap indication.

Treat interactive shell access as arbitrary code execution within its runner. Apply the outer execution boundary even if an upstream operation skips Codex's inner sandbox. Authenticate the upgrade, validate browser Origin, authorize each input/control message, bound bytes/rate/connection count, and close access on credential expiry/revocation. Deliberate user actions are required for links and clipboard integration.

A terminal and its background jobs retain their workspace writer reservation. Managed conflicting writers queue; terminate or move work to another workspace to remove the conflict. Coordination cannot prevent an arbitrary process or external SSH client from editing files. The UI must not imply that keeping a shell open grants safe concurrent edits in the same checkout.

## Independent acceptance

Use P003 with an isolated shell fixture, known workspace markers, delayed output, and a background job. Tests invoke real processes for shell/isolation claims, even though deterministic transport scenarios can use the external protocol fixture.

1. **P006-01:** Create a terminal, run a bounded command, resize it, and inspect its exit/output. Assert the actual workspace and process behavior.
2. **P006-02:** Close every browser while a process emits delayed output, reconnect, and restart only the API. Assert the same process continues and output sequences are not duplicated.
3. **P006-03:** Exceed replay retention and reconnect. Assert a visible output gap rather than fabricated full history; enforce slow-reader and output-size bounds.
4. **P006-04:** End the shell with a background job remaining, terminate it deliberately, and attempt a conflicting managed turn. Assert reservation lifetime and confirmed process cleanup.
5. **P006-05:** Attempt unauthorized/wrong-project control, cross-origin upgrades, stale handles, hostile links/control output, and quota overflow. Revoke access midstream and assert immediate control loss.
6. **P006-06:** With the real pinned PTY implementation on supported Linux, probe forbidden mounts/network/host privileges and kill the runtime. Assert confinement and an honest exited/interrupted terminal state, not automatic command replay.

## Delivery and verification

Use planned `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live` where account-dependent, and `pnpm test:isolation`. Follow [shared evidence rules](README.md#shared-verification-contract). A scripted terminal-output event alone does not close P006-01 or P006-06.

Add terminal metadata/output retention migration and documented shutdown behavior. Session credentials and terminal output are private state with different lifetimes; backups must not promise to restore a running PTY. Promotion drains terminals or records explicit interruption. Add user documentation that distinguishes detach from termination, and verify the complete feature independently.
