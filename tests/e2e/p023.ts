import {
  expect,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Pool } from "pg";

// Measure rendered text, excluding button padding and leading icons.
async function textX(locator: Locator) {
  return locator.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().x;
      }
    }
    throw new Error("Expected rendered text");
  });
}
async function alignedText(title: Locator, status: Locator) {
  // Sidebar movement can span separate browser reads; assert settled geometry.
  await expect
    .poll(async () => Math.abs((await textX(title)) - (await textX(status))))
    .toBeLessThan(0.6);
}
async function alignedMenus(rail: Locator) {
  await expect(rail.locator(".project-more svg")).toHaveCSS("width", "16px");
  await expect(rail.locator(".session-rename svg").first()).toHaveCSS(
    "width",
    "16px",
  );
  expect(
    await rail
      .locator(".project-row > button")
      .evaluateAll((elements) =>
        elements.map((e) =>
          e.classList.contains("project-new")
            ? "new"
            : e.classList.contains("project-more")
              ? "more"
              : "label",
        ),
      ),
  ).toEqual(["label", "new", "more"]);
  await expect
    .poll(async () => {
      const project = (await rail.locator(".project-more").boundingBox())!;
      const session = (await rail
        .locator(".session-rename")
        .first()
        .boundingBox())!;
      const heading = (await rail
        .locator("xpath=ancestor::aside")
        .locator(".rail-heading .icon-button")
        .boundingBox())!;
      const projectGlyph = (await rail
        .locator(".project-more svg")
        .boundingBox())!;
      const sessionGlyph = (await rail
        .locator(".session-rename svg")
        .first()
        .boundingBox())!;
      const plusTextCenter = await rail
        .locator("xpath=ancestor::aside")
        .locator(".rail-heading .icon-button")
        .evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const text = range.getBoundingClientRect();
          return text.x + text.width / 2;
        });
      const centers = [
        project,
        session,
        heading,
        projectGlyph,
        sessionGlyph,
      ].map((box) => box.x + box.width / 2);
      centers.push(plusTextCenter);
      return Math.max(...centers) - Math.min(...centers);
    })
    .toBeLessThan(0.6);
}

/** Real API/database/supervisor pagination and transcript acceptance, after P014. */
export async function p023({
  page,
  context,
  origin,
  artifacts,
  db,
}: {
  page: Page;
  context: BrowserContext;
  origin: string;
  artifacts: string;
  db: Pool;
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
  await precisionHistory({ context, origin, projectId, db, command });
  await page.waitForTimeout(10500);
  let releaseInitial!: () => void;
  const initialGate = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  await page.route("**/api/v1/history?*", async (route) => {
    await initialGate;
    await route.continue();
  });
  await page.goto(origin + "/?conversation=" + ids[0]);
  const rail = page
    .locator(".project-group")
    .filter({ has: page.locator(".project-button.selected") });
  const rows = rail.locator(".conversation-link");
  const loading = rail
    .getByRole("status")
    .filter({ hasText: "Loading conversations" });
  await expect(loading).toBeVisible();
  const initialLoadingX = await textX(loading);
  releaseInitial();
  await expect(rows).toHaveCount(5);
  await page.unroute("**/api/v1/history?*");
  await expect(rows).toHaveText(
    [
      "P023 history 11",
      "P023 history 10",
      "P023 history 09",
      "P023 history 08",
      "P023 history 07",
    ],
    { useInnerText: true },
  );
  const title = rows
    .first()
    .locator("span")
    .filter({ hasText: "P023" })
    .first();
  expect(Math.abs(initialLoadingX - (await textX(title)))).toBeLessThan(0.6);
  const more = rail.getByRole("button", { name: "Show more", exact: true });
  const separator = page.getByRole("separator", {
    name: "Sidebar width",
    exact: true,
  });
  for (const key of ["Home", "End"]) {
    await separator.focus();
    await separator.press(key);
    await alignedText(title, more);
    await alignedMenus(rail);
    await rail.locator(".project-row").hover();
    await alignedMenus(rail);
  }
  await page.locator(".settings-menu > summary").click();
  const settings = page.locator(".settings-menu");
  await expect(
    settings.getByRole("button", { name: "Codex account", exact: true }),
  ).toBeVisible();
  await expect(settings).not.toContainText("Ready");
  await expect(settings).not.toContainText("Work continues when you leave");
  await page.locator(".settings-menu > summary").click();
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
  await alignedText(title, loading);
  await alignedText(title, more);
  releasePage();
  await expect(rows).toHaveCount(10);
  await page.unroute("**/api/v1/history?*");
  expect(
    historyRequests.every((url) => url.searchParams.get("limit") === "5"),
  ).toBe(true);
  const snap = await (
    await context.request.get(origin + `/api/v1/sessions/${ids[2]}/snapshot`)
  ).json();
  await command(`/sessions/${ids[2]}/metadata`, {
    expectedRevision: snap.session.metadataRevision,
    title: "P023 renamed newest",
  });
  await expect(rows.filter({ hasText: "P023 renamed newest" })).toBeVisible({
    timeout: 15000,
  });
  await expect(rows).toHaveCount(10);
  expect(new Set(await rows.allTextContents()).size).toBe(10);
  await expect(rows.nth(0)).toHaveText("P023 history 11", {
    useInnerText: true,
  });
  await expect(rows.nth(9)).toHaveText("P023 renamed newest", {
    useInnerText: true,
  });
  await expect(input).toHaveValue("P023 unsent draft");
  expect(new URL(page.url()).searchParams.get("conversation")).toBe(ids[0]);

  const selectedBefore = await context.request.get(
    origin + `/api/v1/sessions/${ids[10]}/snapshot`,
  );
  const selectedTimestamp = (await selectedBefore.json()).session.updatedAt;
  const orderBeforeSelection = await rows.allInnerTexts();
  await rows.filter({ hasText: "P023 history 10" }).click();
  await expect(rows).toHaveText(orderBeforeSelection, { useInnerText: true });
  await expect(rows).toHaveCount(10);
  await expect(rail.locator(".history")).toHaveAttribute("aria-busy", "false");
  await input.fill("P023 second draft");
  await expect(rows.filter({ hasText: "P023 history 00" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Search and filters", exact: true })
    .click();
  const selectionSearch = page.getByRole("dialog", {
    name: "Search and filters",
    exact: true,
  });
  await selectionSearch
    .getByLabel("Search conversations", { exact: true })
    .fill("P023 history 00");
  await selectionSearch.locator(".conversation-link").click();
  await expect(selectionSearch).toHaveCount(0);
  await expect(rows).toHaveText(orderBeforeSelection, { useInnerText: true });
  await expect(rows.filter({ hasText: "P023 history 00" })).toHaveCount(0);
  await expect(rows).toHaveCount(10);
  await expect(input).toHaveValue("P023 unsent draft");
  const selectedAfter = await context.request.get(
    origin + `/api/v1/sessions/${ids[10]}/snapshot`,
  );
  expect((await selectedAfter.json()).session.updatedAt).toBe(
    selectedTimestamp,
  );

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
  await alignedText(title, rail.locator(".history-error p"));
  await alignedText(title, rail.getByRole("button", { name: "Retry history" }));
  await rail.getByRole("button", { name: "Retry history" }).click();
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(12);
  await page.unroute("**/api/v1/history?*");
  for (
    let pageNumber = 0;
    pageNumber < 10 && (await more.count());
    pageNumber++
  ) {
    const beforeCount = await rows.count();
    await more.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(beforeCount);
    await expect(rail.locator(".history")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  await expect(more).toHaveCount(0);
  expect(
    historyRequests.every((url) => url.searchParams.get("limit") === "5"),
  ).toBe(true);
  const loadedCount = await rows.count();
  const allRecent = await (
    await context.request.get(
      origin +
        "/api/v1/history?" +
        new URLSearchParams({
          projectId,
          order: "queried",
          limit: "50",
        }),
    )
  ).json();
  await expect(rows).toHaveText(
    allRecent.sessions.map((session: { title: string }) => session.title),
    { useInnerText: true },
  );
  expect(new Set(await rows.allTextContents()).size).toBe(loadedCount);
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
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toHaveText("P023 history 00", {
    useInnerText: true,
  });
  const user = page.locator(".message-user").last();
  const copy = user.getByRole("button", { name: "Copy message", exact: true });
  const decorative = user.locator(".decorative-reaction");
  await expect(decorative).toHaveCount(2);
  await expect(user.getByRole("button")).toHaveCount(1);
  expect(
    await decorative.evaluateAll((elements) =>
      elements.every(
        (e) =>
          e.tagName === "SPAN" &&
          e.getAttribute("aria-hidden") === "true" &&
          !e.hasAttribute("tabindex") &&
          !e.hasAttribute("role") &&
          !e.hasAttribute("aria-pressed"),
      ),
    ),
  ).toBe(true);
  const assistantActions = page
    .getByRole("group", { name: "Response actions" })
    .last();
  for (const property of ["width", "height"]) {
    expect(
      await decorative
        .first()
        .evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), property),
    ).toBe(
      await assistantActions
        .getByRole("button", { name: "Like response", exact: true })
        .evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), property),
    );
    expect(
      await decorative
        .first()
        .locator("svg")
        .evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), property),
    ).toBe(
      await assistantActions
        .locator("svg")
        .first()
        .evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), property),
    );
  }
  expect(
    await user
      .locator(".message-actions")
      .evaluate((e) => getComputedStyle(e).gap),
  ).toBe(await assistantActions.evaluate((e) => getComputedStyle(e).gap));
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
  await alignedMenus(rail);
  await alignedText(title, more);
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
    await touch.screenshot({
      path: path.join(artifacts, "p023-user-actions-touch.png"),
      fullPage: true,
    });
    await touch
      .getByRole("button", { name: "Open navigation", exact: true })
      .tap();
    await expect(touch.locator(".session-rename").first()).toHaveCSS(
      "opacity",
      "1",
    );
    const touchRail = touch
      .locator(".project-group")
      .filter({ has: touch.locator(".project-button.selected") });
    const touchRows = touchRail.locator(".conversation-link");
    const touchOrder = await touchRows.allInnerTexts();
    await touchRows.nth(1).tap();
    await touch
      .getByRole("button", { name: "Open navigation", exact: true })
      .tap();
    await expect(touchRows).toHaveText(touchOrder, { useInnerText: true });
    await alignedMenus(touchRail);
    await alignedText(
      touchRail.locator(".conversation-link").first(),
      touchRail.getByRole("button", { name: "Show more", exact: true }),
    );
    await touchRows.first().tap();
    await expect(
      touch.locator(".message-user .decorative-reaction").last(),
    ).toHaveCSS("min-width", "36px");
    await touch
      .getByRole("button", { name: "Open navigation", exact: true })
      .tap();
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
  const populatedInset =
    (await textX(title)) - (await rail.locator(".history").boundingBox())!.x;
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .first()
    .click();
  const projectDialog = page.getByRole("dialog", {
    name: "Add project",
    exact: true,
  });
  await projectDialog.getByLabel("Project name").fill("P023 empty history");
  await projectDialog.getByLabel("Folder path").fill("p023-empty-history");
  await projectDialog.getByLabel("Create a new folder").check();
  await projectDialog
    .getByRole("button", { name: "Add project", exact: true })
    .click();
  await expect(projectDialog).toHaveCount(0);
  const emptyRail = page
    .locator(".project-group")
    .filter({ hasText: "P023 empty history" });
  const empty = emptyRail.getByText("No matching conversations", {
    exact: true,
  });
  await expect(empty).toBeVisible();
  const emptyOrigin = (await emptyRail.locator(".history").boundingBox())!.x;
  expect(
    Math.abs((await textX(empty)) - emptyOrigin - populatedInset),
  ).toBeLessThan(0.6);
}

/** Exact PostgreSQL ordering via the real authenticated history API. */
async function precisionHistory({
  context,
  origin,
  projectId,
  db,
  command,
}: {
  context: BrowserContext;
  origin: string;
  projectId: string;
  db: Pool;
  command: (route: string, data: unknown) => Promise<any>;
}) {
  const precisionIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const created = await command("/sessions", {
      projectId,
      model: "fixture",
      effort: "medium",
      permissionProfile: "read-only",
    });
    precisionIds.push(created.session.id);
    await command(`/sessions/${created.session.id}/metadata`, {
      expectedRevision: created.session.metadataRevision,
      title: `P023 precision ${i}`,
    });
    await db.query(
      "UPDATE sessions SET created_at='2026-01-01T00:00:00.123456Z',updated_at=$2::timestamptz WHERE id=$1",
      [created.session.id, `2026-02-01T00:00:00.00000${i}Z`],
    );
  }
  // One no-query row exercises the creation-time fallback. The others use
  // exact durable user-message times; assistant/tool rows must not affect it.
  for (const [index, timestamp] of [
    [1, "2026-01-01T00:00:00.123400Z"],
    [2, "2026-01-01T00:00:00.123457Z"],
    [3, "2026-01-01T00:00:00.123457Z"],
  ] as const) {
    await db.query(
      "INSERT INTO messages(id,session_id,role,text,status,created_at) VALUES($1,$2,'user',$3,'complete',$4::timestamptz),($5,$2,'assistant','later assistant output','complete','2026-03-01T00:00:00Z'),($6,$2,'tool','later tool output','complete','2026-04-01T00:00:00Z')",
      [
        randomUUID(),
        precisionIds[index],
        `P023 precision query ${index}`,
        timestamp,
        randomUUID(),
        randomUUID(),
      ],
    );
  }
  const get = async (values: Record<string, string>) =>
    context.request.get(
      origin + "/api/v1/history?" + new URLSearchParams(values),
    );
  const base = {
    projectId,
    q: "P023 precision",
    order: "queried",
    limit: "1",
  };
  const first = await (await get(base)).json();
  const tied = [precisionIds[2], precisionIds[3]].sort().reverse();
  expect(first.sessions.map((s: { id: string }) => s.id)).toEqual([tied[0]]);
  expect(first.sessions[0]).not.toHaveProperty("cursor_timestamp");
  expect(first.sessions[0]).not.toHaveProperty("cursor_priority");
  expect(first.sessions[0]).not.toHaveProperty("queriedAt");
  const cursor = JSON.parse(
    Buffer.from(first.nextCursor, "base64url").toString(),
  );
  expect(Object.keys(cursor).sort()).toEqual(["filter", "id", "queriedAt"]);
  expect(cursor.queriedAt).toBe("2026-01-01T00:00:00.123457Z");
  const seen = [first.sessions[0].id];
  let next = first.nextCursor;
  while (next) {
    const response = await get({ ...base, cursor: next });
    expect(response.status()).toBe(200);
    const page = await response.json();
    seen.push(...page.sessions.map((s: { id: string }) => s.id));
    next = page.nextCursor;
  }
  expect(seen).toEqual([...tied, precisionIds[0], precisionIds[1]]);
  const mismatches: Record<string, string>[] = [
    { state: "all" },
    { q: "different" },
    { projectId: randomUUID() },
    { order: "created" },
    { order: "updated" },
  ];
  for (const changed of mismatches) {
    const values: Record<string, string> = {
      ...base,
      ...changed,
      cursor: first.nextCursor,
    };
    expect((await get(values)).status()).toBe(400);
  }
  expect((await get({ ...base, selectedId: precisionIds[0] })).status()).toBe(
    400,
  );
  expect((await get({ projectId, selectedId: precisionIds[0] })).status()).toBe(
    400,
  );
  expect((await get({ ...base, selectedId: "invalid" })).status()).toBe(400);
  const createdBase = { projectId, q: "P023 precision", limit: "1" };
  const legacy = await (await get(createdBase)).json();
  expect(
    Object.keys(
      JSON.parse(Buffer.from(legacy.nextCursor, "base64url").toString()),
    ).sort(),
  ).toEqual(["createdAt", "filter", "id"]);
  const createdSeen = [legacy.sessions[0].id];
  next = legacy.nextCursor;
  while (next) {
    const page = await (
      await get({ ...createdBase, order: "created", cursor: next })
    ).json();
    createdSeen.push(...page.sessions.map((s: { id: string }) => s.id));
    next = page.nextCursor;
  }
  expect(createdSeen).toEqual([...precisionIds].sort().reverse());
  expect((await get({ ...base, cursor: legacy.nextCursor })).status()).toBe(
    400,
  );
  // Preserve the prior updated cursor and selected-priority contract.
  const updatedBase = {
    projectId,
    q: "P023 precision",
    order: "updated",
    selectedId: precisionIds[1],
    limit: "1",
  };
  const updated = await (await get(updatedBase)).json();
  expect(updated.sessions[0].id).toBe(precisionIds[1]);
  expect(
    Object.keys(
      JSON.parse(Buffer.from(updated.nextCursor, "base64url").toString()),
    ).sort(),
  ).toEqual(["filter", "id", "priority", "updatedAt"]);
  const updatedSeen = [updated.sessions[0].id];
  next = updated.nextCursor;
  while (next) {
    const response = await get({ ...updatedBase, cursor: next });
    expect(response.status()).toBe(200);
    const page = await response.json();
    updatedSeen.push(...page.sessions.map((s: { id: string }) => s.id));
    next = page.nextCursor;
  }
  expect(updatedSeen).toEqual([
    precisionIds[1],
    precisionIds[3],
    precisionIds[2],
    precisionIds[0],
  ]);
  const updatedMismatches: Record<string, string>[] = [
    { selectedId: precisionIds[2] },
    { state: "all" },
    { q: "different" },
    { projectId: randomUUID() },
    { order: "created", selectedId: "" },
  ];
  for (const changed of updatedMismatches) {
    const values: Record<string, string> = {
      ...updatedBase,
      ...changed,
      cursor: updated.nextCursor,
    };
    if (!values.selectedId) delete values.selectedId;
    expect((await get(values)).status()).toBe(400);
  }
  expect((await get({ ...base, cursor: updated.nextCursor })).status()).toBe(
    400,
  );
  const allProjects = await (
    await context.request.get(origin + "/api/v1/projects")
  ).json();
  const other = allProjects.projects.find(
    (p: { id: string }) => p.id !== projectId,
  );
  expect(other).toBeTruthy();
  const cross = await (
    await get({ ...base, projectId: other.id, limit: "50" })
  ).json();
  expect(cross.sessions).toEqual([]);
  const unmatched = await (
    await get({ ...base, q: "P023 precision 1" })
  ).json();
  expect(unmatched.sessions.map((s: { id: string }) => s.id)).toEqual([
    precisionIds[1],
  ]);
  const snapshot = await (
    await context.request.get(
      origin + `/api/v1/sessions/${precisionIds[0]}/snapshot`,
    )
  ).json();
  await command(`/sessions/${precisionIds[0]}/metadata`, {
    expectedRevision: snapshot.session.metadataRevision,
    title: "P023 precision fallback renamed",
  });
  const afterMetadata = await (await get({ ...base, limit: "50" })).json();
  expect(afterMetadata.sessions.map((s: { id: string }) => s.id)).toEqual(seen);
  const renamed = await (
    await context.request.get(
      origin + `/api/v1/sessions/${precisionIds[0]}/snapshot`,
    )
  ).json();
  await command(`/sessions/${precisionIds[0]}/metadata`, {
    expectedRevision: renamed.session.metadataRevision,
    archived: true,
  });
  const archived = await (await get({ ...base, limit: "50" })).json();
  expect(archived.sessions.map((s: { id: string }) => s.id)).not.toContain(
    precisionIds[0],
  );

  // Exercise admission rather than manufacturing the decisive query: the
  // accepted request reorders once, its exact-key replay adds no query, and a
  // rejected request leaves the newer no-query conversation unchanged.
  const acceptedOld = await command("/sessions", {
    projectId,
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  });
  await command(`/sessions/${acceptedOld.session.id}/metadata`, {
    expectedRevision: acceptedOld.session.metadataRevision,
    title: "P023 admission older",
  });
  const rejectedNew = await command("/sessions", {
    projectId,
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  });
  await command(`/sessions/${rejectedNew.session.id}/metadata`, {
    expectedRevision: rejectedNew.session.metadataRevision,
    title: "P023 admission newer",
  });
  const admissionBase = {
    projectId,
    q: "P023 admission",
    order: "queried",
    limit: "10",
  };
  expect(
    (await (await get(admissionBase)).json()).sessions.map(
      (s: { id: string }) => s.id,
    ),
  ).toEqual([rejectedNew.session.id, acceptedOld.session.id]);
  const identity = await (
    await context.request.get(origin + "/api/v1/me")
  ).json();
  const turn = async (id: string, key: string, effort = "medium") =>
    context.request.post(origin + `/api/v1/sessions/${id}/turns`, {
      headers: {
        Origin: origin,
        "X-CSRF-Token": identity.csrfToken,
        "Idempotency-Key": key,
      },
      data: {
        text: "P023 accepted durable query",
        model: "fixture",
        effort,
        permissionProfile: "read-only",
      },
    });
  const acceptedKey = `${Date.now()}:${randomUUID()}`;
  expect((await turn(acceptedOld.session.id, acceptedKey)).status()).toBe(202);
  expect((await turn(acceptedOld.session.id, acceptedKey)).status()).toBe(202);
  expect(
    (
      await turn(rejectedNew.session.id, `${Date.now()}:${randomUUID()}`, "max")
    ).status(),
  ).toBe(403);
  expect(
    (
      await db.query(
        "SELECT session_id,count(*)::int AS count FROM messages WHERE session_id=ANY($1::uuid[]) AND role='user' GROUP BY session_id",
        [[acceptedOld.session.id, rejectedNew.session.id]],
      )
    ).rows,
  ).toEqual([{ session_id: acceptedOld.session.id, count: 1 }]);
  expect(
    (await (await get(admissionBase)).json()).sessions.map(
      (s: { id: string }) => s.id,
    ),
  ).toEqual([acceptedOld.session.id, rejectedNew.session.id]);
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM sessions WHERE id=$1", [
            acceptedOld.session.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("succeeded");
  expect(
    (await (await get(admissionBase)).json()).sessions.map(
      (s: { id: string }) => s.id,
    ),
  ).toEqual([acceptedOld.session.id, rejectedNew.session.id]);
  for (const id of [acceptedOld.session.id, rejectedNew.session.id]) {
    const current = await (
      await context.request.get(origin + `/api/v1/sessions/${id}/snapshot`)
    ).json();
    await command(`/sessions/${id}/metadata`, {
      expectedRevision: current.session.metadataRevision,
      archived: true,
    });
  }
}
