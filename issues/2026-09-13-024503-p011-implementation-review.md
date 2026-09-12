# Preview stop reservations and accepted execution readiness

- Severity: High
- Status: In progress
- Owner: P011
- Affected files: `apps/api/src/previews.ts`, `apps/api/src/server.ts`, `apps/supervisor/src/previews.ts`
- Acceptance: [P011-01/05](../design/proposals/011-private-project-previews.md#independent-acceptance)

## Independent review — 13 September 2026

The first full implementation review inspected production checkpoint `4218d71` and clean test/document checkpoint `a8a2f2c`. These are source-proven failure schedules, not claimed runtime reproductions:

1. While a stop is pending, two further requests with new keys return the same physical stop ID but consume the other two reserved generic intent slots. If retirement fails, the required acknowledged second attempt rolls back with `INTENT_QUOTA`, despite only one physical attempt having occurred.
2. After native execution and exact process acknowledgement, relay/HTTP readiness may wait. The readiness settlement rechecks the original source browser/PAT and kills the already-running process if that actor expires or is revoked. The accepted execution contract preserves those effects while requiring fresh authority for viewers and new actions.

The reviewer found no other actionable issue in this bounded full source review. Historical acceptance remains evidence for its exact source; it does not close these schedules. The earlier exact relay-disappearance correction and its historical cause limitations are separate.

## Required correction and evidence

Coalesce pending stop requests onto their retained physical attempt without storing unbounded aliases or consuming later attempt slots; retain exact-key responses and three physical attempts. Hold retirement, submit distinct-key pending requests, induce failure, and prove acknowledged attempts two and three remain available even with saturated ordinary history.

Settle readiness under captured execution identity, current instance/emergency/deployment state and exact runtime/reservation fences. Preserve pre-wire source authority checks. Establish actual delayed native startup, revoke the source actor, then require readiness and continued execution; fresh revoked requests remain denied and a current owner can explicitly stop it. Also exercise API restart with the active preview and no extra execution.

Corrections, focused application evidence, changed Linux lifecycle evidence and independent follow-up review are pending. Full proposal acceptance, installed/protected restore and other mandatory gates retain their separate qualifications.

## Corrective source and focused verification

Both corrections now exist, and the second bounded independent source recheck found no remaining actionable issue. Node24.11.1 actual application run `c494743823` passed at exact start/end `991fb86c4a2cefe8908c57df9e69435ae15ae07144c1be184fc1d1fc0b5517c4` /1,036 files. It exercises all failure schedules above, including API restart/stream reconnect and unchanged native identities. External Codex/OIDC fixtures are explicit. The [development report](../docs/reports/2026-09-08-p011-development.md#full-implementation-review-and-corrections--13-september-2026) preserves exact scope and the preceding test-observation failure.

The reviewer inspected that matching result and both named case artifacts, closing round 2 source plus focused application evidence without another finding. Full Node24 `pnpm check` passed. Keep this issue In progress pending changed supported Linux lifecycle acceptance and cumulative integration checks. Earlier full Linux isolation evidence is unchanged-boundary history, not a claim that these new lifecycle corrections ran there.

The cumulative candidate on main `84b13a1` subsequently passed check/build, 11 integration tests, 20 pinned contracts, 3 preview domain/upgrade tests, 26 Python plus 3 Node deployment contracts, and critical E2E `46bafa3212`, all at unchanged source `991fb86c…5517c4`. See the report's cumulative addendum for commands, exact digest and environment. Main review/acceptance and changed Linux lifecycle verification remain pending; retain In progress rather than closing from fixture acceptance alone.

Actual supported Linux run `c591ca08c4` subsequently passed the same focused corrective lifecycle at identical full source `991fb86c4a2cefe8908c57df9e69435ae15ae07144c1be184fc1d1fc0b5517c4` /1,036 files, Node24.11.1, managed XFS and pinned native runner/relay. Cleanup was confirmed and the old fixture remained intact. The independent reviewer inspected the exact result/readiness/fault artifacts and closed round 2 with no actionable finding. The [report](../docs/reports/2026-09-08-p011-development.md#changed-linux-lifecycle-closure--13-september-2026) records the accepted local-VM transfer review, artifact identity and inherited isolation scope. Only final main acceptance/issue lifecycle reconciliation remains for these two findings; protected restore and upstream live gates stay separately owned.
