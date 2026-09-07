/** Installed UI/file/PTY/drain acceptance. No Harbor fixture and no backup transfer. */
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, chown, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createPool } from "../../packages/storage/src/index.ts";
const tools = process.env.HARBOR_DEPLOY_TEST_TOOLS!;
const admission = JSON.parse(await readFile(tools + "/admission.json", "utf8"));
const c = JSON.parse(await readFile(admission.config, "utf8"));
const evidence =
  process.env.HARBOR_MODULE_EVIDENCE_DIR ??
  admission.control + "/modules-" + randomUUID();
await mkdir(evidence, { mode: 0o700, recursive: true });
console.log("Installed module evidence: " + evidence);
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
const browser = process.env.HARBOR_TEST_BROWSER_ENDPOINT
  ? await chromium.connect(process.env.HARBOR_TEST_BROWSER_ENDPOINT, {
      exposeNetwork: [new URL(c.origin).host, new URL(c.oidcIssuer).host].join(
        ",",
      ),
    })
  : await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
const violations: string[] = [];
let reconciledDroppedResponse = false;
let droppedOperationId: string | undefined;
let completeResponseDrop!: () => void;
let rejectResponseDrop!: (reason: unknown) => void;
const responseDropCompleted = new Promise<void>((resolve, reject) => {
  completeResponseDrop = resolve;
  rejectResponseDrop = reject;
});
void responseDropCompleted.catch(() => {});
const dropSaveResponse = process.env.HARBOR_MODULE_DROP_SAVE_RESPONSE === "1";
const transport: {
  method: string;
  path: string;
  status?: number;
  failure?: string;
}[] = [];
page.on("response", (response) => {
  if (
    transport.length < 128 &&
    new URL(response.url()).pathname.startsWith("/api/v1")
  )
    transport.push({
      method: response.request().method(),
      path: new URL(response.url()).pathname,
      status: response.status(),
    });
});
page.on("requestfailed", (request) => {
  if (transport.length < 128)
    transport.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      failure: (request.failure()?.errorText ?? "unknown")
        .replace(/https?:\/\/\S+/g, "[url]")
        .slice(0, 160),
    });
});
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
  const originalTerminalIds = (
    await db.query("SELECT id FROM terminals")
  ).rows.map((row) => row.id);
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
  let w = (
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
  if (dropSaveResponse)
    await page.route(
      "**/api/v1" + `/workspaces/${w.id}/files/save`,
      async (route) => {
        try {
          const response = await route.fetch();
          expect(response.status()).toBe(202);
          droppedOperationId = (await response.json()).operation.id;
          expect(droppedOperationId).toMatch(/^[a-f0-9-]{36}$/);
          await expect
            .poll(
              async () =>
                (
                  await db.query(
                    "SELECT state FROM file_operations WHERE id=$1 AND workspace_id=$2",
                    [droppedOperationId, w.id],
                  )
                ).rows[0]?.state,
              { timeout: 30000 },
            )
            .toBe("succeeded");
          await route.abort("failed");
          completeResponseDrop();
        } catch (error) {
          rejectResponseDrop(error);
          await route.abort("failed").catch(() => {});
        }
      },
      { times: 1 },
    );
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect
    .poll(() => readFile(file, "utf8"), { timeout: 30000 })
    .toBe("Saved through installed unprivileged API\n");
  if (dropSaveResponse) {
    await responseDropCompleted;
    await expect(
      page.getByRole("button", {
        name: "Retry same file operation",
        exact: true,
      }),
    ).toBeVisible();
    const before = (
      await db.query(
        "SELECT id,state,request_hash FROM file_operations WHERE workspace_id=$1 ORDER BY created_at",
        [w.id],
      )
    ).rows;
    expect(before.find((o) => o.id === droppedOperationId)?.state).toBe(
      "succeeded",
    );
    await page
      .getByRole("button", { name: "Retry same file operation", exact: true })
      .click();
    await expect(page.getByText("Unsaved draft", { exact: true })).toBeHidden({
      timeout: 30000,
    });
    const after = (
      await db.query(
        "SELECT id,state,request_hash FROM file_operations WHERE workspace_id=$1 ORDER BY created_at",
        [w.id],
      )
    ).rows;
    expect(after).toEqual(before);
    expect(await readFile(file, "utf8")).toBe(
      "Saved through installed unprivileged API\n",
    );
    reconciledDroppedResponse = true;
  } else
    await expect(page.getByText("Unsaved draft", { exact: true })).toBeHidden({
      timeout: 30000,
    });
  await page.screenshot({
    path: evidence + "/modules-editor.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close files", exact: true }).click();
  let copied =
    process.env.HARBOR_MODULE_RESUME_OWNED === "1"
      ? (
          await db.query(
            "SELECT id FROM workspaces WHERE project_id=$1 AND source_workspace_id=$2 AND name='Installed copy' AND kind='copy' AND state<>'removed' ORDER BY created_at LIMIT 1",
            [project.id, w.id],
          )
        ).rows[0]
      : undefined;
  if (!copied) {
    const copyResponse = await command(`/projects/${project.id}/workspaces`, {
      name: "Installed copy",
      kind: "copy",
      sourceWorkspaceId: w.id,
      dirtyPolicy: "snapshot",
    });
    expect(copyResponse.status(), await copyResponse.text()).toBe(200);
    copied = (await copyResponse.json()).workspace;
  }
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM workspaces WHERE id=$1", [
            copied.id,
          ])
        ).rows[0]?.state,
      { timeout: 30000 },
    )
    .toBe("ready");
  w = (await db.query("SELECT * FROM workspaces WHERE id=$1", [copied.id]))
    .rows[0];
  expect(await readFile(w.canonical_path + "/tracked.txt", "utf8")).toBe(
    "Saved through installed unprivileged API\n",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Installed modules", exact: true })
    .click();
  await page
    .getByLabel("New conversation workspace", { exact: true })
    .selectOption(w.id);

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
    path: evidence + "/modules-terminal.png",
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
  expect(
    inspection.Mounts.some(
      (m: any) =>
        m.Source === w.canonical_path && m.Destination === "/workspace",
    ),
  ).toBe(true);
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
  expect(registry.terminals.map((row: any) => row.id).sort()).toEqual(
    [...originalTerminalIds, terminal.id, queued.id].sort(),
  );
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
    evidence + "/modules-result.json",
    JSON.stringify(
      {
        status: "passed",
        resumedOwnedFixture: process.env.HARBOR_MODULE_RESUME_OWNED === "1",
        reconciledDroppedResponse,
        browserTopology: process.env.HARBOR_TEST_BROWSER_ENDPOINT
          ? "external Playwright client; Linux Harbor components"
          : "colocated Linux Chromium",
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
      path: evidence + "/modules-failure.png",
      fullPage: true,
    })
    .catch(() => {});
  const health = await context.request
    .get(c.origin + "/api/v1/me")
    .catch(() => null);
  await writeFile(
    evidence + "/modules-failure.json",
    JSON.stringify(
      {
        path: new URL(page.url()).pathname,
        meStatus: health?.status() ?? null,
        consoleErrors: violations,
        transport,
        fileStates: (
          await db.query(
            "SELECT state,failure_code FROM file_operations ORDER BY created_at DESC LIMIT 8",
          )
        ).rows,
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
