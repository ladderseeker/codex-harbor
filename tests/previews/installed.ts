import { openProjectTools } from "../e2e/navigation.ts";
/** Full installed Linux Harbor components; only identity provider is external. */
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, chown } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createPool } from "../../packages/storage/src/index.ts";
import { sourceDigest } from "../../scripts/source-digest.ts";
const tools = process.env.HARBOR_DEPLOY_TEST_TOOLS!;
const admission = JSON.parse(await readFile(tools + "/admission.json", "utf8"));
const c = JSON.parse(await readFile(admission.config, "utf8"));
const evidence = process.env.HARBOR_PREVIEW_EVIDENCE!;
const release = process.env.HARBOR_MANAGED_RELEASE!;
const manifest = JSON.parse(await readFile(release + "/release.json", "utf8"));
if (
  process.getuid?.() !== 0 ||
  !release.startsWith("/opt/codex-harbor/releases/")
)
  throw Error("Owned installed root test required");
const db = createPool(process.env.DATABASE_URL!);
const browser = await chromium.launch({
  headless: true,
  args: ["--host-resolver-rules=MAP *.preview.localhost 127.0.0.1"],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
const traffic: {
  method: string;
  path: string;
  status?: number;
  failure?: string;
}[] = [];
context.on("response", (r) => {
  if (traffic.length < 128)
    traffic.push({
      method: r.request().method(),
      path: new URL(r.url()).pathname,
      status: r.status(),
    });
});
context.on("requestfailed", (r) => {
  if (traffic.length < 128)
    traffic.push({
      method: r.method(),
      path: new URL(r.url()).pathname,
      failure: (r.failure()?.errorText ?? "unknown").slice(0, 100),
    });
});
const sourceAtStart = sourceDigest();
const cli = (args: string[]) =>
  JSON.parse(
    execFileSync(
      release + "/bin/harborctl",
      ["--config", admission.config, ...args],
      {
        env: process.env,
        encoding: "utf8",
        timeout: 90000,
        maxBuffer: 1048576,
      },
    ),
  );
try {
  const reusedFixture = process.env.HARBOR_PREVIEW_REUSE_INSTALL === "1";
  if (reusedFixture) {
    expect(
      Number(
        (await db.query("SELECT count(*) FROM previews WHERE NOT retired"))
          .rows[0].count,
      ),
    ).toBe(0);
    cli(["resume"]);
    await db.query("UPDATE harbor_meta SET emergency=false");
  }
  const projectName = "Installed private preview " + randomUUID().slice(0, 8);
  await page.goto(c.origin + "/auth/login");
  await page
    .getByRole("button", { name: "Sign in as owner", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add project", exact: true }).first(),
  ).toBeVisible();
  const me = await (await context.request.get(c.origin + "/api/v1/me")).json();
  const command = async (route: string, data: unknown, status = 200) => {
    const r = await context.request.post(c.origin + "/api/v1" + route, {
      headers: {
        Origin: c.origin,
        "X-CSRF-Token": me.csrfToken,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data,
    });
    expect(r.status()).toBe(status);
    return r.json();
  };
  const { project } = await command("/projects", {
    rootId: c.roots[0].id,
    name: projectName,
    path: "preview-app-" + randomUUID().slice(0, 8),
    create: true,
  });
  const w = (
    await db.query(
      "SELECT * FROM workspaces WHERE project_id=$1 AND kind='local'",
      [project.id],
    )
  ).rows[0];
  for (const [name, content] of [
    [
      "package.json",
      JSON.stringify({ private: true, scripts: { dev: "node server.mjs" } }),
    ],
    [
      "server.mjs",
      `import http from 'node:http';http.createServer((req,res)=>{if(req.url==='/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: installed preview\\n\\n');return;}res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><h1>Installed private preview</h1><p id="event"></p><script>new EventSource("/events").onmessage=e=>document.querySelector("#event").textContent=e.data</script>');}).listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('INSTALLED_PREVIEW_READY'));`,
    ],
  ]) {
    const file = w.canonical_path + "/" + name;
    await writeFile(file, content, { mode: 0o644 });
    await chown(file, 10001, 10001);
  }
  await page.reload();
  await page
    .getByRole("navigation", { name: "Projects", exact: true })
    .getByRole("button", { name: projectName, exact: true })
    .click();
  await openProjectTools(page);
  await page
    .getByRole("button", { name: "Project previews", exact: true })
    .click();
  await page.getByLabel("Preview name", { exact: true }).fill("Installed app");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/previews") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save preview", exact: true }).click();
  const p = (await (await response).json()).preview;
  await page
    .getByRole("button", { name: "Start preview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Prepare private access", exact: true }),
  ).toBeEnabled({ timeout: 45000 });
  await page
    .getByRole("button", { name: "Prepare private access", exact: true })
    .click();
  const opened = context.waitForEvent("page");
  await page
    .getByRole("link", { name: "Open preview in new tab", exact: false })
    .click();
  const popup = await opened;
  await expect(
    popup.getByRole("heading", { name: "Installed private preview" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(popup.locator("#event")).toHaveText("installed preview");
  const active = (await db.query("SELECT * FROM previews WHERE id=$1", [p.id]))
    .rows[0];
  const physical = JSON.parse(
    execFileSync("docker", ["inspect", active.runner_id], { encoding: "utf8" }),
  )[0];
  expect(physical.HostConfig.NetworkMode).toBe("none");
  const relay = JSON.parse(
    execFileSync("docker", ["inspect", active.relay_id], { encoding: "utf8" }),
  )[0];
  expect(relay.Image).toBe(manifest.images.previewRelay.id);
  expect(relay.Mounts).toEqual([]);
  expect(relay.HostConfig.NetworkMode).toBe("container:" + active.runner_id);
  expect(
    (await db.query("SELECT count(*)::int n FROM runtime_credentials")).rows[0]
      .n,
  ).toBe(0);
  await page.screenshot({
    path: evidence + "/preview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Stop preview", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: evidence + "/preview-mobile.png",
    fullPage: true,
  });
  await popup.screenshot({
    path: evidence + "/preview-application.png",
    fullPage: true,
  });
  // Exact installed maintenance registry/drain. A queued preview cannot deadlock
  // drain: ordinary queued work is frozen, explicit interruption retires active.
  await db.query("UPDATE deployment_state SET maintenance=true");
  await command(
    `/previews/${p.id}/start`,
    { expectedRevision: active.revision },
    503,
  );
  const interrupted = cli(["drain", "--interrupt"]);
  expect(interrupted).toBeTruthy();
  await expect
    .poll(
      async () =>
        (await db.query("SELECT retired FROM previews WHERE id=$1", [p.id]))
          .rows[0].retired,
      { timeout: 20000 },
    )
    .toBe(true);
  const drained = cli(["drain"]);
  expect(drained).toBeTruthy();
  for (const id of [active.runner_id, active.relay_id]) {
    let absent = false;
    try {
      execFileSync("docker", ["inspect", id], { stdio: "pipe" });
    } catch {
      absent = true;
    }
    expect(absent).toBe(true);
  }
  const unavailable = await popup.reload();
  expect(unavailable?.status()).toBe(502);
  expect(
    await popup
      .getByRole("heading", { name: "Installed private preview", exact: true })
      .count(),
  ).toBe(0);
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM preview_grants WHERE NOT revoked",
      )
    ).rows[0].n,
  ).toBe(0);
  await writeFile(
    evidence + "/result.json",
    JSON.stringify(
      {
        status: "passed",
        sourceAtStart,
        sourceAtEnd: sourceDigest(),
        installedArtifact: manifest.artifact,
        reusedFixture,
        explicitFixtureEmergencyReset: reusedFixture,
        stoppedApiReturns502: true,
        releaseSource: manifest.source,
        node: process.version,
        previewRelay: manifest.images.previewRelay.id,
        previewId: p.id,
        runnerId: active.runner_id,
        relayId: active.relay_id,
        modelRequests: 0,
        installedUiApiSupervisorStorage: true,
        privateBootstrapSse: true,
        maintenanceDrainExactRetirement: true,
        protectedTransfer: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    evidence + "/failure.json",
    JSON.stringify(
      {
        status: "failed",
        sourceAtStart,
        sourceAtEnd: sourceDigest(),
        error: String(error).slice(0, 3000),
        traffic,
        document: await page
          .evaluate(() => ({
            ready: document.readyState,
            path: location.pathname,
            rootChildren: document.getElementById("root")?.childElementCount,
          }))
          .catch(() => null),
        previews: (
          await db.query(
            "SELECT id,state,retired,generation,failure_code FROM previews",
          )
        ).rows,
      },
      null,
      2,
    ),
  );
  await page
    .screenshot({ path: evidence + "/failure.png", fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await db.end();
}
