import { terminalMaintenanceRace } from "./maintenance-race.ts";
import type { ChildProcess } from "node:child_process";
import { expect, type APIResponse } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { transaction } from "../../packages/storage/src/index.ts";
import {
  installedModuleStatus,
  restoreInstalledModules,
} from "../../packages/storage/src/deployment-modules.ts";
export async function terminalModules(h: {
  db: Pool;
  supervisor: ChildProcess;
  t: any;
  command: (route: string, data: unknown, key?: string) => Promise<APIResponse>;
}) {
  const { db, t, command } = h;
  await terminalMaintenanceRace(h);
  const create = () =>
    command(`/workspaces/${t.workspace_id}/terminals`, {
      permissionProfile: "read-only",
      cols: 80,
      rows: 24,
    });
  const secondResponse = await create();
  expect(secondResponse.status()).toBe(202);
  const second = (await secondResponse.json()).terminal;
  const file = randomUUID();
  await db.query(
    "INSERT INTO file_operations(id,project_id,workspace_id,actor_hash,kind,state,request_hash,payload) VALUES($1,$2,$3,$4,'save','queued','owned-modules-checkpoint','{}')",
    [file, t.project_id, t.workspace_id, t.actor_hash],
  );
  await db.query("UPDATE deployment_state SET maintenance=true");
  try {
    expect((await create()).status()).toBe(503);
    const controller = (
      await db.query("SELECT * FROM terminals WHERE id=$1", [t.id])
    ).rows[0];
    const frame = {
      version: 1,
      generation: Number(t.generation),
      epoch: Number(controller.controller_epoch),
      controllerId: controller.controller_id,
    };
    const input = await command(`/terminals/${t.id}/input`, {
      ...frame,
      sequence: Number(controller.input_sequence) + 1,
      data: Buffer.from("printf SHOULD_NEVER_DISPATCH\\n").toString("base64"),
    });
    expect(input.status()).toBe(503);
    expect((await input.json()).error.code).toBe("MAINTENANCE");
    expect(
      (
        await command(`/terminals/${t.id}/control`, {
          generation: Number(t.generation),
          expectedEpoch: Number(controller.controller_epoch),
          acknowledgeUncertainInput: false,
        })
      ).status(),
    ).toBe(503);
    await new Promise((r) => setTimeout(r, 1000));
    expect(
      (await db.query("SELECT state FROM terminals WHERE id=$1", [second.id]))
        .rows[0].state,
    ).toBe("queued");
    expect(
      (await db.query("SELECT state FROM file_operations WHERE id=$1", [file]))
        .rows[0].state,
    ).toBe("queued");
    const before = await installedModuleStatus(db);
    expect(before.activeTerminals).toBe(1);
    expect(before.queuedTerminals).toBe(1);
    expect(before.queuedFiles).toBe(1);
    const stopped = await command(`/terminals/${t.id}/terminate`, {
      generation: Number(t.generation),
    });
    expect(stopped.status(), await stopped.text()).toBe(202);
    await expect
      .poll(
        async () =>
          (await db.query("SELECT retired FROM terminals WHERE id=$1", [t.id]))
            .rows[0].retired,
        { timeout: 20000 },
      )
      .toBe(true);
    const after = await installedModuleStatus(db);
    expect(after.activeTerminals).toBe(0);
    expect(after.activeFiles).toBe(0);
    expect(after.queuedTerminals).toBe(1);
    expect(after.queuedFiles).toBe(1);
    // Local module rebind contract, not a backup transfer or full restore. Runtime
    // admission is disabled before injecting an unresolved historical terminal.
    await db.query("UPDATE deployment_state SET activation_required=true");
    await db.query(
      "UPDATE terminals SET state='uncertain',retired=false,controller_actor=$2,controller_id=$3,controller_until=clock_timestamp()+interval '1 hour',controller_epoch=controller_epoch+1 WHERE id=$1",
      [t.id, t.actor_hash, randomUUID()],
    );
    await db.query(
      "UPDATE workspaces SET writer_kind='terminal',writer_owner_id=$2,writer_generation=NULL WHERE id=$1",
      [t.workspace_id, t.id],
    );
    await db.query(
      "UPDATE terminals t SET writer_epoch=w.writer_epoch FROM workspaces w WHERE t.id=$1 AND w.id=t.workspace_id",
      [t.id],
    );
    const old = (await db.query("SELECT * FROM terminals WHERE id=$1", [t.id]))
      .rows[0];
    await db.query(
      "INSERT INTO terminal_input(terminal_id,epoch,sequence,actor_hash,controller_id,hash,bytes,state) VALUES($1,$2,999,$3,$4,'owned-restore-hash',$5,'dispatching')",
      [
        t.id,
        old.controller_epoch,
        t.actor_hash,
        old.controller_id,
        Buffer.from("DO_NOT_REPLAY"),
      ],
    );
    await transaction(db, (client) =>
      restoreInstalledModules(client, "synthetic-source-instance"),
    );
    const restored = (
      await db.query("SELECT * FROM terminals WHERE id=$1", [t.id])
    ).rows[0];
    expect(restored.state).toBe("uncertain");
    expect(restored.retired).toBe(false);
    expect(restored.controller_id).toBeNull();
    expect(restored.controller_until).toBeNull();
    expect(restored.generation).not.toBe(old.generation);
    expect(restored.writer_epoch).not.toBe(old.writer_epoch);
    expect(
      (
        await db.query(
          "SELECT state,bytes FROM terminal_input WHERE terminal_id=$1 AND sequence=999",
          [t.id],
        )
      ).rows[0],
    ).toEqual({ state: "uncertain", bytes: null });
    expect(
      (
        await db.query("SELECT state,retired FROM terminals WHERE id=$1", [
          second.id,
        ])
      ).rows[0],
    ).toEqual({ state: "interrupted", retired: true });
    expect(
      (await db.query("SELECT state FROM file_operations WHERE id=$1", [file]))
        .rows[0].state,
    ).toBe("failed");
    expect(
      (
        await db.query(
          "SELECT historical->>'state' AS state FROM deployment_restored_operations WHERE kind='terminal' AND id=$1",
          [t.id],
        )
      ).rows[0].state,
    ).toBe("uncertain");
    await new Promise((r) => setTimeout(r, 700));
    expect(
      (await db.query("SELECT state FROM terminals WHERE id=$1", [t.id]))
        .rows[0].state,
    ).toBe("uncertain");
    await db.query("UPDATE deployment_state SET activation_required=false");
    const release = await command(`/terminals/${t.id}/terminate`, {
      generation: Number(restored.generation),
    });
    expect(release.status(), await release.text()).toBe(202);
    await expect
      .poll(
        async () =>
          (await db.query("SELECT retired FROM terminals WHERE id=$1", [t.id]))
            .rows[0].retired,
        { timeout: 20000 },
      )
      .toBe(true);
    expect(
      (
        await db.query("SELECT writer_owner_id FROM workspaces WHERE id=$1", [
          t.workspace_id,
        ])
      ).rows[0].writer_owner_id,
    ).toBeNull();
  } finally {
    await db.query(
      "UPDATE deployment_state SET maintenance=false,activation_required=false",
    );
  }
}
