import { workspaceAuthorityExpiry } from "./authority-expiry.ts";
import { sourceDigest } from "../../scripts/source-digest.ts";
import { localComposeFiles } from "../../infra/compose.ts";
import { maintain } from "../../packages/storage/src/maintenance.ts";
import { checkKey } from "../../packages/policy/src/index.ts";
import { Ajv2020 } from "ajv/dist/2020.js";
import pg from "pg";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  chmod,
  rename,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";
const sourceAtStart = sourceDigest();
const children: ChildProcess[] = [];
const serve = process.argv.includes("--serve");
const dir = await mkdtemp(
    path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "harbor-workspaces-",
    ),
  ),
  instance = "harbor-workspaces-" + randomBytes(5).toString("hex");
async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
const [dbPort, apiPort, httpsPort, oidcPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
]);
const rootId = randomUUID(),
  origin = `https://localhost:${httpsPort}`,
  password = randomBytes(24).toString("hex");
const artifacts = path.resolve(".test-runs", instance);
const env = {
  ...process.env,
  NODE_ENV: "test",
  HARBOR_FIXTURE_MODE: "private-test",
  HARBOR_INSTANCE_ID: instance,
  HARBOR_DATABASE_PASSWORD: password,
  HARBOR_DATABASE_PORT: String(dbPort),
  HARBOR_API_PORT: String(apiPort),
  HARBOR_HTTPS_PORT: String(httpsPort),
  HARBOR_PORT: String(apiPort),
  HARBOR_ORIGIN: origin,
  DATABASE_URL: `postgres://harbor:${password}@127.0.0.1:${dbPort}/harbor`,
  OIDC_PORT: String(oidcPort),
  HARBOR_OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
  HARBOR_OIDC_CLIENT_ID: instance,
  HARBOR_OWNER_SUBJECT: "owner",
  HARBOR_PROJECT_ROOTS: JSON.stringify([
    { id: rootId, name: "Test root", path: path.join(dir, "project-roots") },
  ]),
  HARBOR_MODELS: "fixture",
  HARBOR_CONTROL_SOCKET: path.join(dir, "control", "supervisor.sock"),
  HARBOR_CREDENTIAL_KEY_FILE: path.join(dir, "control", "key"),
  HARBOR_FIXTURE_INIT_DELAY_MS: "0",
  HARBOR_FIXTURE_STATE_DIR: path.join(dir, "fixture-state"),
  HARBOR_FIXTURE_TRACE_FILE: path.join(dir, "dispatch-trace.jsonl"),
  HARBOR_PERMISSION_CEILING: "workspace-write",
};
const compose = (args: string[]) =>
  execFileSync("docker", ["compose", ...localComposeFiles(), ...args], {
    env,
    stdio: "pipe",
    timeout: 120000,
  });
const start = (file: string) => {
  const p = spawn(process.execPath, ["--import", "tsx", file], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  p.stderr?.on("data", (b) => {
    diagnostics = (diagnostics + b.toString()).slice(-4000);
  });
  p.on("exit", (code) => {
    if (code)
      console.error(
        file + " failed: " + diagnostics.replaceAll(password, "[redacted]"),
      );
  });
  children.push(p);
  return p;
};
let faultDb: pg.Pool | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  await mkdir(path.join(dir, "project-roots"), { mode: 0o700 });
  await mkdir(path.join(dir, "control"), { mode: 0o700 });
  await writeFile(env.HARBOR_CREDENTIAL_KEY_FILE, randomBytes(32), {
    mode: 0o600,
  });
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({ instance, dbPort, apiPort, httpsPort, oidcPort, rootId }),
  );
  compose(["up", "-d", "--wait"]);
  start("tests/fixtures/oidc/server.ts");
  await new Promise((r) => setTimeout(r, 300));
  let api = start("apps/api/src/main.ts");
  let supervisor = start("apps/supervisor/src/main.ts");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    page = await context.newPage();
  await expect
    .poll(
      async () => {
        try {
          return (await context.request.get(origin + "/api/v1/me")).status();
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(401);
  await page.goto(origin + "/auth/login");
  await page
    .getByRole("button", { name: "Sign in as owner", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add project", exact: true }).first(),
  ).toBeVisible();
  const me = await (await context.request.get(origin + "/api/v1/me")).json(),
    headers = { Origin: origin, "X-CSRF-Token": me.csrfToken };
  const get = async (route: string) =>
    (await context.request.get(origin + "/api/v1" + route)).json();
  const command = async (
    route: string,
    body: unknown = {},
    key = `${Date.now()}:${randomUUID()}`,
  ) =>
    context.request.post(origin + "/api/v1" + route, {
      data: body,
      headers: { ...headers, "Idempotency-Key": key },
    });
  const ready = async (workspace: any) => {
    await expect
      .poll(
        async () => (await get(`/workspaces/${workspace.id}`)).workspace.state,
        { timeout: 40000 },
      )
      .toBe("ready");
    return (await get(`/workspaces/${workspace.id}`)).workspace;
  };
  const success = async (route: string, body: unknown = {}) => {
    const r = await command(route, body);
    expect([200, 202], await r.text()).toContain(r.status());
    return r.json();
  };
  await success("/security/runtime-credentials", {
    apiKey: "synthetic-workspace-test",
  });
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .first()
    .click();
  await page.getByLabel("Project name").fill("Parallel project");
  await page.getByLabel("Folder path").fill("project");
  await page.getByLabel("Create a new folder").check();
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .last()
    .click();
  await expect
    .poll(async () => (await get("/projects")).projects.length)
    .toBe(1);
  const project = (await get("/projects")).projects[0],
    local = (await get(`/projects/${project.id}/workspaces`)).workspaces[0];
  const source = path.join(dir, "project-roots", "project");
  await chmod(source, 0o777);
  await writeFile(path.join(source, "tracked.txt"), "committed\n");
  const seed = [
    "run",
    "--rm",
    "--network=none",
    "--user=10001:10001",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--mount",
    `type=bind,source=${source},target=/source`,
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
      timeout: 20000,
    });
  await chmod(source, 0o755);
  await writeFile(path.join(source, "tracked.txt"), "dirty local\n");
  await page
    .getByRole("button", { name: "Manage workspaces", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page.getByLabel("Workspace name").fill("First checkout");
  await expect(page.getByLabel("Use committed files only")).toBeVisible({
    timeout: 30000,
  });
  await page.getByLabel("Use committed files only").check();
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await get(`/projects/${project.id}/workspaces`)).workspaces.filter(
          (w: any) => w.state === "ready",
        ).length,
      { timeout: 40000 },
    )
    .toBe(2);
  const first = (
    await get(`/projects/${project.id}/workspaces`)
  ).workspaces.find((w: any) => w.kind === "worktree");
  const second = await ready(
    (
      await success(`/projects/${project.id}/workspaces`, {
        name: "Second checkout",
        kind: "worktree",
        sourceWorkspaceId: local.id,
        dirtyPolicy: "exclude",
      })
    ).workspace,
  );
  expect(second.state).toBe("ready");
  const setting = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "workspace-write",
  };
  const session = async (workspaceId: string) =>
    (
      await success("/sessions", {
        projectId: project.id,
        workspaceId,
        ...setting,
      })
    ).session;
  const turn = async (id: string, text: string) =>
    (await success(`/sessions/${id}/turns`, { text, ...setting })).operation;
  const state = async (id: string, operation: string) =>
    (await get(`/sessions/${id}/snapshot`)).operations.find(
      (o: any) => o.id === operation,
    )?.state;
  const a = await session(first.id),
    b = await session(second.id);
  const [ta, tb] = await Promise.all([
    turn(a.id, "[delay] [workspace-marker:first]"),
    turn(b.id, "[delay] [workspace-marker:second]"),
  ]);
  await expect
    .poll(async () => Promise.all([state(a.id, ta.id), state(b.id, tb.id)]), {
      timeout: 30000,
    })
    .toEqual(["running", "running"]);
  const activeRemoval = await context.request.delete(
    origin + "/api/v1/workspaces/" + first.id,
    {
      data: {},
      headers: {
        ...headers,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
    },
  );
  expect(activeRemoval.status()).toBe(409);
  expect((await activeRemoval.json()).error.code).toBe("WORKSPACE_BUSY");
  await expect
    .poll(async () => Promise.all([state(a.id, ta.id), state(b.id, tb.id)]), {
      timeout: 30000,
    })
    .toEqual(["succeeded", "succeeded"]);
  const firstPath = path.join(dir, "project-roots", first.relativePath),
    secondPath = path.join(dir, "project-roots", second.relativePath);
  expect(
    await readFile(path.join(firstPath, "harbor-marker.txt"), "utf8"),
  ).toBe("first");
  expect(
    await readFile(path.join(secondPath, "harbor-marker.txt"), "utf8"),
  ).toBe("second");
  expect(await readFile(path.join(source, "tracked.txt"), "utf8")).toBe(
    "dirty local\n",
  );
  // P007 reconciles a derived checkout using its registered common store,
  // releases the exact writer reservation and preserves original uncertainty.
  const derivedCrash = await turn(a.id, "[crash] derived recovery");
  await expect
    .poll(() => state(a.id, derivedCrash.id), { timeout: 30000 })
    .toBe("uncertain");
  const beforeFence = (await get(`/sessions/${a.id}/snapshot`)).session;
  const derivedRecovery = (
    await success(`/sessions/${a.id}/recovery`, {
      expectedGeneration: beforeFence.generation,
    })
  ).recovery;
  await expect
    .poll(
      async () => (await get(`/sessions/${a.id}/recovery`)).recovery.state,
      { timeout: 30000 },
    )
    .toBe("ready");
  expect(
    (await get(`/workspaces/${first.id}`)).workspace.writerSessionId,
  ).toBeNull();
  const afterFence = (await get(`/sessions/${a.id}/snapshot`)).session;
  const resumed = (
    await success(`/sessions/${a.id}/recovery/continue`, {
      ...setting,
      text: "Fresh derived input after inspected recovery",
      recoveryId: derivedRecovery.id,
      expectedGeneration: afterFence.generation,
      acknowledgeUnknownEffects: true,
    })
  ).operation;
  await expect
    .poll(() => state(a.id, resumed.id), { timeout: 30000 })
    .toBe("succeeded");
  await expect
    .poll(
      async () =>
        (await get(`/workspaces/${first.id}`)).workspace.writerSessionId,
      { timeout: 30000 },
    )
    .toBeNull();
  expect(await state(a.id, derivedCrash.id)).toBe("uncertain");
  expect(
    await readFile(path.join(firstPath, "harbor-marker.txt"), "utf8"),
  ).toBe("first");
  expect(await readFile(path.join(source, "tracked.txt"), "utf8")).toBe(
    "dirty local\n",
  );
  const remove = async (id: string) =>
    context.request.delete(origin + "/api/v1/workspaces/" + id, {
      data: {},
      headers: {
        ...headers,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
    });
  expect((await remove(first.id)).status()).toBe(409);
  await expect
    .poll(
      async () =>
        (await get(`/projects/${project.id}/workspaces`)).workspaces.find(
          (w: any) => w.id === first.id,
        ).writerSessionId,
    )
    .toBe(null);
  const c1 = await session(local.id),
    c2 = await session(local.id),
    t1 = await turn(c1.id, "[input]");
  await expect
    .poll(() => state(c1.id, t1.id), { timeout: 30000 })
    .toBe("waiting_input");
  const t2 = await turn(c2.id, "[delay]");
  expect(await state(c2.id, t2.id)).toBe("queued");
  const active = (
    await get(`/projects/${project.id}/workspaces`)
  ).workspaces.find((w: any) => w.id === local.id);
  expect(
    (
      await command(`/workspaces/${local.id}/release`, {
        acknowledgeUnknownEffects: true,
        expectedSessionId: c1.id,
        expectedGeneration: active.writerGeneration,
      })
    ).status(),
  ).toBe(409);
  await page.goto(origin + "/?conversation=" + c2.id);
  await expect(
    page.getByText("Queued for this workspace.", { exact: false }),
  ).toBeVisible();
  await writeFile(
    path.join(source, "external-change.txt"),
    "cooperative coordination does not block trusted external writes",
  );
  await success(`/turns/${t1.id}/cancel`);
  await expect
    .poll(() => state(c1.id, t1.id), { timeout: 30000 })
    .toBe("interrupted");
  await expect
    .poll(() => state(c2.id, t2.id), { timeout: 30000 })
    .toBe("succeeded");
  await expect
    .poll(
      async () =>
        (await get(`/projects/${project.id}/workspaces`)).workspaces.find(
          (w: any) => w.id === local.id,
        ).writerSessionId,
    )
    .toBe(null);
  await page
    .getByRole("button", { name: "Manage workspaces", exact: true })
    .click();
  const doomed = await session(local.id),
    crash = await turn(doomed.id, "[crash]");
  await expect
    .poll(() => state(doomed.id, crash.id), { timeout: 30000 })
    .toBe("uncertain");
  const reservation = (
    await get(`/projects/${project.id}/workspaces`)
  ).workspaces.find((w: any) => w.id === local.id);
  await workspaceAuthorityExpiry({
    browser,
    owner: context,
    origin,
    database: env.DATABASE_URL,
    workspaceId: local.id,
    sessionId: doomed.id,
    generation: reservation.writerGeneration,
    pause: () => {
      supervisor.kill("SIGSTOP");
    },
    resume: () => {
      supervisor.kill("SIGCONT");
    },
  });
  expect(
    (
      await command(`/workspaces/${local.id}/release`, {
        acknowledgeUnknownEffects: true,
        expectedSessionId: doomed.id,
        expectedGeneration: reservation.writerGeneration + 1,
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await context.request.post(
        origin + `/api/v1/workspaces/${local.id}/release`,
        { data: {}, headers: { Origin: origin } },
      )
    ).status(),
  ).toBe(403);
  await expect(
    page.getByRole("region", { name: "Local", exact: true }),
  ).toContainText(doomed.id, { timeout: 15000 });
  await expect(
    page
      .getByRole("region", { name: "Local", exact: true })
      .getByRole("button", { name: "Release uncertain reservation" }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("region", { name: "Local", exact: true })
    .getByRole("button", { name: "Release uncertain reservation" })
    .click();
  await expect(
    page.getByText("Prior effects remain unknown", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Acknowledge unknown effects and stop processes",
    })
    .click();
  await expect
    .poll(
      async () =>
        (await get(`/projects/${project.id}/workspaces`)).workspaces.find(
          (w: any) => w.id === local.id,
        ).writerSessionId,
      { timeout: 30000 },
    )
    .toBe(null);
  expect(await state(doomed.id, crash.id)).toBe("uncertain");
  const successor = await session(local.id),
    after = await turn(successor.id, "Recovered workspace new intent");
  await expect
    .poll(() => state(successor.id, after.id), { timeout: 30000 })
    .toBe("succeeded");
  await rename(secondPath, secondPath + "-moved");
  await mkdir(secondPath);
  expect((await get(`/workspaces/${second.id}`)).workspace.state).toBe(
    "unavailable",
  );
  expect(
    (
      await command(`/sessions/${b.id}/turns`, {
        text: "must not fallback",
        ...setting,
      })
    ).status(),
  ).toBe(409);
  await rm(secondPath, { recursive: true });
  await rename(secondPath + "-moved", secondPath);
  expect((await get(`/workspaces/${second.id}`)).workspace.state).toBe("ready");
  const uncertainOther = await session(second.id),
    unknownTurn = await turn(uncertainOther.id, "[retirement-unknown]");
  await expect
    .poll(() => state(uncertainOther.id, unknownTurn.id), { timeout: 30000 })
    .toBe("uncertain");
  const unknownReservation = (
    await get(`/projects/${project.id}/workspaces`)
  ).workspaces.find((w: any) => w.id === second.id);
  const failedRelease = (
    await success(`/workspaces/${second.id}/release`, {
      acknowledgeUnknownEffects: true,
      expectedSessionId: uncertainOther.id,
      expectedGeneration: unknownReservation.writerGeneration,
    })
  ).release;
  await expect
    .poll(async () => (await get(`/workspaces/${second.id}`)).release?.state, {
      timeout: 30000,
    })
    .toBe("failed");
  expect(
    (await get(`/projects/${project.id}/workspaces`)).workspaces.find(
      (w: any) => w.id === second.id,
    ).writerSessionId,
  ).toBe(uncertainOther.id);
  const retryRelease = (
    await success(`/workspaces/${second.id}/release`, {
      acknowledgeUnknownEffects: true,
      expectedSessionId: uncertainOther.id,
      expectedGeneration: unknownReservation.writerGeneration,
    })
  ).release;
  expect(retryRelease.id).toBe(failedRelease.id);
  await expect
    .poll(async () => (await get(`/workspaces/${second.id}`)).release?.state, {
      timeout: 30000,
    })
    .toBe("failed");
  const copyProject = (
    await success("/projects", {
      rootId,
      path: "plain",
      name: "Plain project",
      create: true,
    })
  ).project;
  const plain = (await get(`/projects/${copyProject.id}/workspaces`))
    .workspaces[0];
  await writeFile(
    path.join(dir, "project-roots", "plain", "source.txt"),
    "snapshot",
  );
  faultDb = new pg.Pool({ connectionString: env.DATABASE_URL });
  await faultDb.query(
    "CREATE FUNCTION reject_workspace_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='completed' THEN RAISE EXCEPTION 'owned storage COMMIT fault'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER reject_workspace_commit AFTER UPDATE ON workspace_storage_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_workspace_commit()",
  );
  const copyKey = `${Date.now()}:${randomUUID()}`,
    copyBody = {
      name: "Plain copy",
      kind: "copy",
      sourceWorkspaceId: plain.id,
      dirtyPolicy: "snapshot",
    };
  const pendingCopy = (
    await (
      await command(`/projects/${copyProject.id}/workspaces`, copyBody, copyKey)
    ).json()
  ).workspace;
  const expectedCopyPath = path.join(
    dir,
    "project-roots",
    ".harbor-workspaces",
    "plain",
    pendingCopy.id,
    "checkout",
  );
  await expect
    .poll(
      async () => {
        try {
          return await readFile(
            path.join(expectedCopyPath, "source.txt"),
            "utf8",
          );
        } catch {
          return "";
        }
      },
      { timeout: 30000 },
    )
    .toBe("snapshot");
  expect((await get(`/workspaces/${pendingCopy.id}`)).workspace.state).toBe(
    "creating",
  );
  expect(
    (
      await (
        await command(
          `/projects/${copyProject.id}/workspaces`,
          copyBody,
          copyKey,
        )
      ).json()
    ).workspace.id,
  ).toBe(pendingCopy.id);
  await faultDb.query(
    "DROP TRIGGER reject_workspace_commit ON workspace_storage_operations",
  );
  const copied =
    await ready(
      pendingCopy,
    ); /* stable filesystem identity survives failed final COMMIT */
  expect(copied.state).toBe("ready");
  expect(
    await readFile(
      path.join(dir, "project-roots", copied.relativePath, "source.txt"),
      "utf8",
    ),
  ).toBe("snapshot");
  // Hold actual dispatch at a PostgreSQL lock, then change the accepted snapshot.
  await faultDb.query(
    "CREATE FUNCTION hold_workspace_remove() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='remove' AND NEW.state='dispatching' THEN PERFORM pg_advisory_xact_lock(739003); END IF; RETURN NEW; END $$; CREATE TRIGGER hold_workspace_remove BEFORE UPDATE ON workspace_storage_operations FOR EACH ROW EXECUTE FUNCTION hold_workspace_remove()",
  );
  const removalGate = await faultDb.connect();
  try {
    await removalGate.query("SELECT pg_advisory_lock(739003)");
    expect((await remove(copied.id)).status()).toBe(200);
    await writeFile(
      path.join(expectedCopyPath, "source.txt"),
      "changed after acceptance",
    );
  } finally {
    await removalGate.query("SELECT pg_advisory_unlock(739003)");
    removalGate.release();
  }
  await expect
    .poll(
      async () =>
        (
          await faultDb!.query(
            "SELECT state FROM workspace_storage_operations WHERE workspace_id=$1 AND action='remove'",
            [copied.id],
          )
        ).rows[0]?.state,
      { timeout: 30000 },
    )
    .toBe("failed");
  const failedRemoval = (
    await faultDb.query(
      "SELECT id FROM workspace_storage_operations WHERE workspace_id=$1 AND action='remove'",
      [copied.id],
    )
  ).rows[0].id;
  expect((await get(`/workspaces/${copied.id}`)).workspace.state).toBe("ready");
  await writeFile(path.join(expectedCopyPath, "source.txt"), "snapshot");
  await faultDb.query(
    "DROP TRIGGER hold_workspace_remove ON workspace_storage_operations; DROP FUNCTION hold_workspace_remove()",
  );
  await faultDb.query(
    "CREATE CONSTRAINT TRIGGER reject_workspace_commit AFTER UPDATE ON workspace_storage_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_workspace_commit()",
  );
  const removeKey = `${Date.now()}:${randomUUID()}`,
    removeRequest = () =>
      context.request.delete(origin + "/api/v1/workspaces/" + copied.id, {
        data: {},
        headers: { ...headers, "Idempotency-Key": removeKey },
      });
  expect((await removeRequest()).status()).toBe(200);
  expect(
    (
      await faultDb.query(
        "SELECT id FROM workspace_storage_operations WHERE workspace_id=$1 AND action='remove'",
        [copied.id],
      )
    ).rows,
  ).toEqual([{ id: failedRemoval }]);
  await expect
    .poll(
      async () => {
        try {
          await readFile(path.join(expectedCopyPath, "source.txt"));
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    )
    .toBe(false);
  expect((await get(`/workspaces/${copied.id}`)).workspace.state).toBe(
    "removing",
  );
  expect((await removeRequest()).status()).toBe(200);
  await faultDb.query(
    "DROP TRIGGER reject_workspace_commit ON workspace_storage_operations; DROP FUNCTION reject_workspace_commit()",
  );
  await expect
    .poll(async () => (await get(`/workspaces/${copied.id}`)).workspace.state, {
      timeout: 30000,
    })
    .toBe("removed");
  expect(
    await readFile(
      path.join(dir, "project-roots", "plain", "source.txt"),
      "utf8",
    ),
  ).toBe("snapshot");
  // Reach the real configured workspace ceiling through accepted API operations.
  for (let index = 0; index < 15; index++)
    await ready(
      (
        await success(`/projects/${copyProject.id}/workspaces`, {
          ...copyBody,
          name: `Bounded copy ${index}`,
        })
      ).workspace,
    );
  expect(
    (
      await command(`/projects/${copyProject.id}/workspaces`, {
        ...copyBody,
        name: "Beyond ceiling",
      })
    ).status(),
  ).toBe(429);
  expect(
    (
      await command(`/projects/${project.id}/workspaces`, {
        ...copyBody,
        name: "Cross project",
      })
    ).status(),
  ).toBe(403);
  await success(`/workspaces/${plain.id}/archive`);
  await success(`/projects/${copyProject.id}/archive`);
  expect(
    await readFile(
      path.join(dir, "project-roots", "plain", "source.txt"),
      "utf8",
    ),
  ).toBe("snapshot");
  const otherProject = (
    await success("/projects", {
      rootId,
      path: "other-git",
      name: "Other Git",
      create: true,
    })
  ).project;
  const otherSource = path.join(dir, "project-roots", "other-git");
  await chmod(otherSource, 0o777);
  await writeFile(path.join(otherSource, "tracked.txt"), "other repository");
  const otherSeed = seed.map((value) =>
    value.replace(`source=${source},`, `source=${otherSource},`),
  );
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
      "Other fixture",
    ],
  ])
    execFileSync("docker", [...otherSeed, ...args], {
      stdio: "pipe",
      timeout: 20000,
    });
  await chmod(otherSource, 0o755);
  const otherLocal = (await get(`/projects/${otherProject.id}/workspaces`))
    .workspaces[0];
  expect((await get(`/workspaces/${otherLocal.id}`)).inspection.head).not.toBe(
    first.baseRevision,
  );
  await page.reload();
  await page
    .getByRole("navigation", { name: "Projects" })
    .getByRole("button", { name: "Other Git", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .first()
    .click();
  await expect(
    page.getByLabel("Conversation workspace", { exact: true }),
  ).toContainText(otherLocal.id);
  await page.reload();
  await expect(
    page.getByLabel("Conversation workspace", { exact: true }),
  ).toContainText(otherLocal.id);
  await page
    .getByRole("navigation", { name: "Projects" })
    .getByRole("button", { name: "Parallel project", exact: true })
    .click();
  await expect(page.getByLabel("New conversation workspace")).toContainText(
    "First checkout",
  );
  await page.screenshot({
    path: path.join(artifacts, "workspaces.png"),
    fullPage: true,
  });
  await writeFile(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        sourceAtStart,
        sourceAtEnd: sourceDigest(),
        scope:
          "P003 real UI/API/PG/supervisor with external Codex/OIDC fixtures; Linux/live separate",
      },
      null,
      2,
    ),
  );
  console.log("P003 workspace E2E passed: " + artifacts);
} finally {
  await faultDb?.end();
  await browser?.close();
  for (const p of children) p.kill("SIGTERM");
  await Promise.all(
    children.map((p) =>
      p.exitCode !== null || p.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            p.once("exit", r);
            setTimeout(() => {
              p.kill("SIGKILL");
              r(undefined);
            }, 5000);
          }),
    ),
  );
  try {
    compose(["down", "--volumes", "--remove-orphans"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
