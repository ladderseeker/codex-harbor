# P026 — Continuous integration checks

## Metadata

- ID: P026
- Status: Draft
- Priority: Urgent, recommended by the [25 September 2026 project review](../../docs/reports/2026-09-25-project-review.md#recommended-priorities); the owner confirms or changes it.
- Created: 2026-09-25
- Owner: Main conversation; future implementation owner unassigned
- Outcome: Every pull request and every push to `main` runs the standard build, check, test and fixture browser gates on GitHub-hosted runners, and the deploy workflow cannot build or promote a revision whose gates failed.
- Authorization: On 27 September 2026 the owner authorized evaluation and revision of the open proposals, followed by commit and push of these document changes to `main`. Feature implementation, live experiments and deployment are outside this audit.
- Baseline: Source inspection of `d0c505b8b58b6ba8d9597d867f14b36f832b0529`. The only workflow is [deploy-vps.yml](../../.github/workflows/deploy-vps.yml), which runs `pnpm install` and `pnpm build` on the VPS and no checks or tests.
- Dependencies: Hosted Actions execution, scratch-PR permissions and demonstrated Docker/Compose/browser/Git-helper prerequisites are required. They are not established by this audit. P026-06 also requires authorization for its exact VPS build run; unavailable mandatory workflow/build evidence blocks completion.
- Source issues: None.
- Design references: [Workflow verification gate](../workflow.md#implementation-and-verification-gate), [architecture verification contract](../architecture.md#repeatable-verification-through-the-application), [developer guide command availability](../../docs/developer/development.md#command-availability), [GitHub Actions deployment](../../docs/developer/github-actions-deploy.md).
- Exact file fence: [Below](#exact-file-fence).
- Acceptance IDs: P026-01–P026-07.

## Review note — 27 September 2026

Read-only source review against `e6c2a138563139650af46fe51af44c6eb6c28743`; the original baseline in Metadata and dated evidence remain historical. The plan now binds CI and deployment to immutable source identities, gives each job complete prerequisites and separates read-only preflight. Observed hosted workflow and authorized VPS build evidence remain mandatory future gates. This audit runs documentation checks only and adopts no canonical feature contract, performs no application/runtime/Linux acceptance and closes no issue.

## Problem, outcome and exclusions

The repository's gates run only when a person or agent remembers to run them locally, and their results live in prose reports. Nothing checks a pull request automatically, and the deploy workflow can package any commit on the chosen branch. A regression can therefore reach the owner's instance with no failing signal.

After this change, GitHub shows a named status on every pull request and push to `main`: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm check`, `pnpm test` and the fixture design lane `pnpm test:e2e --design`, which exercises the real API, PostgreSQL and supervisor with the Codex and identity-provider fixtures. The deploy workflow's `build` and `deploy` actions run the same gates first and stop when any fails; `preflight` stays read-only and immediate. CI run links can then serve as command evidence in delivery records.

Excluded: the pinned-runtime contract, live-account, managed isolation and egress lanes, which need a pinned Codex binary, credentials or XFS storage; the personal VPS Linux lane, which needs root systemd access and which [P025](025-clean-supervisor-shutdown-and-restart.md) adds as a separate workflow on a GitHub-hosted runner for its own evidence, so making it a required check is left to a later change; automatic deployment on push; and branch protection, which is a repository setting only the owner can change.

## Dependencies and current design

The workflow verification gate already names build, check, test, real-stack E2E and critical regressions for behavioral changes. This plan only automates the subset that needs no secrets or special hosts. It does not change which lanes a proposal must run.

Each fresh job owns checkout, pinned Node/pnpm setup, frozen-lockfile install and build; `needs` does not share files. The browser job verifies Docker Compose supports the repository's `!reset` and networking configuration, obtains the Caddy/PostgreSQL images, installs Chromium with `pnpm exec playwright install --with-deps chromium`, and builds the pinned Git helper with `docker build -f infra/git/Dockerfile -t codex-harbor-git:2.39.5-p003 .`. Record versions and prerequisite exits. Hosted browser installation is allowed; no missing prerequisite may become a skipped successful lane.

## Source issues

None.

## User and API flows

Not applicable to the Harbor UI or API. The developer-facing flow is the pull request status list and the deploy workflow run page.

## Contracts, state and security

- Workflows use the committed lockfile and the pinned Node 24.11.1 and pnpm 12.3.4 versions.
- The CI workflow has `permissions: contents: read`, `persist-credentials: false`, no inherited secrets and no production environment. It runs untrusted PR code without VPS credentials. PR evidence identifies the tested merge SHA; push evidence identifies the push SHA. A reusable workflow called by local path comes from the same commit as its caller.
- Artifact upload allowlists redacted screenshots and structural diagnostics, never entire run directories containing cookies, databases, generated credentials or environment files. Retain source/run identity and command exits; artifacts expire after seven days. Jobs have finite timeouts and cleanup only their owned containers/processes/directories, including failure/cancellation paths.
- The deploy workflow tests, packages and sends one recorded immutable SHA through its reusable CI job. `build`/`deploy` may prepare SSH credentials or touch the VPS only after every required CI job succeeds; failed, cancelled or skipped CI denies those steps. A separate read-only `preflight` job has no dependency on skipped CI, so GitHub dependency propagation cannot suppress it. CI never receives the VPS SSH key, inherited secrets or a production environment.

## Implementation brief

Add a CI workflow that is both triggered directly and callable, with a fast `checks` job and a dependent `e2e-design` job. Make the deploy workflow call it. Update the developer and deployment guides to state exactly what CI runs and what still needs manual lanes. Once future workflow execution is authorized, run it on a scratch pull request, including a deliberately failing commit then its revert. Retain immutable tested/build SHA and run links. This audit neither creates that PR nor triggers Actions or VPS work.

## Exact file fence

The paths below are a prospective feature-implementation fence, not authorization to edit them during this audit. The current audit edits only the fourteen selected Draft proposals. Main must settle any missing new paths and check provisional decision/migration numbering before acceptance.

- `design/proposals/026-continuous-integration.md`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-vps.yml`
- `docs/developer/development.md`
- `docs/developer/github-actions-deploy.md`

If the fixture design lane needs a CI-specific prerequisite check, main amends this fence to add `tests/e2e/run.ts`. Weakening or skipping a test is never an allowed fix.

## Verification and acceptance

- **P026-01:** A fresh pull request run executes pinned setup, frozen install, build, check and test and records its merge SHA/status; a push run records the push SHA. Independent jobs do not inherit an absent checkout or build.
- **P026-02:** The same run executes `pnpm test:e2e --design` against the real API, PostgreSQL and supervisor with fixture Codex and identity provider, after independently satisfying Compose, Chromium system-library and pinned Git-helper prerequisites; failure uploads only the redacted allowlist.
- **P026-03:** A deliberately failing commit on a scratch branch turns the status red, then green again after the revert.
- **P026-04:** Failed, cancelled and skipped CI each prevent SSH-key preparation and any VPS `build`/`deploy` step. Separate `preflight` runs read-only without CI dependencies. A moved branch cannot change the immutable tested/package/build SHA.
- **P026-05:** CI has read-only permissions, checkout credential persistence disabled, no secrets or production environment, and artifact allowlists contain no credentials. Inspect timeout, failure/cancellation cleanup and fork-PR behavior.
- **P026-06:** With the owner's go-ahead, one `build` run of the changed deploy workflow on a revision with green CI completes and stages its release without changing services, which shows that the new CI dependency does not break the path to the VPS.
- **P026-07:** The developer guide lists exact prerequisites, source identities, artifact policy and lanes still required manually. The design lane is a useful subset and never the full release-acceptance claim.

Gate: documentation-only checks for the guides, plus observed workflow runs with their run links recorded. P026-06 needs the owner's go-ahead for that run; without it, P026 stays Accepted.

## Rollout and recovery

Merging the workflow starts CI on later pull requests. The owner may then mark the `checks` and `e2e-design` jobs as required in branch protection. Reverting the workflow files disables CI without affecting the application.

## Review and findings

Pending. After the green gate, main starts fresh-context design and provenance reviewers, with at most three rounds.

## Closing record

Pending.
