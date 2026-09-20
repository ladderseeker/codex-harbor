import { expect, type Page } from "@playwright/test";

/** Runs against a completed real Harbor Markdown fixture reply in the P014 stack. */
export async function messageActions(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const message = page
    .getByRole("article", { name: "Codex message" })
    .filter({ hasText: "Finished Markdown." })
    .last();
  const actions = message.getByRole("group", { name: "Response actions" });
  await expect(actions).toBeVisible();
  await actions
    .getByRole("button", { name: "Copy response", exact: true })
    .click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("````markdown");
  expect(copied).toContain("Finished Markdown.");
  expect(copied).not.toContain("Copy response");
  await expect(
    actions.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  const source = message
    .locator(".markdown-code")
    .filter({ has: page.locator("code.language-markdown") });
  const expectedSource = await source.locator("pre code").textContent();
  await source.getByRole("button", { name: "Copy Markdown source" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    expectedSource,
  );
  const highlighted = message
    .locator(".markdown-code")
    .filter({ has: page.locator("code.language-typescript") });
  await expect(highlighted.locator(".hljs-keyword")).toHaveText("const");
  const header = highlighted.locator(".markdown-code-header");
  expect((await header.boundingBox())!.y).toBeLessThan(
    (await highlighted.locator("pre").boundingBox())!.y,
  );
  expect(
    (await header.locator(".markdown-code-label").boundingBox())!.x,
  ).toBeLessThan((await header.getByRole("button").boundingBox())!.x);
  await header.getByRole("button", { name: "Copy code", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'const title: string = "Harbor";\n',
  );
  const requests: string[] = [];
  const observe = (request: import("@playwright/test").Request) => {
    if (request.method() !== "GET") requests.push(request.url());
  };
  page.on("request", observe);
  try {
    const like = actions.getByRole("button", {
      name: "Like response",
      exact: true,
    });
    const dislike = actions.getByRole("button", {
      name: "Dislike response",
      exact: true,
    });
    await like.click();
    await expect(like).toHaveAttribute("aria-pressed", "true");
    await dislike.click();
    await expect(like).toHaveAttribute("aria-pressed", "false");
    await expect(dislike).toHaveAttribute("aria-pressed", "true");
    await dislike.click();
    await expect(dislike).toHaveAttribute("aria-pressed", "false");
    await like.focus();
    await page.keyboard.press("Space");
    await expect(like).toHaveAttribute("aria-pressed", "true");
    expect(requests).toEqual([]);
  } finally {
    page.off("request", observe);
  }
  await page.reload();
  await expect(
    message.getByRole("button", { name: "Like response", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  // Reject one browser clipboard call to verify honest failure and a working retry.
  await page.evaluate(`(() => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => {
        Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: original });
        throw new Error("Test clipboard denial");
      }
    });
  })()`);
  await actions
    .getByRole("button", { name: "Copy response", exact: true })
    .click();
  await expect(actions.getByRole("status")).toContainText("Copy failed");
  await expect(
    actions.getByRole("button", { name: "Copied", exact: true }),
  ).toHaveCount(0);
  await actions
    .getByRole("button", { name: "Copy response", exact: true })
    .click();
  await expect(
    actions.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
}
