import { expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** Real API/database/supervisor pagination and transcript acceptance, after P014. */
export async function p023({
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
  const existing = await (
    await context.request.get(origin + "/api/v1/sessions")
  ).json();
  const projectId = existing.sessions[0].projectId;
  const me = await (await context.request.get(origin + "/api/v1/me")).json();
  const command = async (route: string, data: unknown) => {
    const response = await context.request.post(origin + "/api/v1" + route, {
      data,
      headers: {
        Origin: origin,
        "X-CSRF-Token": me.csrfToken,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
    });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const created = await command("/sessions", {
      projectId,
      model: "fixture",
      effort: "medium",
      permissionProfile: "read-only",
    });
    ids.push(created.session.id);
    await command(`/sessions/${created.session.id}/metadata`, {
      expectedRevision: created.session.metadataRevision,
      title: `P023 history ${String(i).padStart(2, "0")}`,
    });
  }
  // Setup, polling and navigation share the ordinary request allowance.
  await page.waitForTimeout(10500);
  await page.goto(origin + "/?conversation=" + ids[0]);
  const rail = page
    .locator(".project-group")
    .filter({ has: page.locator(".project-button.selected") });
  const rows = rail.locator(".conversation-link");
  await expect(rows).toHaveCount(5);
  for (const target of [
    rail.locator(".project-more"),
    rail.locator(".session-rename").first(),
  ]) {
    const box = await target.boundingBox();
    expect(box?.width).toBe(30);
    expect(box?.height).toBe(30);
  }

  expect(new URL(page.url()).searchParams.get("conversation")).toBe(ids[0]);
  const input = page.getByLabel("Message Codex");
  await expect(input).toBeEnabled();
  await input.fill("P023 unsent draft");
  const historyRequests: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/history?"))
      historyRequests.push(new URL(request.url()));
  });
  let releasePage!: () => void;
  const pageGate = new Promise<void>((resolve) => {
    releasePage = resolve;
  });
  await page.route("**/api/v1/history?*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("cursor"))
      await pageGate;
    await route.continue();
  });
  await rail.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(
    rail.getByRole("button", { name: "Show more", exact: true }),
  ).toBeDisabled();
  releasePage();
  await expect(rows).toHaveCount(10);
  await page.unroute("**/api/v1/history?*");
  expect(
    historyRequests.every((url) => url.searchParams.get("limit") === "5"),
  ).toBe(true);
  const snap = await (
    await context.request.get(origin + `/api/v1/sessions/${ids[11]}/snapshot`)
  ).json();
  await command(`/sessions/${ids[11]}/metadata`, {
    expectedRevision: snap.session.metadataRevision,
    title: "P023 renamed newest",
  });
  await expect(rows.filter({ hasText: "P023 renamed newest" })).toBeVisible({
    timeout: 15000,
  });
  await expect(rows).toHaveCount(10);
  expect(new Set(await rows.allTextContents()).size).toBe(10);
  await expect(input).toHaveValue("P023 unsent draft");
  expect(new URL(page.url()).searchParams.get("conversation")).toBe(ids[0]);

  let failNextPage = true;
  await page.route("**/api/v1/history?*", async (route) => {
    if (
      failNextPage &&
      new URL(route.request().url()).searchParams.has("cursor")
    ) {
      failNextPage = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await rail.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(
    rail.getByRole("button", { name: "Retry history" }),
  ).toBeVisible();
  await expect(rows).toHaveCount(10);
  await rail.getByRole("button", { name: "Retry history" }).click();
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(12);
  await page.unroute("**/api/v1/history?*");
  const loadedCount = await rows.count();
  const opener = page.getByRole("button", {
    name: "Search and filters",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", {
    name: "Search and filters",
    exact: true,
  });
  const search = dialog.getByLabel("Search conversations", { exact: true });
  await expect(search).toBeFocused();
  await search.fill("P023 history 00");
  await expect(dialog.locator(".conversation-link")).toHaveCount(1);
  await expect(rows).toHaveCount(loadedCount);
  await search.fill("P023 missing");
  await expect(dialog).toContainText("No matching conversations");
  let failSearch = true;
  await page.route("**/api/v1/history?*", async (route) => {
    if (
      failSearch &&
      new URL(route.request().url()).searchParams.get("q") === "P023 history"
    ) {
      failSearch = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await search.fill("P023 history");
  await expect(
    dialog.getByRole("button", { name: "Retry history" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Retry history" }).click();
  await expect(dialog.locator(".conversation-link")).toHaveCount(5);
  await page.unroute("**/api/v1/history?*");
  await dialog.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(dialog.locator(".conversation-link")).toHaveCount(10);
  // A delayed old search cannot repopulate a newer query.
  let releaseStale!: () => void;
  let observedStale!: () => void;
  const staleGate = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  const staleObserved = new Promise<void>((resolve) => {
    observedStale = resolve;
  });
  await page.route("**/api/v1/history?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("q") === "P023 history 01"
    ) {
      const response = await route.fetch();
      observedStale();
      await staleGate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await search.fill("P023 history 01");
  await staleObserved;
  await search.fill("P023 history 00");
  await expect(dialog.locator(".conversation-link")).toHaveText([
    /^P023 history 00(?:Local)?$/,
  ]);
  releaseStale();
  await page.waitForTimeout(300);
  await expect(dialog.locator(".conversation-link")).toHaveText([
    /^P023 history 00(?:Local)?$/,
  ]);
  await page.unroute("**/api/v1/history?*");
  await search.fill("P023 history 01");
  await expect(dialog.locator(".conversation-link")).toHaveCount(1);
  await dialog.locator(".session-rename").click();
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await dialog
    .getByLabel("Conversation title", { exact: true })
    .fill("P023 changed outside search");
  await dialog.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(dialog.locator(".conversation-link")).toHaveCount(0);
  await expect(search).toBeFocused();
  await search.fill("P023 history 00");
  await expect(dialog.locator(".conversation-link")).toHaveText([
    /^P023 history 00(?:Local)?$/,
  ]);
  await expect(dialog.locator(".conversation-link")).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(
      () => document.activeElement?.closest("dialog") !== null,
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: path.join(artifacts, "p023-search-desktop.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await search.fill("P023 missing Escape regression");
  await expect(dialog).toContainText("No matching conversations");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("P023 missing Escape regression");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await search.fill("P023 history 00");
  await expect(dialog.locator(".conversation-link")).toHaveCount(1);
  const resultMenu = dialog.locator("details.action-menu");
  const resultMenuSummary = resultMenu.locator("summary");
  await resultMenuSummary.click();
  await expect(resultMenu).toHaveAttribute("open", "");
  const renameAction = resultMenu.getByRole("button", {
    name: "Rename",
    exact: true,
  });
  await renameAction.focus();
  await expect(renameAction).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(search).toHaveValue("P023 history 00");
  await expect(resultMenu).not.toHaveAttribute("open");
  await expect(resultMenuSummary).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.locator(".conversation-link").click();
  await expect(dialog).toHaveCount(0);
  await expect(input).toHaveValue("P023 unsent draft");
  expect(new URL(page.url()).searchParams.get("conversation")).toBe(ids[0]);

  await input.fill("[activity-group]");
  await input.press("Enter");
  const activity = page.locator(".conversation-activity");
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveCSS("font-size", "12px");
  await expect(activity).toHaveCSS("margin-bottom", "16px");
  await expect(activity).not.toHaveAttribute("open");
  await expect(activity.locator("summary")).toContainText("Running");
  await activity.locator("summary").click();
  await expect(activity).toHaveAttribute("open", "");
  await expect(activity.locator("summary")).toContainText("3 commands", {
    timeout: 15000,
  });
  await expect(activity).toHaveAttribute("open", "");
  await expect(
    page.getByText("Activity complete.", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(activity.locator("pre")).toHaveCount(3);
  await expect(activity.locator("pre").last()).toContainText(
    "literal <diagnostic>",
  );
  const saved = await (
    await context.request.get(origin + `/api/v1/sessions/${ids[0]}/snapshot`)
  ).json();
  expect(
    saved.messages.filter((m: { role: string }) => m.role === "tool"),
  ).toHaveLength(3);
  await page.reload();
  await expect(activity).not.toHaveAttribute("open");
  await expect(activity.locator("summary")).toContainText("3 commands");
  const user = page.locator(".message-user").last();
  const copy = user.getByRole("button", { name: "Copy message", exact: true });
  expect(await copy.evaluate((e) => !e.closest(".user-bubble"))).toBe(true);
  await page.mouse.move(1, 1);
  await expect(user.locator(".message-actions")).toHaveCSS("opacity", "0");
  await user.hover();
  await expect(user.locator(".message-actions")).toHaveCSS("opacity", "1");
  await page.mouse.move(1, 1);
  await copy.focus();
  await expect(user.locator(".message-actions")).toHaveCSS("opacity", "1");
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "[activity-group]",
  );
  await page.evaluate(`(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => { throw new Error("Test clipboard denial"); }
    });
  })()`);
  await page.waitForTimeout(2100);
  await copy.click();
  await page.mouse.move(1, 1);
  await input.focus();
  await expect(user.locator(".message-actions")).toHaveCSS("opacity", "1");
  await expect(user.getByRole("status")).toContainText("Copy failed");
  const colors = await page
    .locator(".sidebar, .app, .composer, .user-bubble")
    .evaluateAll((elements) =>
      elements.map((e) => getComputedStyle(e).backgroundColor),
    );
  for (const color of colors) {
    const channels = color.match(/[\d.]+/g)!;
    expect(channels[0]).toBe(channels[1]);
    expect(channels[1]).toBe(channels[2]);
  }
  await page.screenshot({
    path: path.join(artifacts, "p023-activity-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await opener.click();
  await expect(search).toBeFocused();
  await page.screenshot({
    path: path.join(artifacts, "p023-search-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: path.join(artifacts, "p023-activity-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const browser = context.browser();
  if (!browser) throw new Error("Browser is required for touch acceptance");
  const touchContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: await context.storageState(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const touch = await touchContext.newPage();
    await touch.goto(origin + "/?conversation=" + ids[0]);
    await expect(touch.locator(".app")).toHaveCSS(
      "-webkit-tap-highlight-color",
      "rgb(233, 233, 233)",
    );
    await expect(
      touch.locator(".message-user .message-actions").last(),
    ).toHaveCSS("opacity", "1");
    await touch
      .getByRole("button", { name: "Open navigation", exact: true })
      .tap();
    await expect(touch.locator(".session-rename").first()).toHaveCSS(
      "opacity",
      "1",
    );
    await touch
      .getByRole("button", { name: "Search and filters", exact: true })
      .tap();
    await expect(
      touch.getByRole("dialog", { name: "Search and filters", exact: true }),
    ).toBeVisible();
    await expect(
      touch
        .getByRole("dialog", { name: "Search and filters", exact: true })
        .locator(".conversation-link"),
    ).toHaveCount(5);
    await touch.screenshot({
      path: path.join(artifacts, "p023-search-touch.png"),
      fullPage: true,
    });
  } finally {
    await touchContext.close();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
