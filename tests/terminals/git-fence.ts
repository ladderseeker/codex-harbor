import { expect, type APIResponse } from "@playwright/test";
import type { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export async function terminalGitFence(h: {
  db: Pool;
  command: (route: string, data: unknown, key?: string) => Promise<APIResponse>;
  t: any;
}) {
  const { db, command, t } = h;
  const stop = async (term: any) => {
    const response = await command(`/terminals/${term.id}/terminate`, {
      generation: Number(term.generation),
    });
    expect(response.status(), await response.text()).toBe(202);
    await expect
      .poll(
        async () =>
          (
            await db.query("SELECT retired FROM terminals WHERE id=$1", [
              term.id,
            ])
          ).rows[0].retired,
        { timeout: 20000 },
      )
      .toBe(true);
  };
  await stop(t);
  const local = (
    await db.query("SELECT * FROM workspaces WHERE id=$1", [t.workspace_id])
  ).rows[0];
  await chmod(local.canonical_path, 0o777);
  await writeFile(
    path.join(local.canonical_path, "tracked.txt"),
    "shared Git fixture\n",
  );
  const seed = [
    "run",
    "--rm",
    "--network=none",
    "--user=10001:10001",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--mount",
    `type=bind,source=${local.canonical_path},target=/source`,
    "--entrypoint",
    "git",
    "codex-harbor-git:2.39.5-p003",
  ];
  for (const args of [
    ["init", "/source"],
    ["-C", "/source", "add", "."],
    [
      "-C",
      "/source",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "Fixture",
    ],
  ])
    execFileSync("docker", [...seed, ...args], {
      stdio: "pipe",
      timeout: 30000,
    });
  const createWorkspace = async (name: string) => {
    const response = await command(`/projects/${t.project_id}/workspaces`, {
      name,
      kind: "worktree",
      sourceWorkspaceId: local.id,
      dirtyPolicy: "exclude",
    });
    expect(response.status(), await response.text()).toBe(200);
    const w = (await response.json()).workspace;
    await expect
      .poll(
        async () =>
          (await db.query("SELECT state FROM workspaces WHERE id=$1", [w.id]))
            .rows[0].state,
        { timeout: 40000 },
      )
      .toBe("ready");
    return (await db.query("SELECT * FROM workspaces WHERE id=$1", [w.id]))
      .rows[0];
  };
  const a = await createWorkspace("Git writer A"),
    b = await createWorkspace("Terminal B");
  expect(a.common_path).toBeTruthy();
  expect(b.common_path).toBe(a.common_path);
  expect(b.canonical_path).not.toBe(a.canonical_path);
  const operation = randomUUID();
  // Inject committed, run-owned lifecycle checkpoints, not a simulated helper
  // process. The API, project locks, terminal dispatcher and native PTY are real.
  await db.query(
    "INSERT INTO file_operations(id,workspace_id,project_id,actor_hash,kind,state,request_hash) VALUES($1,$2,$3,$4,'stage','dispatching','fixture-git-fence')",
    [operation, a.id, t.project_id, t.actor_hash],
  );
  await db.query(
    "UPDATE workspaces SET writer_kind='file',writer_owner_id=$2,writer_generation=NULL WHERE id=$1",
    [a.id, operation],
  );
  const response = await command(`/workspaces/${b.id}/terminals`, {
    permissionProfile: "workspace-write",
    cols: 80,
    rows: 24,
  });
  expect(response.status(), await response.text()).toBe(202);
  const queued = (await response.json()).terminal;
  try {
    for (const kind of ["stage", "unstage", "commit"]) {
      for (const state of ["dispatching", "uncertain"]) {
        await db.query(
          "UPDATE file_operations SET kind=$2,state=$3 WHERE id=$1",
          [operation, kind, state],
        );
        await new Promise((resolve) => setTimeout(resolve, 650));
        expect(
          (
            await db.query(
              "SELECT state,writer_epoch FROM terminals WHERE id=$1",
              [queued.id],
            )
          ).rows[0],
        ).toEqual({ state: "queued", writer_epoch: null });
        expect(
          (
            await db.query(
              "SELECT writer_owner_id FROM workspaces WHERE id=$1",
              [b.id],
            )
          ).rows[0].writer_owner_id,
        ).toBeNull();
      }
    }
    // A run-owned settled lifecycle checkpoint releases only its own reservation.
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        t.project_id,
      ]);
      await client.query(
        "UPDATE file_operations SET acknowledged_at=clock_timestamp() WHERE id=$1",
        [operation],
      );
      await client.query(
        "UPDATE workspaces SET writer_kind=NULL,writer_owner_id=NULL WHERE id=$1 AND writer_owner_id=$2",
        [a.id, operation],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await expect
      .poll(
        async () =>
          (
            await db.query("SELECT state FROM terminals WHERE id=$1", [
              queued.id,
            ])
          ).rows[0].state,
        { timeout: 20000 },
      )
      .toBe("running");
    expect(
      (
        await db.query("SELECT state FROM file_operations WHERE id=$1", [
          operation,
        ])
      ).rows[0].state,
    ).toBe("uncertain");
    for (const kind of ["stage", "unstage", "commit"]) {
      await db.query(
        "UPDATE file_operations SET state='queued',kind=$2,acknowledged_at=NULL,epoch=NULL WHERE id=$1",
        [operation, kind],
      );
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(
        (
          await db.query(
            "SELECT state,epoch FROM file_operations WHERE id=$1",
            [operation],
          )
        ).rows[0],
      ).toEqual({ state: "queued", epoch: null });
      expect(
        (
          await db.query("SELECT writer_owner_id FROM workspaces WHERE id=$1", [
            a.id,
          ])
        ).rows[0].writer_owner_id,
      ).toBeNull();
      expect(
        (await db.query("SELECT state FROM terminals WHERE id=$1", [queued.id]))
          .rows[0].state,
      ).toBe("running");
    }
    await db.query("DELETE FROM file_operations WHERE id=$1", [operation]);
    await stop(queued);
  } finally {
    await db.query(
      "UPDATE workspaces SET writer_kind=NULL,writer_owner_id=NULL WHERE id=$1 AND writer_owner_id=$2",
      [a.id, operation],
    );
    await db.query("DELETE FROM file_operations WHERE id=$1", [operation]);
  }
}
