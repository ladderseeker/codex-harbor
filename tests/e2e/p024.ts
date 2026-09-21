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
}
