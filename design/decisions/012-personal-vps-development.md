# D012 — Complete personal VPS development through Harbor

- Decision: Accepted within the owner's 14 September 2026 authorization to implement the recommended development workflow, push main and deploy it to the VPS.
- Owner: [P015](../proposals/015-personal-vps-workspace.md).
- Amends: [D011](011-personal-vps-workspace.md) for the personal VPS profile only. Managed isolation and deferred P010/P012 remain unchanged.

## Context and decision

The deployed owner can converse and edit an original folder, but normal development fails at Git trust/metadata, missing pnpm, temporary storage and disabled command networking. The owner's selected outcome is a complete browser-driven development loop, including a private development-service preview and recognizable persistent conversations. A text response or file canary alone cannot establish this outcome.

Retain the dedicated nonroot service account and native Codex sandbox. The personal VPS workspace-write policy may explicitly grant the selected canonical project's in-place Git metadata, project-specific developer caches and private temporary storage, and enable development networking. Exact project Git trust replaces per-command workarounds; never configure wildcard safe.directory. Only existing ordinary .git directories are granted; linked Git metadata, commondir references and symlink escapes fail closed. Initializing a brand-new repository inside a turn is not yet supported by this native boundary; select an existing repository for the complete Git workflow. Read-only turns remain read-only. No root, sudo, Docker socket or automatic unsandboxed fallback is granted. Native policy and actual Linux probes must agree; a configuration declaration is not proof of .git or filesystem access.

Routine development capabilities are authorized by the chosen policy instead of repeatedly asking the owner for the same permission. The interface shows the actual effective policy and any unsupported operation clearly. Existing supported command/rule approvals retain their server authority checks. Protected host administration remains outside the coding account's authority.

Ship a reproducible development toolchain with pinned Node and pnpm, full pinned official Codex distribution and validated host Git/Python/compiler prerequisites. The noninteractive environment supplies executable search paths, writable temporary and cache locations and the configured preview port. Preserve independent credentials and the immutable application release outside editable projects. Native same-UID and cross-project read limitations in D011 still apply; network access does not establish the managed egress boundary.

## Private attached development preview

For this personal trust domain, attach a browser preview to an administrator-declared loopback development port. The coding conversation starts the application. After a successful personal turn, retain its owned native runtime for 30 minutes, renewing on same-conversation continuation, with at most four retained/active contexts. Hold its workspace writer reservation until confirmed retirement. The owner can stop background work explicitly from the conversation; expiry, archival, emergency stop and graceful supervisor shutdown retire it before releasing the writer. An abrupt restart or unconfirmed retirement marks uncertainty, removes the availability claim, and preserves the writer fence for SSH recovery. Attaching a preview does not claim process ownership, launch a managed runner, or keep an application alive across supervisor retirement. Port bindings in this shared Unix account cannot prove project ownership. Make the selected endpoint clear and do not advertise managed project isolation.

Use a separate verified HTTPS origin for every configured endpoint, distinct from Harbor and each other. A loopback-only gateway connects solely to the declared 127.0.0.1 port, never a browser-supplied URL. Deny collisions with control/database/gateway ports. The owner creates a short-lived, one-use viewing ticket through Harbor's authenticated, CSRF-protected API; exchange it for a host-only secure viewer cookie. Revalidate the originating browser session and relevant project/session authority on requests. Strip Harbor credentials, hop-by-hop headers and forwarding authority before proxying; handle HTTP and development WebSockets under the same authority. Do not expose arbitrary host ports or grant cross-origin access to Harbor APIs.

The deployment may use a DNS name resolving to the owner's VPS with publicly verified TLS when the primary domain has no preview DNS record. This is a deployment configuration value, not an application default. Keep existing Traefik and other services unchanged.

## Conversation contract

Assign a concise title from the first substantive user task, preserve explicit manual renames, and safely populate existing default-titled conversations. Titles persist and agree in the sidebar, history and conversation header. Greetings alone may retain a default title until a task is supplied.

Persist authoritative final assistant items, reconciling streamed partial content idempotently. Expose bounded command output, command status and errors using existing interface patterns. Truncation of bounded tool output must be explicit; do not silently present partial assistant replies as complete. Preserve retention limits, event ordering and restart/replay behavior.

## Acceptance and promotion

[P015-07–10](../proposals/015-personal-vps-workspace.md#complete-development-acceptance) extend the existing P015 gates. Exercise a disposable real project through Harbor UI/API/storage/supervisor and the pinned native runtime: modify files, ordinary Git operations, locked dependency installation, tests/build, localhost serving and authenticated browser preview. Close/reopen the browser during accepted work and continue the same conversation. Verify readonly and outside-write denials, preview authorization, title persistence, full replies and tool failures.

Build and review a separate immutable candidate, freeze its identity for acceptance, then drain live admission and back up private database/config/native state before promotion. Preserve the previous release and compatible rollback instructions. Never use a new schema with an incompatible old binary. Record incomplete gates in the existing P015 issue; unrelated proposals are not closed by this delivery.
