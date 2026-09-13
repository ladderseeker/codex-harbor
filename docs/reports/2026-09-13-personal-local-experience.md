# Personal local experience — 13 September 2026

## Delivered outcome

The owner can start a private Harbor instance, authenticate with an independent official Codex account home, create a local project and conduct a real conversation. The current user instance completed official device login and an authenticated Harbor browser conversation using GPT-5.6-Sol. Its visible final response was “你好，我确认正在通过 Harbor 与你对话。” No file or tool operation was requested in that turn. The service remains running for the owner with a read-only ceiling; account state and local project data persist separately from ordinary Codex state.

[P013](../../design/proposals/013-personal-local-experience.md) is Implemented, not Verified. The [critical regression gate](../../issues/2026-09-13-143001-local-critical-regression-gate.md) remains open. Existing Linux/deployment and dedicated live-account proposal obligations are not satisfied by this personal trial.

## Source and environment

- Reviewed working-tree source digest: `8f914e57677af334c58abb9fc0a7b1990d6df90672d9a55aa0a62eba44abeadb`, algorithm `sha256-path-and-content-v1`, 1,049 implementation/configuration files; computed with `scripts/source-digest.ts` after the local model-discovery correction.
- macOS, Node 24.11.1, pnpm 12.3.4, Docker Linux engine 28.2.2, separate official Codex 0.153.4. Normal Codex 0.154.0 installation was not replaced.
- PostgreSQL/Caddy and native homes are namespaced per instance. Automated checks used fresh fake accounts or empty native homes. The user's official authentication was interactive user activity, separate from automated tests.
- No commits, pushes, stash modifications or installed-service changes. Pre-existing untracked `.pnpm-store/` retained unchanged.

## Verification

- `pnpm dev --local`: build and actual Docker/API/supervisor/owner-provider startup passed. Official `codex login --device-auth` in the instance's private home completed after user authorization.
- Actual browser access uses the instance certificate. The owner explicitly approved installing this specific Caddy public root in the macOS login keychain; no certificate-verification bypass was used. No root private key was copied.
- `node --import tsx tests/local/e2e.ts`: passed through actual local launcher, browser/OIDC, API, PostgreSQL and supervisor. Only external Codex was simulated. Covered unauthorized/Origin/CSRF denials, unsupported operations, project creation, streaming/reload, duplicate intent, approval cancellation, full launcher restart and retained conversation. Artifact `.test-runs/local-e2e-B3AdYK/local-conversation.png`; test-owned Docker resources cleaned.
- Pinned native local contracts: 2/2 passed with empty private homes. Actual native read-only execution permitted a harmless read and denied writes both inside and outside the workspace; canaries remained unchanged. Granular policy accepted with local-only experimental capability, ordinary descendant cleanup confirmed. No model request or user credentials used. Empty native thread resume could not be checked without a persisted turn.
- Independent launcher scratch checks: pre-login symlink rejection preserved an external canary; SIGTERM during fake login stopped the owned child and removed the launcher lock. Reproducer retained in `.test-runs/local-review/launcher.mjs`.
- Local owner OIDC, configuration rejection, OpenAPI/nullable inspection, TypeScript and documentation checks passed. `pnpm check` passed again on the final source digest, including formatting and the versioned OpenAPI check.
- `pnpm test`: 12/12 passed with permission for fresh local Unix-socket creation. Initial sandboxed run was blocked by EPERM and is not a test assertion result.
- `pnpm test:e2e`: failed at retained-conversation composer visibility before the replay-gap scenario, after earlier feature checks passed. Cause unknown; the mandatory gate remains explicitly open rather than being replaced by local success.
- Final native model-discovery helper: actual pinned empty-home model listing and confirmed retirement passed; explicit configured allowlist retained. Shared production model authorization was not changed. This helper was added after the full local E2E; its distinct native check and the owner's subsequent real conversation establish its exercised scope.

## Review and fixes

Two cross-component independent rounds avoided self-review: the native implementer reviewed startup/OIDC/application changes; the startup implementer reviewed native/application changes. Round 1 found native approval escalation, pre-login symlink validation, early cancellation cleanup, stale/false account readiness, production-profile acceptance and unsupported recovery controls. All six were corrected and independently checked in round 2. Subsequent focused review covered local workspace inspection contracts, private-state documentation exclusion and model discovery, with no remaining actionable findings in those deltas.

The [review issue](../../issues/archive/2026-09-13-143000-personal-local-review.md) retains the findings and closing evidence. Native process-group cleanup does not prove hostile detached-descendant containment; uncertain local recovery remains unavailable. [D010](../../design/decisions/010-personal-local-experience.md) documents this personal trust model and the scoped experimental protocol requirement.

## Operations and remaining limits

Use the [personal local guide](../developer/local-personal.md). Default local state is ignored `.harbor-local/`. Normal shutdown preserves it; account replacement requires stopping this instance before native login. Do not rebuild the shared web output while the instance is serving it: restart after a source/build change so static asset registration matches the new files.

The current experience supports read-only conversations. Managed workspaces, file editing, attachments, terminals, schedules, previews and explicit uncertain-work recovery remain unavailable locally. Linux profile behavior and its prior evidence remain separate. The open critical regression prevents P013 verification/archival even though the requested personal account trial works.
