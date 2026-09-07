# Codex Harbor architecture

Decision: Draft (expanded technical design) · Delivery: Planned · 7 September 2026

The owner has authorized the implementation direction and design/feature planning. The technical choices below are the proposed contract, not evidence that every detail has been individually approved or built. The expanded design has completed two independent review rounds; see the [review record](#review-record). Decision status and delivery status are independent; existing session authorization governs work without a universal feature-signoff gate.

## Recommendation and scope

Build a private, single-owner web application around official Codex app-server, with persistent execution on the VPS and an authenticated, documented API. Reproduce the requested workflows first: projects, concurrent conversations, unattended execution, scheduling, terminal, files, attachments, and runtime settings. Treat the screenshot as a workflow reference; exact desktop parity needs a capability inventory and cannot be promised yet.

Target a compatible Linux VPS, including the owner's current Hostinger VPS, without provider APIs or services. Check CPU, RAM, OS, architecture, kernel, and disk before deployment; product labels do not establish specifications. Use containers and Compose, with systemd for host startup where appropriate. Hosts that prevent required isolation are outside the initial target.

Everything below is a target design, not an implemented security guarantee. Development starts on the current macOS machine through real local services and Linux execution environments, then moves to a compatible Linux VPS. No application, deployment, or executable test commands exist yet.

## Official foundation and compatibility boundary

Official documentation presents app-server as an integration interface with conversation history, streamed events, approvals, model discovery, filesystem operations, and sandboxed PTY command execution. It supports generated TypeScript and JSON schemas tied to the installed version. However, the documentation explicitly calls the app-server command and WebSocket transport experimental and unsupported for production workloads. Local CLI 0.153.4 help also labels app-server experimental. Using stdio avoids a public Codex listener; it does not make the dependency production-supported. Some methods, including `thread/shellCommand` and `process/spawn`, execute outside Codex's sandbox. [Official app-server documentation](https://learn.chatgpt.com/docs/app-server)

Start with a capability spike against a pinned executable and generated schemas. Put protocol handling behind one adapter, test supported behavior, and disable unsupported controls. Upgrade deliberately with compatibility tests and rollback packages. Browser automation, voice, plugins/connectors, pull-request workflows, and desktop integrations each require separate assessment; none should appear functional merely because the desktop offers it.

Publish supported, unsupported, and experimental capabilities with versioned evidence for the features delivered at each gate. P001 establishes the local runtime/Linux baseline; P009 establishes the deployed profile and release/restore gate. Later feature owners extend the relevant capability evidence, and runtime upgrades repeat applicable compatibility/isolation checks while preserving tested rollback packages and compatibility limits.

The SDK documentation recommends app-server for custom clients and the SDK for coding automation; our interactive interface fits the former. Official Remote currently describes mobile access to a connected Mac or Windows PC, not this provider-neutral browser/API deployment. [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [Codex Remote](https://learn.chatgpt.com/docs/remote)

## Stack and component boundaries

Use TypeScript across the application, React with Vite for the UI, and Fastify for the backend. This gives shared contracts and familiar tooling without assuming unverifiable model-training statistics. Fastify documents TypeScript support, validation, encapsulated plugins, testing, and an LTS policy. [Fastify documentation](https://fastify.dev/docs/latest/), [Vite documentation](https://vite.dev/guide/)

Choose PostgreSQL for metadata and pg-boss for durable jobs and scheduling, subject to VPS resource checks. pg-boss supports transactional enqueueing, cron schedules, concurrency policies, and retries, avoiding a separate Redis service. Its queue guarantees do not make arbitrary external tool effects exactly-once. [pg-boss documentation](https://pgboss.io/)

Use xterm.js for terminal rendering and Monaco for code and diff views. Reuse capability-tested, sandboxed `command/exec` operations through the adapter before introducing another process-execution implementation. File operations likewise go through a narrow workspace service. Add mature components where they remove work; keep their authority behind application policy.

```text
Browser / external API client
             │ HTTPS
             ▼
       Caddy → authenticated Fastify API
                    │
          PostgreSQL ← trusted supervisor
                    │ adapter + policy
                    │ private IPC / fixed launcher
                    ▼
          isolated project runner containers
                    │ minimal stdio bridge
              pinned Codex app-server
                    │
          approved folders and worktrees
```

The HTTP service handles identity, validation, assets, and requests. The persistent supervisor owns runtimes, protocol adapter, policy, database access, events, approvals, and schedules outside executors. Runner-side stdio bridges hold no control-plane secrets. Executors contain project tools and Codex; the supervisor never runs repository code. Keep these privilege boundaries inside one repository.

## Local-first development and portable environments

Use one source tree, lockfile, versioned migrations, and configuration schema across local development, isolated tests, candidate instances, and VPS releases. Paths are configuration values resolved through registered roots, not hard-coded macOS paths, home-directory assumptions, or provider-specific locations. Container-internal workspace paths stay stable even when host locations differ. Data directories and credentials are external to source checkouts.

On macOS, run the real React frontend, Fastify API, PostgreSQL, supervisor, and a local identity-provider service. The development entry point may run the UI/API on the host for hot reload while starting dependencies and runners through a supported Linux VM/container engine. Alternatively, it may run all services in that environment. Both profiles use the same application contracts. Docker Desktop is one supported candidate for macOS installation, subject to host requirements; it is not a required VPS dependency. [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/)

Run Linux isolation-sensitive execution inside the Linux environment. A convenient macOS process sandbox is not evidence that Linux deployment isolation passes. Bind development listeners to loopback, use local HTTPS and explicit local OIDC callbacks, and retain normal browser authentication/CSRF behavior. Caddy supports local HTTPS; trusting a development certificate is an explicit environment setup step, not an action taken during this documentation task. A local test identity provider exercises real OIDC with disposable test identities; it is not an authentication bypass. Production startup rejects test-provider trust and protocol-fixture settings. [Caddy HTTPS](https://caddyserver.com/docs/automatic-https)

Give every environment an instance ID that namespaces ports, URLs, database names/roles, networks, volumes, Codex homes, upload roots, and test artifacts. Compose project names help separate resource names; they are not security boundaries. Enforce actual isolation through mounts, credentials, networks, and broker policy. Test startup provisions empty storage and known fixtures. Cleanup is restricted to the exact instance manifest; it cannot remove another instance's resources. A failed startup reports the failed dependency and leaves unrelated services alone. [Compose project names](https://docs.docker.com/compose/how-tos/project-name/)

The same command names are the planned developer and automation contract:

| Planned command | Intended behavior once implemented |
| --- | --- |
| `pnpm dev` | Start or attach to the real local development stack; report URLs and prerequisite failures. |
| `pnpm build` | Build versioned application/runner artifacts without touching a live deployment. |
| `pnpm check` | Validate types, formatting/linting, schemas, generated artifacts, and documentation structure. |
| `pnpm test` | Run unit and service integration tests with isolated storage. |
| `pnpm test:e2e` | Run repeatable browser and API flows through the real local stack. |
| `pnpm test:contract` | Validate the adapter against the pinned Codex binary and generated schemas. |
| `pnpm test:live` | Run a small real-Codex/account smoke suite with explicit credentials and bounded usage. |
| `pnpm test:isolation` | Probe actual Linux mount, process, resource, and network boundaries. |
| `pnpm test:e2e:self` | Exercise Harbor-driven candidate development while the stable instance remains healthy. |

This table is the canonical planned command contract. P001 introduces the ordinary development, E2E, contract, live, and isolation lanes it needs; P010 adds the self-development lane. Commands remain unavailable until their owner implements them, with no successful placeholders. A missing prerequisite must produce an explicit failure or documented unverified result, never a fabricated pass. Operational instructions for commands that actually exist belong in the [developer guide](../docs/developer/development.md).

## Public access and identity

Only the owner can sign in; there is no registration or tenant-management feature. Use OpenID Connect through `openid-client`, preferably an existing identity-provider account protected with MFA or passkeys. Pin the allowed issuer and subject, not an email suffix. Use authorization code flow with PKCE, state, nonce, fixed callback URLs, and provider verification. A self-hosted provider can replace the default if preferred, with its additional maintenance cost. [openid-client first-party documentation](https://github.com/panva/openid-client)

After login, issue an opaque database-backed browser session. Use a `__Host-` cookie with `HttpOnly`, `Secure`, `Path=/`, no Domain attribute, and explicit SameSite behavior compatible with the tested login flow. Rotate sessions after authentication, enforce idle and absolute expiry, and provide revocation. Protect cookie-authenticated mutations with CSRF tokens and exact Origin validation. Disable sensitive response caching and avoid browser storage for credentials. [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

Caddy terminates HTTPS and routes protected pages and assets to the backend authentication gate. Only the login flow and callback are public application routes. The same gate protects every API, SSE stream, terminal WebSocket, upload, and download. No static-file shortcut may bypass it. Trust forwarded headers only from the configured proxy; keep internal listeners and health endpoints private. [Caddy reverse-proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

External clients use separate high-entropy personal access tokens: hashed at rest, expiring, revocable, and scoped by operation and project. Send them in `Authorization`, never query strings. The web login, facade API credentials, and Codex account credentials are distinct. Expose a stable `/api/v1` contract and OpenAPI schema; never publish a raw unrestricted Codex protocol proxy.

For server-to-OpenAI authentication, support a server-held API key or the documented headless device-code login, which is beta and account-dependent. Offer onboarding only after Harbor owner authentication; never expose the raw Codex callback publicly. Keep credential entry out of ordinary prompts, logs, and browser storage. [Official authentication guidance](https://learn.chatgpt.com/docs/auth)

Use HTTP commands and SSE with replay cursors for conversations, plus WebSockets for terminal interaction. Authorize subscriptions and each terminal action, validate exact browser Origins, limit messages, and disconnect streams on expiry or revocation. Non-browser clients authenticate explicitly; a missing Origin never substitutes for authentication. Logout revokes access but does not cancel already authorized work. A separate emergency-stop operation stops runs and pauses schedules. [OWASP WebSocket guidance](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)

## Execution and filesystem isolation

Run each project in an isolated nonroot container with fixed, administrator-approved mounts, a read-only base filesystem, bounded writable volumes, dropped capabilities, resource limits, and restricted networking. Prefer rootless container operation where the host supports the required user namespaces and tooling. Verify the actual kernel, cgroup, filesystem, and Codex sandbox combination; do not solve failed isolation checks by silently enabling privileged execution. Rootless mode reduces daemon privilege but is not a complete isolation proof. [Docker rootless documentation](https://docs.docker.com/engine/security/rootless/)

Executor containers receive no privileged mode, host networking, Docker socket, host sudo, or control-plane filesystem mounts. Firewall and egress policy block metadata endpoints, database/control services, private infrastructure, and disallowed destinations while permitting required model and approved development traffic. Test IPv4, IPv6, DNS changes, and redirects. Expose project previews through a dedicated authenticated proxy, never arbitrary host-port publication.

The trusted launcher accepts project IDs and fixed runner templates over private IPC. Browser parameters cannot supply container flags, arbitrary mounts, or launcher commands. Secrets for the stable installation, trusted broker administration, or other instances never enter project or candidate execution environments. A disposable test/candidate environment may receive its own database/OIDC credentials and narrowly scoped candidate-launcher credentials, limited to that candidate's resources; these grant no stable-installation or broker-administrator authority. Deployed Harbor binaries/configuration remain immutable outside allowed project roots, even when editing Harbor source. Protect Codex credential state without claiming every runner process cannot obtain credentials its runtime uses. Runner compromise must not grant host administration or another project's mounts.

Permission controls select named policies below an administrator ceiling stored outside writable projects. Revalidate effective permissions when execution starts and when an approval is answered. Broad execution, if enabled, means broad access inside a disposable container, never a host-access mode. An authenticated terminal deliberately allows arbitrary code within that runner. Treat repository dependencies, setup scripts, skills, and MCP servers as executable code when deciding their mounts, credentials, and network access.

The API accepts opaque project/file IDs and project-relative paths. The workspace service rejects traversal and escape, checks resolved paths, and uses race-resistant, directory-relative file operations rather than a check-then-open pattern alone. Symlink replacement tests and container mount boundaries provide complementary protection. File mutation uses revision checks to avoid overwriting a newer editor or agent change.

Uploads receive opaque IDs, validated types, bounded size/count, and private storage outside served roots. Do not trust a supplied filename or MIME header. Do not extract archives automatically. Images can be pasted or dropped, then attached after validation; other files become controlled workspace attachments. Never render uploaded HTML/SVG as application-origin content. Active previews use a separate origin with scoped access and no main-session cookie. [OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

Treat model output, chat Markdown, filenames, diffs, and terminal links as untrusted content. Disable raw chat HTML, escape for each output context, and use a maintained allowlist sanitizer where HTML is necessary. Allow safe link schemes only; never fetch external images automatically. Apply restrictive CSP and anti-framing headers. Terminal link and clipboard integrations require deliberate user actions. [OWASP XSS guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html), [xterm.js security](https://xtermjs.org/docs/guides/security/)

## Projects, concurrency, and persistent work

“Add project” registers an existing allowed development/VPS folder or creates one beneath an approved root. The UI shows project → conversations and a clear workspace indicator. Keep multiple sessions active with configurable concurrency and per-session stop controls.

Offer Local and Worktree modes. Prefer worktrees for concurrent Git work and explicit copies for non-Git folders. Worktrees share repository metadata and are not a security boundary. Show starting revisions and handle uncommitted files deliberately; review before applying changes elsewhere. [Official worktree explanation](https://learn.chatgpt.com/docs/environments/git-worktrees)

Workspace admission coordinates managed runs, editor writes, and Git operations. Terminals retain writer reservations while shells or background jobs remain active; conflicting managed operations queue. This is cooperative coordination: arbitrary processes and external SSH can bypass it. Show Local conflicts and warn before simultaneous editing; never promise unconditional overwrite prevention.

The supervisor, not the browser, owns running work and subscriptions. Closing every page, changing networks, or restarting the HTTP service must leave execution intact. A turn may still complete, fail, hit a usage limit, or wait for approval. Waiting is visible and never interpreted as permission to continue.

Persist ordered events and bounded terminal output. Reconnect from snapshots and cursors, detecting gaps and duplicates. Slow viewers cannot block execution; browser drafts contain no credentials.

Before acknowledging acceptance, persist an idempotency key, request hash, and durable dispatch intent. Identical retries return the existing operation; changed payloads using that key are rejected. Dispatch one active turn per thread, with later input explicitly queued or steered. Runtime-epoch fences reject stale dispatches and approvals. Reconcile ambiguous delivery before retrying; database transactions cannot make external effects atomic.

A runtime crash or VPS reboot cannot preserve a live process. Restore saved history, classify active work as interrupted or uncertain, and reconcile before continuing. Never blindly resend a prompt whose commands may already have produced side effects. Native Codex history remains authoritative for conversation content; application metadata and replay projections are stored separately, without editing Codex's internal database schema.

Pending approvals carry runtime epoch, request ID, session/turn identity, requested scope, and state. Only the first valid response succeeds across tabs. Requests from a dead runtime expire. Offline approvals wait with an explicit deadline policy; deadline expiry may deny or stop work, never silently approve it. Interrupting a turn does not undo completed side effects; show remaining background processes and provide separate termination controls.

## Scheduling and storage

Implement a VPS scheduler independently of desktop scheduling. Official desktop scheduling needs the machine and app running for local projects; that feature is not evidence of an app-server scheduling endpoint. [Official scheduled-task documentation](https://learn.chatgpt.com/docs/automations)

Save a prompt, project/workspace, model, permission profile, timezone, schedule, next-run preview, overlap policy, and missed-run policy. Start with one-time and cron-style schedules. Display DST behavior explicitly and test clock changes. Default standalone tasks to a new conversation and worktree; returning to an existing conversation is an explicit option. Default to skipping overlaps and recording missed occurrences, with bounded catch-up available.

Use durable occurrence records with unique IDs and transactional job creation. Retry safe dispatch steps, but mark ambiguous Codex delivery for reconciliation instead of repeating external effects. Recheck current policy before every run. Unattended tasks use narrow predefined permissions and the same approval mechanism as interactive work. Include pause, run-now, cancel, history, and an attention inbox.

Store projects, workspaces, session/Codex identifiers, operations, events, approvals, attachments, schedules, credentials, and audits. Bound retention and storage growth. Back up the database, native runtime state, repositories, and attachments consistently. P008 can be verified locally against its delivered dependencies; relying on schedules in a deployed installation also requires P009's encrypted off-server backup and restore gate.

## Domain model and authority

Use opaque application IDs. Browser-provided IDs select records, never filesystem paths or launcher parameters. Keep native Codex identifiers as adapter fields, rather than deriving them from the application's session ID; store additional native identifiers only when the pinned protocol actually supplies them.

| Record | Required state and owner |
| --- | --- |
| Owner identity / browser session / API token | API owns pinned issuer/subject, session/token hashes, expiry, revocation, and scoped grants. |
| Project | Workspace service owns approved root mapping, display metadata, policy ceiling reference, and archived state. |
| Workspace | Workspace service owns project ID, Local/worktree/copy mode, base revision, private path mapping, writer reservations, and retention state. |
| Conversation | Supervisor owns project/workspace association, Codex identifiers, runtime affinity, title, and history projection. |
| Runtime | Supervisor owns project runner identity, generation/epoch, health, supported capabilities, and native state location. |
| Operation / turn | Supervisor owns durable intent, request hash, idempotency key, policy snapshot, dispatch generation, execution state, and result references. |
| Approval / input request | Supervisor owns runtime/request identity, requested grant, pending/resolved/expired state, answer provenance, and deadline. |
| Event / snapshot | Supervisor owns per-conversation sequence, event schema version, payload, projection revision, and retention watermark. |
| Terminal | Supervisor owns runner/process mapping, workspace reservation, output sequence/buffer, subscribers, and exit state. |
| Attachment | Workspace service owns opaque blob ID, validated media type, size/digest, project authorization, and attachment references. |
| Schedule / occurrence | Scheduler owns expression/timezone, next due time, permission reference, policy version, unique occurrence identity, and linked operation. |
| Candidate / release / audit | Trusted build/release service owns isolated manifests, artifact digests, verification evidence, promotion state, and append-only security records. |

Database foreign keys bind conversations and artifacts to their workspace/project. Unique constraints enforce request identity and schedule occurrences. Writers use optimistic revisions for mutable metadata and transactional admission for active turns and managed workspace reservations. The queue is a delivery mechanism; operation records are the application truth for acceptance and reconciliation. A job is not complete merely because a request reached Codex.

Keep actor authorization, administrator ceilings, and runtime generation in the dispatch record. The dispatcher rechecks current revocation and policy before a queued operation starts. Already running work retains its explicit execution grant until completion/cancellation or an enforced policy emergency; expiring a browser session only removes interactive access. API and UI use the same authorization decision function. Direct database access, queue administration, and launcher authority are never public API capabilities.

On database unavailability, fail closed for new mutations and approval answers. Existing runtimes may finish already authorized work and write native history. Buffer events only within a configured bound; record recovery gaps and reconcile snapshots when storage returns. Do not claim a complete durable UI event trail across an outage merely because the native conversation survived. If continued execution threatens storage or isolation, the configured emergency policy may stop the runtime and mark affected operations interrupted.

## API, events, and state transitions

Publish versioned JSON schemas and an OpenAPI contract independent of upstream Codex wire types. Every error includes an application code, operation/request correlation ID, and retry guidance without leaking credentials or host paths. Use `401` for missing/expired authentication, `403` for denied authority, `409` for revision/idempotency/state conflicts, `413` for oversized inputs, and `429` for quotas. Validate request and response limits before forwarding work.

| Proposed surface | Contract |
| --- | --- |
| `/api/v1/projects` and `/projects/{id}/workspaces` | List/register approved projects and create workspace choices; return opaque IDs. |
| `/api/v1/sessions` and `/sessions/{id}` | Create/list/read conversations with project/workspace and capability summaries. |
| `/sessions/{id}/turns`, `/turns/{id}/steer`, `/turns/{id}/cancel` | Accept explicit new input, steering, or cancellation with durable operation IDs. |
| `/api/v1/operations/{id}` | Read queued, dispatching, running, waiting, final, or uncertain operation state. |
| `/sessions/{id}/snapshot` and `/sessions/{id}/events` | Fetch materialized state and authenticated SSE updates from a cursor. |
| `/api/v1/approvals/{id}/answer` | Compare current state, authorize requested subset, and return a durable answer operation. |
| `/api/v1/workspaces/{id}/files` and `/api/v1/attachments` | List/read/revision-write files and upload/download authorized blobs. |
| `/api/v1/terminals` and `/terminals/{id}/stream` | Create bounded terminal sessions; authenticated WS carries input, resize, output, and exit messages. |
| `/api/v1/schedules`, `/schedules/{id}/runs` | Create/pause schedules, inspect occurrences, and request run-now with an idempotency key. |
| `/api/v1/capabilities` and `/api/v1/security/*` | Discover effective settings, manage owner credentials, and emergency-stop authorized work. |

All abbreviated routes in this table, including `/projects`, `/sessions`, `/turns`, `/terminals`, and `/schedules`, are relative to `/api/v1`; no alternate unprotected endpoints exist. Authenticated domain mutation commands carry a client-generated idempotency key and, where applicable, an expected revision. OIDC login/callbacks use their own state/nonce/replay controls rather than this domain-command contract. Scope keys by actor and operation route. Persist the normalized request hash and dispatch intent transactionally before accepting asynchronous work with `202 Accepted` and an operation URL. A synchronous mutation can return its committed result with the documented successful status. Identical retries return the existing operation/result; differing payloads fail. Retain active keys and tombstones for the documented retry window; requests outside that window require an explicit new intent rather than treating an expired retry as new work.

Make that expiration enforceable: execution-command keys include an immutable creation-time component, with bounded clock skew and a documented acceptance window. Look up retained active/completed keys first; when no record remains, reject an old timestamp instead of dispatching it again. Retain active keys throughout their operations and completion tombstones for at least the supported retry window. Changing creation time changes the key and expresses new intent. Document this client contract and test retries after garbage collection.

An operation progresses through `accepted → queued → dispatching → running`, may enter `waiting_input` or `waiting_approval`, and ends as `succeeded`, `failed`, or `interrupted`. `uncertain` is a reconciliation state when dispatch or completion cannot be established. An approval answer is `pending → answering → resolved`, or `expired`; a transport failure during `answering` requires reconciliation. A successful cancellation request means stop was requested, not that the turn has already stopped. Confirm the final runtime state and show surviving background processes separately.

Only one dispatcher holds a generation-fenced lease for a conversation. Queued work cannot overlap its active turn; steering identifies the exact active turn instead of accidentally starting another. A generation change invalidates stale requests, approvals, and terminal process identifiers. Lease loss must prevent further sends from the previous dispatcher, including at the private runner bridge; a database lease alone is insufficient. Do not introduce multiple active supervisors until that fencing is tested.

Persist state changes and corresponding event envelopes transactionally before broadcasting. Events contain schema version, conversation ID, monotonically increasing sequence, type, timestamp, and operation/turn/item references. Reconnect supplies a cursor; return a snapshot with its sequence and events after that sequence. If the cursor precedes retention or the event stream has a known gap, require snapshot resynchronization. Deduplicate by sequence and treat database notifications as wakeups, not durable messages. Terminal binary/base64 chunks have a separate bounded sequence and cannot be inserted as raw chat HTML.

Runtime restarts do not make request IDs replay-safe. Reconcile native history, recorded responses, and current state; if delivery remains ambiguous, show that uncertainty for owner resolution instead of inferring that no action happened. Scheduled and interactive operations use this same machinery. Never promise exactly-once external side effects.

## Repeatable verification through the application

Every implemented feature must be exercisable through its real user-facing route: browser UI where it has UI, plus the public API where it has API. E2E runs start the actual frontend, proxy/auth gate, backend, PostgreSQL, supervisor, and workspace services in a fresh instance. They must not replace internal HTTP handlers, authorization, persistence, or supervisor transitions with test doubles. Playwright can manage application servers and exercise HTTP APIs alongside browser tests. Our harness owns startup/readiness/cleanup and refuses to reuse unknown existing servers. [Playwright web-server setup](https://playwright.dev/docs/test-webserver), [Playwright API testing](https://playwright.dev/docs/api-testing)

For deterministic `test:e2e`, place a scripted Codex protocol fixture only at the external Codex boundary, using the same transport adapter as the real binary. It emits pinned, schema-validated scenarios for streaming, approvals, errors, delays, crashes, reconnect, and terminal events. A local test identity provider supplies a real isolated OIDC flow. Fixture mode is a private test profile refused by production configurations. Keep test processes on host loopback/private networks; remote inspection uses an authenticated proxy or SSH tunnel, never direct public fixture listeners. These tests verify Harbor integration; they do not prove model behavior or Linux sandbox enforcement.

Use fresh browser contexts for cookies/storage and separate namespaces for backend state; browser isolation alone cannot isolate databases or runners. Tests that deliberately use two tabs share only their intended session. [Playwright browser contexts](https://playwright.dev/docs/browser-contexts)

Separately, `test:contract` runs against the real pinned Codex executable and validates schema generation, initialization, capability negotiation, and supported non-model operations. Account-dependent requests are identified as requiring `test:live`. The bounded live smoke suite uses a dedicated test workspace/account configuration, real authentication, and small real turns, recording runtime/version and usage. It never retries uncertain side effects automatically. `test:isolation` uses actual Linux runners and benign negative probes against mounts, namespaces, privilege, resource limits, and egress, including access to another test project's data. A mocked command result is not an isolation test.

Capture the source revision, dependency/runtime versions, instance manifest, test seed, exit status, and relevant screenshots/traces/logs with secret redaction. Reports distinguish passed, failed, skipped, and unimplemented checks. Cleanup affects only the test namespace. Docs-only changes receive link, structure, consistency, and review checks; do not claim an E2E run for a repository with no executable application.

Acceptance coverage includes successful UI and API outcomes, unauthenticated/insufficient-scope denial, replay/retry behavior, restart recovery, quotas, and hostile-content rendering. Add tests because they protect observable behavior, not to mirror implementation internals. A feature may depend on previously accepted capabilities, but no future feature may be required to exercise and verify it in a fresh isolated environment. Seed earlier dependencies through their real setup/API contract or documented database fixtures, without bypassing the behavior under test.

## Developing Harbor through Harbor

The stable instance remains the control session while an agent edits a separate Harbor worktree. It must never edit deployed application files, live configuration, migrations in flight, or production secrets directly. Build a candidate from a recorded source revision into immutable artifacts. The candidate receives its own URL/port namespace, PostgreSQL database and role, networks, Codex home, credentials, volumes, fixture state, and quotas. The stable session has no dependency on the candidate staying healthy.

Run the same planned `pnpm dev`, `build`, `check`, and test commands whether a human shell or Harbor initiates the work. Implement a trusted, narrowly scoped build/test broker outside the project runner. It accepts a registered candidate/worktree ID and a fixed command profile, creates resources from administrator-owned templates, and returns bounded logs and artifact references. The executing repository script receives only candidate-scoped resources. It never receives the host Docker socket, daemon credentials, arbitrary container flags, or unrestricted launcher access.

The broker can launch sibling candidate containers in the local Linux VM or VPS environment; it does not need privileged Docker-in-Docker inside the coding runner. A candidate supervisor receives only authority over that candidate's disposable runner namespace, not the stable launcher namespace. Repository-defined scripts and Dockerfiles are untrusted build inputs: execute them inside restricted build workers and do not let them redefine trusted mounts or profiles. Keep broker policy immutable outside the worktree. Artifact retrieval uses IDs and digests, not arbitrary host read paths.

Reserve CPU, memory, disk, PID, and connection capacity for the stable instance before admitting a candidate. Limit candidate count and maximum lifetime. A failed build, runaway test, exhausted candidate quota, or candidate migration must leave the stable browser/API session and its active turn usable. An out-of-band administrative recovery path can stop candidates without relying on the candidate UI. If the host cannot reserve sufficient capacity, refuse candidate startup with a clear resource result rather than gambling on the running session.

`pnpm test:e2e:self` should prove this sequence: enter a development request through the stable frontend; perform a controlled change in the candidate worktree; request a brokered build and tests; inspect the candidate through its own browser/API; deliberately fail and stop that candidate; verify the stable session still streams and accepts input; then prepare a successful candidate artifact. In deterministic runs, the external protocol fixture scripts the coding actions while all Harbor layers, files, and candidate services are real. Real-account smoke coverage remains separate.

Promotion is a distinct trusted operation referencing an immutable artifact digest and verification report. The user's existing authorization governs whether it can proceed; do not impose a standing manual deployment-approval rule. If current authorization does not cover promotion, first complete the candidate and tests, then request approval for that concrete artifact. Never substitute a generic early permission question for preparing a reviewable change.

## Release, retention, and rollback rules

Use additive, backward-compatible database migrations before swapping traffic. Back up and validate restore prerequisites before migrations that could lose data. A single migration owner acquires a deployment lock; candidates never migrate the stable database. Record application, schema, runner, Codex, and native-history format versions together in the release manifest. Compatibility across all of them is a release gate.

Before replacing a supervisor or runner, stop admitting new work to the old generation and drain its active turns and terminals. Keep the existing generation alive until drained, or defer promotion. Forced termination is an explicit operation with visible interrupted work. A compatible HTTP-only release can change the proxy's active upstream atomically while the existing supervisor continues; it must still preserve browser/API contracts and stream reconnection. Do not suggest proxy switching makes database or external side effects transactional.

Keep the old immutable release and compatible state for recovery. Rollback can switch application traffic back only while the database and native runtime state remain readable by that release. Destructive migrations, native-history changes, or external side effects may require forward repair or a deliberate restore that loses writes after the backup; restoring is not an automatic rollback step. Never run an old and new unfenced supervisor concurrently against the same runtime state. Verify health, authentication, one normal operation, and reconnect before declaring promotion complete.

Define retention by data class: active conversations/approvals/operations cannot expire; completed event replay and terminal buffers may have shorter windows than durable history; referenced attachments persist with their conversations; unreferenced staged uploads and failed candidates expire. Worktrees with uncommitted changes cannot be silently deleted by age. Garbage collection first marks eligible objects, rechecks references and leases, then deletes only approved namespace paths. Show storage use, configured limits, and retention consequences to the owner.

Quota admission checks precede upload, worktree creation, terminal creation, and turn dispatch. Keep headroom for database writes, audit events, cancellation, and recovery. Budget accounting can be delayed or provider-dependent, so advertise enforcement bounds and overshoot risk rather than an exact universal spend cap. Rate-limit retries and reconnects. At disk thresholds, refuse new work and preserve administrative stop/export functions as far as remaining storage permits.

## Operations and repository layout

Expose only HTTPS and controlled administration. Limit requests, runs, connections, uploads/output, CPU/memory/PIDs, disk, and usage budgets. Audit policy, approvals, credentials, and execution with secret redaction; avoid duplicating prompts/files in operational logs. Patch dependencies/OS, monitor attacks and exhaustion, and test rollback. Optional provider-neutral upstream DDoS filtering addresses volumetric traffic beyond VPS capacity; application limits cannot protect a saturated network link.

```text
apps/web/                 React interface
apps/api/                 auth, HTTP, SSE, terminal gateway
apps/supervisor/          durable runtime and scheduling
packages/contracts/      public API and event schemas
packages/codex-adapter/   generated protocol, compatibility layer
packages/policy/          shared authorization decisions
packages/workspaces/      files, attachments, Git worktrees
packages/storage/         database migrations and repositories
infra/                    Compose, Caddy, runner templates, bootstrap
tests/                    integration, security, recovery, browser
design/                   architecture, decisions, active and archived proposals
docs/                     user/developer guides and verification reports
issues/                   active findings, transfer tracking, and archived history
```

## Delivery through complete feature outcomes

Use the [proposal index](proposals/README.md) and [proposal template](proposal-template.md) to define implementable feature outcomes. Split by a complete capability the owner can exercise, not by frontend/backend ownership, file count, or arbitrary size. Each proposal names earlier prerequisites, real setup and verification routes, failure behavior, test evidence, and a completion gate. Earlier capability dependencies are allowed; requiring a future proposal to demonstrate today's feature is not.

The [repository lifecycle rules](../AGENTS.md#document-ownership-and-lifecycle) own work discovery, status, closing notes, archiving, transfer, reopening, and design maintenance. The proposal index links its archive; the [issue index](../issues/README.md) links active and transferred work plus issue history.

All feature proposals currently have `Decision: Draft` and `Delivery: Planned`. The proposal registry owns the dependency graph and implementation order. P001 includes its capability spike, secure conversation, and executable local/E2E foundation as one complete outcome; each later feature owns the additional tests and security controls needed for that outcome. Security and recovery baselines are not postponed until a final hardening phase.

The registry includes an early path to P010 self-development without waiting for optional file-editor, terminal, scheduling, preview, or extension interfaces. Feature verification after declared dependencies is distinct from the deployment-readiness gate. P009 verifies deployment for the modules delivered at that point; subsequent modules extend its backup, migration, and release regression coverage as part of their own acceptance.

Use implementation → independent review → fixes → verification for each delivery slice. Aim for two to three review rounds, stopping earlier when no actionable findings remain. Record unresolved issues with severity, reproduction evidence, impact, and next steps. No critical blocker may be described as completed work.

Remaining validation risk: [Codex runtime compatibility and Linux capability gate](../issues/archive/2026-09-07-073831-codex-runtime-compatibility.md), archived as Transferred with evidence pending in P001 and P009. This unresolved implementation uncertainty does not prevent completion of the planning work; transfer does not satisfy either gate or establish deployment readiness.

## Review record

The earlier architecture review verified hostile-content rendering, cooperative writer admission, durable dispatch idempotency, and trusted control-plane separation. The expanded design subsequently completed two independent review rounds. Round 2 verified candidate credential scope, actual-Harbor-source self-development acceptance, accurate planned-delivery wording, and P001/P009 compatibility-gate ownership; no actionable design findings remained. See the [expanded design review report](../docs/reports/2026-09-07-design-review.md) for scope, checks, and limitations. All 12 feature proposals remain Draft/Planned. Runtime, Linux isolation, and implementation acceptance gates remain open; document review does not establish deployment readiness.
