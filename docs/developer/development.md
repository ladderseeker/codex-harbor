# Developer workflow

P001's foundation is implemented and has completed four independent review rounds. The TypeScript workspace, owner-authenticated application, persistent supervisor, deterministic browser/API harness, and supported Linux isolation lane passed their recorded checks. The [foundation report](../reports/2026-09-07-p001-foundation.md) distinguishes that evidence from the [live-account gate](../../issues/2026-09-07-171225-live-runtime-credentials.md) and medium follow-ups that keep P001 unverified.

The [architecture](../../design/architecture.md) defines the target system. The [proposal index](../../design/proposals/README.md) defines independently verifiable feature outcomes and their dependencies. The [issue index](../../issues/README.md) exposes active findings and pending work transferred to proposals. Both indexes link their archives. [AGENTS.md](../../AGENTS.md#document-ownership-and-lifecycle) contains the canonical lifecycle and working rules.

P002 adds scoped credentials for external clients; use the [programmatic API guide](programmatic-api.md). Its [implementation report](../reports/2026-09-07-p002-api-tokens.md) records the original two review rounds, a focused third authority-correction round, and Node 24 validation separately from the still-open live-account and feature-integration gates.

P003 adds managed parallel workspaces; see the [workspace guide](workspaces.md) and [implementation evidence](../reports/2026-09-07-p003-workspaces.md). Its combined P001/P002/P003 application and actual Linux checks passed on Node 24; the real-account parallel-turn gate remains open.

P005 adds bounded image/text attachments and saved drafts. See [attachment verification](attachments.md) for API/storage boundaries, real Linux publication checks, and the separate live-account command. Three independent review rounds and the recorded browser/Linux checks passed; the mandatory real-account and cross-feature integration gates remain open.

## Run the deterministic application locally

The tested macOS toolchain uses Node 24.11.1, pnpm 12.3.4, and a running Linux Docker engine with Compose. The repository pins JavaScript dependencies and the external Codex protocol baseline at 0.153.4. PostgreSQL 17.6 and Caddy 2.10.2 are provisioned by the run-specific Compose instance.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```

The E2E harness starts real Caddy, API, PostgreSQL, supervisor, and browser components. Only the identity provider and external Codex process are deterministic fixtures. It creates fresh ports, credentials, project folders, and state, then removes its own resources. Secret-free screenshots and the run result remain under `.test-runs/<instance>/`; that directory is ignored by Git. On Linux, Playwright also needs its documented system browser dependencies.

For a disposable interactive instance:

```sh
pnpm dev --fixture
```

Use the printed login URL and the fixture provider's owner identity. The denied identity exercises owner allowlisting. This command builds once, then runs until Ctrl-C; restart it after source changes. Its project files and database are disposable and removed on shutdown. Use only test data and fake model credentials in this profile.

Caddy generates a private development certificate. Automated E2E accepts it only within its fresh test browser context. An ordinary browser requires appropriate local certificate trust; real credential onboarding must use verified HTTPS. The harness does not install a root certificate in the user's normal trust store.

## Working on documents now

1. Inspect the working tree, including untracked files, and use the proposal/issue indexes and their archives to find the relevant design, existing work, and dependencies before editing.
2. Put new design or feature proposals in `design/`. Update the canonical requirement instead of copying it into another document. Keep the relevant indexes and links current.
3. Put documentation for actual behavior, developer procedures, and completed reports in `docs/`. State limitations and pending verification explicitly.
4. Review changed documents for complete acceptance criteria, dependency consistency, portability, security boundaries, and agreement between architecture and proposals.
5. Validate local Markdown links, document structure, and whitespace; include newly created files in the checks. `git diff --check` can check tracked diffs but does not validate untracked files or links.
6. Complete independent review and any resulting fixes according to [the repository review cycle](../../AGENTS.md#delegation-and-review). Record findings and maintain their ownership through the [issue lifecycle](../../AGENTS.md#issue-resolution-and-transfer).

Document validation establishes document quality. It does not establish that proposed application behavior, runtime compatibility, or isolation works.

## Delivering a feature

Select a proposal whose dependencies are delivered, then define its acceptance evidence before implementation. A proposal is a complete outcome: its UI, API, persistence, permissions, lifecycle, and failure paths belong together where applicable. A large feature may take several implementation steps without becoming several proposals. A small feature may remain a proposal if it produces a complete useful outcome.

Use the [proposal lifecycle](../../AGENTS.md#proposal-completion-and-archive) to track decision and delivery independently, starting implementation at `In progress`. Follow its evidence requirements before completion and archival; a design review establishes no application delivery.

Use a branch/worktree for isolated implementation, especially when work happens in parallel. Preserve unrelated changes. Keep the proposal current if requirements change, and update actual user/developer documentation as behavior becomes available. Do not make commits or publish changes without task authorization.

Implement the outcome, run its end-to-end acceptance scenarios and the critical regression suite, obtain independent review, fix actionable findings, and verify the fixes. Record the revision, environment, commands, results, skipped gates, and review rounds in an appropriate report linked from the proposal. Screenshots and test traces are supporting evidence, not a substitute for assertions about the result.

Finish the lifecycle update with the proposal's closing notes, source-issue evidence, current user/developer documentation, and both active/archive indexes and links. Follow the [reopening and design maintenance rules](../../AGENTS.md#reopening-and-design-maintenance) when findings invalidate closure or materially change the design.

## Command availability

The implemented entry points are `pnpm dev`, `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm test:contract`, `pnpm test:live`, `pnpm test:isolation`, and `pnpm test:egress`. Their results and unavailable gates are recorded in the foundation report. The canonical semantics and future feature ownership remain in the [design's command contract](../../design/architecture.md#local-first-development-and-portable-environments).

`pnpm test:contract` requires the real pinned Codex 0.153.4 executable and uses fresh native homes without the developer's account state. `pnpm test:egress` exercises gateway policy, HTTP transport, DNS validation, and stream bounds. The corresponding Linux gateway test additionally requires built runner/gateway images:

```sh
docker build -f infra/runner/Dockerfile -t codex-harbor-runner:0.153.4 .
docker build -f infra/egress/Dockerfile -t codex-harbor-egress:1 .
node tests/egress/linux.mjs
```

When the system resolver returns reserved synthetic addresses, the trusted optional `HARBOR_EGRESS_DNS_PROFILE=cloudflare-doh` profile uses authenticated DNS over HTTPS; it retains public-address validation and fixed upstream routing. See [D001](../../design/decisions/001-confined-runtime-egress.md). Do not alter address-denial rules to make a local network test pass.

Production-profile isolation needs the [D003 XFS storage profile](../../design/decisions/003-quota-backed-project-storage.md) on a Linux host or dedicated VM. Follow the [Linux verification workflow](linux-verification.md) for its dedicated storage and test setup. Docker Desktop namespace/network checks alone do not prove persistent hard quotas. Incomplete prerequisite checks cannot establish a pass.

`pnpm test:live` requires dedicated `HARBOR_TEST_OPENAI_API_KEY` credentials, plus the supported Linux execution profile. No dedicated credentials are currently configured. The lane reports that missing gate explicitly and makes no model request; do not substitute normal Codex state or personal project directories. `pnpm test:e2e:self` remains unavailable until P010 is implemented.

Configured `pnpm dev` starts the API and supervisor against explicitly configured dependencies. It requires `DATABASE_URL`, canonical HTTPS `HARBOR_ORIGIN`, the allowlisted OIDC issuer/client/subject, registered project roots, and the protected launcher/storage/credential services. It fails on missing prerequisites. Use the disposable fixture command above while the complete production setup instructions are being verified.

## End-to-end verification

End-to-end tests should start from the feature's public entry point and assert its persisted and observable outcome. Browser features use a real browser and Harbor's real API, database, and supervisor. API-only features use an authenticated API client and the same real services. Codex and identity-provider fixtures are permitted at those external boundaries to make ordinary tests repeatable; replacing Harbor's own services does not qualify as end-to-end coverage.

Test the feature's relevant negative and lifecycle cases as well as its successful path. For example, persistent conversation work must distinguish a closed browser from an interrupted runtime; authentication must cover API and streaming entry points, not only the login screen. Exact scenarios belong in the owning proposals rather than in a duplicate checklist here.

Use focused end-to-end coverage plus the critical regression suite for behavioral changes. Add lower-level tests when they cover meaningful risks, not implementation details. Adapter changes also need real pinned-runtime contracts and a live smoke check. Execution-boundary changes also need the real Linux isolation lane. Record unavailable required lanes as unverified and link an issue; do not advance the affected proposal to `Verified`.

Each test run owns isolated databases, project fixtures, temporary directories, listener ports, credentials, and `CODEX_HOME`. Never reuse the developer's ordinary Codex login/state, personal projects, or production database. Acquire real-runtime test credentials through the documented dedicated test configuration without copying them into logs or fixtures. Bound model usage and redact sensitive output from artifacts.

Assign each run a unique identity and clean up only its own processes, containers, volumes, and temporary files. Do not use broad `pkill`, shared-volume destruction, or unscoped container shutdown as test cleanup. A failed test must leave the stable service and other development sessions intact.

## Local and VPS implementation references

Development starts locally on macOS/Linux and later uses the same entry points on compatible Linux VPS hosts. The [local environment design](../../design/architecture.md#local-first-development-and-portable-environments) owns the planned topology and Linux VM requirements. [P010](../../design/proposals/010-self-development.md) owns developing Harbor through its stable instance; [P009](../../design/proposals/009-portable-deployment-and-restore.md) owns deployment, restore, and external recovery.

Those capabilities are planned, not operational today. As they are implemented, add tested setup and recovery instructions here or in linked operational guides. Keep future broker, candidate, and promotion specifications in their canonical design/proposals rather than copying them into this handbook. Existing authorization still governs work; self-development does not create a separate standing permission gate.
