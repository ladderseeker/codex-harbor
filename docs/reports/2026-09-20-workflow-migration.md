# P017 — Delivery workflow migration

- Date: 2026-09-20
- State: Implemented; two independent review rounds and final documentation bookkeeping gate passed.
- Baseline: `008227355bd05cb27dc13f4fbb585ef709b474b0`, initially clean working tree.
- Proposal: [P017](../../design/proposals/archive/017-evidence-based-delivery-workflow.md).
- Scope: English collaboration rules, current design ownership and reconciliation of legacy planning records. No application, test, runtime, package, UI asset or deployment behavior is changed.

## Evidence policy

Historical source/report observations support the legacy reconciliation; they are not new application test runs. Closing a legacy planning record as Finished / Baseline reconciled does not pass its outstanding product or release gates. Those obligations remain linked to inbox issues.

Raw validation output and the task-maintained delegation/review ledger are retained under ignored `.test-runs/p017-workflow-migration/`. This ledger is not an exported runtime session transcript. No complete runtime session export is available in this task. Independent provenance review must distinguish directly inspected output and source from historical report claims and unavailable artifacts.

## Implementation and acceptance

The selected outcome is one documentation migration: an executable proposal workflow, independent design/provenance review roles, current subsystem design ownership, and honest closure of legacy planning records. It does not implement deferred product features or pass old missing application gates.

The main conversation wrote P017 before delegating implementation. One worker owns governance/navigation; a second owns legacy records, issue ownership and subsystem design consolidation. Both began with fresh context and explicit file ownership. The baseline worker retains its read-only inventory context. The task ledger records this delegation as task-maintained history, not independently exported chronology.

During migration, all 14 moved legacy proposal historical bodies were compared against their baseline Git versions, normalizing only Markdown link destinations. All matched in `history-preservation-precheck.json`. This precheck establishes retained historical text, not the correctness of new summaries or application behavior.

Environment inspected for documentation checks: Linux x86_64, Node v24.11.1, pnpm 12.3.4, Git 2.43.0. Commands and exits are retained in `environment.json`; version inspection is not an application test.

The combined pre-review gate passed on 2026-09-20 at 08:18 UTC:

- `node scripts/check-docs.mjs`: exit 0; 152 Markdown files passed local links, anchors and whitespace.
- `git diff --check`: exit 0.
- The run-owned audit checked changed/new Markdown final newlines and trailing whitespace, all staged/unstaged/untracked paths against P017's exact fence, absence of application changes, all 16 legacy archive records, reopened runtime compatibility, folder-navigation tables and AGENTS length. No exceptions; AGENTS has 46 lines. The 166 changed paths count old and new move paths separately.
- Reproducible implementation digest: `71009ea9f605a5773638cb54935b9ee902f57c42b6298336f583f37b7d29148c`.

The digest is SHA-256 of sorted `path + NUL + file SHA-256 (or DELETED) + newline` records for changed/new paths. It excludes P017's active/archive paths and this report to avoid self-reference while review results are recorded. The exact manifest, command arguments/exits and log digests are in `review-round-1.json`; raw outputs are `review-round-1-links.log` and `review-round-1-whitespace.log` under the run directory. The run-owned `validate.py` reproduces the audit; it is scratch verification tooling, not a new product command.

At the initial gate, P017-01–05 were ready for independent review; P017-06 review and P017-07 archival were still pending. Their subsequent outcomes are recorded below. No build, typecheck, application, live-account or isolation suite ran for this documentation-only change.

## Review record

Round 1 reviewed implementation digest `71009ea9f605a5773638cb54935b9ee902f57c42b6298336f583f37b7d29148c` through separate fresh-context design and provenance reviewers, neither an implementation author. Both independently reproduced the digest and documentation results.

- **D1, Medium, accepted by main:** the workspace design copied obsolete optional-token and file/terminal exclusion wording from its historical plan. This conflicts with P017-02's current-design requirement. The actual workspace-management routes require owner-browser authority; token-exposed operations use an explicit allowlist. The original baseline implementer was assigned the paragraph correction and links to the current resource sections. No product code change is needed.
- **Provenance:** no actionable findings. The reviewer independently verified all 14 historical proposal bodies, original proposal anchors, preserved report/issue history and all 32 obligation-map entries. Its raw receipt is `provenance-review/review-result.json` under the run directory. An initial reviewer history-extraction mismatch was diagnosed as its parser error; the corrected comparison passed and both are retained.

Main's judgments are recorded in `round-1-dispositions.json`. The original implementer corrected D1 after inspecting the route/authority source. The retained `round1-D1.patch` and `round1-D1-source-and-patch.json` identify that fix. Main's combined gate passed again at 08:26 UTC: 152-file documentation check, whitespace and the full bounded path/layout audit, all exit 0. The implementation digest is now `0f2acb84fa8551957aac3af0f5bd477e35d949b611c39fdf975c7bd9edb50eef`; the manifest comparison in `round-2-delta.json` confirms that only `design/systems/002-workspaces-and-resources.md` changed since round 1. Report/proposal bookkeeping remains excluded as documented.

Round 2 is complete. The design reviewer confirmed D1 resolved against current authorization code. The provenance reviewer reproduced the changed manifest, fix before/after and five source hashes, current check counts/timestamps and log identities. Both returned clear for reviewed digest `0f2acb84fa8551957aac3af0f5bd477e35d949b611c39fdf975c7bd9edb50eef`; unchanged round-1 history checks remain applicable. Main accepted both verdicts. `round-2-dispositions.json` and `provenance-review/round-2-review-result.json` retain the evidence. No unresolved in-scope or new out-of-scope finding remains.

## Acceptance and final bookkeeping

- **P017-01:** English rules, 46-line AGENTS, canonical workflow, dependency/file-fence template and three role briefs are implemented and reviewed.
- **P017-02:** Six subsystem designs own current contracts and distinguish implemented, partial and deferred boundaries; the single copied-scope finding is corrected.
- **P017-03:** All 16 legacy proposals are archived. Fourteen retain reconciled-baseline summaries and original history; P014/P016 retain verified completion evidence. All 32 unresolved-obligation mappings resolve to inbox records. Runtime compatibility is reopened; new [self-development](../../issues/2026-09-20-000003-self-development-acceptance.md) and [managed-extension](../../issues/2026-09-20-000004-managed-extensions-acceptance.md) issues retain complete deferred outcomes. No legacy gate is waived.
- **P017-04:** Proposal/issue READMEs provide folder navigation without priority/status tables. Local links/anchors passed before review and after the scoped correction.
- **P017-05:** Documentation-only path, whitespace/newline, structure and history-preservation checks passed. No application source, runtime, package, UI asset or test is changed.
- **P017-06:** Two independent design/provenance review rounds completed; D1 was accepted, fixed by its original implementer and verified; both final verdicts are clear. Session-export and historical-artifact limits remain explicit.
- **P017-07:** P017 is marked Implemented / Completed and moved to the archive. Main repaired its relative links and the D013/report inbound links. Final bookkeeping gate and digest are recorded below.

Main's final archive bookkeeping gate passed at 08:30 UTC: `node scripts/check-docs.mjs` validated 152 Markdown files, `git diff --check` exited 0, and the exact fence/newline/layout audit reported no exceptions and zero active proposals. P017's Implemented/Completed metadata and unchanged source HEAD/empty staging area were inspected separately.

The final bookkeeping digest is `3d2a2cb63da60493f6a9b7232d0358d0607794f6765b12e1117cb99c522ecffc`. Comparison with the independently reviewed digest shows only D013's execution-record link changed in the implementation manifest, now targeting archived P017. The excluded proposal/report received the planned status, relative/inbound link and result updates. `archive-bookkeeping.json` retains exact command exits, scope and log hashes; `final-bookkeeping-delta.json` identifies the delta and metadata checks. This final bookkeeping verification is attributed to main, not to the reviewers' earlier source identity. The final report text is checked again with the same documentation gate in `final-closure.json`.

## Delivery

No commit, push or deployment has been performed. The completed candidate remains an unstaged working-tree diff for owner review and commit confirmation. The source HEAD is unchanged; there are no staged paths or stashes. Persistent run-owned evidence remains under `.test-runs/p017-workflow-migration/`; no test service or long-lived process was started by this task.
