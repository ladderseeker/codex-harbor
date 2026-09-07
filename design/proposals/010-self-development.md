# P010 — Develop Harbor through Harbor

- Decision: Draft
- Delivery: Planned
- Dependencies: [P002](002-programmatic-api-access.md), [P003](003-parallel-project-workspaces.md), [P009](009-portable-deployment-and-restore.md)
- Outcome: A conversation in stable Harbor edits Harbor source, builds and tests a separate candidate, and produces a reviewable release while stable Harbor remains usable.

## Scope and owner flow

Register Harbor's source as an ordinary allowed project and select a separate development worktree. Through the running conversation, request a source change, invoke the same development/build/test entry points used locally, inspect candidate results, and prepare an immutable artifact for promotion. A candidate URL is available only through its authenticated private route. Failure can be inspected and cleaned up from stable Harbor or the external recovery path.

The initial self-development workflow does not require the file-editor UI, interactive terminal UI, general preview feature, scheduler, or extension manager. P001's agent execution performs source edits; this feature provides its scoped build/test authority and candidate inspection route. It does not allow a task to edit the running deployment directly.

## Broker and isolation contract

Implement a trusted build/test broker outside coding runners. It accepts only registered worktree/snapshot IDs, a server-owned command profile, and bounded resource requests. Snapshot source before execution and record its digest. Scripts and Dockerfiles remain untrusted input: the broker runs them in restricted build workers, not its privileged process.

The broker provisions sibling candidate services inside a disposable Linux environment, using fixed mount/network/launcher templates. The candidate receives a separate database/role, volumes, Codex home, identity configuration, URL/ports, and credentials. Candidate supervisor launch authority is restricted to its disposable execution resources. Names alone are insufficient: enforce resource ownership at the broker/OS boundary and reject stable/other-candidate IDs.

Coding tasks receive no host Docker socket, daemon credentials, arbitrary mount flags, privileged nested Docker, or host-admin token. A short-lived capability may invoke only the assigned test job and inspect its output; it cannot administer deployments or mint broader credentials. Standard command wrappers route supported build/test profiles through this broker in a Harbor runner and use equivalent trusted local provisioning from a developer shell. Upon delivery, this path must work without manually bypassing isolation.

Reserve capacity for stable Harbor, enforce candidate quotas/lifetimes, and clean up by manifest. Candidate tests use synthetic state and external fixtures; real runtime/isolation evidence remains separately required. Promotion references the tested artifact digest/report and follows P009's independent release path and current user authorization. Deployment credentials never enter candidate code; replacing the supervisor drains or explicitly interrupts its active control session.

## Independent acceptance

Use a stable installation of delivered P009 and P002/P003, an isolated immutable snapshot of an actual Harbor repository revision, and real candidate services. Create the editable candidate worktree from that snapshot, apply a controlled test change, and snapshot the resulting source for its recorded build digest. Do not substitute a toy replacement application for Harbor. The deterministic external Codex fixture may script coding actions; the source edits, broker, build, candidate, database, and browser/API tests are real.

1. **P010-01:** Start a development request through stable UI, make a controlled worktree change, and broker a build/E2E run. Assert source/artifact identity and observable candidate behavior.
2. **P010-02:** Inspect candidate through its authorized browser/API route while the stable conversation continues streaming. Assert distinct state, cookies, ports, database credentials, and runtime homes.
3. **P010-03:** Fail a candidate build/test, crash its services, and exceed candidate resources. Assert stable health/input/cancellation remain usable and failure is visible.
4. **P010-04:** Supply malicious script/Dockerfile, mount/path/namespace arguments, and another candidate's IDs. Assert no stable-secret, host, or cross-candidate access.
5. **P010-05:** Run cleanup and expire a test capability. Assert only owned candidate resources disappear and the capability cannot later mutate either environment.
6. **P010-06:** Prepare a successful artifact, reject a changed/untested artifact, and exercise the P009 promotion/rollback procedure. Assert exact artifact verification and explicit handling of the running development session.
7. **P010-07:** Exercise the same entry points from local development and a compatible Linux host, including real Linux isolation and bounded real-Codex smoke. Assert no manual privilege bypass is required.

## Delivery and verification

Implement planned `pnpm test:e2e:self`, including a stable/candidate fixture and a release-independent bootstrap path. Run normal build/check/E2E plus relevant contract/live/isolation lanes under [shared rules](README.md#shared-verification-contract). Test the resulting artifact identity, not just source before a different rebuild.

Persist job manifests, source/artifact digests, expiry, and redacted verification references; extend backup/retention for durable release evidence without backing up disposable candidate secrets. Document the real local/VPS command routing and recovery procedure after implementation. No successful candidate test establishes host-wide security or automatic deployment authorization. Complete independent review before verified delivery.
