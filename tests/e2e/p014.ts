import { messageActions } from "./message-actions.ts";
import { openProjectTools } from "./navigation.ts";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdir, symlink, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { request as apiRequest } from "@playwright/test";
import path from "node:path";

type Session = { id: string; projectId: string; title: string };
/** Real Harbor browser/API acceptance; the caller owns the isolated full stack. */
export async function p014({
  page,
  context,
  origin,
  artifacts,
  rootId,
  rootPath,
}: {
  page: Page;
  context: BrowserContext;
  origin: string;
  artifacts: string;
  rootId: string;
  rootPath: string;
}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mkdir(path.join(rootPath, "nested", "existing"), { recursive: true });
  await mkdir(path.join(rootPath, "many"));
  await mkdir(path.join(rootPath, "temporarily-unavailable"));
  await Promise.all(
    Array.from({ length: 205 }, (_, i) =>
      mkdir(path.join(rootPath, "many", `folder-${i}`)),
    ),
  );
  await symlink(path.dirname(rootPath), path.join(rootPath, "escape"));
  const directoryRoute = `/api/v1/project-roots/${rootId}/directories`;
  const anonymous = await apiRequest.newContext({ ignoreHTTPSErrors: true });
  try {
    expect((await anonymous.get(origin + directoryRoute)).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
  const listing = await context.request.get(origin + directoryRoute);
  expect(listing.status()).toBe(200);
  const listingBody = await listing.json();
  expect(
    listingBody.directories.map((entry: { name: string }) => entry.name),
  ).not.toContain("escape");
  expect(JSON.stringify(listingBody)).not.toContain(rootPath);
  for (const relative of ["..", "escape", "nested/../many"]) {
    expect(
      (
        await context.request.get(
          origin + directoryRoute + "?path=" + encodeURIComponent(relative),
        )
      ).status(),
    ).toBe(403);
  }
  expect(
    (
      await context.request.get(
        origin + `/api/v1/project-roots/${randomUUID()}/directories`,
      )
    ).status(),
  ).toBe(403);
  const truncated = await (
    await context.request.get(origin + directoryRoute + "?path=many")
  ).json();
  expect(truncated.truncated).toBe(true);
  expect(truncated.directories).toHaveLength(200);
  const sessions = async (): Promise<Session[]> => {
    const response = await context.request.get(origin + "/api/v1/sessions");
    expect(response.status()).toBe(200);
    return (await response.json()).sessions;
  };
  // Dense setup and UI refreshes share the production 200-request/10s allowance.
  // Start reload/navigation phases in a fresh bounded window; never retry a mutation.
  const browserPhaseBoundary = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 10500));
  const noOverflow = async () =>
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  const shot = async (name: string) => {
    await noOverflow();
    await page.screenshot({
      path: path.join(artifacts, "p014-" + name + ".png"),
      fullPage: true,
    });
  };
  const startChat = async (button: import("@playwright/test").Locator) => {
    const before = new Set((await sessions()).map((s) => s.id));
    await expect(button).toBeEnabled({ timeout: 30000 });
    await button.click();
    await expect
      .poll(
        async () => (await sessions()).filter((s) => !before.has(s.id)).length,
      )
      .toBe(1);
    const created = (await sessions()).find((s) => !before.has(s.id))!;
    await expect
      .poll(() => new URL(page.url()).searchParams.get("conversation"))
      .toBe(created.id);
    await expect(page.getByLabel("Message Codex")).toBeEnabled({
      timeout: 30000,
    });
    return created;
  };
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .first()
    .click();
  const projectDialog = page.getByRole("dialog", {
    name: "Add project",
    exact: true,
  });
  await projectDialog.getByLabel("Approved root").selectOption(rootId);
  await projectDialog.getByLabel("Project name").fill("Design project");
  await projectDialog
    .getByRole("button", { name: "Browse folders", exact: true })
    .click();
  await expect(
    projectDialog.getByRole("button", {
      name: "Open folder temporarily-unavailable",
      exact: true,
    }),
  ).toBeVisible();
  await rm(path.join(rootPath, "temporarily-unavailable"), { recursive: true });
  await projectDialog
    .getByRole("button", {
      name: "Open folder temporarily-unavailable",
      exact: true,
    })
    .click();
  await expect(projectDialog.getByRole("alert")).toBeVisible();
  await shot("folder-error");
  await mkdir(path.join(rootPath, "temporarily-unavailable"));
  await projectDialog
    .getByRole("button", { name: "Retry folders", exact: true })
    .click();
  await expect(projectDialog).toContainText("No subfolders");
  await projectDialog
    .getByRole("button", { name: "Parent folder", exact: true })
    .click();
  await projectDialog
    .getByRole("button", { name: "Open folder many", exact: true })
    .click();
  await expect(projectDialog).toContainText("Only the first folders are shown");
  await shot("folder-truncated");
  await projectDialog
    .getByRole("button", { name: "Parent folder", exact: true })
    .click();
  await projectDialog
    .getByRole("button", { name: "Open folder nested", exact: true })
    .click();
  await projectDialog
    .getByRole("button", { name: "Open folder existing", exact: true })
    .click();
  await expect(projectDialog).toContainText("No subfolders");
  await shot("project-browser");
  await projectDialog
    .getByRole("button", { name: "Use this folder", exact: true })
    .click();
  await expect(projectDialog.getByLabel("Folder path")).toHaveValue(
    "nested/existing",
  );
  await projectDialog
    .getByRole("button", { name: "Add project", exact: true })
    .click();
  await expect(projectDialog).toHaveCount(0);
  const first = await startChat(
    page.getByRole("button", { name: "New conversation", exact: true }).first(),
  );
  const me = await (await context.request.get(origin + "/api/v1/me")).json();
  const tokenResponse = await context.request.post(
    origin + "/api/v1/security/api-tokens",
    {
      headers: {
        Origin: origin,
        "X-CSRF-Token": me.csrfToken,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data: {
        name: "Design route-denial test",
        projectIds: [first.projectId],
        scopes: ["read"],
        permissionProfile: "read-only",
        expiresInDays: 1,
      },
    },
  );
  expect(tokenResponse.status()).toBe(200);
  const token = await tokenResponse.json();
  const machine = await apiRequest.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: "Bearer " + token.secret },
  });
  try {
    expect((await machine.get(origin + directoryRoute)).status()).toBe(403);
  } finally {
    await machine.dispose();
  }
  const input = page.getByLabel("Message Codex");
  await expect.poll(() => input.evaluate((e) => e.clientHeight)).toBe(24);
  await input.fill(
    Array.from({ length: 24 }, (_, i) => `Line ${i}`).join("\n"),
  );
  await expect
    .poll(() =>
      input.evaluate((e) => ({
        height: e.clientHeight,
        scroll: getComputedStyle(e).overflowY,
        overflowing: e.scrollHeight > e.clientHeight,
      })),
    )
    .toEqual({ height: 160, scroll: "auto", overflowing: true });
  await input.fill("P014 multiline");
  await expect.poll(() => input.evaluate((e) => e.clientHeight)).toBe(24);
  await input.press("Shift+Enter");
  await input.pressSequentially("second line");
  await expect(input).toHaveValue("P014 multiline\nsecond line");
  // IME's confirming Enter must not dispatch a turn.
  const beforeIme = (
    await (
      await context.request.get(
        origin + `/api/v1/sessions/${first.id}/snapshot`,
      )
    ).json()
  ).messages.length;
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(input).toHaveValue("P014 multiline\nsecond line");
  expect(
    (
      await (
        await context.request.get(
          origin + `/api/v1/sessions/${first.id}/snapshot`,
        )
      ).json()
    ).messages.length,
  ).toBe(beforeIme);
  await input.press("Enter");
  await expect(page.locator("body")).toContainText(
    "Fixture response: P014 multiline",
    { timeout: 30000 },
  );
  await expect(input).toHaveValue("");
  await shot("conversation-desktop");
  await expect(page.locator(".transcript")).not.toContainText(
    "Storage and limits",
  );
  await expect(page.locator(".conversation-header")).not.toContainText(
    "Connected",
  );
  await expect(page.getByText("Project tools", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Search and filters", exact: true }),
  ).toHaveCount(1);
  const more = page.locator(`[data-rename-focus="${first.id}"]`);
  await more.focus();
  await more.press("Enter");
  await page.getByRole("button", { name: "View status", exact: true }).click();
  const status = page.getByRole("dialog", {
    name: "Conversation status",
    exact: true,
  });
  await expect(status).toContainText("Storage and limits");
  await status
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(more).toBeFocused();
  await page
    .getByRole("button", { name: "Search and filters", exact: true })
    .click();
  await page
    .getByLabel("Search conversations", { exact: true })
    .fill("no matching title p016");
  await expect(
    page
      .locator(".project-group")
      .filter({ has: page.locator(".project-button.selected") }),
  ).toContainText("No matching conversations");
  await page.getByLabel("Search conversations", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Search and filters", exact: true })
    .click();

  await input.fill("[markdown]");
  await input.press("Enter");
  const markdown = page.locator(".markdown-body").filter({
    has: page.getByRole("heading", { name: "Markdown acceptance" }),
  });
  await expect(markdown.getByRole("table")).toBeVisible();
  await expect(markdown.locator("pre code.language-markdown")).toContainText(
    "const nested = true;",
  );
  await expect(
    markdown.locator("pre code.language-markdown"),
  ).not.toContainText("Finished Markdown");
  await expect(page.getByText("Writing…", { exact: true })).toBeVisible();
  await expect(markdown).toContainText("Finished Markdown.", {
    timeout: 30000,
  });
  await expect(markdown.locator("pre code.language-markdown")).toHaveText(
    "# Literal Markdown\n```js\nconst nested = true;\n```\n",
  );
  await expect(markdown.locator("pre code.language-mermaid")).toContainText(
    "graph TD; A-->B",
  );
  await expect(markdown.locator(".markdown-align-right").last()).toHaveText(
    "42",
  );
  expect(
    await markdown
      .locator(".markdown-align-right")
      .last()
      .evaluate((element) => getComputedStyle(element).textAlign),
  ).toBe("right");
  await expect(markdown.getByRole("checkbox").first()).toBeChecked();
  await expect(markdown.getByRole("checkbox").first()).toBeDisabled();
  await expect(
    markdown.getByRole("link", { name: "Documentation", exact: true }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await expect(
    markdown.locator("a").filter({ hasText: /^Unsafe$/ }),
  ).not.toHaveAttribute("href");
  await expect(markdown.locator("script, img")).toHaveCount(0);
  expect(await page.evaluate(() => "markdownInjected" in window)).toBe(false);
  await shot("markdown-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("markdown-mobile");
  expect(
    await markdown
      .getByRole("region", { name: "Markdown table" })
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  expect(
    await markdown
      .locator('pre[aria-label="text code block"]')
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);

  await markdown.getByRole("region", { name: "Markdown table" }).focus();
  await expect(
    markdown.getByRole("region", { name: "Markdown table" }),
  ).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });

  await messageActions(page);
  await page.getByLabel("Model", { exact: true }).selectOption("gpt-6-astra");
  await expect(
    page.getByLabel("Effort", { exact: true }).locator("option"),
  ).toHaveText(["Low", "Medium", "High", "Extra High", "Max"]);
  for (const level of ["xhigh", "max"]) {
    await page.getByLabel("Effort", { exact: true }).selectOption(level);
    await input.fill(`P016 reasoning ${level}`);
    await input.press("Enter");
    await expect(
      page
        .getByRole("article", { name: "Codex message" })
        .filter({ hasText: `Fixture response: P016 reasoning ${level}` }),
    ).toBeVisible({ timeout: 30000 });
    const saved = await (
      await context.request.get(
        origin + `/api/v1/sessions/${first.id}/snapshot`,
      )
    ).json();
    expect(saved.session.effort).toBe(level);
    expect(saved.session.model).toBe("gpt-6-astra");
  }
  await page.getByLabel("Model", { exact: true }).selectOption("fixture");
  await expect(
    page.getByLabel("Effort", { exact: true }).locator("option"),
  ).toHaveText(["Low", "Medium", "High"]);
  await expect(page.getByLabel("Effort", { exact: true })).toHaveValue(
    "medium",
  );
  const currentIdentity = await (
    await context.request.get(origin + "/api/v1/me")
  ).json();
  const denied = await context.request.post(
    origin + `/api/v1/sessions/${first.id}/turns`,
    {
      headers: {
        Origin: origin,
        "X-CSRF-Token": currentIdentity.csrfToken,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data: {
        text: "unsupported effort must not run",
        model: "fixture",
        effort: "max",
        permissionProfile: "read-only",
      },
    },
  );
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe("EFFORT_DENIED");
  const second = await startChat(
    page.getByRole("button", {
      name: "New conversation in Design project",
      exact: true,
    }),
  );
  expect(second.projectId).toBe(first.projectId);
  const draft = "Draft belongs to the active chat";
  await input.fill(draft);
  await expect(
    page.getByText("Draft saved for 24 hours.", { exact: true }),
  ).toBeVisible();
  const hostileTitle =
    '<img src=x onerror="window.p014Injected=true"> Design renamed';
  await page.locator(`[data-rename-focus="${first.id}"]`).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const renameDialog = page.locator(".sidebar-rename");
  await renameDialog
    .getByLabel("Conversation title", { exact: true })
    .fill(hostileTitle);
  await renameDialog
    .getByRole("button", { name: "Save title", exact: true })
    .click();
  await expect
    .poll(async () => (await sessions()).find((s) => s.id === first.id)?.title)
    .toBe(hostileTitle);
  await expect(input).toHaveValue(draft);
  expect(new URL(page.url()).searchParams.get("conversation")).toBe(second.id);
  expect(await page.evaluate(() => "p014Injected" in window)).toBe(false);
  await browserPhaseBoundary();
  await page.reload();
  await expect(input).toHaveValue(draft, { timeout: 30000 });
  const renamedRow = page
    .locator(".session-row")
    .filter({ has: page.locator(`[data-rename-focus="${first.id}"]`) });
  await expect(renamedRow.locator(".conversation-link")).toContainText(
    hostileTitle,
  );
  await renamedRow.locator(".conversation-link").click();
  await expect(page.locator("body")).toContainText(
    "Fixture response: P014 multiline",
  );
  await expect(markdown.getByRole("table")).toBeVisible();
  await expect(input).toHaveValue("");
  await page.locator(`[data-rename-focus="${first.id}"]`).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByLabel("Conversation title", { exact: true })
    .fill("Design active renamed");
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect
    .poll(async () => (await sessions()).find((s) => s.id === first.id)?.title)
    .toBe("Design active renamed");
  await browserPhaseBoundary();
  await page.reload();
  await expect(
    page.locator(".session-row.selected .conversation-link"),
  ).toContainText("Design active renamed");
  // Register through the retained typed-path form, then start in this other project
  // while the first project's conversation is active.
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .first()
    .click();
  await projectDialog.getByLabel("Project name").fill("Other design project");
  await projectDialog.getByLabel("Folder path").fill("other-design");
  await projectDialog.getByLabel("Create a new folder").check();
  await projectDialog
    .getByRole("button", { name: "Add project", exact: true })
    .click();
  await expect(projectDialog).not.toBeVisible();
  const projectList = await (
    await context.request.get(origin + "/api/v1/projects")
  ).json();
  const otherProject = projectList.projects.find(
    (p: { name: string }) => p.name === "Other design project",
  );
  expect(otherProject.id).not.toBe(first.projectId);
  await browserPhaseBoundary();
  await page.goto(origin + "/?conversation=" + first.id);
  await expect(input).toBeEnabled();
  const other = await startChat(
    page.getByRole("button", {
      name: "New conversation in Other design project",
      exact: true,
    }),
  );
  expect(other.projectId).toBe(otherProject.id);
  const otherSnapshot = await (
    await context.request.get(origin + `/api/v1/sessions/${other.id}/snapshot`)
  ).json();
  const otherWorkspaces = await (
    await context.request.get(
      origin + `/api/v1/projects/${otherProject.id}/workspaces`,
    )
  ).json();
  expect(otherWorkspaces.workspaces.map((w: { id: string }) => w.id)).toContain(
    otherSnapshot.session.workspaceId,
  );
  await shot("empty-conversation-desktop");
  await browserPhaseBoundary();
  await page.goto(origin + "/?conversation=" + first.id);
  await expect(input).toBeEnabled();
  const separator = page.getByRole("separator", {
    name: "Sidebar width",
    exact: true,
  });
  await separator.focus();
  await separator.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "220");
  await separator.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "400");
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "390");
  const edge = (await separator.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 150);
  await page.mouse.down();
  await page.mouse.move(100, edge.y + 150);
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "220");
  await page.setViewportSize({ width: 760, height: 900 });
  await separator.focus();
  await separator.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "320");
  await noOverflow();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(separator).not.toBeVisible();
  const open = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await open.click();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await shot("navigation-mobile");
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  await expect(page.locator("aside")).toHaveAttribute("inert", "");
  await shot("conversation-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [button, title, file] of [
    ["Codex account", "Codex account", "account"],
    ["API tokens", "API tokens", "tokens"],
    ["Manage workspaces", "Workspaces in Design project", "workspaces"],
  ]) {
    if (button === "Manage workspaces") await openProjectTools(page);
    else await page.locator("details.rail-footer > summary").click();
    await page
      .getByRole("button", {
        name: button === "Codex account" ? /^Codex account/ : button,
        exact: button !== "Codex account",
      })
      .click();
    const panel = page.getByRole("dialog", { name: title, exact: true });
    await expect(panel).toBeVisible();
    if (button === "Codex account")
      await expect(panel.locator(".account-status strong")).toHaveText(
        "Account ready",
      );
    await shot(file + "-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(file + "-mobile");
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}
