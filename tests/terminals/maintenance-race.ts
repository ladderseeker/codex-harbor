/** Real API/supervisor transactions contend with an administrator freeze. */
import { expect, type APIResponse } from "@playwright/test";
import type { Pool } from "pg";
import type { ChildProcess } from "node:child_process";
export async function terminalMaintenanceRace(h: {
  db: Pool;
  t: any;
  supervisor: ChildProcess;
  command: (route: string, data: unknown) => Promise<APIResponse>;
}) {
  const { db, t, supervisor, command } = h;
  const admin = await db.connect(),
    probe = await db.connect();
  let resumed = true;
  try {
    // Pause only the test-owned supervisor; admission still uses the real API.
    supervisor.kill("SIGSTOP");
    resumed = false;
    const row = (await db.query("SELECT * FROM terminals WHERE id=$1", [t.id]))
      .rows[0];
    const sequence = Number(row.input_sequence) + 1;
    const input = await command(`/terminals/${t.id}/input`, {
      version: 1,
      generation: Number(t.generation),
      epoch: Number(row.controller_epoch),
      controllerId: row.controller_id,
      sequence,
      data: Buffer.from("printf 'MAINTENANCE_%s\\n' FORBIDDEN\n").toString(
        "base64",
      ),
    });
    expect(input.status(), await input.text()).toBe(200);
    await admin.query("BEGIN");
    await admin.query("UPDATE deployment_state SET maintenance=true");
    supervisor.kill("SIGCONT");
    resumed = true;
    // A pending final wire grant must wait at deployment, before resources. A
    // second API mutation also waits; committing the freeze rejects both.
    const control = command(`/terminals/${t.id}/control`, {
      generation: Number(t.generation),
      expectedEpoch: Number(row.controller_epoch),
      acknowledgeUncertainInput: false,
    });
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='p006-supervisor' AND wait_event_type='Lock' AND query LIKE '%deployment_state%FOR SHARE%'",
            )
          ).rows[0].n,
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
    await probe.query("BEGIN");
    await probe.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE NOWAIT", [
      t.project_id,
    ]);
    await probe.query(
      "SELECT id FROM workspaces WHERE id=$1 FOR UPDATE NOWAIT",
      [t.workspace_id],
    );
    await probe.query(
      "SELECT id FROM terminals WHERE id=$1 FOR UPDATE NOWAIT",
      [t.id],
    );
    await probe.query("COMMIT");
    await admin.query("COMMIT");
    const denied = await control;
    expect(denied.status(), await denied.text()).toBe(503);
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT state FROM terminal_input WHERE terminal_id=$1 AND sequence=$2",
              [t.id, sequence],
            )
          ).rows[0].state,
        { timeout: 10000 },
      )
      .toBe("denied");
    const output = (
      await db.query("SELECT bytes FROM terminal_output WHERE terminal_id=$1", [
        t.id,
      ])
    ).rows
      .map((r) => r.bytes.toString())
      .join("");
    expect(output).not.toContain("MAINTENANCE_FORBIDDEN");
    expect(
      (await db.query("SELECT state FROM terminals WHERE id=$1", [t.id]))
        .rows[0].state,
    ).toBe("running");
  } finally {
    if (!resumed) supervisor.kill("SIGCONT");
    await admin.query("ROLLBACK").catch(() => {});
    await probe.query("ROLLBACK").catch(() => {});
    admin.release();
    probe.release();
    await db.query("UPDATE deployment_state SET maintenance=false");
  }
}
