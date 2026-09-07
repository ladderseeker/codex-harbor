import { expect } from "@playwright/test";
import { writeFile, readFile, chmod, stat, rm } from "node:fs/promises";
import { join } from "node:path";
/** Real browser requests and managed saves; interception delays only delivery. */
export async function editorRegressions(h: any) {
  const { page, source, local } = h;
  await writeFile(
    join(source, "open-target.txt"),
    "DO NOT REPLACE THE NEW DRAFT\n",
  );
  await writeFile(join(source, "encoding.txt"), "\ufeffone\r\ntwo\r\n");
  await chmod(join(source, "encoding.txt"), 0o775);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const target =
    local.id + ":" + Buffer.from("open-target.txt").toString("base64url");
  let held = false;
  let release!: () => void, completed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delivered = new Promise<void>((resolve) => {
    completed = resolve;
  });
  const matcher = (url: URL) =>
    url.pathname.endsWith("/files/content") &&
    url.searchParams.get("ref") === target;
  await page.route(matcher, async (route: any) => {
    const response = await route.fetch();
    held = true;
    try {
      await gate;
      await route.fulfill({ response });
    } finally {
      completed();
    }
  });
  try {
    await page
      .getByRole("button", { name: "open-target.txt", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    await page.locator(".monaco-editor").click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("A changed while B was loading");
    release();
    await delivered;
    await expect(page.locator(".files-dialog .inline-error")).toContainText(
      "draft changed while that file was opening",
    );
    await expect(page.locator(".view-lines")).toContainText(
      "A changed while B was loading",
    );
    await expect(page.locator(".file-content h3")).toHaveText("tracked.txt");
    expect(await readFile(join(source, "tracked.txt"), "utf8")).not.toContain(
      "A changed while B",
    );
  } finally {
    release();
    await page.unroute(matcher);
  }
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page.getByRole("button", { name: "encoding.txt", exact: true }).click();
  await expect(page.locator(".file-content h3")).toHaveText("encoding.txt");
  await expect(page.locator(".view-lines")).toContainText("two");
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("three");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await readFile(join(source, "encoding.txt"))).toString("hex"),
      { timeout: 30000 },
    )
    .toBe(Buffer.from("\ufeffone\r\ntwo\r\nthree").toString("hex"));
  await expect(page.locator(".file-operation")).toContainText("succeeded", {
    timeout: 30000,
  });
  expect((await stat(join(source, "encoding.txt"))).mode & 0o777).toBe(0o775);
  await page.getByRole("button", { name: "tracked.txt", exact: true }).click();
  await expect(page.locator(".file-content h3")).toHaveText("tracked.txt");
  await expect(page.locator(".view-lines")).toContainText("dirty local");
  await rm(join(source, "encoding.txt"));
  await rm(join(source, "open-target.txt"));
}
