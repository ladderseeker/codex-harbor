import { expect, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { restoreInstalledModules } from "../../packages/storage/src/deployment-modules.ts";
/** Real API/PG/supervisor; SQL supplies explicit fault preconditions. */
export async function previewLifecycle(h: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  csrf: string;
  supervisor: ChildProcess;
  previewId: string;
}) {
  const read = async () =>
    (await h.db.query("SELECT * FROM previews WHERE id=$1", [h.previewId]))
      .rows[0];
  const command = async (
    suffix: string,
    body: unknown,
    key = `${Date.now()}:${randomUUID()}`,
  ) => {
    const response = await h.context.request.post(
      h.origin + "/api/v1/previews/" + h.previewId + suffix,
      {
        headers: {
          Origin: h.origin,
          "X-CSRF-Token": h.csrf,
          "Idempotency-Key": key,
        },
        data: body,
      },
    );
    return { status: response.status(), body: await response.json() };
  };
  const previous = await read();
  h.supervisor.kill("SIGSTOP");
  try {
    const key = `${Date.now()}:${randomUUID()}`;
    const first = await command(
      "/start",
      { expectedRevision: previous.revision },
      key,
    );
    expect(first.status).toBe(202);
    expect(
      await command("/start", { expectedRevision: previous.revision }, key),
    ).toEqual(first);
    await h.db.query("UPDATE deployment_state SET maintenance=true");
  } finally {
    h.supervisor.kill("SIGCONT");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const queued = await read();
  expect(queued.state).toBe("queued");
  expect(queued.retired).toBe(true);
  expect(queued.generation).not.toBe(previous.generation);
  expect(queued.hostname).not.toBe(previous.hostname);
  expect(
    (await command("/start", { expectedRevision: queued.revision })).status,
  ).toBe(503);
  await h.db.query("UPDATE deployment_state SET maintenance=false");
  await expect
    .poll(async () => (await read()).state, { timeout: 30000 })
    .toBe("ready");
  expect(
    (
      await command("/stop", {
        expectedGeneration: Number(previous.generation),
      })
    ).status,
  ).toBe(409);
  expect((await read()).state).toBe("ready");
  expect(
    (await command("/stop", { expectedGeneration: Number(queued.generation) }))
      .status,
  ).toBe(202);
  await expect
    .poll(async () => (await read()).retired, { timeout: 15000 })
    .toBe(true);
  // The real fixed transform in a rollback-only synthetic transaction establishes
  // metadata behavior, not filesystem/off-host restore or native activation.
  const db = await h.db.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "UPDATE previews SET state='ready',retired=false,lease_epoch=nextval('runtime_generation_seq') WHERE id=$1",
      [h.previewId],
    );
    await db.query(
      "INSERT INTO preview_readers(owner_id,workspace_id,epoch,generation) SELECT id,workspace_id,lease_epoch,generation FROM previews WHERE id=$1",
      [h.previewId],
    );
    const before = (
      await db.query("SELECT * FROM previews WHERE id=$1", [h.previewId])
    ).rows[0];
    await restoreInstalledModules(db, "public-source-fixture");
    const restored = (
      await db.query("SELECT * FROM previews WHERE id=$1", [h.previewId])
    ).rows[0];
    expect(restored.state).toBe("stopped");
    expect(restored.retired).toBe(true);
    expect(restored.generation).not.toBe(before.generation);
    expect(restored.lease_epoch).toBeNull();
    expect(restored.runner_id).toBeNull();
    expect(restored.relay_id).toBeNull();
    expect(restored.output_lost).toBe(true);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM preview_readers WHERE owner_id=$1",
          [h.previewId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM preview_grants WHERE NOT revoked",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query(
          "SELECT historical->>'state' state FROM deployment_restored_operations WHERE kind='preview' AND id=$1",
          [h.previewId],
        )
      ).rows[0].state,
    ).toBe("ready");
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
}
