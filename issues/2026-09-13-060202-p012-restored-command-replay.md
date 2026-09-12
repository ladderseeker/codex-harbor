# Restored command aliases can retain a valid owner's replay identity

- Severity: Medium
- Status: In progress
- Owner: P012 implementer; separate module reviewer verifies the correction
- Affected files: `packages/storage/src/extension-restore.ts`, `packages/extensions/src/commands.ts`, extension history indexing and restore regression tests
- Acceptance: [P012-04/05](../design/proposals/012-managed-skills-and-mcp.md#independent-acceptance) and inherited [P009-04](../design/proposals/009-portable-deployment-and-restore.md#independent-acceptance)

## Source finding — 13 September 2026

Independent module review of `5c7a0be` found that `extension-restore.ts:180` preserves an existing actor string beginning with `restored:` while renaming its command slot and expiring its retry window. `apps/api/src/config.ts:32` permits any nonempty owner subject, so `restored:owner` is a valid original owner. `commands.ts:88–101` looks up that actor and idempotency key before expiry or ordinary-alias collection and returns the retained result without excluding restored slots.

A fresh authenticated destination owner with that subject can therefore submit the old matching key/body and receive the source command result, although destination extension configuration is disabled. This violates the restore contract's rejection of source command retries. The finding is source-proven and confirmed by the implementer; no new external effect, browser reproduction or actual restored-host failure is claimed.

The bounded module review found no other actionable defect in registry/drain, exact retirement, destination manifest validation/retry, control/catalog revocation or retained-capacity changes. Existing real PostgreSQL and confined tmpfs primitive tests do not establish the pending managed destination bridge, physical/native, protected-transfer or complete feature gates.

## Correction and required evidence

Reject historical source commands explicitly before live replay or new admission, using retained original owner/key evidence rather than an actor-prefix convention. Preserve that denial after ordinary alias collection while allowing a distinct fresh request under current destination authority. Keep lookups and retained history bounded, and preserve original results for historical inspection.

Add a real PostgreSQL regression with the valid prefix owner and exact old request before and after alias collection, plus a fresh request with one admitted effect. Recheck repeated restore and reserved control capacity. Record exact correction identity, commands/environment/results, independent corrective review and main integration before resolving and archiving. Actual installed/managed restore and the separately blocked protected A-to-B gate remain explicit.

## Corrective review round 2 — 13 September 2026

Checkpoint `9c44fc5` rejects retained original owner/key history before command replay, alias collection or new effects. A partial digest index accelerates the lookup, and exact comparisons determine the match; the correction adds no retained history rows. The real PostgreSQL regression invokes `extensionCommand` with the exact prefix owner and old request, verifies denial both before and after alias collection, and admits one distinct fresh effect. Repeated-restore and 544-control recovery-headroom/overflow-rollback assertions continue to pass.

Node 24.11.1 validation passed in the final PostgreSQL/module run and `pnpm check`. The P012 worktree log `.test-runs/p012-module-alias-db-final-2.log` has SHA-256 `dd8d7d95896c8418cec9b33f5e606f35567ca249a89c838563f5d8bc7ce6128e`; `.test-runs/p012-module-alias-check.log` has SHA-256 `4fc3b7fb31ad629747374ef41ac7781df5ce8a737046e41f7dbe546bab892f1c`. The tested code subsequently formed aggregate checkpoint `81377fb`, source digest `9ac651060edc156005002219b416f2f22f0cc4d17e539108dc8cefee1670a2d6` across 1,085 files. Its separate publication/trust-capture test addition was prepared but not executed by these checks.

Independent round 2 matched both logs, inspected the correction and real database assertions, and closed the sole module source finding without another actionable issue. The reviewer did not rerun tests. Main integration and actual installed/managed, physical/native and complete acceptance gates remain pending; this issue stays In progress. The two module review rounds are separate from the earlier four-finding implementation review and its qualified application evidence.
