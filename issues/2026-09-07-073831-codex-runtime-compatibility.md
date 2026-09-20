# Codex runtime compatibility requires a deployment capability gate

- Severity: Medium; compatibility uncertainty, with separately recorded High acceptance blockers.
- Inbox owner: Unassigned; awaiting owner selection of a new proposal.
- Evidence state: Partial local/installed evidence; full managed acceptance remains unverified.
- Reopened: 2026-09-20. P001/P009 legacy records are reconciled, so their unfinished obligations return to the inbox.
- Current design: [Conversations/access](../design/systems/001-conversations-and-access.md) and [deployment/profiles](../design/systems/004-deployment-and-profiles.md).

## Current obligation map

- **P001-03–08:** Retain identified pinned protocol/schema, fixture and Linux passes; execute remaining authenticated conversation/approval/cancel smoke, record capability limits and upgrade requirements. [Dedicated credentials](2026-09-07-171225-live-runtime-credentials.md) remain a separate prerequisite.
- **P009-01/02:** Complete fresh installed browser/API conversation and current fail-closed authentication, internal-port and prerequisite acceptance. Partial historical install/native checks do not establish this complete outcome.
- **P009-03:** Exercise actual persisted conversation/native history across a disposable host reboot, retaining interrupted/uncertain outcomes without replay. The historical reboot had zero conversations.
- **P009-04/05:** Verify complete protected backup registry/integrity, changed-host restoration, revoked cookies/PATs/receipts and re-encrypted credentials, validated filesystem identities, disabled admission, uncertainty and no source-host contact. Exercise corrupt/missing module/key, interrupted restore and disk-pressure failures. The [backup transfer issue](2026-09-07-231526-p009-backup-transfer-approval.md) retains the exact rejected action and checkpoint prerequisite.
- **P009-06/07:** Establish exact tested-artifact promotion/compatible rollback and refused incompatible downgrade, deployed pinned-account/Linux behavior, target-host connectivity and external administrator recovery. Earlier bounded administrator recovery remains historical evidence.
- **Delivered module integration:** P003 project/workspace/native state, P005 attachment blob/reference/publication state, P004 file/receipt authority, P006 terminal history/input, P008 schedule grants/occurrences, and P011 preview state must all be covered by complete P009-04/05 acceptance. Feature-specific issue links retain their own evidence and correction history.
- **Continuing requirement:** Publish supported/unsupported/experimental capabilities, versions, resource prerequisites, reproducible evidence, rollback compatibility and applicable upgrade checks. No personal profile result substitutes for the managed profile.

Recheck the selected capability against current source and its exact historical evidence before proposing work. Do not rerun unchanged suites merely to erase evidence age; run the affected mandatory gates when prerequisites and authorization exist.

## Historical transfer and evidence

The original transfer below is retained as history, not the current ownership state. Reopening is not a new defect or a withdrawal of prior passes.

- Severity: Medium
- Archive disposition: Transferred — not resolved
- Archived: 2026-09-07
- Owners: [P001](../design/proposals/archive/001-secure-persistent-conversations.md#source-issues) and [P009](../design/proposals/archive/009-portable-deployment-and-restore.md#source-issues); both evidence parts pending
- Recorded: 2026-09-07 07:38:31 Asia/Shanghai
- Category: Dependency and implementation uncertainty
- Affected: [design/architecture.md](../design/architecture.md); future `packages/codex-adapter/` and `infra/`

## Evidence

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server) states that the app-server command and WebSocket transport are experimental and unsupported for production workloads. The same documentation describes a stable method subset with separate experimental opt-in. A stable subset does not establish production support for the entire runtime or deployment.

The local Codex CLI 0.153.4 help observed during planning marks app-server `[experimental]`. The target VPS runtime, Linux kernel and isolation prerequisites, account authentication, and requested feature matrix have not been tested. No deployment or production-readiness claim has been made.

## Impact

Runtime upgrades may change protocol behavior, and account, platform, or host limitations may make some requested desktop features unavailable. An unsupported configuration could fail compatibility or isolation acceptance tests and require a design adjustment before deployment.

This record captures a dependency and implementation uncertainty. It is not an unresolved defect preventing completion of the requested research and planning work.

## Original planning next steps

The original Open finding assigned the following work on 2026-09-07. This historical plan is preserved; the dated transfer record below owns current tracking.

1. [P001 — Secure persistent conversations](../design/proposals/archive/001-secure-persistent-conversations.md) owns selecting/pinning the runtime, generating matching schemas, and validating its delivered conversation, streaming, approval, and recovery contracts plus local Linux runner prerequisites/isolation.
2. Later feature owners extend the capability matrix and contracts for their delivered model controls, files, images, terminals, and other runtime integration; P001 does not wait for future features to be verified.
3. [P009 — Portable deployment and restore](../design/proposals/archive/009-portable-deployment-and-restore.md) owns validation on the target VPS, including kernel/container prerequisites, isolation, deployed account capabilities, and release/restore readiness. Fail closed when required controls are unavailable.
4. Publish supported, unsupported, and experimental capabilities with evidence for the features delivered at each gate.
5. Re-run the applicable compatibility/isolation checks before upgrades, preserving P009's tested rollback package and documented compatibility limits.

Record P001 and P009 results separately: passing the local capability gate does not establish VPS release readiness. Close or revise this record once their applicable checks establish the supported deployment configuration and the release plan documents remaining limitations and any required follow-up issues. Later features and runtime upgrades must extend or reopen the relevant validation gate.

## Transfer record — 2026-09-07

Archived as **Transferred**, because all current obligations are assigned within existing proposals. This is an ownership change, not a compatibility result or resolution. The original evidence above has not been revalidated. No runtime, account, Linux, deployment, or restore checks ran for this lifecycle change; the medium-severity risk remains.

| Part | Unresolved obligation and receiving owner | Acceptance mapping | Evidence and remaining gate |
| --- | --- | --- | --- |
| Local baseline | P001: select/pin the runtime and matching schemas; validate delivered conversation, streaming, approval, cancellation, recovery, and local Linux prerequisites/isolation; publish supported, unsupported, and experimental local capabilities with versions, limitations, and reproducible checks. | [P001 Independent acceptance](../design/proposals/archive/001-secure-persistent-conversations.md#independent-acceptance), P001-03–08, and [Delivery and verification](../design/proposals/archive/001-secure-persistent-conversations.md#delivery-and-verification). | Pending. Missing real runtime/account or Linux evidence blocks P001 verification. Local success does not establish target-host readiness. |
| Deployment and release | P009: validate target-host kernel/container prerequisites, deployed account/runtime capabilities, isolation, release/restore readiness, and fail-closed behavior; publish the delivered deployment capability matrix and limits; establish applicable pre-upgrade revalidation and retain tested rollback/restore compatibility. | [P009 Independent acceptance](../design/proposals/archive/009-portable-deployment-and-restore.md#independent-acceptance), P009-01/02/04/06/07; [Release and recovery contract](../design/proposals/archive/009-portable-deployment-and-restore.md#release-and-recovery-contract); [Delivery and verification](../design/proposals/archive/009-portable-deployment-and-restore.md#delivery-and-verification). | Pending. Missing target-host/runtime/isolation or restore evidence blocks P009 verification and deployment-readiness claims. |

The [architecture's compatibility boundary](../design/architecture.md#official-foundation-and-compatibility-boundary), [verification contract](../design/architecture.md#repeatable-verification-through-the-application), and [release rules](../design/architecture.md#release-retention-and-rollback-rules) retain the continuing requirement for later feature owners and runtime upgrades to extend/revalidate capability evidence. P001 establishes the versioned local baseline; P009 establishes the deployed baseline and repeatable upgrade/recovery gate. Neither waits for unimplemented future features, and resolving this record for a tested baseline will not waive future validation.

Reciprocal ownership is recorded in [P001 Source issues](../design/proposals/archive/001-secure-persistent-conversations.md#source-issues) and [P009 Source issues](../design/proposals/archive/009-portable-deployment-and-restore.md#source-issues). Track pending work from the [active issue index](README.md) and [proposal index](../design/proposals/README.md); the [archive index](archive/README.md) records this disposition. Record each owner's eventual evidence here separately, retaining Transferred until both mapped parts are verified under the [issue lifecycle](../design/workflow.md#issue-resolution-and-transfer).

## Implementation evidence addendum — 2026-09-07

P001 now has matching pinned generated schemas, eleven adapter/launcher/schema contracts, real-stack fixture E2E, and actual Linux/XFS isolation evidence on source SHA256 05971cd8dfcba617b16dd68eaf33f17dadcc0fbfbc1aad99c4c1e65d118183e0. The [foundation report](../docs/reports/2026-09-07-p001-foundation.md) records versions, artifacts, commands, supported behavior, and limitations.

P001's authenticated real-account gate remains blocked, so its transferred part is only partially evidenced. P009 target-host, deployed account, reboot, release, and restore obligations remain pending. Keep this record Transferred and visible from the active index; no local fixture or Linux-only result resolves the full finding.

## History

### Deployment implementation evidence — 8 September 2026

P009's [reviewed development report](../docs/reports/2026-09-08-p009-development.md) now records actual immutable installation, HTTPS owner login/project creation, UID/private socket/SCRAM denials, a reboot preserving the registered project identity, and account-free confined Codex initialization on the disposable supported Linux profile. Each installed artifact retains its own identity and scope. Reboot used zero conversations; it does not establish restored or rebooted native conversation history. Main integrated the reviewed deployment source in `f7872ed`; matching-source `b6599ab3…7a4289` passed the full Node 24 application regression and two bounded independent review rounds.

The deployment part remains partial. Restored-host destination enrollment and available administrator checks are still being completed. Protected A-to-B checkpoint/restore, actual release promotion/rollback, native-history activation and dedicated live-account gates remain unverified. This record stays Transferred, not Resolved; no completed local or installed check waives the remaining mapped obligations.

- 2026-09-07 07:38:31 Asia/Shanghai: Recorded Open during design planning, with P001 and P009 identified as future validation owners.
- 2026-09-07: Formally transferred the full finding to P001/P009 acceptance and delivery sections, added reciprocal links and pending evidence tracking, and moved the same filename to `issues/archive/`. No implementation or release gate was passed or waived.
