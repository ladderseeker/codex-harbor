import { expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { png } from "../fixtures/png.ts";

/** Public UI against the caller's owned real API, database and supervisor. */
export async function p024({
  page,
  context,
  origin,
  artifacts,
}: {
  page: Page;
  context: BrowserContext;
  origin: string;
  artifacts: string;
}) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const me = await (await context.request.get(origin + "/api/v1/me")).json();
  const sessions = await (
    await context.request.get(origin + "/api/v1/sessions")
  ).json();
  const created = await context.request.post(origin + "/api/v1/sessions", {
    headers: {
      Origin: origin,
      "X-CSRF-Token": me.csrfToken,
      "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
    },
    data: {
      projectId: sessions.sessions[0].projectId,
      model: "fixture",
      effort: "medium",
      permissionProfile: "read-only",
    },
  });
  expect(created.status()).toBe(200);
  const id = (await created.json()).session.id;
  await page.goto(origin + "/?conversation=" + id);
  const message = page.getByLabel("Message Codex");
  await expect(message).toBeEnabled({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "Attach file", exact: true }),
  ).toBeEnabled();
  const saved = () =>
    expect(
      page.getByText("Draft saved for 24 hours.", { exact: true }),
    ).toBeVisible();
  const geometry = async () => {
    const result = await page.evaluate(() => {
      const scroll = document.querySelector<HTMLElement>(".chat-scroll")!;
      const header = document
        .querySelector(".conversation-header")!
        .getBoundingClientRect();
      const composer = document
        .querySelector(".composer-region")!
        .getBoundingClientRect();
      const rect = scroll.getBoundingClientRect();
      return {
        top: rect.top,
        headerBottom: header.bottom,
        bottom: rect.bottom,
        height: innerHeight,
        composerBottom: composer.bottom,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(Math.abs(result.top - result.headerBottom)).toBeLessThan(1);
    expect(Math.abs(result.bottom - result.height)).toBeLessThan(1);
    expect(result.composerBottom).toBeLessThanOrEqual(result.height + 1);
    expect(result.overflow).toBe(false);
  };
  await geometry();
  await page.screenshot({
    path: path.join(artifacts, "p024-desktop-empty.png"),
  });
  await page.getByLabel("Choose attachment").setInputFiles([
    {
      name: "p024-image.png",
      mimeType: "image/png",
      buffer: png(true, 32, 32),
    },
    {
      name: "p024-long-unbroken-filename-long-unbroken-filename-long-unbroken-filename-long-unbroken-filename-long-unbroken-filename-document.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("Synthetic opaque PDF fixture"),
    },
  ]);
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toHaveCount(2);
  // Clipboard File items and drops exercise the real upload path; the OS clipboard
  // boundary is synthetic, like the deterministic external Codex boundary.
  for (const [kind, name] of [
    ["paste", "p024-pasted.csv"],
    ["drop", "p024-dropped.bin"],
  ]) {
    await page.locator("form.composer").evaluate(
      (form, { kind, name }) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(["synthetic " + name], name, {
            type: "application/octet-stream",
          }),
        );
        form.dispatchEvent(
          kind === "paste"
            ? new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              })
            : new DragEvent("drop", {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true,
              }),
        );
      },
      { kind, name },
    );
  }
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toHaveCount(4);
  await saved();
  await page.getByLabel("Choose attachment").setInputFiles({
    name: "p024-extra.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("must reject"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "p024-extra.txt" }),
  ).toBeVisible();
  await expect(page.locator(".attachment-list .attachment-row")).toHaveCount(4);
  expect(
    await page.locator(".attachment-list").evaluate((e) => e.clientHeight),
  ).toBeLessThanOrEqual(180);
  await page.reload();
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toHaveCount(4);
  await expect(page.locator(".attachment-preview img")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Remove p024-dropped.bin", exact: true })
    .click();
  await expect(
    page.getByText("Selected for this message", { exact: true }),
  ).toHaveCount(3);
  // A text-only paste must not be intercepted by the file handler.
  const textPaste = await message.evaluate((e) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "ordinary pasted text");
    const event = new ClipboardEvent("paste", {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    e.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(textPaste).toBe(false);
  await message.fill(
    Array.from({ length: 20 }, (_, i) => `Composer line ${i}`).join("\n"),
  );
  await expect(message).toHaveCSS("height", "160px");
  await page.setViewportSize({ width: 390, height: 844 });
  await geometry();
  await page.screenshot({
    path: path.join(artifacts, "p024-mobile-attachments.png"),
  });
  await message.fill("");
  await saved();
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.locator(".message-user .attachment-preview")).toHaveCount(
    3,
    { timeout: 30000 },
  );
  await expect(page.locator(".attachment-list .attachment-row")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".message-user .attachment-preview")).toHaveCount(
    3,
  );
  const sentLayout = async () => {
    const layout = await page
      .locator(".message-attachments")
      .first()
      .evaluate((group) => {
        const bounds = group.getBoundingClientRect();
        const rows = [...group.children].map((row) =>
          row.getBoundingClientRect(),
        );
        const names = [
          ...group.querySelectorAll(".attachment-preview > span"),
        ].map((name) => name.getBoundingClientRect());
        return {
          gaps: rows.slice(1).map((row, index) => row.top - rows[index].bottom),
          fits: [...rows, ...names].every(
            (rect) =>
              rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
          ),
          noOverflow: document.documentElement.scrollWidth <= innerWidth,
        };
      });
    expect(layout.gaps).toHaveLength(2);
    for (const gap of layout.gaps) expect(gap).toBeGreaterThanOrEqual(11.5);
    expect(layout.fits).toBe(true);
    expect(layout.noOverflow).toBe(true);
  };
  await sentLayout();
  await page.locator(".chat-scroll").evaluate((e) => {
    e.scrollTop = 0;
  });
  await page.screenshot({
    path: path.join(artifacts, "p024-mobile-sent-attachments.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await sentLayout();
  await expect(message).toBeEnabled();
  await message.fill(
    Array.from({ length: 65 }, (_, i) => `Long chat fixture line ${i}`).join(
      "\n",
    ),
  );
  await saved();
  await expect(send).toBeEnabled({ timeout: 30000 });
  await send.click();
  await expect(page.locator(".message-user")).toHaveCount(2, {
    timeout: 30000,
  });
  const scroll = page.locator(".chat-scroll");
  await expect
    .poll(() => scroll.evaluate((e) => e.scrollHeight - e.clientHeight))
    .toBeGreaterThan(300);
  await scroll.evaluate((e) => {
    e.scrollTop = 0;
    e.dispatchEvent(new Event("scroll"));
  });
  await message.fill(Array(12).fill("Growing while reading above").join("\n"));
  await expect.poll(() => scroll.evaluate((e) => e.scrollTop)).toBeLessThan(1);
  await geometry();
  await page.screenshot({
    path: path.join(artifacts, "p024-desktop-reading-above.png"),
  });
  await scroll.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
    e.dispatchEvent(new Event("scroll"));
  });
  await message.fill("Compact again");
  await expect
    .poll(() =>
      scroll.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight),
    )
    .toBeLessThan(2);
  await page.screenshot({
    path: path.join(artifacts, "p024-desktop-bottom-follow.png"),
  });
  // Navigation during a held upload must never attach its result to the next
  // conversation. Only the browser transport is held; staging remains real.
  const other = await context.request.post(origin + "/api/v1/sessions", {
    headers: {
      Origin: origin,
      "X-CSRF-Token": me.csrfToken,
      "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
    },
    data: {
      projectId: sessions.sessions[0].projectId,
      model: "fixture",
      effort: "medium",
      permissionProfile: "read-only",
    },
  });
  expect(other.status()).toBe(200);
  const otherId = (await other.json()).session.id;
  let release!: () => void;
  let intercepted = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/v1/attachments/*/content",
    async (route) => {
      intercepted = true;
      await held;
      await route.continue().catch(() => {});
    },
    { times: 1 },
  );
  await page.getByLabel("Choose attachment").setInputFiles({
    name: "p024-old-session.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("belongs only to previous conversation"),
  });
  await expect.poll(() => intercepted).toBe(true);
  try {
    await page.goto(origin + "/?conversation=" + otherId);
  } finally {
    release();
  }
  await expect(message).toBeEnabled({ timeout: 30000 });
  await expect(page.locator(".attachment-list .attachment-row")).toHaveCount(0);
  await expect(message).toHaveValue("");
  const otherDraft = await (
    await context.request.get(origin + `/api/v1/sessions/${otherId}/draft`)
  ).json();
  expect(otherDraft.draft.attachmentIds).toEqual([]);
  await p024SendRaces(
    page,
    context,
    origin,
    sessions.sessions[0].projectId,
    me.csrfToken,
  );
}

/** Controlled browser transport delays; all commands still reach real Harbor. */
export async function p024SendRaces(
  page: Page,
  context: BrowserContext,
  origin: string,
  projectId: string,
  csrf: string,
) {
  const headers = () => ({
    Origin: origin,
    "X-CSRF-Token": csrf,
    "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
  });
  async function fresh() {
    const response = await context.request.post(origin + "/api/v1/sessions", {
      headers: headers(),
      data: {
        projectId,
        model: "fixture",
        effort: "medium",
        permissionProfile: "read-only",
      },
    });
    expect(response.status()).toBe(200);
    const id = (await response.json()).session.id as string;
    await page.goto(origin + "/?conversation=" + id);
    await expect(page.getByLabel("Message Codex")).toBeEnabled();
    return id;
  }
  function barrier() {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { wait, release };
  }
  const message = page.getByLabel("Message Codex");
  const picker = page.getByLabel("Choose attachment");
  const send = page.getByRole("button", { name: "Send", exact: true });
  const selected = page.getByText("Selected for this message", { exact: true });
  const saved = () =>
    expect(
      page.getByText("Draft saved for 24 hours.", { exact: true }),
    ).toBeVisible();
  const submit = () =>
    page
      .locator("form.composer")
      .evaluate((form) => (form as HTMLFormElement).requestSubmit());

  // Dirty draft persistence is held after Send reserves its exact input.
  const dirtyId = await fresh();
  const draftGate = barrier();
  const draftDone = barrier();
  let draftStarted = false;
  let draftFailure: unknown;
  // Freeze the 600 ms autosave timer so this POST can only be owned by Send.
  // Network, React rendering and Playwright assertions still run normally.
  const browserTime = Date.now();
  await page.clock.install({ time: browserTime });
  await page.clock.pauseAt(browserTime + 1000);
  let draftHeld = false;
  let turns = 0;
  const count = (request: import("@playwright/test").Request) => {
    if (request.method() === "POST" && request.url().endsWith("/turns"))
      turns++;
  };
  page.on("request", count);
  await page.route(`**/api/v1/sessions/${dirtyId}/draft`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    draftStarted = true;
    try {
      const response = await route.fetch();
      draftHeld = true;
      await draftGate.wait;
      await route.fulfill({ response });
    } catch (failure) {
      draftFailure = failure;
    } finally {
      draftDone.release();
    }
  });
  try {
    await message.fill("Controlled dirty draft reservation");
    await submit();
    await expect.poll(() => draftHeld).toBe(true);
    // Baseline fails here: picker and text remain editable during draft save.
    await expect(picker).toBeDisabled();
    await expect(message).toBeDisabled();
    await page.locator("form.composer").evaluate((form) => {
      const files = new DataTransfer();
      files.items.add(new File(["must not enqueue"], "reserved.txt"));
      form.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: files,
          bubbles: true,
          cancelable: true,
        }),
      );
      (form as HTMLFormElement).requestSubmit();
      (form as HTMLFormElement).requestSubmit();
    });
    expect(turns).toBe(0);
    await expect(selected).toHaveCount(0);
  } finally {
    draftGate.release();
    if (draftStarted) await draftDone.wait;
    await page.unroute(`**/api/v1/sessions/${dirtyId}/draft`);
    await page.clock.resume();
  }
  if (draftFailure) throw draftFailure;
  await expect(page.locator(".message-user")).toHaveCount(1, {
    timeout: 30000,
  });
  expect(turns).toBe(1);
  page.off("request", count);

  // File enqueue and Send occur in the SAME JS task, before React effects.
  const uploadId = await fresh();
  const uploadGate = barrier();
  const uploadDone = barrier();
  let uploadFailure: unknown;
  let uploadHeld = false;
  turns = 0;
  page.on("request", count);
  await message.fill("Include the pending file");
  await saved();
  await page.route("**/api/v1/attachments/*/content", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    uploadHeld = true;
    try {
      await uploadGate.wait;
      await route.continue();
    } catch (failure) {
      uploadFailure = failure;
    } finally {
      uploadDone.release();
    }
  });
  try {
    await page.locator("form.composer").evaluate((form) => {
      const files = new DataTransfer();
      files.items.add(
        new File(["synthetic same-task file"], "same-task.txt", {
          type: "text/plain",
        }),
      );
      form.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: files,
          bubbles: true,
          cancelable: true,
        }),
      );
      (form as HTMLFormElement).requestSubmit();
    });
    await expect.poll(() => uploadHeld).toBe(true);
    await expect(send).toBeDisabled();
    await message.press("Enter");
    await submit();
    expect(turns).toBe(0);
  } finally {
    uploadGate.release();
    if (uploadHeld) await uploadDone.wait;
    await page.unroute("**/api/v1/attachments/*/content");
  }
  if (uploadFailure) throw uploadFailure;
  await expect(selected).toHaveCount(1);
  await saved();
  await send.click();
  await expect(page.locator(".message-user .attachment-preview")).toHaveCount(
    1,
    { timeout: 30000 },
  );
  expect(turns).toBe(1);
  page.off("request", count);
  expect(uploadId).not.toBe(dirtyId);

  // Accepted response followed by a failed GET must immediately clear submitted
  // refs and expose recovery. A newer other-tab attachment draft survives CAS.
  const recoveryId = await fresh();
  await picker.setInputFiles({
    name: "accepted.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("submitted synthetic file"),
  });
  await expect(selected).toHaveCount(1);
  await message.fill("Accepted before refresh failure");
  await saved();
  const acceptedGate = barrier();
  const acceptedDone = barrier();
  let acceptedFailure: unknown;
  let sendHeld = false;
  await page.route(
    `**/api/v1/sessions/${recoveryId}/turns`,
    async (route) => {
      sendHeld = true;
      try {
        await acceptedGate.wait;
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        await route.fulfill({ response });
      } catch (failure) {
        acceptedFailure = failure;
      } finally {
        acceptedDone.release();
      }
    },
    { times: 1 },
  );
  await send.click();
  await expect.poll(() => sendHeld).toBe(true);
  try {
    const data = Buffer.from("newer other-tab attachment");
    const digest = await import("node:crypto").then(({ createHash }) =>
      createHash("sha256").update(data).digest("hex"),
    );
    const stage = await context.request.post(
      origin + `/api/v1/sessions/${recoveryId}/attachments`,
      {
        headers: headers(),
        data: {
          name: "newer.txt",
          mediaType: "application/octet-stream",
          size: data.length,
          sha256: digest,
        },
      },
    );
    expect(stage.status()).toBe(200);
    const attachment = (await stage.json()).attachment;
    const uploaded = await context.request.put(
      origin + `/api/v1/attachments/${attachment.id}/content`,
      {
        headers: { ...headers(), "Content-Type": "application/octet-stream" },
        data,
      },
    );
    expect(uploaded.ok()).toBe(true);
    const currentDraft = (
      await (
        await context.request.get(
          origin + `/api/v1/sessions/${recoveryId}/draft`,
        )
      ).json()
    ).draft;
    const newer = await context.request.post(
      origin + `/api/v1/sessions/${recoveryId}/draft`,
      {
        headers: headers(),
        data: {
          expectedRevision: currentDraft.revision,
          text: "Newer other-tab draft",
          attachmentIds: [attachment.id],
        },
      },
    );
    expect(newer.status()).toBe(200);
    await page.route(
      `**/api/v1/sessions/${recoveryId}/draft`,
      async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "Controlled draft refresh failure" },
          }),
        });
      },
      { times: 1 },
    );
  } finally {
    acceptedGate.release();
    if (sendHeld) await acceptedDone.wait;
  }
  if (acceptedFailure) throw acceptedFailure;
  await expect(
    page.getByText(/Message accepted. Reload the saved draft to continue:/),
  ).toBeVisible();
  await expect(selected).toHaveCount(0);
  await expect(message).toHaveValue("");
  await expect(message).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Retry same request", exact: true }),
  ).toHaveCount(0);
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Reload saved draft", exact: true })
    .click();
  await expect(message).toHaveValue("Newer other-tab draft");
  await expect(selected).toHaveCount(1);
  await expect(page.locator(".attachment-list")).toContainText("newer.txt");
  await expect(page.locator(".attachment-list")).not.toContainText(
    "accepted.txt",
  );
}
