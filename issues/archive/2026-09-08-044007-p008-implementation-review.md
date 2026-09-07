# Scheduling authority, source and retention corrections

- Severity: High overall; individual findings below
- Status: Resolved
- Archive disposition: Resolved
- Archived: 2026-09-08
- Owner: P008 implementer; independent feature reviewer
- Affected files: `packages/schedules/`, `apps/supervisor/src/main.ts`, scheduling routes, `tests/schedules/`
- Acceptance: [P008-01–06](../../design/proposals/008-scheduled-tasks.md#independent-acceptance), critical regression gate

## Independent review findings — 8 September 2026

Round 1 reviewed checkpoint `095d1b5f0cc5b608e804741e34680e4aadef48e6`, source `521ea276490e80e59961aa40d41df9a9d39ac1f8dfd4f5ea9a1c5a03b99a21ae` /984 files. It identified five corrections under the accepted scheduling contract:

1. **High — admitted Git source was not frozen.** Admission persisted IDs and prompt, but standalone preparation resolved HEAD later. Moving HEAD between admission and preparation could change the accepted source. Capture the immutable OID under the required source/project reservation, then use it after current-authority checks.
2. **Medium — material edits lacked execution authority.** A manage-only or insufficient-write-ceiling PAT could revise executable configuration. Require execute permission and the current target/preparation ceiling before changing a revision or grant.
3. **Medium — idle retention did not expire control receipts.** Expired command references could keep settled occurrences beyond 90 days when a paused or completed schedule had no new admissions. Periodic bounded maintenance must prune eligible receipts before occurrence history.
4. **Medium — pause reconciliation ignored newer one-shot grants.** Run-now advanced the grant epoch without changing the regular active grant ID. A new-key pause could reuse an older result while leaving the newer one-shot valid. Bind new pause intent to the current grant frontier while preserving an old-key retry's exact response.
5. **Medium — emergency stop lacked durable schedule state.** The execution fence denied dispatch, but schedule rows/grants remained active. Atomically pause future/accepted work and revoke its grants, preserve already-running history, and allow denied preparation to settle without opening new dispatch.

## Correction checkpoint

Round 2 source review found no remaining actionable finding in these corrections, including the settlement-only fence retaining identity, lease and deployment checks. Source `1f91692c5091df9e9ce401203acc9ca8b5fa58ed2ef9b2581c695f612e62a909` /985 files passed Node 24.11.1 check/build, 11 integration tests, 18 pinned Codex 0.153.4 contracts, and real-stack schedule acceptance `4b2ae9e5f7` with matching start/end identity. The independent reviewer inspected the feature result. Harbor's API, PostgreSQL, queue and supervisor were real; external Codex/OIDC were fixtures.

Cumulative run `9a406b0873` stopped at the separate [attachment-selection regression](../2026-09-08-044009-p005-selection-regression.md). A later diagnostic-only source `c3abd75c6c73174c9650e56d2168703a66227b15a5a770ae2cbeda0e2dfbbec8` /985 passed cumulative `6a3bf52ef0`; that does not establish the earlier attachment cause. Record the committed correction, final report and independently inspected regression evidence before archiving this issue. P009 registry/drain/restore integration, managed workspace validation and live-account acceptance remain separately owned gates.

## Resolution — 8 September 2026

The five corrections are committed in `cc38b943`, integrated with the reviewed module baseline in `9f3b414`, and merged into root `e1b754a`. Independent round 2 closed the corrective source and exact feature evidence. A separate bounded integration review inspected registry/drain/rebind, matching feature and critical evidence, and the final actual Linux administrator metadata bridge with no remaining actionable scoped finding.

Node 24.11.1 integrated schedule run `9cefdbb8f5` passed at exact `f0db8bcc0cd515d42b8519df6403379d7698ad8672a1659fa9ceea64259b6b47` /998. Its original intermediate scope label is stale; the [development report](../../docs/reports/2026-09-08-p008-development.md#installed-module-integration-checkpoint--8-september-2026) qualifies the actual executed authority, lifecycle, fault, quota and maintenance assertions. Critical run `177ce1a3c3` passed at `ad4517f57745bb18accd7c870767acbc22335794d02fb49a1f346e3609df7c09` /998 with identical production bytes and a diagnostic-only delta. Check/build, 11 integration tests and 18 pinned-runtime contracts also passed. Final Linux bridge evidence is bound to `ce8ad2847e116ac6f6f059198bd9bbaf1564fc74edfc09bdf78113fe72858a9e` /998, with only the reported test-driver changes.

This resolution closes the five source findings, not complete P008 verification. Its time-engine DST tests passed, while real-stack non-UTC preview and occurrence coverage remains an active P008-02 task. P008-07 dedicated credentials and protected filesystem restore/promotion remain separate blocked gates. The unexplained P005 draft failures remain Open after the reviewed diagnostic integration; passing regression evidence does not assign their cause.
