import { expect, request, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
/** A real dispatcher waits on a project lock until its accepted PAT expires. */
export async function previewQueuedAuthority(h: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  csrf: string;
  previewId: string;
  supervisor: ChildProcess;
}) {
  const p = (
    await h.db.query("SELECT * FROM previews WHERE id=$1", [h.previewId])
  ).rows[0];
  const r = await h.context.request.post(
    h.origin + "/api/v1/security/api-tokens",
    {
      headers: {
        Origin: h.origin,
        "X-CSRF-Token": h.csrf,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data: {
        name: "Preview expiry gate",
        scopes: ["previews:read", "previews:manage", "execute"],
        projectIds: [p.project_id],
        permissionProfile: "read-only",
        expiresInDays: 1,
      },
    },
  );
  expect(r.status()).toBe(200);
  const token = await r.json();
  const api = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: "Bearer " + token.secret },
    }),
    locker = await h.db.connect();
  let paused = false;
  try {
    h.supervisor.kill("SIGSTOP");
    paused = true;
    expect(
      (
        await api.post(h.origin + `/api/v1/previews/${p.id}/start`, {
          headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
          data: { expectedRevision: p.revision },
        })
      ).status(),
    ).toBe(202);
    const queued = (
      await h.db.query("SELECT * FROM previews WHERE id=$1", [p.id])
    ).rows[0];
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
      p.project_id,
    ]);
    await h.db.query(
      "UPDATE api_tokens SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",
      [queued.actor_hash.slice(4)],
    );
    h.supervisor.kill("SIGCONT");
    paused = false;
    await expect
      .poll(
        async () =>
          Number(
            (
              await h.db.query(
                "SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM projects WHERE id=$1 FOR UPDATE%' ",
              )
            ).rows[0].count,
          ),
        { timeout: 5000 },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (
            await h.db.query(
              "SELECT expires_at<=clock_timestamp() expired FROM api_tokens WHERE id=$1",
              [queued.actor_hash.slice(4)],
            )
          ).rows[0].expired,
        { timeout: 5000 },
      )
      .toBe(true);
    await locker.query("COMMIT");
    await expect
      .poll(
        async () =>
          (await h.db.query("SELECT state FROM previews WHERE id=$1", [p.id]))
            .rows[0].state,
        { timeout: 10000 },
      )
      .toBe("failed");
    const final = (
      await h.db.query("SELECT * FROM previews WHERE id=$1", [p.id])
    ).rows[0];
    expect(final.failure_code).toBe("TOKEN_INVALID");
    expect(final.retired).toBe(true);
    expect(final.lease_epoch).toBeNull();
    expect(final.runner_id).toBeNull();
    expect(final.relay_id).toBeNull();
    expect(
      Number(
        (
          await h.db.query(
            "SELECT count(*) FROM preview_logs WHERE preview_id=$1 AND generation=$2",
            [p.id, queued.generation],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
  } finally {
    if (paused) h.supervisor.kill("SIGCONT");
    await locker.query("ROLLBACK");
    locker.release();
    await api.dispose();
  }
}
