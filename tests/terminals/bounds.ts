import {
  expect,
  type BrowserContext,
  type APIResponse,
} from "@playwright/test";
import type { Pool } from "pg";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { maintainTerminalOutput } from "../../packages/terminals/src/store.ts";
export async function terminalBounds(h: {
  context: BrowserContext;
  db: Pool;
  origin: string;
  csrf: string;
  t: any;
  supervisor: ChildProcess;
  showGap?: (id: string) => Promise<void>;
  command: (route: string, data: unknown, key?: string) => Promise<APIResponse>;
}) {
  const { context, db, origin, csrf, t, supervisor, command } = h;
  const base = `/terminals/${t.id}`,
    headers = { Origin: origin, "X-CSRF-Token": csrf };
  const current = (
    await (await context.request.get(origin + "/api/v1" + base)).json()
  ).terminal;
  const grant = await command(base + "/control", {
    generation: Number(t.generation),
    expectedEpoch: current.controllerEpoch,
    acknowledgeUncertainInput: true,
  });
  expect(grant.status(), await grant.text()).toBe(200);
  const c = (await grant.json()).control;
  const input = (sequence: number) =>
    context.request.post(origin + "/api/v1" + base + "/input", {
      headers,
      data: {
        version: 1,
        generation: Number(t.generation),
        epoch: c.epoch,
        controllerId: c.controllerId,
        sequence,
        data: Buffer.from("printf 'BOUNDED_%s\\n' INPUT\n").toString("base64"),
      },
    });
  const actor = (
    await db.query("SELECT controller_actor FROM terminals WHERE id=$1", [t.id])
  ).rows[0].controller_actor;
  supervisor.kill("SIGSTOP");
  try {
    // Synthetic retained/pending rows reach finite limits without flooding the
    // process. Only the subsequent accepted input is actually dispatched.
    await db.query(
      "INSERT INTO terminal_input(terminal_id,epoch,sequence,actor_hash,controller_id,hash,bytes,state) SELECT $1,$2,n,$3,$4,'owned-fixture',decode('61','hex'),'accepted' FROM generate_series(1,128) n",
      [t.id, c.epoch, actor, c.controllerId],
    );
    await db.query("UPDATE terminals SET input_sequence=128 WHERE id=$1", [
      t.id,
    ]);
    let r = await input(129);
    expect(r.status()).toBe(429);
    expect((await r.json()).error.code).toBe("INPUT_PENDING_LIMIT");
    await db.query(
      "DELETE FROM terminal_input WHERE terminal_id=$1 AND epoch=$2",
      [t.id, c.epoch],
    );
    await db.query(
      "INSERT INTO terminal_input(terminal_id,epoch,sequence,actor_hash,controller_id,hash,bytes,state) SELECT $1,$2,n,$3,$4,'owned-fixture',convert_to(repeat('a',4096),'UTF8'),'accepted' FROM generate_series(1,16) n",
      [t.id, c.epoch, actor, c.controllerId],
    );
    await db.query("UPDATE terminals SET input_sequence=16 WHERE id=$1", [
      t.id,
    ]);
    r = await input(17);
    expect(r.status()).toBe(429);
    expect((await r.json()).error.code).toBe("INPUT_PENDING_LIMIT");
    await db.query(
      "DELETE FROM terminal_input WHERE terminal_id=$1 AND epoch=$2",
      [t.id, c.epoch],
    );
    await db.query(
      "UPDATE terminals SET input_sequence=0,input_window=clock_timestamp(),input_bytes=262144 WHERE id=$1",
      [t.id],
    );
    r = await input(1);
    expect(r.status()).toBe(429);
    expect((await r.json()).error.code).toBe("INPUT_RATE_LIMIT");
    await db.query(
      "UPDATE terminals SET input_bytes=0,input_frame_window=clock_timestamp(),input_frames=20 WHERE id=$1",
      [t.id],
    );
    r = await input(1);
    expect(r.status()).toBe(429);
    expect((await r.json()).error.code).toBe("INPUT_RATE_LIMIT");
    await db.query(
      "UPDATE terminals SET input_frames=0,input_frame_window=NULL,input_sequence=200 WHERE id=$1",
      [t.id],
    );
    await db.query(
      "INSERT INTO terminal_input(terminal_id,epoch,sequence,actor_hash,controller_id,hash,state,settled_at) SELECT $1,$2,n,$3,$4,'owned-fixture','delivered',clock_timestamp() FROM generate_series(1,200) n",
      [t.id, c.epoch, actor, c.controllerId],
    );
    r = await input(201);
    expect(r.status(), await r.text()).toBe(200);
  } finally {
    supervisor.kill("SIGCONT");
  }
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT count(*) AS n FROM terminal_input WHERE terminal_id=$1",
            [t.id],
          )
        ).rows[0].n,
    )
    .toBe("128");
  const tooOld = await input(1);
  expect(tooOld.status()).toBe(410);
  expect((await tooOld.json()).error.code).toBe("INPUT_OUTCOME_EXPIRED");
  // A separate queued-then-cancelled record has no runtime. Exercise output
  // byte/count/age pruning and cursor gaps without altering a live sequence.
  const create = await command(`/workspaces/${t.workspace_id}/terminals`, {
    permissionProfile: "read-only",
    cols: 80,
    rows: 24,
  });
  expect(create.status()).toBe(202);
  const tail = (await create.json()).terminal;
  const cancel = await command(`/terminals/${tail.id}/terminate`, {
    generation: tail.generation,
  });
  expect(cancel.status()).toBe(202);
  expect((await cancel.json()).terminal.retired).toBe(true);
  await db.query(
    "INSERT INTO terminal_output(terminal_id,sequence,bytes) SELECT $1,n,convert_to(repeat('a',16384),'UTF8') FROM generate_series(1,140) n",
    [tail.id],
  );
  await db.query("UPDATE terminals SET output_sequence=140 WHERE id=$1", [
    tail.id,
  ]);
  let replay = await (
    await context.request.get(
      origin + `/api/v1/terminals/${tail.id}/output?cursor=0`,
    )
  ).json();
  expect(replay.gap).toBe(true);
  expect(replay.floor).toBe(12);
  expect(replay.chunks.length).toBe(16);
  expect(
    (
      await db.query(
        "SELECT sum(octet_length(bytes)) AS bytes FROM terminal_output WHERE terminal_id=$1",
        [tail.id],
      )
    ).rows[0].bytes,
  ).toBe("2097152");
  await db.query(
    "UPDATE terminal_output SET created_at=clock_timestamp()-interval '25 hours' WHERE terminal_id=$1",
    [tail.id],
  );
  await maintainTerminalOutput(db);
  expect(
    (
      await db.query(
        "SELECT count(*) AS n FROM terminal_output WHERE terminal_id=$1",
        [tail.id],
      )
    ).rows[0].n,
  ).toBe("0");
  replay = await (
    await context.request.get(
      origin + `/api/v1/terminals/${tail.id}/output?cursor=0`,
    )
  ).json();
  expect(replay.floor).toBe(140);
  expect(replay.chunks).toEqual([]);
  expect(
    (
      await context.request.get(
        origin + `/api/v1/terminals/${tail.id}/output?cursor=141`,
      )
    ).status(),
  ).toBe(400);
  await h.showGap?.(tail.id);
  const remove = await context.request.delete(
    origin + `/api/v1/terminals/${tail.id}`,
    {
      headers: {
        ...headers,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data: {},
    },
  );
  expect(remove.status()).toBe(200);
}
