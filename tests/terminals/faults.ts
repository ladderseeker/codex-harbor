import {
  expect,
  type BrowserContext,
  type APIResponse,
} from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
export async function terminalFaults(h: {
  context: BrowserContext;
  db: Pool;
  origin: string;
  csrf: string;
  t: any;
  command: (route: string, data: unknown, key?: string) => Promise<APIResponse>;
}) {
  const { context, db, origin, csrf, t, command } = h;
  const create = async () => {
    const key = `${Date.now()}:${randomUUID()}`,
      route = `/workspaces/${t.workspace_id}/terminals`,
      body = { permissionProfile: "read-only", cols: 80, rows: 24 };
    const response = await command(route, body, key);
    expect(response.status(), await response.text()).toBe(202);
    const terminal = (await response.json()).terminal;
    expect((await (await command(route, body, key)).json()).terminal.id).toBe(
      terminal.id,
    );
    expect((await command(route, { ...body, cols: 81 }, key)).status()).toBe(
      409,
    );
    return terminal;
  };
  const row = async (id: string) =>
    (await db.query("SELECT * FROM terminals WHERE id=$1", [id])).rows[0];
  const flood = await create();
  await expect
    .poll(async () => (await row(flood.id)).state, { timeout: 20000 })
    .toBe("running");
  const queued = [await create(), await create()];
  expect(
    (
      await command(`/workspaces/${t.workspace_id}/terminals`, {
        permissionProfile: "read-only",
        cols: 80,
        rows: 24,
      })
    ).status(),
  ).toBe(429);
  for (const q of queued) {
    expect((await row(q.id)).state).toBe("queued");
    const stopped = await command(`/terminals/${q.id}/terminate`, {
      generation: q.generation,
    });
    expect(stopped.status()).toBe(202);
    expect((await row(q.id)).retired).toBe(true);
  }
  const granted = await command(`/terminals/${flood.id}/control`, {
    generation: flood.generation,
    expectedEpoch: 0,
    acknowledgeUncertainInput: false,
  });
  expect(granted.status()).toBe(200);
  const c = (await granted.json()).control;
  const input = await context.request.post(
    origin + `/api/v1/terminals/${flood.id}/input`,
    {
      headers: { Origin: origin, "X-CSRF-Token": csrf },
      data: {
        version: 1,
        generation: flood.generation,
        epoch: c.epoch,
        controllerId: c.controllerId,
        sequence: 1,
        data: Buffer.from(
          "node -e 'process.stdout.write(Buffer.alloc(4194304,120))'\n",
        ).toString("base64"),
      },
    },
  );
  expect(input.status()).toBe(200);
  try {
    await expect
      .poll(async () => (await row(flood.id)).retired, { timeout: 20000 })
      .toBe(true);
  } catch (error) {
    const f = await row(flood.id);
    const bytes = (
      await db.query(
        "SELECT bytes FROM terminal_output WHERE terminal_id=$1 ORDER BY sequence DESC LIMIT 1",
        [flood.id],
      )
    ).rows[0]?.bytes;
    throw Error(
      "Output flood failed: " +
        JSON.stringify({
          state: f.state,
          failure: f.failure_code,
          retired: f.retired,
          seq: f.output_sequence,
          floor: f.output_floor,
          input: (
            await db.query(
              "SELECT state,failure_code FROM terminal_input WHERE terminal_id=$1",
              [flood.id],
            )
          ).rows,
          tail: bytes?.toString().slice(-200),
        }),
    );
  }
  const failed = await row(flood.id);
  expect(failed.state).toBe("interrupted");
  expect(failed.failure_code).toBe("OUTPUT_LIMIT");
  expect(failed.output_lost).toBe(true);
  expect(Number(failed.output_floor)).toBeGreaterThan(0);
  expect(
    (
      await db.query("SELECT writer_owner_id FROM workspaces WHERE id=$1", [
        t.workspace_id,
      ])
    ).rows[0].writer_owner_id,
  ).toBe(null);
  const timed = await create();
  await expect
    .poll(async () => (await row(timed.id)).state, { timeout: 20000 })
    .toBe("running");
  await db.query(
    "UPDATE terminals SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1",
    [timed.id],
  );
  await expect
    .poll(async () => (await row(timed.id)).retired, { timeout: 20000 })
    .toBe(true);
  expect((await row(timed.id)).failure_code).toBe("LIFETIME_EXPIRED");
}
