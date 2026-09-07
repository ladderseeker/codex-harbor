import { filesRecovery } from "./recovery.ts";
import { filesReads } from "./reads.ts";
import { xfsFixture } from "../isolation/xfs-fixture.ts";
import { filesAcceptance } from "./acceptance.ts";
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
  chown,
  rename,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
import { chromium, expect, type Page } from "@playwright/test";
if (process.platform !== "linux" && !process.argv.includes("--render-only")) {
  console.error(
    "P004 write acceptance requires the supported Linux filesystem boundary; use --render-only for UI/CSP checks.",
  );
  process.exit(2);
}
const managed = process.argv.includes("--managed")
  ? await xfsFixture()
  : undefined;
const sourceAtStart = sourceDigest();
const children: ChildProcess[] = [];
const serve = process.argv.includes("--serve");
const dir = await mkdtemp(
    path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "harbor-files-",
    ),
  ),
  instance = "harbor-files-" + randomBytes(5).toString("hex");
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
const rootId = managed?.rootId ?? randomUUID(),
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
  HARBOR_FILE_SOCKET:
    managed?.env.HARBOR_STORAGE_SOCKET ??
    path.join(dir, "control", "files.sock"),
  HARBOR_CONTROL_SOCKET: path.join(dir, "control", "supervisor.sock"),
  HARBOR_CREDENTIAL_KEY_FILE: path.join(dir, "control", "key"),
  HARBOR_FIXTURE_INIT_DELAY_MS: "0",
  HARBOR_FIXTURE_STATE_DIR: path.join(dir, "fixture-state"),
  HARBOR_FIXTURE_TRACE_FILE: path.join(dir, "dispatch-trace.jsonl"),
  HARBOR_PERMISSION_CEILING: "workspace-write",
  ...(managed
    ? {
        HARBOR_XFS_PROFILE: managed.env.HARBOR_XFS_PROFILE,
        HARBOR_PROJECT_ROOTS: managed.env.HARBOR_PROJECT_ROOTS,
        HARBOR_LAUNCHER_STATE_DIR: managed.env.HARBOR_LAUNCHER_STATE_DIR,
        HARBOR_STORAGE_SOCKET: managed.env.HARBOR_STORAGE_SOCKET,
        HARBOR_STORAGE_CLIENT_UID: managed.env.HARBOR_STORAGE_CLIENT_UID,
      }
    : {}),
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
let activePage: Page | undefined;
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
  start(managed ? "infra/storage/server.ts" : "tests/files/worker.ts");
  await new Promise((r) => setTimeout(r, 300));
  let api = start("apps/api/src/main.ts");
  let supervisor = start("apps/supervisor/src/main.ts");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    page = await context.newPage();
  activePage = page;
  page.on("response", async (response) => {
    const route = new URL(response.url()).pathname;
    if (response.status() >= 400 && /^\/api\/v1\/workspaces\//.test(route)) {
      const value = await response.json().catch(() => ({}));
      console.error(
        "P004 HTTP diagnostic",
        response.status(),
        route,
        /^[A-Z_]+$/.test(value.error?.code ?? "")
          ? value.error.code
          : "UNKNOWN",
      );
    }
  });
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
  const get = async (route: string) => {
    const response = await context.request.get(origin + "/api/v1" + route);
    if (response.status() !== 200) {
      const failure = await response.json();
      throw new Error(
        `P004 read ${route}: HTTP ${response.status()} ${failure.error?.code ?? "UNKNOWN"}`,
      );
    }
    return response.json();
  };
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
  faultDb = new pg.Pool({ connectionString: env.DATABASE_URL });
  const source = managed
    ? (
        await faultDb.query("SELECT canonical_path FROM projects WHERE id=$1", [
          project.id,
        ])
      ).rows[0].canonical_path
    : path.join(dir, "project-roots", "project");
  if (!managed) {
    await chmod(source, 0o777);
    if (process.platform === "linux" && process.getuid?.() === 0)
      await chown(source, 10001, 10001);
  }
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
  if (!managed)
    await chmod(source, process.platform === "linux" ? 0o755 : 0o777);
  await writeFile(
    path.join(source, "tracked.txt"),
    'dirty local\n<img src=x onerror="window.harborFileExecuted=true" style="color:red">\nplain style="color:red" stays text\n',
  );
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
  const acceptance = process.argv.includes("--faults-only")
    ? filesRecovery
    : process.argv.includes("--reads-only")
      ? filesReads
      : filesAcceptance;
  await acceptance({
    page,
    context,
    origin,
    project,
    local,
    first,
    second,
    source,
    artifacts,
    get,
    command,
    success,
    headers,
    rootId,
    env,
    api,
    supervisor,
    start,
  });
  const sourceAtEnd = sourceDigest();
  expect(sourceAtEnd).toEqual(sourceAtStart);
  await writeFile(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        sourceAtStart,
        sourceAtEnd,
        node: process.version,
        selection: process.argv.includes("--faults-only")
          ? "targeted recovery fault checks"
          : process.argv.includes("--reads-only")
            ? "targeted bounded read and authority checks"
            : "complete current file acceptance",
        scope: process.argv.includes("--render-only")
          ? "P004 real authenticated UI CSP rendering only; no save/Git acceptance claim"
          : managed
            ? "P004 real UI/API/PG/supervisor, managed XFS provisioning and fixed production file helper; external OIDC/Codex fixtures"
            : "P004 real UI/API/PG/supervisor and fixed Docker file helper; external OIDC/Codex fixtures; actual Linux separate",
      },
      null,
      2,
    ),
  );
  console.log(
    (process.argv.includes("--render-only")
      ? "P004 CSP render check passed: "
      : "P004 files E2E passed: ") + artifacts,
  );
} catch (error) {
  await activePage
    ?.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error("P004 owned failure artifacts:", artifacts);
  throw error;
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
    await managed?.cleanup();
  }
}
