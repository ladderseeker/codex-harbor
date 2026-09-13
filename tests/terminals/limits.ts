import { openProjectTools } from "../e2e/navigation.ts";
import {
  expect,
  type BrowserContext,
  type Page,
  type APIResponse,
} from "@playwright/test";
import type { Pool } from "pg";
import type { ChildProcess } from "node:child_process";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
export async function terminalLimits(h: {
  context: BrowserContext;
  page: Page;
  db: Pool;
  origin: string;
  t: any;
  supervisor: ChildProcess;
  command: (route: string, data: unknown, key?: string) => Promise<APIResponse>;
}) {
  const { page, db, origin, t, supervisor, command } = h;
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const seeds: string[] = [],
    sockets: WebSocket[] = [];
  const seed = async (
    projectId: string,
    workspaceId: string,
    n: number,
    state = "interrupted",
  ) => {
    const ids = Array.from({ length: n }, () => randomUUID());
    seeds.push(...ids);
    await db.query(
      "INSERT INTO terminals(id,project_id,workspace_id,actor_hash,permission_profile,state,retired) SELECT unnest($1::uuid[]),$2,$3,$4,'read-only',$5,$6",
      [ids, projectId, workspaceId, t.actor_hash, state, state !== "running"],
    );
    return ids;
  };
  const create = (workspace = t.workspace_id) =>
    command(`/workspaces/${workspace}/terminals`, {
      permissionProfile: "read-only",
      cols: 80,
      rows: 24,
    });
  const clear = async () => {
    await db.query("DELETE FROM terminals WHERE id=ANY($1::uuid[])", [
      seeds.splice(0),
    ]);
  };
  const root = (
    await db.query("SELECT root_id FROM projects WHERE id=$1", [t.project_id])
  ).rows[0].root_id;
  try {
    // Synthetic metadata reaches exact bounded capacities without claiming 256
    // executed shells. All admission/stream/dispatcher code remains real.
    const count = Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM terminals WHERE project_id=$1",
          [t.project_id],
        )
      ).rows[0].n,
    );
    await seed(t.project_id, t.workspace_id, 64 - count);
    let rejected = await create();
    expect(rejected.status()).toBe(429);
    expect((await rejected.json()).error.code).toBe("TERMINAL_RECORD_LIMIT");
    await clear();
    const resources = [{ project: t.project_id, workspace: t.workspace_id }];
    for (let i = 0; i < 4; i++) {
      const r = await command("/projects", {
        name: "Terminal bound " + i,
        rootId: root,
        path: "terminal-bound-" + randomUUID(),
        create: true,
      });
      expect(r.status(), await r.text()).toBe(200);
      const p = (await r.json()).project;
      const w = (
        await db.query(
          "SELECT id FROM workspaces WHERE project_id=$1 AND kind='local'",
          [p.id],
        )
      ).rows[0];
      resources.push({ project: p.id, workspace: w.id });
    }
    for (let i = 0; i < resources.length; i++)
      await seed(
        resources[i].project,
        resources[i].workspace,
        (i === 4 ? 4 : 63) - (i === 0 ? count : 0),
      );
    expect(
      (await db.query("SELECT count(*) AS n FROM terminals")).rows[0].n,
    ).toBe("256");
    rejected = await create(resources[4].workspace);
    expect(rejected.status()).toBe(429);
    expect((await rejected.json()).error.code).toBe("TERMINAL_RECORD_LIMIT");
    await clear();
    await seed(t.project_id, t.workspace_id, 4, "running");
    const queued = await create(resources[1].workspace);
    expect(queued.status()).toBe(202);
    const q = (await queued.json()).terminal;
    await new Promise((r) => setTimeout(r, 600));
    expect(
      (
        await db.query("SELECT state,writer_epoch FROM terminals WHERE id=$1", [
          q.id,
        ])
      ).rows[0],
    ).toEqual({ state: "queued", writer_epoch: null });
    await clear();
    await expect
      .poll(
        async () =>
          (await db.query("SELECT state FROM terminals WHERE id=$1", [q.id]))
            .rows[0].state,
        { timeout: 20000 },
      )
      .toBe("running");
    await command(`/terminals/${q.id}/terminate`, { generation: q.generation });
    await expect
      .poll(
        async () =>
          (await db.query("SELECT retired FROM terminals WHERE id=$1", [q.id]))
            .rows[0].retired,
        { timeout: 20000 },
      )
      .toBe(true);
    const views = await seed(t.project_id, t.workspace_id, 5);
    const actors: string[] = [];
    for (let i = 0; i < 3; i++) {
      const issued = await command("/security/api-tokens", {
        name: "Viewer limit " + i,
        scopes: ["terminal:read"],
        projectIds: [t.project_id],
        permissionProfile: "read-only",
        expiresInDays: 1,
      });
      expect(issued.status()).toBe(200);
      actors.push((await issued.json()).secret);
    }
    const connect = async (id: string, actor: number, allow: boolean) => {
      const s = new WebSocket(
        origin.replace("https:", "wss:") + `/api/v1/terminals/${id}/stream`,
        {
          rejectUnauthorized: false,
          headers: { Authorization: "Bearer " + actors[actor] },
        },
      );
      sockets.push(s);
      s.on("error", () => {});
      const result = await new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Viewer capacity deadline")),
          5000,
        );
        s.once("open", () => {
          clearTimeout(timer);
          resolve(true);
        });
        s.once("close", () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
      expect(result).toBe(allow);
      if (allow)
        s.send(
          JSON.stringify({
            type: "hello",
            version: 1,
            generation: 1,
            cursor: 0,
          }),
        );
    };
    for (let v = 0; v < 2; v++)
      for (let n = 0; n < 4; n++) await connect(views[v], 0, true);
    await connect(views[2], 0, false); // ninth viewer for this actor
    for (let v = 2; v < 4; v++)
      for (let n = 0; n < 4; n++) await connect(views[v], 1, true);
    await connect(views[4], 2, false); // seventeenth viewer for the instance
  } finally {
    for (const s of sockets) s.terminate();
    await clear();
    await openProjectTools(page);
    await page
      .getByRole("button", { name: "Open terminals", exact: true })
      .click();
  }
}
