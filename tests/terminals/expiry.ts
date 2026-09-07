import {
  expect,
  request,
  type BrowserContext,
  type APIResponse,
} from "@playwright/test";
import type { Pool } from "pg";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
export async function terminalExpiry(h: {
  context: BrowserContext;
  db: Pool;
  origin: string;
  t: any;
  supervisor: ChildProcess;
  command: (route: string, data: unknown, key?: string) => Promise<APIResponse>;
}) {
  const { context, db, origin, t, supervisor, command } = h;
  const created = await command("/security/api-tokens", {
    name: "Terminal expiring fixture",
    scopes: ["terminal:read", "terminal:control"],
    projectIds: [t.project_id],
    permissionProfile: "read-only",
    expiresInDays: 1,
  });
  expect(created.status()).toBe(200);
  const token = await created.json();
  const machine = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: "Bearer " + token.secret },
  });
  const holder = await db.connect();
  let held = false;
  try {
    const current = (
      await (await machine.get(origin + `/api/v1/terminals/${t.id}`)).json()
    ).terminal;
    const acquired = await machine.post(
      origin + `/api/v1/terminals/${t.id}/control`,
      {
        headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
        data: {
          generation: Number(t.generation),
          expectedEpoch: current.controllerEpoch,
          acknowledgeUncertainInput: true,
        },
      },
    );
    expect(acquired.status(), await acquired.text()).toBe(200);
    const c = (await acquired.json()).control;
    supervisor.kill("SIGSTOP");
    await db.query(
      "UPDATE api_tokens SET expires_at=clock_timestamp()+interval '3 seconds' WHERE id=$1",
      [token.token.id],
    );
    const admitted = await machine.post(
      origin + `/api/v1/terminals/${t.id}/input`,
      {
        data: {
          version: 1,
          generation: Number(t.generation),
          epoch: c.epoch,
          controllerId: c.controllerId,
          sequence: 1,
          data: Buffer.from("printf 'EXPIRED_%s\\n' MUST_NOT_SEND\n").toString(
            "base64",
          ),
        },
      },
    );
    expect(admitted.status(), await admitted.text()).toBe(200);
    await holder.query("BEGIN");
    held = true;
    // Hold the actual final input-dispatch UPDATE after actor/resource grants.
    // Output flushes now share parent-first locks and may wait at an earlier
    // parent, so a workspace-only wait does not identify the wire boundary.
    await holder.query(
      "SELECT sequence FROM terminal_input WHERE terminal_id=$1 AND epoch=$2 AND sequence=1 FOR UPDATE",
      [t.id, c.epoch],
    );
    supervisor.kill("SIGCONT");
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT count(*) AS n FROM pg_stat_activity WHERE application_name='p006-supervisor' AND wait_event_type='Lock' AND query LIKE 'UPDATE terminal_input SET state=%'",
            )
          ).rows[0].n,
      )
      .toBe("1");
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT expires_at<=clock_timestamp() AS expired FROM api_tokens WHERE id=$1",
              [token.token.id],
            )
          ).rows[0].expired,
      )
      .toBe(true);
    await holder.query("COMMIT");
    held = false;
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
      .toBe("denied");
    expect(
      (
        await (
          await context.request.get(origin + `/api/v1/terminals/${t.id}`)
        ).json()
      ).terminal.state,
    ).toBe("running");
    expect(
      (
        await db.query(
          "SELECT bytes FROM terminal_output WHERE terminal_id=$1 ORDER BY sequence",
          [t.id],
        )
      ).rows
        .map((r) => r.bytes.toString())
        .join(""),
    ).not.toContain("EXPIRED_MUST_NOT_SEND");
  } finally {
    supervisor.kill("SIGCONT");
    if (held) await holder.query("ROLLBACK");
    holder.release();
    await machine.dispose();
  }
}
