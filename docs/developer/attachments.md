# Attachment verification and storage

The attachment implementation uses authenticated browser-owner routes described by `/api/v1/openapi.json`: create metadata under `/sessions/{id}/attachments`, PUT a complete binary body under `/attachments/{id}/content`, read a protected preview/download, delete unsubmitted content, and GET/POST the session draft. Mutations use the ordinary CSRF, Origin and retained idempotency contract. PAT access fails closed because no attachment route descriptor grants it.

The initial profile accepts bounded PNG and UTF-8 text; the [user guide](../user/attachments.md) lists effective limits and recovery behavior. PostgreSQL is authoritative for metadata, blobs and revisioned drafts. Migration 008 creates `attachments`, `conversation_drafts` and `session_attachment_storage`. Stage admission reserves declared bytes. A PUT accepts only the declared complete size/hash and validates media before committing staged content. Turn admission atomically associates validated references with its operation and clears only the submitted draft revision.

The trusted Linux supervisor publishes only committed operation content through the fixed quota helper. Files use opaque IDs, root ownership, read-only permissions and verified digests/inodes. Publication uses the registered project canonical identity independently of a selected P003 derived checkout; both the helper and launcher validate that identity. Files reside within the project's XFS quota unit in `attachments/<session-id>/`; the launcher binds only that session directory read-only at `/attachments`. Database commit failure after publication leaves the blob authoritative; an exact publication retry verifies and reuses the physical inode. Unsubmitted upload cleanup never deletes submitted native files.

Run from the repository root:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:contract
pnpm test:e2e
```

The browser suite includes real Harbor UI, Caddy, API, PostgreSQL and supervisor. Only OIDC and the external Codex protocol process are fixtures. It covers selection, drop, clipboard paste, safe preview/history reload, draft CAS/expiry, abort/retry and lost responses, count/byte/type/ownership denials, and exact fixture input references. The fixture profile skips filesystem publication only when no trusted storage socket is configured. With the Linux storage socket, the real supervisor still publishes through the quota helper; only its external Codex process is a fixture. Neither configuration establishes model understanding.

On the dedicated supported host configured by the [Linux verification guide](linux-verification.md):

```sh
HARBOR_TEST_XFS_MOUNT=/srv/harbor-verification pnpm test:isolation --attachments
```

This lane creates its own XFS quota slots, database, API, OIDC fixture and HTTPS proxy. It tests real uploads and association, deferred database COMMIT rejection during trusted publication, same-inode retry, content/directory identity rejection, and a pinned native runner reading its session-only mount while writes/unlinks and cross-session paths fail. Its capability catalog is an explicit external fixture. Evidence includes source digests and environment versions under `.test-runs/`. The lane does not simulate physical power loss.

With a separately provisioned dedicated account key in `HARBOR_TEST_OPENAI_API_KEY` and the same Linux prerequisites:

```sh
pnpm test:live --attachments
```

The live variant discovers an image/text-capable model, submits only a generated red PNG and synthetic text, and requires a bounded completed response identifying the color and exact text. Without the dedicated key it exits 2 before making a model request. Normal Codex credentials are never used. This mandatory gate remains [blocked](../../issues/2026-09-07-171225-live-runtime-credentials.md).

For P009, register all three database tables and complete project quota units including materialized attachment directories. Restore must preserve blobs and associations while revalidating/rebinding materialized directory/file identities before launching a runner. Old releases that cannot interpret this schema must deny new attachment writes; rollback must preserve existing blobs and native copies. See the [canonical proposal](../../design/proposals/005-attachments-and-rich-input.md) for the owning retention and backup contract.
