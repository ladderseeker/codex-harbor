import {
  expect,
  request,
  type BrowserContext,
  type APIResponse,
} from "@playwright/test";
import type { Pool } from "pg";
import type { ChildProcess } from "node:child_process";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
export async function terminalSecurity(h: {
  context: BrowserContext;
  db: Pool;
  origin: string;
  csrf: string;
  t: any;
  supervisor: ChildProcess;
  command: (route: string, data: unknown, key?: string) => Promise<APIResponse>;
}) {
  const { context, db, origin, csrf, t, supervisor, command } = h;
  const base = `/terminals/${t.id}`;
  const fresh = async () =>
    (await (await context.request.get(origin + "/api/v1" + base)).json())
      .terminal;
  const control = async () => {
    const now = await fresh();
    const r = await command(base + "/control", {
      generation: Number(t.generation),
      expectedEpoch: now.controllerEpoch,
      acknowledgeUncertainInput: true,
    });
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).control;
  };
  let c = await control();
  const frame = (sequence: number, text: string, cc = c) => ({
    version: 1,
    generation: Number(t.generation),
    epoch: cc.epoch,
    controllerId: cc.controllerId,
    sequence,
    data: Buffer.from(text).toString("base64"),
  });
  const post = (suffix: string, data: unknown) =>
    context.request.post(origin + "/api/v1" + base + suffix, {
      headers: { Origin: origin, "X-CSRF-Token": csrf },
      data,
    });
  const input = frame(1, "printf 'ONCE_%s\\n' MAILBOX\n");
  const accepted = await post("/input", input);
  expect(accepted.status(), await accepted.text()).toBe(200);
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT state FROM terminal_input WHERE terminal_id=$1 AND epoch=$2 AND sequence=1",
            [t.id, c.epoch],
          )
        ).rows[0]?.state,
    )
    .toBe("delivered");
  expect((await (await post("/input", input)).json()).input.state).toBe(
    "delivered",
  );
  expect(
    (
      await post("/input", {
        ...input,
        data: Buffer.from("different\n").toString("base64"),
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await db.query(
        "SELECT bytes FROM terminal_input WHERE terminal_id=$1 AND epoch=$2 AND sequence=1",
        [t.id, c.epoch],
      )
    ).rows[0].bytes,
  ).toBe(null);
  const text = async () =>
    (
      await db.query(
        "SELECT bytes FROM terminal_output WHERE terminal_id=$1 ORDER BY sequence",
        [t.id],
      )
    ).rows
      .map((r) => r.bytes.toString())
      .join("");
  await expect
    .poll(async () => (await text()).split("ONCE_MAILBOX").length - 1)
    .toBe(1);
  // Real supervisor pause separates accepted mailbox state from final send.
  const stalledEpoch = c.epoch;
  supervisor.kill("SIGSTOP");
  try {
    const queued = await post(
      "/input",
      frame(2, "printf 'FORBIDDEN_%s\\n' OLD_CONTROLLER\n"),
    );
    expect(queued.status()).toBe(200);
    const old = c;
    c = await control();
    expect((await post("/input", frame(3, "x", old))).status()).toBe(409);
  } finally {
    supervisor.kill("SIGCONT");
  }
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT state FROM terminal_input WHERE terminal_id=$1 AND epoch=$2 AND sequence=2",
            [t.id, stalledEpoch],
          )
        ).rows[0]?.state,
    )
    .toBe("denied");
  expect(await text()).not.toContain("FORBIDDEN_OLD_CONTROLLER");
  for (const bad of ["", "%%%%", Buffer.alloc(4097, 97).toString("base64")])
    expect([400, 413]).toContain(
      (await post("/input", { ...frame(1, "a"), data: bad })).status(),
    );
  expect(
    (
      await post("/resize", {
        version: 1,
        generation: Number(t.generation),
        epoch: c.epoch,
        controllerId: c.controllerId,
        sequence: 1,
        cols: 241,
        rows: 24,
      })
    ).status(),
  ).toBe(400);
  // Browser CSRF/Origin checks apply equally to frame routes.
  expect(
    (
      await context.request.post(origin + "/api/v1" + base + "/input", {
        data: frame(1, "x"),
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post(origin + "/api/v1" + base + "/input", {
        data: frame(1, "x"),
        headers: { Origin: "https://untrusted.invalid", "X-CSRF-Token": csrf },
      })
    ).status(),
  ).toBe(403);
  // A real deferred COMMIT rejection after native write is uncertain, never
  // replayed. A distinct settlement COMMIT failure is repaired from retained
  // supervisor metadata after the database accepts commits again.
  c = await control();
  await db.query(
    `CREATE FUNCTION terminal_wire_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='dispatching' THEN RAISE EXCEPTION 'owned terminal wire commit fault'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER terminal_wire_fault AFTER UPDATE ON terminal_input DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION terminal_wire_fault()`,
  );
  try {
    const uncertainInput = frame(1, "printf 'WIRE_%s\\n' ONCE\n");
    expect((await post("/input", uncertainInput)).status()).toBe(200);
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT state FROM terminal_input WHERE terminal_id=$1 AND epoch=$2 AND sequence=1",
              [t.id, c.epoch],
            )
          ).rows[0]?.state,
      )
      .toBe("uncertain");
    expect((await fresh()).inputUncertain).toBe(true);
    expect(
      (await (await post("/input", uncertainInput)).json()).input.state,
    ).toBe("uncertain");
    await expect
      .poll(async () => (await text()).split("WIRE_ONCE").length - 1)
      .toBe(1);
  } finally {
    await db.query(
      "DROP TRIGGER terminal_wire_fault ON terminal_input; DROP FUNCTION terminal_wire_fault()",
    );
  }
  c = await control();
  await db.query(
    `CREATE FUNCTION terminal_settlement_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='delivered' THEN RAISE EXCEPTION 'owned terminal settlement fault'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER terminal_settlement_fault AFTER UPDATE ON terminal_input DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION terminal_settlement_fault()`,
  );
  try {
    expect(
      (
        await post("/input", frame(1, "printf 'SETTLED_%s\\n' ONCE\n"))
      ).status(),
    ).toBe(200);
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT state FROM terminal_input WHERE terminal_id=$1 AND epoch=$2 AND sequence=1",
              [t.id, c.epoch],
            )
          ).rows[0]?.state,
      )
      .toBe("dispatching");
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    await db.query(
      "DROP TRIGGER terminal_settlement_fault ON terminal_input; DROP FUNCTION terminal_settlement_fault()",
    );
  }
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT state FROM terminal_input WHERE terminal_id=$1 AND epoch=$2 AND sequence=1",
            [t.id, c.epoch],
          )
        ).rows[0]?.state,
    )
    .toBe("delivered");
  await expect
    .poll(async () => (await text()).split("SETTLED_ONCE").length - 1)
    .toBe(1);
  // Explicit machine capabilities never grant raw runtime or browser administration.
  const token = await command("/security/api-tokens", {
    name: "Terminal fixture",
    scopes: ["terminal:read", "terminal:control", "terminal:terminate"],
    projectIds: [t.project_id],
    permissionProfile: "read-only",
    expiresInDays: 1,
  });
  expect(token.status(), await token.text()).toBe(200);
  const issued = await token.json();
  const machine = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: "Bearer " + issued.secret },
  });
  try {
    expect((await machine.get(origin + "/api/v1" + base)).status()).toBe(200);
    expect((await machine.get(origin + "/api/v1/projects")).status()).toBe(403);
    expect(
      (
        await machine.post(origin + "/api/v1/command/exec", { data: {} })
      ).status(),
    ).toBe(403);
    const ws = new WebSocket(
      origin.replace("https:", "wss:") + "/api/v1" + base + "/stream",
      {
        rejectUnauthorized: false,
        headers: { Authorization: "Bearer " + issued.secret },
      },
    );
    ws.on("error", () => {});
    const messages: any[] = [];
    ws.on("message", (b) => messages.push(JSON.parse(b.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("unexpected-response", (_, r) =>
        reject(Error("Upgrade denied " + r.statusCode)),
      );
      ws.once("error", reject);
    });
    ws.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        generation: Number(t.generation),
        cursor: 0,
      }),
    );
    await expect
      .poll(() => messages.some((m) => m.type === "state"))
      .toBe(true);
    const closed = new Promise<number>((resolve) =>
      ws.once("close", (code) => resolve(code)),
    );
    const revoke = await context.request.post(
      origin + `/api/v1/security/api-tokens/${issued.token.id}/revoke`,
      {
        headers: {
          Origin: origin,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
        },
        data: {},
      },
    );
    expect(revoke.status(), await revoke.text()).toBe(200);
    await Promise.race([
      closed,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("Revoked terminal stream stayed open")),
          5000,
        ),
      ),
    ]);
    expect((await machine.get(origin + "/api/v1" + base)).status()).toBe(401);
    expect((await fresh()).state).toBe("running");
  } finally {
    await machine.dispose();
  }
}
