# Personal VPS development delivery — 14 September 2026

Owner: P015 / D012. The owner authorized implementation on main, push and VPS deployment. This report records tested boundaries and remaining gates; it does not close unrelated managed deployment, dedicated-account or deferred P010/P012 obligations.

## Delivered candidate

The personal VPS workspace-write policy supplies existing in-place Git metadata, exact repository trust, network, private temporary/cache storage and a complete pinned pnpm toolchain. Separate-origin authenticated previews attach to an explicit localhost endpoint. Successful personal turns retain their owned runtime and writer reservation for 30 minutes, with same-conversation continuation and explicit stop. Unconfirmed retirement remains visibly uncertain and fenced.

Conversation titles are populated from substantive requests and preserve manual renames. Authoritative native final items reconcile partial streams; bounded command transcripts show status/output. Parent thread and turn identity now govern notification and approval routing, including callbacks received before turn/start acknowledgement. Foreign child events are rejected before charging the parent mailbox.

## Observed failure and historical limits

The original owner conversation contained a 427-character assistant item identical to a linked child thread's final response. Its parent operation was marked succeeded 27.7 milliseconds after the child task completed, while the parent's native transcript had no task completion. The unfiltered child completion could end the parent operation and retire its runtime. This explains both mixed messages and the clipped parent checklist.

The 392-character partial parent checklist never reached a completed native message. No authoritative replacement was found; historical partial text is preserved rather than fabricated or replaced with a child's response. The new thread-scoped regression reproduces 300 child events, foreign approval and early parent output before parent acknowledgement, then requires the parent to remain running and retain its own final response.

## Verification records

Environment: macOS Node 24.11.1/pnpm 12.3.4 for source checks; Ubuntu 24.04 VPS with isolated candidate source, nonroot test identities, PostgreSQL fixtures, Chromium 1194, pinned official Codex 0.153.4 and separate credential-only native test home. The running owner instance is separate from candidate code and test resources.

| Boundary | Evidence |
| --- | --- |
| Source check | `pnpm check` passed TypeScript, OpenAPI, formatting and documentation checks. `TMPDIR=/private/tmp pnpm test` with scoped local socket access passed 25/25 integration tests. Initial sandbox socket denials and macOS `/var` versus `/private/var` mismatch are environment failures, not passing runs. |
| Pinned runtime contracts | Linux `node --import tsx --test tests/contract/*.test.ts`: 22 passed, zero failed, one optional native local test skipped. Actual personal Linux/native lanes below cover this profile. |
| Deployment contracts | Linux `python3 -m unittest discover -s tests/deployment -p '*_test.py'`: 39 passed. |
| Actual Linux sandbox | Owned nonroot/systemd run `fce2124295`: existing-repository Git add/commit, npm DNS, temporary files and localhost listener passed; readonly and outside-write denials retained. Native executable SHA256 `56ef98ab4032d317ab26e9b5e5a175650717351edb16ed9cde0cb6d1734d62da`. A separate new-repository initialization probe failed and is not claimed supported. |
| Real model development | Unit `harbor-native-dev-53ebd8b568` passed in 57 seconds: ChatGPT account, actual tools, Git commit, pinned dependency installation, independent test/build checks, localhost response, confirmed process retirement and resumed native-thread edit. Adapter/harness SHA256 `b022476b41dfb9544287457876e792b358bb1daf6875fc04f2a9ebd9314f88ee`; 10 tool events. The later parent-routing correction is separately tested through Harbor. Credential clone and owned AppArmor allowance were removed. |
| Personal browser before routing correction | `harbor-p015-b998a8db98` passed real nonroot Harbor UI/API/database/supervisor with only external OIDC/Codex fixtures. Preview stays available after turn completion; 1 MiB JS, development-style WebSocket subprotocol, origin/session denial, credential stripping, API-restart grant invalidation, continuation and explicit stop passed. Desktop/mobile screenshots inspected. The fixture is not an actual Vite server. |
| Critical suite before routing correction | `harbor-e2e-4fbfbaf0c4/result.json` records passed status and unchanged start/end source digest `e8b1b0aa8a2bf0f5551b2d70d3390c4cc87fef8c586fda35ae710e4d2ba4eb00`. SSH transport later closed without delivering the shell exit code; persisted result and absence of the owned process were inspected. A final routing-regression rerun uses durable systemd exit records. |

Final routing correction: personal browser run `harbor-p015-ae3cca62b2` and critical run `harbor-e2e-ef7cda9a40` both passed with durable systemd exit 0. The critical run records identical start/end source digest `91eb1af981eba44b7b2c7b25fd771b29ebc7de72cdea4ec221f46313c71011ec` (1081 files). This includes the parent/child flood, early activation and final-output regression. Installed browser evidence remains a separate gate below.

## Independent review

Implementation was delegated to runtime/toolchain, conversation and preview owners. Separate agents cross-reviewed each other's changes because the available agent-thread limit prevented an additional fresh reviewer.

1. Round 1 found normal completion killing preview servers, optional command output exhausting total history capacity, and duplicate start reopening completed output. These were fixed with lifetime/stop handling and bounded diagnostics.
2. Round 2 found unconfirmed retirement could leave stale availability after the runtime map entry disappeared. It now records uncertainty and preserves the writer fence.
3. Round 3 verified the bounded retirement fix and clarified retention and existing-repository limits.
4. A critical-only additional round investigated live child/parent mixing. Parent identity/activation handling and a pre-mailbox child-flood filter were added and independently reviewed. No remaining critical finding in that reviewed boundary; final application execution is the gate.

The concrete promotion script received two independent reviews. Fixes bind it to an expected manifest hash and complete immutable tree, check stable service executable identity and gateway readiness, and disable Python bytecode writes into the release before importing the installer. Private backup/drain and no automatic rollback over newly admitted work were reviewed.

## Packaging, deployment and recovery

The official pnpm wrapper and Linux native package were fetched from the npm registry and verified against SHA512 integrity metadata. Their SHA256 values are `08a3d2d539b377a6b7ea2469b612672255ca71c30a62698530582cb9d35c268f` and `9b1c95fc413600ca75a51ebe8332d7019dc3568fd4187f5a5f2df4a156efb65c`. The complete pinned Codex bytes were preserved from the previously integrity-verified distribution.

Final source revision, artifact identity, private backup location, migration outcome, verified public TLS and post-promotion browser acceptance remain to be appended. Migrations 017/018 require a matched database/native/config checkpoint for rollback to the older client/lifecycle contract. The existing root-owned release, Google owner identity, subscription state, exact project write drop-ins and Traefik service are preserved through promotion.

## Limits

This is the explicit personal nonroot trust model, not managed cross-project isolation or host administration. New Git repository initialization and external/linked metadata remain unsupported; select an existing ordinary repository. Preview endpoints are shared personal-account ports and do not prove project process ownership. Developer processes expire after 30 minutes and cannot survive supervisor retirement.

The browser security policy blocked opening the local `file:` prototype. Its guide/prototype source consistency and links were checked; the actual rendered desktop/mobile application screenshots were inspected as the available safer alternative. No rendered-prototype check is claimed. Real browser/computer automation, hosted plugin parity and P009 off-host restore remain outside this outcome.

The pre-existing local AGENTS.md SSH-handoff edit remains owner work. No temporary stash was created. Candidate assets live under ignored `.test-runs/` and the isolated VPS `/var/lib/harbor-dev-20260914`; P015 owns their evidence and cleanup.
