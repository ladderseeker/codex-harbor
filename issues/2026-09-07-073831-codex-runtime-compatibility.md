# Codex runtime compatibility requires a deployment capability gate

- Severity: Medium
- Status: Open — planned P001 runtime/local Linux gate and P009 target VPS/release gate
- Recorded: 2026-09-07 07:38:31 Asia/Shanghai
- Category: Dependency and implementation uncertainty
- Affected: [design/architecture.md](../design/architecture.md); future `packages/codex-adapter/` and `infra/`

## Evidence

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server) states that the app-server command and WebSocket transport are experimental and unsupported for production workloads. The same documentation describes a stable method subset with separate experimental opt-in. A stable subset does not establish production support for the entire runtime or deployment.

The local Codex CLI 0.153.4 help observed during planning marks app-server `[experimental]`. The target VPS runtime, Linux kernel and isolation prerequisites, account authentication, and requested feature matrix have not been tested. No deployment or production-readiness claim has been made.

## Impact

Runtime upgrades may change protocol behavior, and account, platform, or host limitations may make some requested desktop features unavailable. An unsupported configuration could fail compatibility or isolation acceptance tests and require a design adjustment before deployment.

This record captures a dependency and implementation uncertainty. It is not an unresolved defect preventing completion of the requested research and planning work.

## Next steps

1. [P001 — Secure persistent conversations](../design/proposals/001-secure-persistent-conversations.md) owns selecting/pinning the runtime, generating matching schemas, and validating its delivered conversation, streaming, approval, and recovery contracts plus local Linux runner prerequisites/isolation.
2. Later feature owners extend the capability matrix and contracts for their delivered model controls, files, images, terminals, and other runtime integration; P001 does not wait for future features to be verified.
3. [P009 — Portable deployment and restore](../design/proposals/009-portable-deployment-and-restore.md) owns validation on the target VPS, including kernel/container prerequisites, isolation, deployed account capabilities, and release/restore readiness. Fail closed when required controls are unavailable.
4. Publish supported, unsupported, and experimental capabilities with evidence for the features delivered at each gate.
5. Re-run the applicable compatibility/isolation checks before upgrades, preserving P009's tested rollback package and documented compatibility limits.

Record P001 and P009 results separately: passing the local capability gate does not establish VPS release readiness. Close or revise this record once their applicable checks establish the supported deployment configuration and the release plan documents remaining limitations and any required follow-up issues. Later features and runtime upgrades must extend or reopen the relevant validation gate.
