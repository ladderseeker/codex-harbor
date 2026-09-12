import { expect, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import { execFileSync } from "node:child_process";
/** Actual fresh managed native previews plus P004 file helper, no seeded leases. */
export async function previewCoexistLinux(h: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  csrf: string;
  local: any;
  copy: any;
  port: number;
  artifacts: string;
}) {
  const post = async (route: string, data: unknown, status = 202) => {
    const r = await h.context.request.post(h.origin + "/api/v1" + route, {
      headers: {
        Origin: h.origin,
        "X-CSRF-Token": h.csrf,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data,
    });
    expect(r.status(), route).toBe(status);
    return r.json();
  };
  const get = async (route: string) => {
    const r = await h.context.request.get(h.origin + "/api/v1" + route);
    expect(r.status()).toBe(200);
    return r.json();
  };
  const row = async (id: string) =>
    (await h.db.query("SELECT * FROM previews WHERE id=$1", [id])).rows[0];
  const start = async (w: any, profile: string) => {
    const { preview: p } = await post(
      "/previews",
      {
        workspaceId: w.id,
        name: "Coexist " + profile,
        script: "dev",
        port: h.port,
        permissionProfile: profile,
      },
      201,
    );
    await post(`/previews/${p.id}/start`, { expectedRevision: p.revision });
    await expect
      .poll(async () => (await row(p.id)).state, { timeout: 30000 })
      .toBe("ready");
    return row(p.id);
  };
  const stop = async (p: any) => {
    await post(`/previews/${p.id}/stop`, {
      expectedGeneration: Number(p.generation),
    });
    await expect
      .poll(async () => (await row(p.id)).retired, { timeout: 20000 })
      .toBe(true);
  };
  const open = async (p: any) => {
    const r = await post(
      `/previews/${p.id}/open`,
      { expectedGeneration: Number(p.generation) },
      200,
    );
    const page = await h.context.newPage();
    await page.goto(h.origin + r.bootstrapPath);
    await expect(
      page.getByRole("heading", { name: "Private application", exact: true }),
    ).toBeVisible();
    const url = page.url();
    const cookie = (await h.context.cookies(url)).find(
      (c) => c.name === "__Host-harbor-preview",
    )!.value;
    await page.close();
    return { url, cookie };
  };
  const request = (url: string, cookie: string) =>
    new Promise<number>((resolve, reject) => {
      const u = new URL(url);
      const req = https.get(
        {
          hostname: u.hostname,
          port: u.port || 443,
          path: "/",
          servername: u.hostname,
          rejectUnauthorized: false,
          lookup: (_h: any, _o: any, done: any) =>
            done(null, [{ address: "127.0.0.1", family: 4 }]),
          headers: {
            Origin: u.origin,
            Cookie: "__Host-harbor-preview=" + cookie,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.setTimeout(5000, () => req.destroy(Error("Bounded preview request")));
      req.on("error", reject);
    });
  const a = await start(h.local, "read-only"),
    b = await start(h.copy, "read-only");
  expect(a.hostname).not.toBe(b.hostname);
  expect(a.runner_id).not.toBe(b.runner_id);
  const ga = await open(a),
    gb = await open(b);
  expect(await request(ga.url, ga.cookie)).toBe(200);
  expect(await request(gb.url, gb.cookie)).toBe(200);
  expect(await request(ga.url, gb.cookie)).toBe(403);
  expect(await request(gb.url, ga.cookie)).toBe(403);
  const base = `/workspaces/${h.local.id}/files`,
    tree = await get(base + "/tree");
  const ref = tree.entries.find((e: any) => e.name === "server.mjs").ref;
  const content = await get(base + "/content?ref=" + encodeURIComponent(ref));
  const text = content.text + "\n// PUBLIC_PREVIEW_READER_SAVE\n";
  const save = await post(base + "/save", {
    ref,
    expectedRevision: content.revision,
    text,
  });
  const fileState = async (id: string) =>
    (await h.db.query("SELECT state FROM file_operations WHERE id=$1", [id]))
      .rows[0].state;
  await expect
    .poll(() => fileState(save.operation.id), { timeout: 30000 })
    .toBe("succeeded");
  expect(await readFile(h.local.canonical_path + "/server.mjs", "utf8")).toBe(
    text,
  );
  expect((await row(a.id)).runner_id).toBe(a.runner_id);
  expect((await row(a.id)).state).toBe("ready");
  expect(
    Number(
      (
        await h.db.query(
          "SELECT count(*) FROM preview_readers WHERE owner_id=$1",
          [a.id],
        )
      ).rows[0].count,
    ),
  ).toBe(1);
  await stop(a);
  await stop(b);
  const writer = await start(h.local, "workspace-write");
  const current = await get(base + "/content?ref=" + encodeURIComponent(ref)),
    next = text + "// PUBLIC_PREVIEW_WRITER_RELEASE\n";
  const queued = await post(base + "/save", {
    ref,
    expectedRevision: current.revision,
    text: next,
  });
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 250));
    expect(await fileState(queued.operation.id)).toBe("queued");
  }
  expect(
    (
      await h.db.query("SELECT writer_owner_id FROM workspaces WHERE id=$1", [
        h.local.id,
      ])
    ).rows[0].writer_owner_id,
  ).toBe(writer.id);
  expect(await readFile(h.local.canonical_path + "/server.mjs", "utf8")).toBe(
    text,
  );
  const childPid = execFileSync(
    "docker",
    [
      "exec",
      writer.runner_id,
      "node",
      "-e",
      "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});c.unref();console.log(c.pid)",
    ],
    { encoding: "utf8", timeout: 5000 },
  ).trim();
  expect(childPid).toMatch(/^[1-9][0-9]*$/);
  execFileSync(
    "docker",
    ["exec", writer.runner_id, "test", "-d", "/proc/" + childPid],
    { timeout: 5000, stdio: "pipe" },
  );
  await stop(writer);
  let removed = false;
  try {
    execFileSync("docker", ["inspect", writer.runner_id], {
      timeout: 5000,
      stdio: "pipe",
    });
  } catch {
    removed = true;
  }
  expect(removed).toBe(true);
  await expect
    .poll(() => fileState(queued.operation.id), { timeout: 30000 })
    .toBe("succeeded");
  expect(await readFile(h.local.canonical_path + "/server.mjs", "utf8")).toBe(
    next,
  );
  await writeFile(
    h.artifacts + "/coexist-cases.json",
    JSON.stringify(
      {
        status: "passed",
        concurrentNativeOrigins: true,
        crossGrantDeniedBothDirections: true,
        readOnlyPreviewRetainedDuringFileSave: true,
        writePreviewQueuesFileSaveUntilRetired: true,
        survivingDetachedChildPresentBeforeWholeRunnerRetirement: true,
        fileOperationIds: [save.operation.id, queued.operation.id],
        previewIds: [a.id, b.id, writer.id],
        modelRequests: 0,
      },
      null,
      2,
    ),
  );
}
