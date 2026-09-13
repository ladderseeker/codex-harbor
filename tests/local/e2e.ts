import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { localComposeFiles } from "../../infra/compose.ts";
const dir = await mkdtemp(path.resolve(".test-runs/local-e2e-"));
const state = path.join(dir, "state");
const binary = path.join(dir, "codex");
const fixture = path.join(dir, "external-codex.mjs");
await writeFile(
  fixture,
  (await readFile("tests/fixtures/codex/server.mjs", "utf8"))
    .replace("let authenticated = false;", "let authenticated = true;")
    .replace(
      "const stateFile = process.env.HARBOR_FIXTURE_STATE_FILE;",
      'const stateFile = process.env.CODEX_HOME + "/test-history.json";',
    ),
);
await writeFile(
  binary,
  `#!${process.execPath}\nif(process.argv.includes('--version')) console.log('codex-cli 0.153.4'); else await import(${JSON.stringify(fixture)});\n`,
  { mode: 0o700 },
);
let logs = "";
let launcher: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let saved: any;
const start = () => {
  const p = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/local-dev.ts"],
    {
      env: {
        ...process.env,
        HARBOR_LOCAL_STATE_DIR: state,
        HARBOR_LOCAL_CODEX_BINARY: binary,
        HARBOR_MODELS: "fixture",
      },
      stdio: "pipe",
    },
  );
  p.stdout!.on("data", (b) => {
    logs = (logs + b).slice(-24000);
  });
  p.stderr!.on("data", (b) => {
    logs = (logs + b).slice(-24000);
  });
  launcher = p;
  return p;
};
async function stop() {
  if (!launcher || launcher.exitCode !== null) return;
  const p = launcher;
  p.kill("SIGTERM");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Launcher failed to stop")),
      20000,
    );
    p.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
try {
  start();
  await expect
    .poll(
      async () => {
        try {
          saved = JSON.parse(
            await readFile(path.join(state, "instance.json"), "utf8"),
          );
          return logs.includes("Local Harbor:");
        } catch {
          return false;
        }
      },
      { timeout: 120000 },
    )
    .toBe(true);
  const origin = `https://localhost:${saved.httpsPort}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  expect((await context.request.get(origin + "/api/v1/me")).status()).toBe(401);
  await page.goto(origin + "/auth/login");
  await page
    .locator('input[name="token"]')
    .fill(await readFile(path.join(state, "owner-token"), "utf8"));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(origin + "/").catch(async (error) => {
    console.error(
      "Auth page",
      new URL(page.url()).pathname,
      await page.locator("body").innerText(),
    );
    throw error;
  });
  const me = await (await context.request.get(origin + "/api/v1/me")).json();
  const post = (route: string, data: unknown, headers = {}) =>
    context.request.post(origin + "/api/v1" + route, {
      data,
      headers: {
        Origin: origin,
        "X-CSRF-Token": me.csrfToken,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
        ...headers,
      },
    });
  expect(
    (await post("/projects", {}, { Origin: "https://evil.example" })).status(),
  ).toBe(403);
  expect(
    (await post("/projects", {}, { "X-CSRF-Token": "invalid" })).status(),
  ).toBe(403);
  for (const route of [
    "/schedules",
    "/workspaces/11111111-1111-4111-8111-111111111111/terminals",
    "/security/runtime-credentials",
    "/sessions/11111111-1111-4111-8111-111111111111/attachments",
  ])
    expect((await post(route, {})).status()).toBe(409);
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .first()
    .click();
  await page.getByLabel("Approved root").selectOption(saved.rootId);
  await page.getByLabel("Project name").fill("Local acceptance");
  await page.getByLabel("Folder path").fill("project");
  await page.getByLabel("Create a new folder").check();
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .last()
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await context.request.get(origin + "/api/v1/capabilities")
          ).json()
        ).account?.authenticated,
      { timeout: 30000 },
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page.getByLabel("Message Codex").fill("P013 local hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("body")).toContainText("Fixture response", {
    timeout: 30000,
  });
  await page.reload();
  await expect(page.locator("body")).toContainText("Fixture response");
  await page.screenshot({
    path: path.join(dir, "local-conversation.png"),
    fullPage: true,
  });
  const session = (
    await (await context.request.get(origin + "/api/v1/sessions")).json()
  ).sessions[0];
  const intent = `${Date.now()}:${randomUUID()}`;
  const body = {
    text: "[approval]",
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const first = await post(`/sessions/${session.id}/turns`, body, {
    "Idempotency-Key": intent,
  });
  expect(first.status(), await first.text()).toBe(202);
  const operationId = (await first.json()).operation.id;
  expect(
    (
      await post(`/sessions/${session.id}/turns`, body, {
        "Idempotency-Key": intent,
      })
    ).status(),
  ).toBe(202);
  await expect
    .poll(
      async () =>
        (
          await (
            await context.request.get(
              origin + `/api/v1/sessions/${session.id}/snapshot`,
            )
          ).json()
        ).approvals.some((a: any) => a.state === "pending"),
      { timeout: 30000 },
    )
    .toBe(true);
  const cancel = await post(`/turns/${operationId}/cancel`, {});
  expect(cancel.status(), await cancel.text()).toBe(202);
  await expect
    .poll(
      async () =>
        (
          await (
            await context.request.get(
              origin + `/api/v1/sessions/${session.id}/snapshot`,
            )
          ).json()
        ).operations.some((o: any) =>
          ["running", "waiting_approval", "dispatching"].includes(o.state),
        ),
      { timeout: 30000 },
    )
    .toBe(false);
  await stop();
  logs = "";
  start();
  await expect
    .poll(() => logs.includes("Local Harbor:"), { timeout: 120000 })
    .toBe(true);
  expect(
    (await (await context.request.get(origin + "/api/v1/sessions")).json())
      .sessions[0].id,
  ).toBe(session.id);
  console.log(
    `P013 local real-stack E2E passed; external Codex simulated. Artifact: ${dir}`,
  );
} catch (error) {
  // Startup output can contain database connection strings: keep it out of artifacts.
  console.error(logs.replace(/postgres:\/\/[^\s]+/g, "[database redacted]"));
  throw error;
} finally {
  await browser?.close();
  await stop();
  if (saved)
    execFileSync("docker", ["compose", ...localComposeFiles(), "down", "-v"], {
      env: {
        ...process.env,
        HARBOR_INSTANCE_ID: saved.instance,
        HARBOR_DATABASE_PASSWORD: saved.password,
        HARBOR_DATABASE_PORT: String(saved.dbPort),
        HARBOR_API_PORT: String(saved.apiPort),
        HARBOR_HTTPS_PORT: String(saved.httpsPort),
      },
      stdio: "ignore",
    });
  await rm(state, { recursive: true, force: true });
  await rm(binary, { force: true });
  await rm(fixture, { force: true });
}
