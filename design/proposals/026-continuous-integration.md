# P026 — Continuous integration checks

## Metadata

- ID: P026
- Status: Draft
- Priority: Urgent, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Every pull request and every push to `main` runs the standard build, check, test and fixture browser gates on GitHub-hosted runners, and the deploy workflow cannot build or promote a revision whose gates failed.
- Authorization: Proposal writing only. Adding workflows, changing branch protection and running deploys need the owner's go-ahead.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529`. The only workflow is [deploy-vps.yml](../../.github/workflows/deploy-vps.yml), which runs `pnpm install` and `pnpm build` on the VPS and no checks or tests.
- Dependencies: None. GitHub-hosted `ubuntu-24.04` runners provide Docker, which the fixture browser lane uses for PostgreSQL.
- Source issues: None.
- Design references: [Workflow verification gate](../workflow.md#implementation-and-verification-gate), [architecture verification contract](../architecture.md#repeatable-verification-through-the-application), [developer guide command availability](../../docs/developer/development.md#command-availability), [GitHub Actions deployment](../../docs/developer/github-actions-deploy.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P026-01–P026-07.

## Problem, outcome and exclusions

The repository's gates run only when a person or agent remembers to run them locally, and their results live in prose reports. Nothing checks a pull request automatically, and the deploy workflow can package any commit on the chosen branch. A regression can therefore reach the owner's instance with no failing signal.

After this change, GitHub shows a named status on every pull request and push to `main`: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm check`, `pnpm test` and the fixture design lane `pnpm test:e2e --design`, which exercises the real API, PostgreSQL and supervisor with the Codex and identity-provider fixtures. The deploy workflow's `build` and `deploy` actions run the same gates first and stop when any fails; `preflight` stays read-only and immediate. CI run links can then serve as command evidence in delivery records.

Excluded: the pinned-runtime contract, live-account, managed isolation, egress and personal VPS Linux lanes, which need a pinned Codex binary, credentials, XFS storage or root systemd access; automatic deployment on push; and branch protection, which is a repository setting only the owner can change. [P025](025-clean-supervisor-shutdown-and-restart.md) adds a separate workflow that runs the personal VPS Linux lane on a GitHub-hosted runner for its own evidence; making that lane a required check is left to a later change.

## Dependencies and current design

The workflow verification gate already names build, check, test, real-stack E2E and critical regressions for behavioral changes. This plan only automates the subset that needs no secrets or special hosts. It does not change which lanes a proposal must run.

The fixture design lane uses Docker Compose for PostgreSQL and Playwright's Chromium. On hosted runners the browser is installed by the workflow; the no-download rule for cloud coding sessions does not apply there.

## Source issues

None.

## User and API flows

Not applicable to the Harbor UI or API. The developer-facing flow is the pull request status list and the deploy workflow run page.

## Contracts, state and security

- Workflows use the committed lockfile and the pinned Node 24.11.1 and pnpm 12.3.4 versions.
- The CI workflow has `permissions: contents: read`, uses no secrets and runs on `pull_request`, so fork pull requests receive no credentials.
- Failure artifacts contain only fixture data, such as screenshots and structural diagnostics from the run-owned `.test-runs` directory, and expire after seven days.
- The deploy workflow calls the CI workflow as a reusable job and makes its `deploy` job depend on it for the `build` and `deploy` actions. The VPS SSH key is never exposed to the CI job.

## Implementation brief

Add a CI workflow that is both triggered directly and callable, with a fast `checks` job and a dependent `e2e-design` job. Make the deploy workflow call it. Update the developer and deployment guides to state exactly what CI runs and what still needs manual lanes. Run the new workflow on a scratch pull request, including one deliberately failing commit on that scratch branch that is then reverted, to show that failures turn the status red.

## Exact file fence

- `design/proposals/026-continuous-integration.md`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-vps.yml`
- `docs/developer/development.md`
- `docs/developer/github-actions-deploy.md`

If the fixture design lane needs a CI-specific prerequisite check, main amends this fence to add `tests/e2e/run.ts`. Weakening or skipping a test is never an allowed fix.

## Verification and acceptance

- **P026-01:** A pull request run executes install, build, check and test and shows a named status.
- **P026-02:** The same run executes `pnpm test:e2e --design` against the real API, PostgreSQL and supervisor with fixture Codex and identity provider, and uploads its failure artifacts when it fails.
- **P026-03:** A deliberately failing commit on a scratch branch turns the status red, then green again after the revert.
- **P026-04:** A `build` or `deploy` run of the deploy workflow stops before touching the VPS when CI fails, and `preflight` still runs without CI.
- **P026-05:** The CI job has read-only permissions and no secrets, and its artifacts contain no credentials.
- **P026-06:** With the owner's go-ahead, one `build` run of the changed deploy workflow on a revision with green CI completes and stages its release without changing services, which shows that the new CI dependency does not break the path to the VPS.
- **P026-07:** The developer guide lists what CI covers and which lanes remain manual.

Gate: documentation-only checks for the guides, plus observed workflow runs with their run links recorded. P026-06 needs the owner's go-ahead for that run; without it, P026 stays Accepted.

## Rollout and recovery

Merging the workflow starts CI on later pull requests. The owner may then mark the `checks` and `e2e-design` jobs as required in branch protection. Reverting the workflow files disables CI without affecting the application.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
