import { attachmentWorkspaces } from "./p005-workspaces.ts";
import { expect, type Page, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { request as httpsRequest } from "node:https";
import { request as playwrightRequest } from "@playwright/test";
import { png, highBitPng } from "../fixtures/png.ts";
import { maintainAttachments } from "../../packages/attachments/src/store.ts";
export async function p005({
  page,
  context,
  origin,
  csrf,
  db,
  projectId,
  traceFile,
  artifacts,
}: {
  page: Page;
  context: BrowserContext;
  origin: string;
  csrf: string;
  db: Pool;
  projectId: string;
  traceFile: string;
  artifacts: string;
}) {
  const key = () => `${Date.now()}:${randomUUID()}`;
  const headers = () => ({
    Origin: origin,
    "X-CSRF-Token": csrf,
    "Idempotency-Key": key(),
  });
  const command = async (route: string, body: unknown, k = key()) => {
    await new Promise((r) => setTimeout(r, 100));
    return context.request.post(origin + "/api/v1" + route, {
      headers: { ...headers(), "Idempotency-Key": k },
      data: body,
    });
  };
  // These deliberately dense rejection/setup phases share the real 200/10s IP
  // allowance with browser bootstrap and polling. Start browser fault scenarios
  // in a new bounded window; never retry a rejected user mutation to hide 429.
  const browserPhaseBoundary = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 10500));
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const newSession = async (title: string) => {
    const response = await command("/sessions", {
      projectId,
      title,
      ...settings,
    });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).session;
  };
  const stageFile = async (
    id: string,
    bytes: Buffer,
    mediaType = "text/plain",
    name = "fixture.txt",
  ) => {
    const response = await command(`/sessions/${id}/attachments`, {
      name,
      mediaType,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).attachment;
  };
  const putFile = (id: string, bytes: Buffer, k = key()) =>
    context.request.put(origin + `/api/v1/attachments/${id}/content`, {
      headers: {
        ...headers(),
        "Idempotency-Key": k,
        "Content-Type": "application/octet-stream",
      },
      data: bytes,
    });
  await expect
    .poll(
      async () =>
        (
          await (
            await context.request.get(origin + "/api/v1/capabilities")
          ).json()
        ).models.length,
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  const session = (
    await (
      await command("/sessions", {
        projectId,
        title: "Attachments acceptance",
        ...settings,
      })
    ).json()
  ).session;
  const other = (
    await (
      await command("/sessions", {
        projectId,
        title: "Attachment boundary",
        ...settings,
      })
    ).json()
  ).session;
  const data = png(true),
    hash = createHash("sha256").update(data).digest("hex");
  const stageKey = key();
  const meta = {
    name: "../../<script>alert(1)</script>.png",
    mediaType: "image/png",
    size: data.length,
    sha256: hash,
  };
  const stage = await command(
    `/sessions/${session.id}/attachments`,
    meta,
    stageKey,
  );
  expect(stage.status(), await stage.text()).toBe(200);
  const a = (await stage.json()).attachment;
  expect(
    (
      await (
        await command(`/sessions/${session.id}/attachments`, meta, stageKey)
      ).json()
    ).attachment.id,
  ).toBe(a.id);
  const binaryKey = key();
  const put = () =>
    context.request.put(origin + `/api/v1/attachments/${a.id}/content`, {
      headers: {
        ...headers(),
        "Idempotency-Key": binaryKey,
        "Content-Type": "application/octet-stream",
      },
      data,
    });
  expect((await put()).status()).toBe(200);
  expect((await put()).status()).toBe(200);
  expect(
    (
      await command(`/sessions/${other.id}/turns`, {
        text: "foreign attachment",
        ...settings,
        attachmentIds: [a.id],
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await command(`/sessions/${session.id}/turns`, {
        text: "duplicate attachment",
        ...settings,
        attachmentIds: [a.id, a.id],
      })
    ).status(),
  ).toBe(400);
  const download = await context.request.get(
    origin + `/api/v1/attachments/${a.id}/content`,
  );
  expect(download.headers()["content-disposition"]).toContain("attachment;");
  expect((await download.body()).equals(png())).toBe(true);
  const draftKey = key(),
    draftBody = {
      text: "[approval] Review the supplied image",
      attachmentIds: [a.id],
      expectedRevision: 0,
    };
  const saved = await command(
    `/sessions/${session.id}/draft`,
    draftBody,
    draftKey,
  );
  expect(saved.status(), await saved.text()).toBe(200);
  expect(
    (
      await command(`/sessions/${session.id}/draft`, {
        ...draftBody,
        text: "stale",
      })
    ).status(),
  ).toBe(409);
  await page.goto(origin + "/?conversation=" + session.id);
  await expect(page.getByLabel("Message Codex")).toHaveValue(draftBody.text);
  await expect(page.getByRole("img", { name: /Attachment:/ })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Message Codex")).toHaveValue(draftBody.text);
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url() === origin + `/api/v1/sessions/${session.id}/turns`,
    { timeout: 10000 },
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const submittedResponse = await submitted;
  expect(submittedResponse.status(), await submittedResponse.text()).toBe(202);
  try {
    await expect(
      page.getByRole("button", { name: "Approve once" }),
    ).toBeVisible({
      timeout: 30000,
    });
  } catch (error) {
    const status = (
      await db.query(
        "SELECT state,generation,native_thread_id IS NOT NULL AS native FROM sessions WHERE id=$1",
        [session.id],
      )
    ).rows;
    const operations = (
      await db.query("SELECT kind,state FROM operations WHERE session_id=$1", [
        session.id,
      ])
    ).rows;
    const events = (
      await db.query(
        "SELECT type,data->>'reason' AS reason FROM events WHERE session_id=$1 ORDER BY sequence",
        [session.id],
      )
    ).rows;
    throw Error(JSON.stringify({ status, operations, events }), {
      cause: error,
    });
  }
  expect(
    (await db.query("SELECT state FROM attachments WHERE id=$1", [a.id]))
      .rows[0].state,
  ).toBe("attached");
  expect(
    (
      await command(`/sessions/${session.id}/draft`, draftBody, draftKey)
    ).status(),
  ).toBe(200); // same receipt after draft was consumed
  expect(
    (
      await context.request.delete(origin + `/api/v1/attachments/${a.id}`, {
        headers: headers(),
        data: {},
      })
    ).status(),
  ).toBe(409);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  const recorded = (await readFile(traceFile, "utf8"))
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x));
  expect(
    recorded.filter((x) => x.attachmentPaths?.includes(`/attachments/${a.id}`)),
  ).toHaveLength(1);
  await page.goto(origin + "/?conversation=" + other.id);
  const text = Buffer.from("<script>window.attachmentExecuted=true</script>");
  await writeFile(
    path.join(artifacts, "p005-text-selection-readiness.json"),
    JSON.stringify({
      visibleAttachEnabled: await page
        .getByRole("button", { name: "Attach file", exact: true })
        .isEnabled(),
      hiddenInputEnabled: await page
        .getByLabel("Choose attachment")
        .isEnabled(),
    }),
  );
  // setInputFiles bypasses the hidden input's visible button. Observe the same
  // readiness gate a real file-picker interaction must pass; never retry a mutation.
  await expect(
    page.getByRole("button", { name: "Attach file", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Choose attachment")
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: text });
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Draft saved for 24 hours.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Boolean((window as any).attachmentExecuted)),
  ).toBe(false);
  const removed = page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" && r.url().includes("/attachments/"),
  );
  await page
    .getByRole("button", { name: "Remove notes.txt", exact: true })
    .click();
  const removalResponse = await removed;
  expect(removalResponse.status(), await removalResponse.text()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Remove notes.txt", exact: true }),
  ).toHaveCount(0);
  // Clipboard file entry and HTML name display exercise real composer handlers.
  await page.getByLabel("Message Codex").evaluate((node, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(bytes)], "pasted.png", { type: "image/png" }),
    );
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, Array.from(png()));
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Draft saved for 24 hours.", { exact: true }),
  ).toBeVisible();
  const pasted = (
    await db.query(
      "SELECT id FROM attachments WHERE session_id=$1 AND state='staged'",
      [other.id],
    )
  ).rows[0].id;
  // Real drop handler plus pasted image are associated with one submitted turn.
  await page
    .getByRole("region", { name: "Attachments", exact: true })
    .evaluate((node) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["Dropped input"], "drop.txt", { type: "text/plain" }),
      );
      node.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByText("Draft saved for 24 hours.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Message Codex")
    .fill("[approval] Read the dropped file and pasted image");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve once", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.screenshot({
    path: path.join(artifacts, "attachments-desktop.png"),
    fullPage: true,
  });
  const combined = (await readFile(traceFile, "utf8"))
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x))
    .find((x) => x.attachmentPaths?.includes(`/attachments/${pasted}`));
  expect(
    combined.attachmentTypes.filter((t: string) => t === "text"),
  ).toHaveLength(2);
  expect(
    combined.attachmentTypes.filter((t: string) => t === "localImage"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await db.query("SELECT state FROM sessions WHERE id=$1", [other.id]))
          .rows[0].state,
    )
    .toBe("succeeded");
  await page.reload();
  await expect(page.getByText("Dropped input", { exact: true })).toHaveCount(0); // downloads are not inline HTML/text execution
  await expect(
    page.getByRole("img", { name: "Attachment: pasted.png", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.body.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: path.join(artifacts, "attachments-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const stagedGc = await stageFile(other.id, Buffer.from("unreferenced"));
  expect(
    (await putFile(stagedGc.id, Buffer.from("unreferenced"))).status(),
  ).toBe(200);
  const draftNow = (
    await (
      await context.request.get(origin + `/api/v1/sessions/${other.id}/draft`)
    ).json()
  ).draft;
  expect(
    (
      await command(`/sessions/${other.id}/draft`, {
        text: "Retained draft",
        attachmentIds: [stagedGc.id],
        expectedRevision: draftNow.revision,
      })
    ).status(),
  ).toBe(200);
  await db.query(
    "UPDATE attachments SET expires_at=now()-interval '1 hour' WHERE id=$1",
    [stagedGc.id],
  );
  await maintainAttachments(db);
  expect(
    (await db.query("SELECT state FROM attachments WHERE id=$1", [stagedGc.id]))
      .rows[0].state,
  ).toBe("staged");
  await db.query(
    "UPDATE conversation_drafts SET updated_at=now()-interval '25 hours' WHERE session_id=$1",
    [other.id],
  );
  await maintainAttachments(db);
  expect(
    (await db.query("SELECT state FROM attachments WHERE id=$1", [stagedGc.id]))
      .rows[0].state,
  ).toBe("expired");
  await db.query(
    "UPDATE attachments SET expires_at=now()-interval '2 days' WHERE id=$1",
    [pasted],
  );
  await maintainAttachments(db);
  expect(
    (await db.query("SELECT state FROM attachments WHERE id=$1", [pasted]))
      .rows[0].state,
  ).toBe("attached");

  const negative = await newSession("Attachment rejection boundaries");
  for (const [media, bytes] of [
    ["image/png", Buffer.from("<svg onload='x'/>")],
    ["image/png", highBitPng()],
    ["image/png", Buffer.concat([png(), Buffer.from("trailing")])],
    ["text/plain", Buffer.from([0xc0, 0xaf])],
  ] as const) {
    const bad = await stageFile(negative.id, bytes, media, "spoof.png");
    expect((await putFile(bad.id, bytes)).status()).toBe(400);
    expect(
      (
        await db.query("SELECT state,content FROM attachments WHERE id=$1", [
          bad.id,
        ])
      ).rows[0],
    ).toEqual({ state: "uploading", content: null });
  }
  expect(
    (
      await command(`/sessions/${negative.id}/attachments`, {
        name: "too-big.txt",
        mediaType: "text/plain",
        size: 65537,
        sha256: hash,
      })
    ).status(),
  ).toBe(413);
  expect(
    (
      await command(`/sessions/${negative.id}/attachments`, {
        name: "active.svg",
        mediaType: "image/svg+xml",
        size: 4,
        sha256: hash,
      })
    ).status(),
  ).toBe(400);
  expect((await putFile(a.id, Buffer.alloc(262145))).status()).toBe(413);
  expect(
    (
      await command(`/sessions/${negative.id}/turns`, {
        ...settings,
        text: "count denial",
        attachmentIds: Array.from({ length: 5 }, () => randomUUID()),
      })
    ).status(),
  ).toBe(400);
  const anonymous = await playwrightRequest.newContext({
    ignoreHTTPSErrors: true,
  });
  try {
    expect(
      (
        await anonymous.get(origin + `/api/v1/attachments/${a.id}/content`)
      ).status(),
    ).toBe(401);
    expect(
      (
        await anonymous.get(origin + `/api/v1/attachments/${a.id}/preview`)
      ).status(),
    ).toBe(401);
    expect(
      (await anonymous.delete(origin + `/api/v1/attachments/${a.id}`)).status(),
    ).toBe(401);
  } finally {
    await anonymous.dispose();
  }

  const binary = Buffer.from("partial upload fixture");
  const partial = await stageFile(negative.id, binary);
  const cookie = (await context.cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  await new Promise<void>((resolve) => {
    const req = httpsRequest(
      origin + `/api/v1/attachments/${partial.id}/content`,
      {
        method: "PUT",
        rejectUnauthorized: false,
        headers: {
          ...headers(),
          Cookie: cookie,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(binary.length),
        },
      },
      (res) => res.resume(),
    );
    req.on("error", () => resolve());
    req.write(binary.subarray(0, 3));
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 30);
  });
  expect(
    (
      await db.query("SELECT state,content FROM attachments WHERE id=$1", [
        partial.id,
      ])
    ).rows[0],
  ).toEqual({ state: "uploading", content: null });
  expect((await putFile(partial.id, binary)).status()).toBe(200);
  expect((await putFile(partial.id, Buffer.from("different"))).status()).toBe(
    409,
  );

  await browserPhaseBoundary();
  const uploadSession = await newSession("Upload response recovery");
  const uploadNavigation = await page.goto(
    origin + "/?conversation=" + uploadSession.id,
  );
  expect(uploadNavigation?.status()).toBe(200);
  await expect(page.getByLabel("Message Codex"))
    .toBeVisible()
    .catch(async (error) => {
      throw new Error(
        "Upload recovery page failed to load: " +
          (await page.locator("body").innerText()),
        { cause: error },
      );
    });
  let releasePause!: () => void;
  const pause = new Promise<void>((r) => (releasePause = r));
  let uploadIntercepted!: () => void;
  const intercepted = new Promise<void>((r) => (uploadIntercepted = r));
  await page.route(
    "**/api/v1/attachments/*/content",
    async (route) => {
      uploadIntercepted();
      await pause;
      await route.abort().catch(() => {});
    },
    { times: 1 },
  );
  await expect(
    page.getByRole("button", { name: "Attach file", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Choose attachment").setInputFiles({
    name: "retry.txt",
    mimeType: "text/plain",
    buffer: binary,
  });
  await intercepted;
  await expect(
    page.getByRole("button", { name: "Pause upload", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause upload", exact: true }).click();
  releasePause();
  await expect(
    page.getByRole("button", { name: "Retry same upload", exact: true }),
  ).toBeVisible();
  const retryResponse = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes("/attachments/"),
  );
  await page
    .getByRole("button", { name: "Retry same upload", exact: true })
    .click();
  const retriedUpload = await retryResponse;
  expect(retriedUpload.status(), await retriedUpload.text()).toBe(200);
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toHaveCount(1);
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM attachments WHERE session_id=$1",
        [uploadSession.id],
      )
    ).rows[0].n,
  ).toBe(1);
  await page.route(
    "**/api/v1/attachments/*/content",
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await expect(
    page.getByRole("button", { name: "Attach file", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Choose attachment").setInputFiles({
    name: "lost.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("lost committed response"),
  });
  await expect(
    page.getByRole("button", { name: "Retry same upload", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry same upload", exact: true })
    .click();
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByText("Draft saved for 24 hours.", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM attachments WHERE session_id=$1",
        [uploadSession.id],
      )
    ).rows[0].n,
  ).toBe(2);

  // A committed turn response may be lost: retry must keep one operation and association.
  await page
    .getByLabel("Message Codex")
    .fill("[approval] Lost attachment turn response");
  await page.route(
    "**/api/v1/sessions/*/turns",
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry same request", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry same request", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve once", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM operations WHERE session_id=$1 AND kind='turn'",
        [uploadSession.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.query(
        "SELECT count(DISTINCT operation_id)::int AS n,count(*)::int AS files FROM attachments WHERE session_id=$1 AND state='attached'",
        [uploadSession.id],
      )
    ).rows[0],
  ).toEqual({ n: 1, files: 2 });
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await browserPhaseBoundary();
  // Pausing during the metadata response is a logical cancellation, before XHR exists.
  const preflight = await newSession("Paused metadata admission");
  await page.goto(origin + "/?conversation=" + preflight.id);
  await expect(page.getByLabel("Message Codex")).toBeEnabled();
  let releaseMetadata!: () => void, metadataArrived!: () => void;
  const metadataWait = new Promise<void>((r) => (releaseMetadata = r)),
    metadataSeen = new Promise<void>((r) => (metadataArrived = r));
  let binaryCalls = 0;
  const countBinary = (request: any) => {
    if (request.method() === "PUT" && request.url().includes("/attachments/"))
      binaryCalls++;
  };
  page.on("request", countBinary);
  await page.route(
    "**/api/v1/sessions/*/attachments",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      metadataArrived();
      await metadataWait;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await expect(
    page.getByRole("button", { name: "Attach file", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Choose attachment").setInputFiles({
    name: "preflight.txt",
    mimeType: "text/plain",
    buffer: binary,
  });
  await metadataSeen;
  await page.getByRole("button", { name: "Pause upload", exact: true }).click();
  releaseMetadata();
  await expect(
    page.getByRole("button", { name: "Retry same upload", exact: true }),
  ).toBeVisible();
  expect(binaryCalls).toBe(0);
  page.off("request", countBinary);
  const reloadResponses: Array<{
    path: string;
    method: string;
    status: number;
  }> = [];
  const observeReload = (response: import("@playwright/test").Response) => {
    const url = new URL(response.url());
    if (url.origin !== origin) return;
    reloadResponses.push({
      path: url.pathname,
      method: response.request().method(),
      status: response.status(),
    });
    if (reloadResponses.length > 100) reloadResponses.shift();
  };
  page.on("response", observeReload);
  try {
    const navigation = await page.reload();
    try {
      await expect(
        page.getByText("Upload incomplete: choose the same file to resume", {
          exact: true,
        }),
      ).toBeVisible();
    } catch (failure) {
      await writeFile(
        path.join(artifacts, "p005-paused-reload-failure.json"),
        JSON.stringify(
          {
            navigationStatus: navigation?.status(),
            intendedConversation:
              new URL(page.url()).searchParams.get("conversation") ===
              preflight.id,
            composerCount: await page.getByLabel("Message Codex").count(),
            draftLoadingCount: await page
              .getByText("Loading saved draft…", { exact: true })
              .count(),
            rateLimitCount: await page
              .getByText("Request rate limit reached", { exact: true })
              .count(),
            attachments: (
              await db.query(
                "SELECT state,expected_size,content IS NOT NULL AS has_content FROM attachments WHERE session_id=$1 ORDER BY id",
                [preflight.id],
              )
            ).rows,
            responses: reloadResponses,
          },
          null,
          2,
        ),
      );
      throw failure;
    }
  } finally {
    page.off("response", observeReload);
  }
  await expect(
    page.getByRole("button", { name: "Attach file", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Choose attachment").setInputFiles({
    name: "preflight.txt",
    mimeType: "text/plain",
    buffer: binary,
  });
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM attachments WHERE session_id=$1",
        [preflight.id],
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    page.getByText("Draft saved for 24 hours.", { exact: true }),
  ).toBeVisible();
  // A delayed accepted result belongs to A even after B has opened its draft.
  const oldConversation = await newSession("Delayed attachment completion A"),
    newConversation = await newSession("Preserved attachment draft B");
  expect(
    (
      await command(`/sessions/${newConversation.id}/draft`, {
        text: "B draft remains intact",
        attachmentIds: [],
        expectedRevision: 0,
      })
    ).status(),
  ).toBe(200);
  await page.goto(origin + "/?conversation=" + oldConversation.id);
  await expect(page.getByLabel("Message Codex")).toBeEnabled();
  await page.getByLabel("Message Codex").fill("Delayed response from A");
  let releaseTurn!: () => void, turnArrived!: () => void;
  const turnWait = new Promise<void>((r) => (releaseTurn = r)),
    turnSeen = new Promise<void>((r) => (turnArrived = r));
  await page.route(
    `**/api/v1/sessions/${oldConversation.id}/turns`,
    async (route) => {
      const response = await route.fetch();
      turnArrived();
      await turnWait;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await turnSeen;
  await page
    .getByRole("button", { name: /Preserved attachment draft B/ })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Preserved attachment draft B",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Message Codex")).toHaveValue(
    "B draft remains intact",
  );
  await expect(
    page.getByText("Draft saved for 24 hours.", { exact: true }),
  ).toBeVisible();
  releaseTurn();
  await expect(page.getByLabel("Message Codex")).toBeEnabled();
  await expect(page.getByLabel("Message Codex")).toHaveValue(
    "B draft remains intact",
  );
  await page
    .getByLabel("Message Codex")
    .fill("B remains editable after old A response");
  await expect(
    page.getByText("Draft saved for 24 hours.", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await db.query(
        "SELECT text FROM conversation_drafts WHERE session_id=$1",
        [newConversation.id],
      )
    ).rows[0].text,
  ).toBe("B remains editable after old A response");
  // Expiry removes plaintext even when no unsubmitted attachment exists.
  const textOnly = await newSession("Text-only draft expiry");
  for (const id of [textOnly.id, uploadSession.id]) {
    const revision = (
      await (
        await context.request.get(origin + `/api/v1/sessions/${id}/draft`)
      ).json()
    ).draft.revision;
    expect(
      (
        await command(`/sessions/${id}/draft`, {
          text: "Expired private draft",
          attachmentIds: [],
          expectedRevision: revision,
        })
      ).status(),
    ).toBe(200);
    await db.query(
      "UPDATE conversation_drafts SET updated_at=now()-interval '25 hours' WHERE session_id=$1",
      [id],
    );
  }
  await maintainAttachments(db);
  expect(
    (
      await db.query(
        "SELECT text FROM conversation_drafts WHERE session_id=ANY($1::uuid[])",
        [[textOnly.id, uploadSession.id]],
      )
    ).rows.map((r) => r.text),
  ).toEqual(["", ""]);
  // Submission clears only its exact saved draft revision.
  const cas = await newSession("Concurrent draft submission");
  const v1 = (
    await (
      await command(`/sessions/${cas.id}/draft`, {
        text: "Original draft",
        attachmentIds: [],
        expectedRevision: 0,
      })
    ).json()
  ).draft;
  const v2 = (
    await (
      await command(`/sessions/${cas.id}/draft`, {
        text: "Newer other-tab draft",
        attachmentIds: [],
        expectedRevision: v1.revision,
      })
    ).json()
  ).draft;
  expect(
    (
      await command(`/sessions/${cas.id}/turns`, {
        ...settings,
        text: v1.text,
        attachmentIds: [],
        draftRevision: v1.revision,
      })
    ).status(),
  ).toBe(202);
  expect(
    (
      await db.query(
        "SELECT text,revision FROM conversation_drafts WHERE session_id=$1",
        [cas.id],
      )
    ).rows[0],
  ).toEqual({ text: v2.text, revision: String(v2.revision) });

  await expect
    .poll(
      async () =>
        (await db.query("SELECT state FROM sessions WHERE id=$1", [cas.id]))
          .rows[0].state,
      { timeout: 30000 },
    )
    .toBe("succeeded");
  const capabilities = (await db.query("SELECT data FROM runtime_capabilities"))
    .rows[0].data;
  const imageSession = await newSession("Model modality boundary");
  const image = await stageFile(
    imageSession.id,
    png(),
    "image/png",
    "model.png",
  );
  expect((await putFile(image.id, png())).status()).toBe(200);
  expect(
    (
      await command(`/sessions/${imageSession.id}/draft`, {
        text: "image draft",
        attachmentIds: [image.id],
        expectedRevision: 0,
      })
    ).status(),
  ).toBe(200);
  try {
    await db.query("UPDATE runtime_capabilities SET data=$1", [
      {
        ...capabilities,
        data: capabilities.data.map((m: any) => ({
          ...m,
          inputModalities: ["text"],
        })),
      },
    ]);
    await page.goto(origin + "/?conversation=" + imageSession.id);
    await expect(
      page.getByText(
        "The selected model cannot receive one or more selected attachments.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeDisabled();
    expect(
      (
        await command(`/sessions/${imageSession.id}/turns`, {
          ...settings,
          text: "crafted bypass",
          attachmentIds: [image.id],
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM operations WHERE session_id=$1",
          [imageSession.id],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await db.query("UPDATE runtime_capabilities SET data=$1", [capabilities]);
  }

  const countSession = await newSession("Retained attachment count");
  for (let i = 0; i < 32; i++)
    await stageFile(countSession.id, Buffer.from("x"));
  expect(
    (
      await command(`/sessions/${countSession.id}/attachments`, {
        name: "limit.txt",
        mediaType: "text/plain",
        size: 1,
        sha256: hash,
      })
    ).status(),
  ).toBe(429);
  const quotaSession = await newSession("Attachment byte quota");
  for (let i = 0; i < 16; i++)
    await stageFile(
      quotaSession.id,
      Buffer.alloc(262144),
      "image/png",
      "reserved.png",
    );
  expect(
    (
      await command(`/sessions/${quotaSession.id}/attachments`, {
        name: "limit.txt",
        mediaType: "text/plain",
        size: 1,
        sha256: hash,
      })
    ).status(),
  ).toBe(429);
  const turnLimitSession = await newSession("Attachment turn byte quota"),
    large = png(false, 240, 240),
    largeIds: string[] = [];
  expect(large.length).toBeLessThanOrEqual(262144);
  for (let i = 0; i < 3; i++) {
    const image = await stageFile(
      turnLimitSession.id,
      large,
      "image/png",
      "large.png",
    );
    expect((await putFile(image.id, large)).status()).toBe(200);
    largeIds.push(image.id);
  }
  expect(
    (
      await command(`/sessions/${turnLimitSession.id}/turns`, {
        ...settings,
        text: "over turn byte quota",
        attachmentIds: largeIds,
      })
    ).status(),
  ).toBe(413);
  // Seed only run-owned reservations, each respecting the ordinary local count/byte bounds.
  const seedSessions: string[] = [];
  try {
    let remaining =
      104857600 -
      Number(
        (
          await db.query(
            "SELECT coalesce(sum(expected_size),0) AS n FROM attachments WHERE state IN ('uploading','staged','attached')",
          )
        ).rows[0].n,
      );
    while (remaining > 0) {
      const id = randomUUID();
      seedSessions.push(id);
      await db.query(
        "INSERT INTO sessions(id,project_id,workspace_id,title,model,effort,permission_profile) SELECT $1,project_id,workspace_id,'Owned global quota seed',model,effort,permission_profile FROM sessions WHERE id=$2",
        [id, negative.id],
      );
      for (let n = 0; n < 16 && remaining > 0; n++) {
        const size = Math.min(262144, remaining);
        await db.query(
          "INSERT INTO attachments(id,session_id,project_id,name,declared_type,expected_size,expected_hash) VALUES($1,$2,$3,'Owned reservation','image/png',$4,$5)",
          [randomUUID(), id, projectId, size, hash],
        );
        remaining -= size;
      }
    }
    expect(
      (
        await command(`/sessions/${negative.id}/attachments`, {
          name: "global limit",
          mediaType: "text/plain",
          size: 1,
          sha256: hash,
        })
      ).status(),
    ).toBe(429);
  } finally {
    await db.query("DELETE FROM attachments WHERE session_id=ANY($1::uuid[])", [
      seedSessions,
    ]);
    await db.query("DELETE FROM sessions WHERE id=ANY($1::uuid[])", [
      seedSessions,
    ]);
  }
  await attachmentWorkspaces(context, page, origin, csrf, db, traceFile);
  console.log(
    "P005 attachment UI/API atomic association, cross-session denial, saved drafts, safe previews, paste and staged GC passed. Native image delivery requires separate live evidence.",
  );
}
