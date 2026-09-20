# Developer workflow

The [architecture](../../design/architecture.md) and [subsystem designs](../../design/systems/README.md) own current system contracts, source ownership and evidence limits. This guide documents implemented development entry points and verification setup. The [delivery workflow](../../design/workflow.md) owns collaboration and record lifecycle; [AGENTS.md](../../AGENTS.md) provides essential safety directives.

Discover concrete findings and prior work through the [issue inbox](../../issues/README.md), [proposal directory](../../design/proposals/README.md) and their archive folders. [D013](../../design/decisions/013-evidence-based-delivery-workflow.md) reconciles legacy plans into historical baseline records without claiming all their original acceptance passed. Select one cohesive need, not an inherited execution queue. Self-development and managed extensions remain unavailable on main until selected, implemented and verified under a new plan.

Historical reports retain bounded results at identified sources. The [foundation report](../reports/2026-09-07-p001-foundation.md), [installed module report](../reports/2026-09-08-installed-module-integration.md), [scheduling report](../reports/2026-09-08-p008-development.md) and [preview report](../reports/2026-09-08-p011-development.md) distinguish application/native/Linux evidence from remaining real-account and protected restore gates. See [deployment tooling](deployment.md) for the implemented administrator interface and explicit readiness limits, and the [documentation index](../README.md) for feature-specific guides and reports.

## Run the deterministic application locally

For the real local account experience, see the [personal local guide](local-personal.md). The [dated critical-regression addendum](../reports/2026-09-13-personal-local-experience.md#critical-regression-addendum--13-september-2026) records the later P014 pass and supersedes the report's earlier open-gate statement. That personal trial does not satisfy managed Linux/deployment/live gates. The fixture profile below remains separate and must not use real credentials.

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

Follow the [workflow's document ownership](../../design/workflow.md#document-ownership-and-lifecycle) and [execution brief](../../design/workflow.md#mains-execution-brief), with the selected proposal's exact file fence. Update canonical designs and actual behavior docs, preserving dated historical reports. Before handing off, check content consistency, obligation mappings and navigation as well as the executable checks:

```sh
node scripts/check-docs.mjs
git diff --check
```

The document script checks local Markdown paths/anchors and whitespace/final newlines, including new files outside ignored directories. The Git command checks tracked differences only. Review the changed path list, required sections and factual consistency separately. Document validation does not establish application behavior, runtime compatibility or isolation.

## Delivering a feature

Use the [canonical workflow](../../design/workflow.md) and [proposal template](../../design/proposal-template.md). Main supplies a settled plan and self-contained brief; role instructions are [implementer](agents/implementer.md), [design reviewer](agents/design-reviewer.md) and [provenance reviewer](agents/provenance-reviewer.md). These plain documents do not install or configure runtime agents. The workflow owns automatic review after the green gate, finding adjudication, fix verification, the three-round cap and owner confirmation before a commit.

Keep enduring verification assets and supported isolated checkouts in persistent ignored storage, such as `.test-runs/`. OS temporary storage is for recreatable scratch. Preserve unrelated Git changes and record ownership/recovery for unfinished edits and live resources. The [interruption recovery report](../reports/2026-09-13-interrupted-work-recovery.md) records historical recovery locations and limitations; inspect current availability before relying on them.

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

`pnpm test:live` requires dedicated `HARBOR_TEST_OPENAI_API_KEY` credentials, plus the supported Linux execution profile. The historical reports record missing dedicated credentials; use explicit test configuration and a presence-only prerequisite check for each new run. When credentials are absent, the lane reports that missing gate explicitly and makes no model request; do not substitute normal Codex state or personal project directories. `pnpm test:e2e:self` is absent from the current package manifest and remains a deferred contract in the [development and extensions design](../../design/systems/005-development-and-extensions.md).

`pnpm test:live --history` adds P007's pinned native history/restart/resume check. Configure an explicit supported `HARBOR_TEST_CODEX_MODEL` alongside the dedicated test key on the trusted Linux/XFS fixture. The lane attempts at most two short read-only turns, confirms the exact first runtime is retired, resumes its persisted thread in a new generation and submits only new input. It records source identity and owned cleanup separately from the real Harbor application E2E. The [driver report](../reports/2026-09-13-p007-live-history-driver.md) records two review rounds, passing no-model checks and the still-unexecuted authenticated gate. Missing prerequisites return exit 2, not a pass.

Configured `pnpm dev` starts the API and supervisor against explicitly configured dependencies. It requires `DATABASE_URL`, canonical HTTPS `HARBOR_ORIGIN`, the allowlisted OIDC issuer/client/subject, registered project roots, and the protected launcher/storage/credential services. It fails on missing prerequisites. Use the disposable fixture command above while the complete production setup instructions are being verified.

## End-to-end verification

`pnpm test:e2e --design` exercises the P014 frontend through a fresh real Harbor stack: local-root browsing and denial cases, project registration, real fixture replies, persisted active/inactive rename and drafts, project-targeted creation, sidebar resizing, and desktop/mobile navigation. It retains screenshots and structural failure diagnostics under the owned `.test-runs/harbor-e2e-*` directory. The lane uses bounded pauses between burst-heavy browser/API phases to respect the ordinary request limit; it does not change server rate limits. P016 extends this lane with conversation menus/status, current-project search and archive/restore, source clipboard and temporary reactions, model-specific five-effort selection and rejection, and mobile dialog focus restoration. P023 adds five-row history pagination and refresh, separate modal search, top code headers and explicit bundled syntax grammars, outside-bubble user copy, and persisted command-group disclosures. `tests/e2e/p023.ts` runs after P014 in the design lane using the same owned real stack; its browser fault injection affects only history reads. Run `pnpm build` first and freeze source edits during acceptance. The [redesign delivery report](../reports/2026-09-13-frontend-redesign.md) records the current result and supporting lanes.

End-to-end tests should start from the feature's public entry point and assert its persisted and observable outcome. Browser features use a real browser and Harbor's real API, database, and supervisor. API-only features use an authenticated API client and the same real services. Codex and identity-provider fixtures are permitted at those external boundaries to make ordinary tests repeatable; replacing Harbor's own services does not qualify as end-to-end coverage.

Test the feature's relevant negative and lifecycle cases as well as its successful path. For example, persistent conversation work must distinguish a closed browser from an interrupted runtime; authentication must cover API and streaming entry points, not only the login screen. Durable acceptance contracts belong in current subsystem designs; the selected proposal maps its changed outcome to executable scenarios.

Run `pnpm build`, `pnpm check` and `pnpm test`, with focused end-to-end coverage plus the critical regression suite for behavioral changes. Add lower-level tests when they cover meaningful risks, not implementation details. Adapter changes also need real pinned-runtime contracts and a live smoke check. Execution-boundary changes also need the real Linux isolation lane. Record unavailable required lanes as unverified and link an issue; the affected proposal stays Accepted until its mandatory gate passes.

Each test run owns isolated databases, project fixtures, temporary directories, listener ports, credentials, and `CODEX_HOME`. Never reuse the developer's ordinary Codex login/state, personal projects, or production database. Acquire real-runtime test credentials through the documented dedicated test configuration without copying them into logs or fixtures. Bound model usage and redact sensitive output from artifacts.

Assign each run a unique identity and clean up only its own processes, containers, volumes, and temporary files. Do not use broad `pkill`, shared-volume destruction, or unscoped container shutdown as test cleanup. A failed test must leave the stable service and other development sessions intact.

## Local and VPS implementation references

Development starts locally on macOS/Linux and later uses the same entry points on compatible Linux VPS hosts. The [local environment design](../../design/architecture.md#local-first-development-and-portable-environments) owns the planned topology and Linux VM requirements. The [development and extensions design](../../design/systems/005-development-and-extensions.md) owns the deferred self-development contract; the [deployment and profiles design](../../design/systems/004-deployment-and-profiles.md) owns installation, restore and external recovery.

Deployment tooling has partial installed-profile evidence and a [current command guide](deployment.md); complete checkpoint/restore and release readiness remain unverified. The self-development broker and candidate workflow are deferred. Add tested usage when that outcome is delivered, keeping current requirements in its canonical design and the bounded implementation plan in a selected proposal. Existing authorization still governs work; self-development does not create a separate standing permission gate.

## History and recovery API

The authenticated versioned OpenAPI document includes `/history`, `/sessions/{id}/metadata`, `/sessions/{id}/recovery`, and `/sessions/{id}/recovery/continue`. All mutations use the existing owner browser cookie, exact Origin, CSRF header, and timestamped Idempotency-Key. These administrative recovery routes have no implicit programmatic-token permission.

History pagination uses a filter-bound cursor and a maximum page size of 50. Metadata edits require `expectedRevision`; changing archive visibility never cancels execution. Recovery requests capture `expectedGeneration`; a failed attempt is explicitly retried with its existing `recoveryId` and `expectedAttempt`. The old key always reconciles its original accepted attempt. A ready fence can be consumed once by a separately acknowledged new turn. The original operation remains uncertain, with an acknowledgement reference; it is not reclassified as successful or automatically replayed.

Migration 007 adds history metadata, replay watermarks, recovery attempts and bounded control reservations. New conversations have a 500-record ceiling with ordinary turn admission stopped at 400 retained records. Existing histories receive a one-time ceiling sufficient to preserve all records and reserve missing cancellation/fencing slots. This does not permit further ordinary work above the admission limit. Recovery reports and audit slots have separate fixed bounds. Restore a matching database backup when rolling back across this migration; older binaries do not understand acknowledged uncertainty and must not be pointed at the upgraded database.

`tests/e2e/p007.ts` runs inside the same real-stack harness as the P001 regressions. It exercises UI search/rename/archive, API and supervisor restart, a dropped accepted continuation response, native projection repair/conflict, actual PostgreSQL stop/start, deferred-commit recovery failures, replay age/count and saturated control reservations. `tests/contract/history.test.ts` checks pinned native non-model behavior on a fresh CODEX_HOME and persisted fixture history. A dedicated live native turn remains an explicit unavailable gate; the fixture does not establish Linux isolation or live-account recovery.

## Terminal development

`pnpm test:e2e --terminals` runs the terminal browser/API/database/supervisor lane. Its external Codex fixture wraps a real run-owned shell/PTy, but supplies no Linux confinement evidence. `tests/contract/terminal.test.ts` separately starts the pinned real Codex runtime with an empty private home and no account, and checks PTY readiness, resize, delayed exit and exact terminal seccomp policy. `pnpm test:isolation --terminals` uses the supported [Linux verification environment](linux-verification.md), including the P003 Git helper image, to verify actual terminal mounts, quota/namespace denials, no network, background retirement and crash behavior.

Migration 011 adds terminal metadata, input outcomes and byte output, plus the shared typed workspace writer reservation. Its persistent reservation epoch is independent of the native conversation generation. Older binaries do not understand terminal ownership; do not run them on this upgraded database. Backups cannot resume a native PTY, and complete protected drain/restore acceptance remains an obligation in the [deployment design](../../design/systems/004-deployment-and-profiles.md#evidence-and-open-obligations).

The API exposes explicit terminal routes and a restricted WebSocket protocol; input is sequenced by terminal generation and controller epoch rather than an ordinary command idempotency key. Creation/control/termination retain timestamped Idempotency-Key handling. The trusted factory selects the fixed external-sandbox policy only after confined Linux runner admission. No API request can choose a sandbox, argv, environment or host path. The authenticated application document supplies a style-only nonce to the pinned xterm build adapter; script policy stays self-only.

## Scheduled work development

Scheduling source is integrated. The [schedule API and verification guide](schedules.md) describes its UI/API and specialist test entry points; the [development report](../reports/2026-09-08-p008-development.md) records module integration and remaining live/protected-restore gates.

## Preview development

The [preview report](../reports/2026-09-08-p011-development.md) records main integration after two independent review rounds and cumulative local/Linux verification at its identified sources. Use the [preview guide](previews.md) for fixed configuration, browser/API acceptance commands and the remaining protected restore and upstream gates. The [user guide](../user/previews.md) explains profiles, private access, logs and confirmed retirement.

## Personal VPS profile

The [deployment and profiles design](../../design/systems/004-deployment-and-profiles.md) defines the separate subscription/existing-folder profile recorded historically in [P015](../../design/proposals/archive/015-personal-vps-workspace.md). See the [personal VPS guide](personal-vps.md) for implemented tooling and explicit acceptance limits. This does not establish managed installation or its protected restore gates.

On a fresh Linux verification host, the critical suite's workspace inspection requires the pinned Git helper image even when Codex is a fixture: build it with `docker build -f infra/git/Dockerfile -t codex-harbor-git:2.39.5-p003 .` before the suite. Its absence can surface as `WORKSPACE_UNAVAILABLE` during later turn admission. P015's candidate report records this observed prerequisite and successful rerun.
