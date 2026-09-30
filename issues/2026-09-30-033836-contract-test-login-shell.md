# A real-runtime contract test runs the host's login profile

- Severity: Low. It changes host state outside the test's own directories, but the change seen so far is harmless.
- Owner: Awaiting owner selection in this inbox.
- Status: Open. Reported by P035's provenance review on 30 September 2026 in a cloud container.
- Recorded: 30 September 2026.
- Related: [history.test.ts](../tests/contract/history.test.ts).

## Problem

`tests/contract/history.test.ts` starts the real `codex app-server` with the ambient `PATH` and a run-owned `HOME` and `CODEX_HOME`. When a Codex runtime starts, it can run the user's login shell to capture a shell environment. A login shell reads host files such as `/etc/profile` and `/etc/profile.d/*`, which the test does not own.

In the cloud container, `/etc/profile.d/rbenv.sh` runs `rbenv init -`, and each run of the test rewrote `/opt/rbenv/shims`. The directory's modification time changed to 03:15:39 UTC on 30 September 2026, during the review's contract runs, and the reviewer reproduced it twice with the history test alone. The login-shell step is inferred from that profile file and was not traced in Codex.

## Impact

The repository requires tests to own their directories and state and to leave host resources alone. On a developer machine or CI host, this test can run arbitrary login-profile code and change what that code manages.

## Recheck

Record the modification time of `/opt/rbenv/shims`, or of whatever a host's login profile touches. Run `HARBOR_LOCAL_CONTRACT_BINARY=<pinned binary> node --import tsx --test tests/contract/history.test.ts` and compare. A fix gives the runtime a controlled shell environment, for example a minimal `PATH` and a run-owned shell profile, or turns the shell snapshot off if Codex offers that, with a check that host files stay unchanged.
