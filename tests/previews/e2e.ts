import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import os from "node:os";
import { chromium, expect } from "@playwright/test";
import pg from "pg";
import { sourceDigest } from "../../scripts/source-digest.ts";
import { localComposeFiles } from "../../infra/compose.ts";
const sourceAtStart = sourceDigest(),
  instance = "harbor-previews-" + randomBytes(5).toString("hex"),
  children: ChildProcess[] = [],
  dir = await mkdtemp(
    path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "harbor-previews-",
    ),
  ),
  artifacts = path.resolve(".test-runs", instance);
async function free() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as import("node:net").AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
const [dbPort, apiPort, previewPort, httpsPort, oidcPort, appPort] =
    await Promise.all(Array.from({ length: 6 }, free)),
  origin = `https://localhost:${httpsPort}`,
  password = randomBytes(24).toString("hex"),
  rootId = randomUUID();
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
  HARBOR_HOST: "127.0.0.1",
  HARBOR_ORIGIN: origin,
  DATABASE_URL: `postgres://harbor:${password}@127.0.0.1:${dbPort}/harbor`,
  OIDC_PORT: String(oidcPort),
  HARBOR_OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
  HARBOR_OIDC_CLIENT_ID: instance,
  HARBOR_OWNER_SUBJECT: "owner",
  HARBOR_PROJECT_ROOTS: JSON.stringify([
    { id: rootId, name: "Preview test root", path: path.join(dir, "projects") },
  ]),
  HARBOR_MODELS: "fixture",
  HARBOR_CONTROL_SOCKET: path.join(dir, "control", "credentials.sock"),
  HARBOR_CREDENTIAL_KEY_FILE: path.join(dir, "control", "key"),
  HARBOR_FIXTURE_STATE_DIR: path.join(dir, "native"),
  HARBOR_FIXTURE_TRACE_FILE: path.join(dir, "trace.jsonl"),
  HARBOR_PERMISSION_CEILING: "workspace-write",
  HARBOR_PREVIEW_DOMAIN: "preview.localhost",
  HARBOR_PREVIEW_HTTPS_PORT: String(httpsPort),
  HARBOR_PREVIEW_PORT: String(previewPort),
  HARBOR_PREVIEW_SOCKET: path.join(dir, "control", "preview.sock"),
};
let diagnostics = "",
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
  db: pg.Pool | undefined,
  composed = false;
const exchangeTraffic: unknown[] = [];
const previewCookieChecks: Promise<boolean>[] = [];
const override = path.join(dir, "compose.yaml");
const compose = (args: string[]) =>
  execFileSync(
    "docker",
    ["compose", ...localComposeFiles(), "-f", override, ...args],
    { env, stdio: "pipe", timeout: 120000 },
  );
function start(file: string) {
  const child = spawn(process.execPath, ["--import", "tsx", file], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (b) => {
      diagnostics = (diagnostics + b.toString()).slice(-262144);
    });
  children.push(child);
  return child;
}
try {
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  for (const name of ["projects", "control", "native"])
    await mkdir(path.join(dir, name), { mode: 0o700 });
  await writeFile(env.HARBOR_CREDENTIAL_KEY_FILE, randomBytes(32), {
    mode: 0o600,
  });
  const caddy = path.join(dir, "Caddyfile");
  await writeFile(
    caddy,
    `{\nadmin off\nauto_https disable_redirects\n}\nhttps://localhost:3443 {\ntls internal\nreverse_proxy host.docker.internal:${apiPort}\n}\nhttps://*.preview.localhost:3443 {\ntls internal\nreverse_proxy host.docker.internal:${previewPort}\n}\n`,
  );
  await writeFile(
    override,
    JSON.stringify({
      services: { caddy: { volumes: [caddy + ":/etc/caddy/Caddyfile:ro"] } },
    }),
  );
  compose(["up", "-d", "--wait"]);
  composed = true;
  start("tests/fixtures/oidc/server.ts");
  await new Promise((r) => setTimeout(r, 300));
  start("apps/api/src/main.ts");
  start("apps/supervisor/src/main.ts");
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${apiPort}/health`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
  db = new pg.Pool({ connectionString: env.DATABASE_URL });
  browser = await chromium.launch({
    headless: true,
    args: ["--host-resolver-rules=MAP *.preview.localhost 127.0.0.1"],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  context.on("request", (req) => {
    if (new URL(req.url()).hostname.endsWith(".preview.localhost"))
      previewCookieChecks.push(
        req
          .allHeaders()
          .then((headers) =>
            (headers.cookie ?? "")
              .split(";")
              .some((v) => /^__Host-harbor(?:-login)?=/.test(v.trim())),
          ),
      );
    if (new URL(req.url()).pathname === "/__harbor/exchange") {
      const headers = req.headers();
      exchangeTraffic.push({
        method: req.method(),
        origin: headers.origin,
        contentType: headers["content-type"],
        fetchSite: headers["sec-fetch-site"],
      });
    }
  });
  const page = await context.newPage();
  await page.goto(origin + "/auth/login");
  await page
    .getByRole("button", { name: "Sign in as owner", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add project", exact: true }).first(),
  ).toBeVisible();
  const me = await (await context.request.get(origin + "/api/v1/me")).json();
  const command = async (
    route: string,
    body: unknown,
    status = 200,
    key = `${Date.now()}:${randomUUID()}`,
  ) => {
    const response = await context.request.post(origin + "/api/v1" + route, {
      headers: {
        Origin: origin,
        "X-CSRF-Token": me.csrfToken,
        "Idempotency-Key": key,
      },
      data: body,
    });
    expect(response.status()).toBe(status);
    return response.json();
  };
  const { project } = await command("/projects", {
    name: "Private preview project",
    rootId,
    path: "app",
    create: true,
  });
  const workspace = (
    await (
      await context.request.get(
        origin + `/api/v1/projects/${project.id}/workspaces`,
      )
    ).json()
  ).workspaces.find((w: any) => w.kind === "local");
  const row = (
    await db.query("SELECT canonical_path FROM workspaces WHERE id=$1", [
      workspace.id,
    ])
  ).rows[0];
  await writeFile(
    path.join(row.canonical_path, "package.json"),
    JSON.stringify({
      name: "harbor-preview-fixture",
      private: true,
      scripts: { dev: "node server.mjs" },
    }),
  );
  await writeFile(
    path.join(row.canonical_path, "server.mjs"),
    `import http from 'node:http';\nconst server=http.createServer((req,res)=>{if(req.url==='/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: preview event\\n\\n');return;}res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><h1>Private application</h1><p id="event">waiting</p><script>new EventSource("/events").onmessage=e=>document.querySelector("#event").textContent=e.data</script>');});server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('PREVIEW_READY'));\n`,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Project previews", exact: true })
    .click();
  await page
    .getByLabel("Preview name", { exact: true })
    .fill("Local private app");
  await page
    .getByLabel("Application port", { exact: true })
    .fill(String(appPort));
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/previews") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save preview", exact: true }).click();
  const p = (await (await created).json()).preview;
  await page
    .getByRole("button", { name: "Start preview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Prepare private access", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  expect(
    (await db.query("SELECT state,retired FROM previews WHERE id=$1", [p.id]))
      .rows[0],
  ).toEqual({ state: "ready", retired: false });
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM preview_readers WHERE owner_id=$1",
        [p.id],
      )
    ).rows[0].n,
  ).toBe(1);
  await page
    .getByRole("button", { name: "Prepare private access", exact: true })
    .click();
  const popupPromise = context.waitForEvent("page");
  await page
    .getByRole("link", { name: "Open preview in new tab", exact: false })
    .click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("heading", { name: "Private application" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(popup.locator("#event")).toHaveText("preview event");
  expect(new URL(popup.url()).hostname).toMatch(
    /^[a-f0-9]{32}\.preview\.localhost$/,
  );
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  const cookies = await context.cookies(popup.url());
  expect((await Promise.all(previewCookieChecks)).some(Boolean)).toBe(false);
  const previewCookie = cookies.find(
    (c) =>
      c.name === "__Host-harbor-preview" &&
      c.domain === new URL(popup.url()).hostname,
  );
  expect(
    previewCookie && {
      secure: previewCookie.secure,
      httpOnly: previewCookie.httpOnly,
      path: previewCookie.path,
    },
  ).toEqual({ secure: true, httpOnly: true, path: "/" });
  await page.screenshot({
    path: path.join(artifacts, "preview-panel.png"),
    fullPage: true,
  });
  await popup.screenshot({
    path: path.join(artifacts, "preview-application.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Stop preview", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await db!.query("SELECT retired FROM previews WHERE id=$1", [p.id]))
          .rows[0].retired,
      { timeout: 15000 },
    )
    .toBe(true);
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM preview_readers WHERE owner_id=$1",
        [p.id],
      )
    ).rows[0].n,
  ).toBe(0);
  await popup.reload();
  await expect(
    popup.getByText("Preview unavailable.", { exact: false }),
  ).toBeVisible();
  await writeFile(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        instance,
        sourceAtStart,
        sourceAtEnd: sourceDigest(),
        node: process.version,
        scope:
          "Initial P011 real UI/API/PG/supervisor/relay lifecycle and separate-origin SSE; external OIDC/Codex fixtures. Full security/fault/Linux acceptance remains pending.",
      },
      null,
      2,
    ),
  );
  console.log("P011 initial real-stack result: " + artifacts);
} catch (error) {
  const state = db
    ? await db
        .query("SELECT id,state,retired,failure_code,generation FROM previews")
        .then((r) => r.rows)
        .catch(() => [])
    : [];
  const logs = db
    ? await db
        .query("SELECT bytes FROM preview_logs ORDER BY sequence")
        .then((r) =>
          r.rows
            .map((v) => v.bytes.toString("utf8"))
            .join("")
            .slice(-16384),
        )
        .catch(() => "")
    : "";
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page
          .screenshot({
            path: path.join(artifacts, "failure-page-" + randomUUID() + ".png"),
            fullPage: true,
          })
          .catch(() => undefined);
  await writeFile(
    path.join(artifacts, "failure.json"),
    JSON.stringify(
      {
        status: "failed",
        instance,
        sourceAtStart,
        sourceAtEnd: sourceDigest(),
        error: String(error),
        state,
        logs,
        exchangeTraffic,
        diagnostics: diagnostics.replaceAll(password, "[redacted]"),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  for (const p of children) p.kill("SIGTERM");
  for (const p of children)
    if (p.exitCode === null && p.signalCode === null)
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          p.kill("SIGKILL");
          resolve();
        }, 10000);
        p.once("close", () => {
          clearTimeout(t);
          resolve();
        });
      });
  await db?.end();
  if (composed) compose(["down", "-v", "--remove-orphans"]);
  await rm(dir, { recursive: true, force: true });
}
