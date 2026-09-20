# P011 headless command capability

Recorded 8 September 2026. This is a bounded upstream capability check for [P011](../../design/proposals/archive/011-private-project-previews.md), which remains Planned. It does not implement a Harbor preview, prove HTTP readiness, or establish Linux isolation.

## Tested source and environment

The final probe used real Codex 0.153.4, Node 24.11.1 and macOS ARM64 against main `609b115`. It initialized the repository adapter with experimental API access disabled, a fresh native home and an empty account. Its child environment contained only `PATH` and the fresh `HOME`/`CODEX_HOME`; no personal native state or model credential was imported. It made zero thread or model requests.

The diagnostic is retained at `.test-runs/p011-headless-spike-20260908.mjs`, SHA-256 `1e790dcfc1ee2e084114583310d34606a202ece25469866fbb93869e1394ebe6`. Its contemporaneous `.json` result records 2026-09-07T19:23:11.023Z and process identity `bddd15b4-c593-45e6-9f4f-090dd98d1db0`. The diagnostic uses the adapter's internal request transport to inspect the pin; no raw protocol capability was added to Harbor's public API.

## Observed behavior

A fixed silent Node process ran with non-PTY `command/exec`, `streamStdin: true`, streamed output enabled, a finite command deadline, and native `readOnly` policy with networking disabled. `command/exec/write` with the exact `processId` and `deltaBase64: ""` returned `{}` after 2 ms without injecting input. The same empty write was rejected before launch, for a different process ID, and after the process exited.

The process produced no output and remained active after two seconds, beyond the diagnostic's 1.5-second ordinary RPC deadline; its command completion used a separate finite deadline. A second empty write still acknowledged its identity. Exact `command/exec/terminate` returned `{}`, followed by the original completion response with exit code 137 and empty stdout/stderr. The native process closed and only the fresh owned home was removed.

The first attempt under the parent tool sandbox acknowledged identity but exited early with 53 bytes of stderr. That stderr text was not retained, so its cause is not established. Its failed result remains separately at `.test-runs/p011-headless-first-attempt-20260908.json`, recording diagnostic SHA-256 `ececdadad8373bc8b5d9f93094ce8098750fbdd4fa00dc739440d4208a518726`. The final recorded run executed outside that parent wrapper while keeping Codex's own explicit read-only policy. No Harbor confinement policy was changed.

## Implementation consequence and limits

P011 can test and use a bounded zero-byte write as an acknowledgement of its connection-scoped native process identity. Retry only the demonstrated not-present result during a finite startup interval. An acknowledgement is not an application-ready signal: the supervisor must still reject completed/lost generations, verify the exact runner/relay and obtain the required bounded HTTP result before publishing readiness.

This probe did not run npm, an HTTP application, the Harbor supervisor, a relay, a browser grant, a background-child retirement case or a 24-hour lifetime. P011's full application, authorization, streaming, hostile-origin and supported Linux lanes remain required. The official reference describes sandboxed command execution and its process-ID controls; the pinned generated types and the actual probe establish the narrower behavior used here. [Official app-server reference](https://learn.chatgpt.com/docs/app-server#command-execution).

One independent prerequisite review checked the diagnostic code/hash, both results and the report's scope, closing with no actionable finding. Documentation links and whitespace passed across 78 files. This is not a P011 implementation review or completion gate.

## Navigation and ownership addendum — 20 September 2026

P017 reconciled legacy planning records into the [proposal archive](../../design/proposals/archive/). [Current subsystem designs](../../design/systems/) now own requirements, and unfinished acceptance belongs to the [issue inbox](../../issues/) until a new proposal is selected. Historical statements here about active proposal states, queues, permissions and recovery locations describe the recorded date. This addendum changes navigation/ownership only: original tested sources, commands, results, review rounds and limitations above remain historical evidence. No application gate was rerun for the documentation migration. Historical raw artifacts or worktrees not present in this checkout were not newly verified.
