/** Installed UI/file/PTY/drain acceptance. No Harbor fixture and no backup transfer. */
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, chown } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createPool } from "../../packages/storage/src/index.ts";
const tools = process.env.HARBOR_DEPLOY_TEST_TOOLS!;
const admission = JSON.parse(await readFile(tools + "/admission.json", "utf8"));
const c = JSON.parse(await readFile(admission.config, "utf8"));
const release = process.env.HARBOR_MANAGED_RELEASE!;
if (
  process.getuid?.() !== 0 ||
  !release?.startsWith("/opt/codex-harbor/releases/")
)
  throw Error("Run-owned installed root profile required");
const manifest = JSON.parse(await readFile(release + "/release.json", "utf8"));
const bridge = (action: string, fields: any = {}) =>
  JSON.parse(
    execFileSync(
      release + "/bin/node",
      [
        "--import",
        release + "/node_modules/tsx/dist/loader.mjs",
        release + "/infra/deploy/database.ts",
      ],
      {
        input: JSON.stringify({ action, ...fields }),
        env: process.env,
        timeout: 60000,
        encoding: "utf8",
      },
    ),
  );
const db = createPool(process.env.DATABASE_URL!);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
const violations: string[] = [];
page.on("console", (m) => {
  if (
    m.type() === "error" &&
    /Content Security Policy|Refused to apply/.test(m.text())
  )
    violations.push(m.text().slice(0, 200));
});
try {
  const { retireFileHelper } = await import(
    release + "/infra/files/launcher.ts"
  );
  const collision = randomUUID();
  const canary = execFileSync(
    "docker",
    [
      "create",
      "--name",
      "harbor-file-" + collision,
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--entrypoint=/bin/true",
      "--label",
      "org.codex-harbor.owner=file-helper",
      "--label",
      "org.codex-harbor.operation=" + collision,
      "--label",
      "org.codex-harbor.instance=owned-other-instance-canary",
      manifest.images.files.id,
    ],
    { encoding: "utf8" },
  ).trim();
  try {
    await expect(retireFileHelper(collision)).rejects.toThrow(
      "ownership mismatch",
    );
    expect(
      execFileSync("docker", ["inspect", "--format", "{{.Id}}", canary], {
        encoding: "utf8",
      }).trim(),
    ).toBe(canary);
  } finally {
    execFileSync("docker", ["rm", canary], { stdio: "pipe" });
  }
  await page.goto(c.origin + "/auth/login");
  await page
    .getByRole("button", { name: "Sign in as owner", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add project", exact: true }).first(),
  ).toBeVisible();
  const me = await (await context.request.get(c.origin + "/api/v1/me")).json();
  const headers = { Origin: c.origin, "x-csrf-token": me.csrfToken };
  const command = (route: string, data: any) =>
    context.request.post(c.origin + "/api/v1" + route, {
      data,
      headers: {
        ...headers,
        "Idempotency-Key": Date.now() + ":" + randomUUID(),
      },
    });
  let project: any;
  if (process.env.HARBOR_MODULE_RESUME_OWNED === "1") {
    project = (
      await db.query(
        "SELECT * FROM projects WHERE name='Installed modules' AND root_id=$1 AND relative_path='installed-modules/workspace'",
        [c.roots[0].id],
      )
    ).rows[0];
    expect(project).toBeTruthy();
  } else {
    const response = await command("/projects", {
      name: "Installed modules",
      rootId: c.roots[0].id,
      path: "installed-modules",
      create: true,
    });
    expect(response.status(), await response.text()).toBe(200);
    project = (await response.json()).project;
  }
  const w = (
    await db.query(
      "SELECT * FROM workspaces WHERE project_id=$1 AND kind='local'",
      [project.id],
    )
  ).rows[0];
  const file = w.canonical_path + "/tracked.txt";
  await writeFile(file, "Installed file seed\n", { mode: 0o644 });
  await chown(file, 10001, 10001);
  await page.reload();
  await page
    .getByRole("button", { name: "Installed modules", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Files and changes", exact: true })
    .click();
  await page.getByRole("button", { name: "tracked.txt", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("Saved through installed unprivileged API\n");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect
    .poll(() => readFile(file, "utf8"), { timeout: 30000 })
    .toBe("Saved through installed unprivileged API\n");
  await expect(page.getByText("Unsaved draft", { exact: true })).toBeHidden({
    timeout: 30000,
  });
  await page.screenshot({
    path: admission.control + "/modules-editor.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close files", exact: true }).click();
  await page
    .getByRole("button", { name: "Open terminals", exact: true })
    .click();
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT state FROM terminals WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1",
            [w.id],
          )
        ).rows[0]?.state,
      { timeout: 30000 },
    )
    .toBe("running");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  await expect(
    page.getByText("You control this terminal.", { exact: true }),
  ).toBeVisible();
  const textarea = page.locator(".xterm-helper-textarea");
  await textarea.pressSequentially(
    "sleep 300 & printf 'INSTALLED_%s\\n' BACKGROUND",
    { delay: 50 },
  );
  await textarea.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "INSTALLED_BACKGROUND",
    { timeout: 10000 },
  );
  await page.screenshot({
    path: admission.control + "/modules-terminal.png",
    fullPage: true,
  });
  expect(violations).toEqual([]);
  const terminal = (
    await db.query(
      "SELECT * FROM terminals WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1",
      [w.id],
    )
  ).rows[0];
  const name = `harbor-${c.instance}-terminal-${terminal.id}-${terminal.generation}`;
  const inspection = JSON.parse(
    execFileSync("docker", ["inspect", name], { encoding: "utf8" }),
  )[0];
  expect(inspection.HostConfig.NetworkMode).toBe("none");
  expect(inspection.Config.Image).toBe(manifest.images.runner.id);
  expect(
    inspection.Mounts.some((m: any) =>
      /docker.sock|credentials.sock/.test(m.Source),
    ),
  ).toBe(false);
  const queuedResponse = await command(`/workspaces/${w.id}/terminals`, {
    permissionProfile: "read-only",
    cols: 80,
    rows: 24,
  });
  expect(queuedResponse.status()).toBe(202);
  const queued = (await queuedResponse.json()).terminal;
  bridge("maintenance", { enabled: true });
  expect(
    (
      await command(`/workspaces/${w.id}/terminals`, {
        permissionProfile: "read-only",
        cols: 80,
        rows: 24,
      })
    ).status(),
  ).toBe(503);
  expect(bridge("status").queuedTerminals).toBe(1);
  const registry = bridge("registry");
  expect(registry.modules.P004).toHaveLength(4);
  expect(registry.modules.P006).toHaveLength(3);
  expect(registry.terminals).toHaveLength(2);
  bridge("interrupt");
  await expect
    .poll(() => bridge("status").activeTerminals, { timeout: 30000 })
    .toBe(0);
  expect(
    (await db.query("SELECT state FROM terminals WHERE id=$1", [queued.id]))
      .rows[0].state,
  ).toBe("queued");
  const drained = JSON.parse(
    execFileSync(
      release + "/bin/harborctl",
      ["--config", admission.config, "drain"],
      { env: process.env, timeout: 120000, encoding: "utf8" },
    ),
  );
  expect(drained.drained).toBe(true);
  expect(
    execFileSync("docker", ["ps", "-aq", "--filter", `name=^/${name}$`], {
      encoding: "utf8",
    }).trim(),
  ).toBe("");
  expect(
    JSON.parse(
      await readFile(
        process.env.HARBOR_LAUNCHER_STATE_DIR + "/file-slots.json",
        "utf8",
      ),
    ),
  ).toEqual([]);
  const status = bridge("status");
  expect(status.activeTerminals).toBe(0);
  expect(status.activeFiles).toBe(0);
  expect(status.queuedTerminals).toBe(1);
  expect(status.deployment.maintenance).toBe(true);
  await writeFile(
    admission.control + "/modules-result.json",
    JSON.stringify(
      {
        status: "passed",
        resumedOwnedFixture: process.env.HARBOR_MODULE_RESUME_OWNED === "1",
        node: process.version,
        artifact: manifest.artifact,
        source: manifest.source,
        installedUiSave: true,
        installedNativePty: true,
        sharedDocumentCsp: true,
        noModelAccount: true,
        networkNone: true,
        wholeBackgroundRetired: true,
        wrongInstanceFileHelperPreserved: true,
        queuedRetainedWithoutDrainDeadlock: true,
        modules: registry.modules,
        protectedTransfer: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("Installed modules acceptance passed");
} catch (error) {
  await page
    .screenshot({
      path: admission.control + "/modules-failure.png",
      fullPage: true,
    })
    .catch(() => {});
  const health = await context.request
    .get(c.origin + "/api/v1/me")
    .catch(() => null);
  await writeFile(
    admission.control + "/modules-failure.json",
    JSON.stringify(
      {
        path: new URL(page.url()).pathname,
        meStatus: health?.status() ?? null,
        consoleErrors: violations,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
  await db.end();
}
