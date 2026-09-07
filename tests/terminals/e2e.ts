import { terminalGitFence } from "./git-fence.ts";
import { terminalReviewFixes } from "./review-fixes.ts";
import { terminalFaults } from "./faults.ts";
import { terminalExpiry } from "./expiry.ts";
import { terminalBounds } from "./bounds.ts";
import { terminalSecurity } from "./security.ts";
import { sourceDigest } from "../../scripts/source-digest.ts";
import { localComposeFiles } from "../../infra/compose.ts";
import { maintain } from "../../packages/storage/src/maintenance.ts";
import { checkKey } from "../../packages/policy/src/index.ts";
import { Ajv2020 } from "ajv/dist/2020.js";
import pg from "pg";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
import { chromium, expect, request as apiRequest } from "@playwright/test";
const sourceAtStart = sourceDigest();
const children: ChildProcess[] = [];
let diagnosticText = "";
let rotationBearer = "";

const dir = await mkdtemp(
    path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "harbor-e2e-",
    ),
  ),
  instance = "harbor-e2e-" + randomBytes(5).toString("hex");
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
    env: {
      ...env,
      PGAPPNAME: file.includes("/supervisor/") ? "p006-supervisor" : "p006-api",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (b: Buffer) => {
    diagnosticText = (diagnosticText + b.toString()).slice(-131072);
  };
  p.stdout?.on("data", capture);
  p.stderr?.on("data", capture);
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
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  await mkdir(path.join(dir, "project-roots"), { mode: 0o700 });
  await mkdir(path.join(dir, "control"), { mode: 0o700 });
  await writeFile(env.HARBOR_CREDENTIAL_KEY_FILE, randomBytes(32), {
    mode: 0o600,
  });
  compose(["up", "-d", "--wait"]);
  start("tests/fixtures/oidc/server.ts");
  let api = start("apps/api/src/main.ts");
  let supervisor = start("apps/supervisor/src/main.ts");
  browser = await chromium.launch({ headless: true });
  let context = await browser.newContext({ ignoreHTTPSErrors: true });
  let page = await context.newPage();
  const browserErrors: string[] = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") browserErrors.push(m.text());
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
  const me = await (await context.request.get(origin + "/api/v1/me")).json();
  const headers = { Origin: origin, "X-CSRF-Token": me.csrfToken };
  const command = (
    route: string,
    data: unknown,
    key = `${Date.now()}:${randomUUID()}`,
  ) =>
    context.request.post(origin + "/api/v1" + route, {
      data,
      headers: { ...headers, "Idempotency-Key": key },
    });
  const created = await command("/projects", {
    name: "PTY project",
    rootId,
    path: "pty-project",
    create: true,
  });
  expect(created.status(), await created.text()).toBe(200);
  const project = (await created.json()).project;
  await page.reload();
  await page.getByRole("button", { name: "PTY project", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open terminals", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Open terminals", exact: true })
    .click();
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  const db = new pg.Pool({ connectionString: env.DATABASE_URL });
  try {
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT state,failure_code FROM terminals ORDER BY created_at DESC LIMIT 1",
            )
          ).rows[0],
        { timeout: 30000 },
      )
      .toEqual({ state: "running", failure_code: null });
    await expect(page.locator(".xterm-screen")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Take control", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Take control", exact: true })
      .click();
    await expect(
      page.getByText("You control this terminal.", { exact: true }),
    ).toBeVisible();
    const textarea = page.locator(".xterm-helper-textarea");
    await textarea.pressSequentially(
      "printf '\\033[31mHARBOR_%s\\033[0m\\n' PTY_READY",
      { delay: 70 },
    );
    await textarea.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText(
      "HARBOR_PTY_READY",
      { timeout: 15000 },
    );
    expect(
      browserErrors.filter((e) =>
        /Content Security Policy|Refused to apply|requestMode|renderer/i.test(
          e,
        ),
      ),
    ).toEqual([]);
    const response = await context.request.get(origin + "/");
    expect(response.headers()["content-security-policy"]).toContain(
      "style-src 'self' 'nonce-",
    );
    expect(response.headers()["content-security-policy"]).not.toContain(
      "unsafe-inline",
    );
    expect(
      await page.evaluate(
        () =>
          [...document.querySelectorAll(".xterm style")].filter(
            (s) =>
              (s as HTMLStyleElement).nonce ===
              document.querySelector<HTMLMetaElement>(
                'meta[name="harbor-style-nonce"]',
              )?.content,
          ).length,
      ),
    ).toBe(3);
    await page.screenshot({
      path: path.join(artifacts, "terminal-desktop.png"),
      fullPage: true,
    });
    const t = (await db.query("SELECT * FROM terminals LIMIT 1")).rows[0];
    if (process.argv.includes("--terminal-git-fence")) {
      await terminalGitFence({ db, command, t });
    } else if (process.argv.includes("--terminal-review-fixes")) {
      await command(`/terminals/${t.id}/terminate`, {
        generation: Number(t.generation),
      });
      await expect
        .poll(
          async () =>
            (
              await db.query("SELECT retired FROM terminals WHERE id=$1", [
                t.id,
              ])
            ).rows[0].retired,
          { timeout: 20000 },
        )
        .toBe(true);
      await terminalReviewFixes({
        directOrigin: `http://127.0.0.1:${apiPort}`,
        context,
        page,
        db,
        origin,
        csrf: me.csrfToken,
        t,
        supervisor,
        restartSupervisor: () =>
          (supervisor = start("apps/supervisor/src/main.ts")),
        command,
      });
    } else {
      // Persist actual shell variables and produce output while every browser and
      // the API are gone. The supervisor/PTY and writer epoch remain unchanged.
      await textarea.pressSequentially(
        "HARBOR_PERSIST=kept; (sleep 2; printf 'DETACHED_%s\\n' OUTPUT)&",
        { delay: 70 },
      );
      await textarea.press("Enter");
      await expect
        .poll(
          async () =>
            (
              await db.query(
                "SELECT count(*) AS n FROM terminal_input WHERE terminal_id=$1 AND state IN ('accepted','dispatching')",
                [t.id],
              )
            ).rows[0].n,
        )
        .toBe("0");
      const saved = await context.storageState();
      await context.close();
      const exited = new Promise<void>((resolve) =>
        api.once("exit", () => resolve()),
      );
      api.kill("SIGTERM");
      await exited;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      api = start("apps/api/src/main.ts");
      context = await browser.newContext({
        ignoreHTTPSErrors: true,
        storageState: saved,
      });
      await expect
        .poll(
          async () => {
            try {
              return (
                await context.request.get(origin + "/api/v1/me")
              ).status();
            } catch {
              return 0;
            }
          },
          { timeout: 20000 },
        )
        .toBe(200);
      page = await context.newPage();
      await page.goto(origin + "/");
      await page
        .getByRole("button", { name: "Open terminals", exact: true })
        .click();
      await page.getByLabel("Selected terminal").selectOption(t.id);
      await expect(page.locator(".xterm-rows")).toContainText(
        "DETACHED_OUTPUT",
        {
          timeout: 15000,
        },
      );
      await expect(
        page.getByText("Read-only viewer. Take control to send input.", {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        (
          await db.query(
            "SELECT generation,writer_epoch,state FROM terminals WHERE id=$1",
            [t.id],
          )
        ).rows[0],
      ).toEqual({
        generation: t.generation,
        writer_epoch: t.writer_epoch,
        state: "running",
      });
      await page
        .getByRole("button", { name: "Take control", exact: true })
        .click();
      await expect(
        page.getByText("You control this terminal.", { exact: true }),
      ).toBeVisible();
      await page
        .locator(".xterm-helper-textarea")
        .pressSequentially("printf 'STATE_%s\\n' \"$HARBOR_PERSIST\"", {
          delay: 70,
        });
      await page.locator(".xterm-helper-textarea").press("Enter");
      await expect(page.locator(".xterm-rows")).toContainText("STATE_kept", {
        timeout: 15000,
      });
      const pasteIntoTerminal = async (text: string) =>
        page.locator(".terminal-canvas").evaluate((node, text) => {
          const data = new DataTransfer();
          data.setData("text/plain", text);
          node.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            }),
          );
        }, text);
      const beforePaste = (
        await db.query("SELECT input_sequence FROM terminals WHERE id=$1", [
          t.id,
        ])
      ).rows[0].input_sequence;
      const multiline = [
        "printf 'PASTE_%s\\n' FIRST",
        "printf 'PASTE_%s\\n' SECOND",
        "",
      ].join("\n");
      await pasteIntoTerminal(multiline);
      await expect(
        page
          .getByRole("dialog", { name: "Confirm multiline paste" })
          .locator("pre"),
      ).toHaveText(multiline);
      expect(
        (
          await db.query("SELECT input_sequence FROM terminals WHERE id=$1", [
            t.id,
          ])
        ).rows[0].input_sequence,
      ).toBe(beforePaste);
      await page
        .getByRole("button", { name: "Cancel paste", exact: true })
        .click();
      await pasteIntoTerminal(multiline);
      await page
        .getByRole("button", { name: "Send paste", exact: true })
        .click();
      await expect(page.locator(".xterm-rows")).toContainText("PASTE_SECOND");
      const originalTitle = await page.title(),
        external: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("hostile.invalid")) external.push(r.url());
      });
      const beforeHostile = Number(
        (
          await db.query("SELECT input_sequence FROM terminals WHERE id=$1", [
            t.id,
          ])
        ).rows[0].input_sequence,
      );
      const ESC = String.fromCharCode(27),
        BEL = String.fromCharCode(7);
      const hostile = `${ESC}]52;c;QQ==${BEL}${ESC}]8;;https://hostile.invalid${BEL}LINK${ESC}]8;;${BEL}${ESC}]2;HOSTILE_TITLE${BEL}${ESC}[6n<img src=https://hostile.invalid>SAFE_OUTPUT\n`;
      await pasteIntoTerminal(
        `node -e 'process.stdout.write(Buffer.from("${Buffer.from(hostile).toString("base64")}","base64"))'` +
          String.fromCharCode(10),
      );
      await page
        .getByRole("button", { name: "Send paste", exact: true })
        .click();
      await expect(page.locator(".xterm-rows")).toContainText("SAFE_OUTPUT");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await page.title()).toBe(originalTitle);
      expect(external).toEqual([]);
      expect(await page.locator('img[src*="hostile.invalid"]').count()).toBe(0);
      expect(
        Number(
          (
            await db.query("SELECT input_sequence FROM terminals WHERE id=$1", [
              t.id,
            ])
          ).rows[0].input_sequence,
        ),
      ).toBe(beforeHostile + 1);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(
          async () =>
            (
              await db.query("SELECT resize_cols FROM terminals WHERE id=$1", [
                t.id,
              ])
            ).rows[0].resize_cols,
        )
        .toBeLessThan(80);
      await expect(
        page.getByRole("button", { name: "Terminate terminal", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      const canvasBox = await page.locator(".terminal-canvas").boundingBox();
      expect(
        Math.min(844, canvasBox!.y + canvasBox!.height) -
          Math.max(0, canvasBox!.y),
      ).toBeGreaterThanOrEqual(260);
      await page.screenshot({
        path: path.join(artifacts, "terminal-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1280, height: 720 });

      await terminalSecurity({
        context,
        db,
        origin,
        csrf: me.csrfToken,
        t,
        supervisor,
        command,
      });
      await terminalExpiry({ context, db, origin, t, supervisor, command });
      await terminalBounds({
        context,
        db,
        origin,
        csrf: me.csrfToken,
        t,
        supervisor,
        command,
        showGap: async (tail) => {
          await expect
            .poll(async () =>
              page
                .getByLabel("Selected terminal")
                .locator(`option[value="${tail}"]`)
                .count(),
            )
            .toBe(1);
          await page.getByLabel("Selected terminal").selectOption(tail);
          await expect(
            page.getByText(
              "Older output expired or was lost. The display was reset; this tail cannot reconstruct a full-screen application.",
              { exact: true },
            ),
          ).toBeVisible();
          await page.getByLabel("Selected terminal").selectOption(t.id);
        },
      });
      const stopped = await command(`/terminals/${t.id}/terminate`, {
        generation: Number(t.generation),
      });
      expect(stopped.status(), await stopped.text()).toBe(202);
      await expect
        .poll(
          async () =>
            (
              await db.query("SELECT retired FROM terminals WHERE id=$1", [
                t.id,
              ])
            ).rows[0].retired,
          { timeout: 20000 },
        )
        .toBe(true);
      await terminalFaults({
        context,
        db,
        origin,
        csrf: me.csrfToken,
        t,
        command,
      });
      await terminalReviewFixes({
        directOrigin: `http://127.0.0.1:${apiPort}`,
        context,
        page,
        db,
        origin,
        csrf: me.csrfToken,
        t,
        supervisor,
        restartSupervisor: () =>
          (supervisor = start("apps/supervisor/src/main.ts")),
        command,
      });
    }
  } finally {
    await db.end();
  }
  expect(diagnosticText, "No database deadlock in any viewer").not.toContain(
    "(40P01)",
  );
  await writeFile(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        instance,
        status: "passed",
        node: process.version,
        sourceAtStart,
        sourceAtEnd: sourceDigest(),
        scope: process.argv.includes("--terminal-git-fence")
          ? "P004/P006 focused shared-Git reservation admission with real UI/API/supervisor; synthetic file lifecycle checkpoints, external OIDC/Codex PTY fixture; Linux separate"
          : process.argv.includes("--terminal-stream-check")
            ? "P006 focused real terminal stream/authority/slow-reader acceptance; external OIDC/Codex PTY fixture; Linux separate"
            : process.argv.includes("--terminal-review-fixes")
              ? "P006 corrective browser/API/DB/process/stream acceptance with initial UI smoke; external OIDC/Codex PTY fixture; Linux separate"
              : "P006 complete terminal application acceptance; external OIDC/Codex PTY fixture; Linux separate",
      },
      null,
      2,
    ),
  );
  console.log("P006 initial real-stack acceptance passed: " + artifacts);
} catch (error) {
  const deadlocks: unknown[] = [];
  if (diagnosticText.includes("(40P01)")) {
    const logs = compose([
      "logs",
      "--no-color",
      "--tail",
      "300",
      "postgres",
    ]).toString();
    for (const line of logs.split("\n")) {
      const query = line.match(/Process \d+: (.+)/)?.[1];
      const wait = line.match(
        /Process \d+ waits for [A-Za-z]+ on (?:transaction|tuple|relation) [0-9(), ]+; blocked by process \d+/,
      )?.[0];
      if (wait) deadlocks.push({ wait });
      const relation = line.match(
        /while (?:locking|updating) tuple \([0-9,]+\) in relation "([a-z_]+)"/,
      )?.[1];
      if (relation) deadlocks.push({ relation });
      if (query)
        deadlocks.push({
          verb: query.match(/^(SELECT|UPDATE|DELETE|INSERT)/)?.[1] ?? "other",
          tables: [
            ...query.matchAll(/(?:FROM|UPDATE|JOIN|INTO)\s+([a-z_]+)/g),
          ].map((m) => m[1]),
          locks: [
            ...query.matchAll(/FOR (UPDATE|SHARE|KEY SHARE|NO KEY UPDATE)/g),
          ].map((m) => m[1]),
          whereColumn: query.match(/WHERE ([a-z_.]+)/)?.[1] ?? null,
          columns: [...query.matchAll(/([a-z_]+)\s*=/g)].map((m) => m[1]),
        });
    }
  }
  await writeFile(
    path.join(artifacts, "failure.json"),
    JSON.stringify(
      {
        error: String(error),
        deadlocks,
        diagnostics: diagnosticText.replaceAll(password, "[redacted]"),
        sourceAtStart,
        sourceAtEnd: sourceDigest(),
      },
      null,
      2,
    ),
  );
  const page = browser?.contexts()[0]?.pages()[0];
  if (page)
    await page
      .screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true })
      .catch(() => {});
  console.error("P006 failed checkpoint: " + artifacts);
  throw error;
} finally {
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
