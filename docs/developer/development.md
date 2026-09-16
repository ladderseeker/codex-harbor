# Developer workflow

P001's foundation is implemented and has completed four independent review rounds. The TypeScript workspace, owner-authenticated application, persistent supervisor, deterministic browser/API harness, and supported Linux isolation lane passed their recorded checks. The [foundation report](../reports/2026-09-07-p001-foundation.md) distinguishes that evidence from the [live-account gate](../../issues/2026-09-07-171225-live-runtime-credentials.md) and medium follow-ups that keep P001 unverified.

The [architecture](../../design/architecture.md) defines the target system. The [proposal index](../../design/proposals/README.md) defines independently verifiable feature outcomes and their dependencies. The [issue index](../../issues/README.md) exposes active findings and pending work transferred to proposals. Both indexes link their archives. [AGENTS.md](../../AGENTS.md#document-ownership-and-lifecycle) contains the canonical lifecycle and working rules.

Current work follows [D009](../../design/decisions/009-common-use-release.md): finish the common-use candidate, then implement and verify one needed feature at a time. P010/P012 are deferred with their work preserved. Existing fixture, non-model, Linux and installed results retain their own scopes; required live and recovery gates still prevent finished-delivery claims.

P002 adds scoped credentials for external clients; use the [programmatic API guide](programmatic-api.md). Its [implementation report](../reports/2026-09-07-p002-api-tokens.md) records the original two review rounds, a focused third authority-correction round, and Node 24 validation including the now-resolved P003/P007 authority integration and the still-open live-account gate.

P003 adds managed parallel workspaces; see the [workspace guide](workspaces.md) and [implementation evidence](../reports/2026-09-07-p003-workspaces.md). Its combined P001/P002/P003 application and actual Linux checks passed on Node 24; the real-account parallel-turn gate remains open.

P004 provides a reviewed file editor and Git actions integrated with terminal and deployment behavior. The [file guide](files.md) explains the available flows and Linux write prerequisite; the [feature report](../reports/2026-09-08-p004-files.md) records its two review rounds and matching critical/Linux acceptance. Subsequent installed integration is recorded below.

P006 adds persistent terminals with bounded output, explicit control ownership and retirement. The [terminal guide](../user/terminals.md) describes current behavior. The [combined file/terminal report](../reports/2026-09-08-p004-p006-integration.md) records the reviewed shared Git fence and passing cumulative application suites. The [installed module report](../reports/2026-09-08-installed-module-integration.md) records the added registry, maintenance and restored-authority implementation, passing installed ordinary/fault acceptance and the remaining protected restore/live/release gates.

P005 adds bounded image/text attachments and saved drafts. See [attachment verification](attachments.md) for API/storage boundaries, real Linux publication checks, and the separate live-account command. Three feature review rounds and a separate cumulative integration review passed. The [integration report](../reports/2026-09-07-p005-integration.md) records Node 24 application/workspace acceptance and the unchanged Linux boundary; the mandatory real-account gate remains open.

P007 adds bounded history search, visibility-only conversation archival and explicit uncertainty fencing/continuation. Its [integration report](../reports/2026-09-07-p007-history-integration.md) records two feature reviews, separate integration review, Node 24 combined acceptance, and the unchanged Linux boundary. Review, authority-expiry and replay/control-bound findings are resolved; dedicated live-account evidence remains open.

P008 adds recurring and one-time schedules, offline execution, scoped grants and bounded occurrence history. The [schedule guide](schedules.md) documents the API and maintained test lanes. Its [development report](../reports/2026-09-08-p008-development.md) records two feature reviews, module integration and qualified browser/API/Linux evidence. Targeted real-stack DST coverage and its bounded review passed; dedicated live-account and protected full restore gates remain unverified.

P009 deployment work is In progress. Its [development command guide](deployment.md) documents the implemented administrator interface, tested subset and explicit transfer/live blockers; it is not a production-readiness claim.

## Run the deterministic application locally

For the newly selected real local account experience, see the [personal local guide](local-personal.md). P013 is implemented and reviewed with an open critical regression gate; the fixture profile below remains separate and must not use real credentials.

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

Keep worktrees and verification assets that must survive an interruption in persistent ignored storage, such as this repository's `.test-runs/worktrees/` directory. Operating-system temporary storage is for recreatable scratch files. Record the owner and recovery plan for uncommitted edits and live test resources; preserve coherent checkpoints under existing commit authorization. The [interruption recovery report](../reports/2026-09-13-interrupted-work-recovery.md) records the current restored branches and access limitation.

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

`pnpm test:live --history` adds P007's pinned native history/restart/resume check. Configure an explicit supported `HARBOR_TEST_CODEX_MODEL` alongside the dedicated test key on the trusted Linux/XFS fixture. The lane attempts at most two short read-only turns, confirms the exact first runtime is retired, resumes its persisted thread in a new generation and submits only new input. It records source identity and owned cleanup separately from the real Harbor application E2E. The [driver report](../reports/2026-09-13-p007-live-history-driver.md) records two review rounds, passing no-model checks and the still-unexecuted authenticated gate. Missing prerequisites return exit 2, not a pass.

Configured `pnpm dev` starts the API and supervisor against explicitly configured dependencies. It requires `DATABASE_URL`, canonical HTTPS `HARBOR_ORIGIN`, the allowlisted OIDC issuer/client/subject, registered project roots, and the protected launcher/storage/credential services. It fails on missing prerequisites. Use the disposable fixture command above while the complete production setup instructions are being verified.

## End-to-end verification

`pnpm test:e2e --design` exercises the P014 frontend through a fresh real Harbor stack: local-root browsing and denial cases, project registration, real fixture replies, persisted active/inactive rename and drafts, project-targeted creation, sidebar resizing, and desktop/mobile navigation. It retains screenshots and structural failure diagnostics under the owned `.test-runs/harbor-e2e-*` directory. The lane uses bounded pauses between burst-heavy browser/API phases to respect the ordinary request limit; it does not change server rate limits. P016 extends this lane with conversation menus/status, current-project search and archive/restore, source clipboard and temporary reactions, model-specific five-effort selection and rejection, and mobile dialog focus restoration. Run `pnpm build` first and freeze source edits during acceptance. The [redesign delivery report](../reports/2026-09-13-frontend-redesign.md) records the current result and supporting lanes.

End-to-end tests should start from the feature's public entry point and assert its persisted and observable outcome. Browser features use a real browser and Harbor's real API, database, and supervisor. API-only features use an authenticated API client and the same real services. Codex and identity-provider fixtures are permitted at those external boundaries to make ordinary tests repeatable; replacing Harbor's own services does not qualify as end-to-end coverage.

Test the feature's relevant negative and lifecycle cases as well as its successful path. For example, persistent conversation work must distinguish a closed browser from an interrupted runtime; authentication must cover API and streaming entry points, not only the login screen. Exact scenarios belong in the owning proposals rather than in a duplicate checklist here.

Use focused end-to-end coverage plus the critical regression suite for behavioral changes. Add lower-level tests when they cover meaningful risks, not implementation details. Adapter changes also need real pinned-runtime contracts and a live smoke check. Execution-boundary changes also need the real Linux isolation lane. Record unavailable required lanes as unverified and link an issue; do not advance the affected proposal to `Verified`.

Each test run owns isolated databases, project fixtures, temporary directories, listener ports, credentials, and `CODEX_HOME`. Never reuse the developer's ordinary Codex login/state, personal projects, or production database. Acquire real-runtime test credentials through the documented dedicated test configuration without copying them into logs or fixtures. Bound model usage and redact sensitive output from artifacts.

Assign each run a unique identity and clean up only its own processes, containers, volumes, and temporary files. Do not use broad `pkill`, shared-volume destruction, or unscoped container shutdown as test cleanup. A failed test must leave the stable service and other development sessions intact.

## Local and VPS implementation references

Development starts locally on macOS/Linux and later uses the same entry points on compatible Linux VPS hosts. The [local environment design](../../design/architecture.md#local-first-development-and-portable-environments) owns the planned topology and Linux VM requirements. [P010](../../design/proposals/010-self-development.md) owns developing Harbor through its stable instance; [P009](../../design/proposals/009-portable-deployment-and-restore.md) owns deployment, restore, and external recovery.

Deployment tooling has partial installed-profile evidence and a [current command guide](deployment.md); complete checkpoint/restore and release readiness remain unverified. The self-development broker and candidate workflow are deferred. Add tested usage when that outcome is delivered, keeping its evolving specification in the canonical design/proposal. Existing authorization still governs work; self-development does not create a separate standing permission gate.

## History and recovery API

The authenticated versioned OpenAPI document includes `/history`, `/sessions/{id}/metadata`, `/sessions/{id}/recovery`, and `/sessions/{id}/recovery/continue`. All mutations use the existing owner browser cookie, exact Origin, CSRF header, and timestamped Idempotency-Key. These administrative recovery routes have no implicit programmatic-token permission.

History pagination uses a filter-bound cursor and a maximum page size of 50. Metadata edits require `expectedRevision`; changing archive visibility never cancels execution. Recovery requests capture `expectedGeneration`; a failed attempt is explicitly retried with its existing `recoveryId` and `expectedAttempt`. The old key always reconciles its original accepted attempt. A ready fence can be consumed once by a separately acknowledged new turn. The original operation remains uncertain, with an acknowledgement reference; it is not reclassified as successful or automatically replayed.

Migration 007 adds history metadata, replay watermarks, recovery attempts and bounded control reservations. New conversations have a 500-record ceiling with ordinary turn admission stopped at 400 retained records. Existing histories receive a one-time ceiling sufficient to preserve all records and reserve missing cancellation/fencing slots. This does not permit further ordinary work above the admission limit. Recovery reports and audit slots have separate fixed bounds. Restore a matching database backup when rolling back across this migration; older binaries do not understand acknowledged uncertainty and must not be pointed at the upgraded database.

`tests/e2e/p007.ts` runs inside the same real-stack harness as the P001 regressions. It exercises UI search/rename/archive, API and supervisor restart, a dropped accepted continuation response, native projection repair/conflict, actual PostgreSQL stop/start, deferred-commit recovery failures, replay age/count and saturated control reservations. `tests/contract/history.test.ts` checks pinned native non-model behavior on a fresh CODEX_HOME and persisted fixture history. A dedicated live native turn remains an explicit unavailable gate; the fixture does not establish Linux isolation or live-account recovery.

## Terminal development

`pnpm test:e2e --terminals` runs the terminal browser/API/database/supervisor lane. Its external Codex fixture wraps a real run-owned shell/PTy, but supplies no Linux confinement evidence. `tests/contract/terminal.test.ts` separately starts the pinned real Codex runtime with an empty private home and no account, and checks PTY readiness, resize, delayed exit and exact terminal seccomp policy. `pnpm test:isolation --terminals` uses the supported [Linux verification environment](linux-verification.md), including the P003 Git helper image, to verify actual terminal mounts, quota/namespace denials, no network, background retirement and crash behavior.

Migration 011 adds terminal metadata, input outcomes and byte output, plus the shared typed workspace writer reservation. Its persistent reservation epoch is independent of the native conversation generation. Older binaries do not understand terminal ownership; do not run them on this upgraded database. Backups cannot resume a native PTY, and portable drain/restore integration remains a P009 integration gate.

The API exposes explicit terminal routes and a restricted WebSocket protocol; input is sequenced by terminal generation and controller epoch rather than an ordinary command idempotency key. Creation/control/termination retain timestamped Idempotency-Key handling. The trusted factory selects the fixed external-sandbox policy only after confined Linux runner admission. No API request can choose a sandbox, argv, environment or host path. The authenticated application document supplies a style-only nonce to the pinned xterm build adapter; script policy stays self-only.

## Scheduled work development

P008 is implemented. The [schedule API and verification guide](schedules.md) describes its UI/API and specialist test entry points; the [development report](../reports/2026-09-08-p008-development.md) records module integration and remaining live/protected-restore gates.

## Preview development

P011 is implemented on main after two independent review rounds and cumulative local/Linux verification. Use the [preview guide](previews.md) for fixed configuration, browser/API acceptance commands and the remaining protected restore and upstream gates. The [user guide](../user/previews.md) explains profiles, private access, logs and confirmed retirement.

## Personal VPS profile

[P015](../../design/proposals/015-personal-vps-workspace.md) adds a separate subscription/existing-folder profile. See the [personal VPS guide](personal-vps.md) for implemented tooling and explicit acceptance limits. This does not complete P009 managed installation or its restore gates.

On a fresh Linux verification host, the critical suite's workspace inspection requires the pinned Git helper image even when Codex is a fixture: build it with `docker build -f infra/git/Dockerfile -t codex-harbor-git:2.39.5-p003 .` before the suite. Its absence can surface as `WORKSPACE_UNAVAILABLE` during later turn admission. P015's candidate report records this observed prerequisite and successful rerun.
