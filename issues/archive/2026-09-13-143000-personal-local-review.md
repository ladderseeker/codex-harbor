# Personal local experience review

- Severity: High
- Archive disposition: Resolved
- Resolved: 2026-09-13
- Owner: P013 implementation lead
- Affected files: `scripts/local-dev.ts`, `apps/api/src/config.ts`, `apps/supervisor/src/main.ts`, `apps/api/src/server.ts`, `apps/web/src/App.tsx`, `packages/codex-adapter/src/index.ts`, `packages/codex-adapter/src/local-runtime.ts`.
- Scope: [P013](../../design/proposals/013-personal-local-experience.md), [D010](../../design/decisions/010-personal-local-experience.md).

## Evidence and impact

Two cross-component reviewers independently inspected files they did not implement on 2026-09-13. Round 1 found:

1. High: the personal runtime reused `untrusted` native approvals without proving that accepted approvals cannot escalate outside the native sandbox. The local profile lacks the Linux outer boundary, so it needs explicit escalation denial and native contract evidence.
2. High: local launcher authentication could follow a pre-existing `codex-home` symlink before runtime private-home validation, potentially changing normal account state. Validate before login.
3. Medium: startup installed signal cleanup after synchronous login/build/Compose work; interruption could leave the launcher lock and instance resources.
4. Medium: a successfully logged-in fresh instance could display login-required until a project exists, or retain stale account readiness after restart.
5. Medium: local profile validation did not reject `NODE_ENV=production`.
6. Medium: the local UI exposed recovery controls that the API always rejects.

A separate evidence limit remains: native process-group cleanup is not proof of hostile descendant containment. Keep the personal trust boundary explicit; uncertain recovery must remain fenced and cannot assert Linux-equivalent retirement.

## Next action

The fixes and independent verification are recorded below. No user credentials were entered during the initial startup checks; the later owner-authorized trial is documented separately.

## Resolution

All six findings corrected and independently verified in two cross-component review rounds, plus focused delta review. Local E2E, native no-escalation/denial checks, launcher symlink/cancellation checks and the real owner conversation passed within the scopes documented in the [delivery report](../../docs/reports/2026-09-13-personal-local-experience.md). Reviewed final source digest: `8f914e57677af334c58abb9fc0a7b1990d6df90672d9a55aa0a62eba44abeadb`. No hostile descendant isolation is claimed. The separate [critical regression gate](2026-09-13-143001-local-critical-regression-gate.md) remains open and keeps P013 unverified.

### Later regression evidence — 13 September 2026

The historical open-gate statement above is superseded by the [resolved regression record](2026-09-13-143001-local-critical-regression-gate.md): P014 instrumented critical acceptance passed, including retention/replay gap. This addendum does not archive P013.
