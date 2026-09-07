import { expect, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export async function scheduleWorkspacesE2e(o: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  csrf: string;
  post: (route: string, data: unknown, key?: string) => Promise<any>;
  pauseSupervisor: () => void;
  resumeSupervisor: () => void;
  restartSupervisor: (whileStopped?: () => Promise<void>) => Promise<void>;
}) {
  const { db, post } = o;
  const roots = (
    await (
      await o.context.request.get(o.origin + "/api/v1/project-roots")
    ).json()
  ).roots;
  const project = (
    await post("/projects", {
      name: "Git schedule source",
      rootId: roots[0].id,
      path: "schedule-git-" + randomUUID(),
      create: true,
    })
  ).project;
  const local = (
    await db.query(
      "SELECT * FROM workspaces WHERE project_id=$1 AND kind='local'",
      [project.id],
    )
  ).rows[0];
  await chmod(local.canonical_path, 0o777);
  const git = (args: string[]) =>
    execFileSync(
      "docker",
      [
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
        ...args,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 },
    ).trim();
  await writeFile(
    path.join(local.canonical_path, "version.txt"),
    "first committed source\n",
  );
  git(["init", "/source"]);
  git(["-C", "/source", "add", "version.txt"]);
  git([
    "-C",
    "/source",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "First fixture",
  ]);
  const first = git(["-C", "/source", "rev-parse", "HEAD"]);
  await writeFile(
    path.join(local.canonical_path, "version.txt"),
    "second committed source\n",
  );
  git(["-C", "/source", "add", "version.txt"]);
  git([
    "-C",
    "/source",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "Second fixture",
  ]);
  const second = git(["-C", "/source", "rev-parse", "HEAD"]);
  await chmod(local.canonical_path, 0o755);
  await writeFile(
    path.join(local.canonical_path, "version.txt"),
    "dirty source must remain private to Local\n",
  );
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const input = {
    title: "Committed scheduled source",
    projectId: project.id,
    prompt: "P008 committed source selection",
    config: {
      rule: { kind: "cron", expression: "0 0 * * *", timezone: "UTC" },
      workspaceMode: "standalone",
      sourceWorkspaceId: local.id,
      sourcePolicy: "committed",
      ...settings,
    },
    grantDays: 1,
  };
  for (const [revision, expected] of [
    [first, "first committed source\n"],
    [undefined, "second committed source\n"],
  ] as const) {
    const schedule = await post("/schedules", {
      ...input,
      config: {
        ...input.config,
        ...(revision ? { baseRevision: revision } : {}),
      },
    });
    const occurrence = (
      await post(`/schedules/${schedule.id}/runs`, { expectedRevision: 1 })
    ).occurrence;
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT state FROM schedule_occurrences WHERE id=$1",
              [occurrence.id],
            )
          ).rows[0].state,
        { timeout: 45000 },
      )
      .toBe("succeeded");
    const workspace = (
      await db.query(
        "SELECT w.* FROM workspaces w JOIN schedule_occurrences o ON o.workspace_id=w.id WHERE o.id=$1",
        [occurrence.id],
      )
    ).rows[0];
    expect(workspace.kind).toBe("worktree");
    expect(workspace.base_revision).toBe(revision ?? second);
    expect(
      await readFile(
        path.join(workspace.canonical_path, "version.txt"),
        "utf8",
      ),
    ).toBe(expected);
    expect(
      await readFile(path.join(local.canonical_path, "version.txt"), "utf8"),
    ).toBe("dirty source must remain private to Local\n");
    await post(`/schedules/${schedule.id}/pause`, { expectedRevision: 1 });
  }
  // Accept default HEAD, then move the source while the owned dispatcher is held.
  const capturedSchedule = await post("/schedules", input);
  let captured: any;
  await o.restartSupervisor(async () => {
    captured = (
      await post(`/schedules/${capturedSchedule.id}/runs`, {
        expectedRevision: 1,
      })
    ).occurrence;
    expect(
      (
        await db.query(
          "SELECT snapshot->>'sourceRevision' AS oid FROM schedule_occurrences WHERE id=$1",
          [captured.id],
        )
      ).rows[0].oid,
    ).toBe(second);
    await chmod(local.canonical_path, 0o777);
    await writeFile(
      path.join(local.canonical_path, "version.txt"),
      "third committed after admission\n",
    );
    git(["-C", "/source", "add", "version.txt"]);
    git([
      "-C",
      "/source",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "After accepted occurrence",
    ]);
    expect(git(["-C", "/source", "rev-parse", "HEAD"])).not.toBe(second);
    await chmod(local.canonical_path, 0o755);
  });
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM schedule_occurrences WHERE id=$1", [
            captured.id,
          ])
        ).rows[0].state,
      { timeout: 45000 },
    )
    .toBe("succeeded");
  const pinned = (
    await db.query(
      "SELECT w.* FROM workspaces w JOIN schedule_occurrences o ON o.workspace_id=w.id WHERE o.id=$1",
      [captured.id],
    )
  ).rows[0];
  expect(pinned.base_revision).toBe(second);
  expect(
    await readFile(path.join(pinned.canonical_path, "version.txt"), "utf8"),
  ).toBe("second committed source\n");
  await post(`/schedules/${capturedSchedule.id}/pause`, {
    expectedRevision: 1,
  });
  // Actual terminal ownership prevents preparation and never becomes schedule authority.
  const busy = await post("/schedules", input);
  const terminal = (
    await post(`/workspaces/${local.id}/terminals`, {
      permissionProfile: "workspace-write",
      cols: 80,
      rows: 24,
    })
  ).terminal;
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM terminals WHERE id=$1", [
            terminal.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("running");
  const deniedBusy = await o.context.request.post(
    o.origin + `/api/v1/schedules/${busy.id}/runs`,
    {
      headers: {
        Origin: o.origin,
        "X-CSRF-Token": o.csrf,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data: { expectedRevision: 1 },
    },
  );
  expect(deniedBusy.status(), await deniedBusy.text()).toBe(409);
  expect((await deniedBusy.json()).error.code).toBe("WORKSPACE_BUSY");
  expect(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM schedule_occurrences WHERE schedule_id=$1",
          [busy.id],
        )
      ).rows[0].count,
    ),
  ).toBe(0);
  expect(
    (
      await db.query("SELECT writer_kind FROM workspaces WHERE id=$1", [
        local.id,
      ])
    ).rows[0].writer_kind,
  ).toBe("terminal");
  await post(`/terminals/${terminal.id}/terminate`, {
    generation: terminal.generation,
  });
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT retired FROM terminals WHERE id=$1", [
            terminal.id,
          ])
        ).rows[0].retired,
      { timeout: 30000 },
    )
    .toBe(true);
  await post(`/schedules/${busy.id}/pause`, { expectedRevision: 1 });
  // Seed only retained workspace metadata to exercise the finite physical-workspace
  // budget. These records are not claimed as real allocated checkouts.
  const quotaSchedule = await post("/schedules", input);
  const retained = Number(
    (
      await db.query(
        "SELECT count(*) FROM workspaces WHERE project_id=$1 AND state<>'removed' AND canonical_path IS NOT NULL",
        [project.id],
      )
    ).rows[0].count,
  );
  const metadataIds: string[] = [];
  for (let index = retained; index < 16; index++) {
    const id = randomUUID();
    metadataIds.push(id);
    await db.query(
      "INSERT INTO workspaces(id,project_id,name,kind,state,canonical_path) VALUES($1,$2,'Retained quota metadata','copy','ready',$3)",
      [
        id,
        project.id,
        path.join(local.canonical_path, "unallocated-quota-" + id),
      ],
    );
  }
  const storageBefore = Number(
    (
      await db.query(
        "SELECT count(*) FROM workspace_storage_operations WHERE project_id=$1",
        [project.id],
      )
    ).rows[0].count,
  );
  const quotaOccurrence = (
    await post(`/schedules/${quotaSchedule.id}/runs`, { expectedRevision: 1 })
  ).occurrence;
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM schedule_occurrences WHERE id=$1", [
            quotaOccurrence.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("failed");
  const quotaRow = (
    await db.query("SELECT * FROM schedule_occurrences WHERE id=$1", [
      quotaOccurrence.id,
    ])
  ).rows[0];
  expect(quotaRow.reason).toBe("WORKSPACE_QUOTA");
  expect(
    Number(
      (
        await db.query("SELECT count(*) FROM operations WHERE id=$1", [
          quotaRow.turn_id,
        ])
      ).rows[0].count,
    ),
  ).toBe(0);
  expect(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM workspace_storage_operations WHERE project_id=$1",
          [project.id],
        )
      ).rows[0].count,
    ),
  ).toBe(storageBefore);
  await db.query("DELETE FROM workspaces WHERE id=ANY($1::uuid[])", [
    metadataIds,
  ]);
  await post(`/schedules/${quotaSchedule.id}/pause`, { expectedRevision: 1 });
  // Source policy is revalidated at occurrence preparation, not inferred again silently.
  const plain = (
    await post("/projects", {
      name: "Changing source policy",
      rootId: roots[0].id,
      path: "schedule-policy-" + randomUUID(),
      create: true,
    })
  ).project;
  const source = (
    await db.query(
      "SELECT * FROM workspaces WHERE project_id=$1 AND kind='local'",
      [plain.id],
    )
  ).rows[0];
  const policy = await post("/schedules", {
    ...input,
    projectId: plain.id,
    title: "Snapshot policy remains explicit",
    config: {
      ...input.config,
      sourceWorkspaceId: source.id,
      sourcePolicy: "snapshot",
    },
  });
  // Only this fresh test checkout is initialized; global/system Git configuration is excluded.
  execFileSync(
    "git",
    ["init", "--initial-branch=main", source.canonical_path],
    {
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TEMPLATE_DIR: "",
      },
      stdio: "ignore",
      timeout: 10000,
    },
  );
  execFileSync(
    "git",
    [
      "-C",
      source.canonical_path,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "Committed policy fixture",
    ],
    {
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TEMPLATE_DIR: "",
      },
      stdio: "ignore",
      timeout: 10000,
    },
  );
  // Creation/activation itself rejects the changed policy, so no one-shot grant or occurrence appears.
  const rejected = await o.context.request.post(
    o.origin + `/api/v1/schedules/${policy.id}/runs`,
    {
      headers: {
        Origin: o.origin,
        "X-CSRF-Token": o.csrf,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data: { expectedRevision: 1 },
    },
  );
  expect(rejected.status(), await rejected.text()).toBe(409);
  expect((await rejected.json()).error.code).toBe("SOURCE_POLICY");
  expect(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM schedule_occurrences WHERE schedule_id=$1",
          [policy.id],
        )
      ).rows[0].count,
    ),
  ).toBe(0);
  await post(`/schedules/${policy.id}/pause`, { expectedRevision: 1 });
}
