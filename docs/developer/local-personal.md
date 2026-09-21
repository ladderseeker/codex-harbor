# Personal local experience

## Design and evidence ownership — 20 September 2026

[Current subsystem designs](../../design/systems/) own behavior and limits; the [issue inbox](../../issues/) owns unfinished acceptance. Historical proposal IDs below identify feature lineage and evidence, not active execution. Future changes follow a newly selected proposal under the [workflow](../../design/workflow.md); baseline reconciliation did not rerun application gates.

P013's local profile is implemented and independently reviewed. Local browser/API/database/supervisor acceptance, pinned native permission checks and the owner's real account conversation passed. The initial separate critical regression failed; the later P014 pass is recorded under Verification limits below. See the [delivery report](../reports/2026-09-13-personal-local-experience.md) for exact scope and evidence.

The profile runs Harbor on loopback and calls a local Codex process. Its default conversation permission ceiling is read-only. It uses the native sandbox and does not establish Linux container, network or hard-quota isolation. Managed workspaces, file editing, terminals, schedules, previews and explicit uncertain-work recovery are unavailable in this initial local scope; the normal Linux profile retains those implemented features.

## Start and sign in

Install the locked dependencies and ensure Docker is running. Set `HARBOR_LOCAL_CODEX_BINARY` to an absolute path to a separately installed official Codex 0.153.4 executable; do not replace a different version used for ordinary Codex work.

```sh
pnpm install --frozen-lockfile
export HARBOR_LOCAL_CODEX_BINARY=/absolute/path/to/codex
pnpm dev --local --login
```

The executable path above is a placeholder. Official CLI login uses an independent account home and the provider's authentication page. Never paste an API key or login token into a conversation. `--local` cannot be combined with `--fixture`; fixture mode must not contain real credentials.

The launcher discovers the actual native model list by default; an explicit `HARBOR_MODELS` allowlist overrides it. After login the command builds the UI, starts PostgreSQL/Caddy and the local owner provider/API/supervisor, and prints the HTTPS URL. The Harbor owner token is stored in the instance's `owner-token` file; enter it only into the local Harbor owner sign-in page. This local owner unlock is separate from the official Codex account login.

Caddy's instance-specific private certificate must be trusted by the browser. Account onboarding never disables HTTPS verification or bypasses a browser warning automatically. Review and approve any change to the operating system's trusted certificate authorities yourself. A local CA trust change is separate from Codex account authorization.

## State and stopping

The default persistent directory is `.harbor-local/`, ignored by Git. It contains instance metadata, private account state, owner authentication material and local project folders. Docker volumes are namespaced by that instance. `HARBOR_LOCAL_STATE_DIR` can select a separate private state directory for an independent instance; tests must always use their own fresh directory and credentials.

Ctrl+C requests owned service shutdown while preserving data. Start again with `pnpm dev --local`; use `--login` only after stopping the instance when changing the account. Never clear another instance's lock, processes or Docker resources. A stale lock after a crash requires checking the recorded process identity before recovery.

## Conversation concurrency

P018/P024 are released for personal VPS. Native macOS ownership cannot prove complete detached-process retirement; that platform is outside the selected release scope. Local unknown runtimes remain counted and cannot be safely reclaimed automatically. The shared code below is not a claim of supported native macOS lifecycle parity.

Personal conversations can share a registered directory while retaining independent native threads and runtime generations. Each conversation runs one turn at a time; the local read-only ceiling is unchanged. `HARBOR_MAX_ACTIVE_TURNS` (1–16) and `HARBOR_MAX_CONVERSATION_RUNTIMES` (1–32) propagate through local startup, both default to four, and require runtime capacity at least active capacity. Lower limits defer new work without forcibly cancelling accepted turns.

[D014](../../design/decisions/014-personal-conversation-concurrency.md) defines ordinary-idle reuse/retirement and protected or unknown process states. Targeted stop affects only the selected conversation and requires confirmed retirement before releasing capacity. Migration 019 requires a matched database/native/config checkpoint when reverting to older binaries. Follow the [P018 report](../reports/2026-09-21-p018-concurrency.md) for current verification status; no new dedicated-account or Linux acceptance is implied by this guide.

## Verification limits

A personal account trial is user activity, not an automated dedicated-account acceptance run for P001–P009. Keep the inherited acceptance obligations and historical reports unchanged. Completed independent review covered native permission denial, pre-login home validation, startup cancellation, account readiness and unsupported local controls. The [critical browser regression gate](../../issues/archive/2026-09-13-143001-local-critical-regression-gate.md) passed under P014; P013’s legacy record was subsequently reconciled under P017 without rerunning those gates. Restart after source/build changes; rebuilding shared web assets while serving can leave registered asset routes out of date.

P024 adds authenticated image/general-file attachments backed by private instance state outside project and development-cache write grants. See [attachment storage and verification](attachments.md); the selected personal VPS native/Linux/live acceptance passed at the sources in the execution record. P018's native ownership probes invalidated group-only retirement for ordinary detached commands. Linux now requires a cgroup-v2 subtree delegated only to the supervisor, with fixed generation leaves and confirmed empty state before capacity release. The owner selected VPS-only release support; native macOS lifecycle completion is not planned for this release and no group-only absence is claimed.
