import { openProjectTools } from "../e2e/navigation.ts";
import { editorRegressions } from "./editor-regressions.ts";
import { filesReads } from "./reads.ts";
import { filesRecovery } from "./recovery.ts";
import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export async function filesAcceptance(h: any) {
  const { page, context, origin, local, source, get, command, artifacts } = h;
  const base = `/workspaces/${local.id}`;
  const settle = async (r: any) => {
    expect(r.status(), await r.text()).toBe(202);
    const op = (await r.json()).operation;
    await expect
      .poll(
        async () =>
          (await get(base + "/file-operations/" + op.id)).operation.state,
        { timeout: 45000 },
      )
      .toBe("succeeded");
    return (await get(base + "/file-operations/" + op.id)).operation;
  };
  page.on("pageerror", (error: Error) =>
    console.error("P004 browser error:", error.message),
  );
  await page.evaluate(() => {
    (window as any).fileCspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as any).fileCspViolations.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
      });
    });
  });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await openProjectTools(page);
  await page.getByLabel("New conversation workspace").selectOption(local.id);
  await openProjectTools(page);
  await page
    .getByRole("button", { name: "Files and changes", exact: true })
    .click();
  await page.getByRole("button", { name: "tracked.txt", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate(() => (window as any).fileCspViolations)).toEqual(
    [],
  );
  expect(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("style")).every(
        (s) =>
          s.nonce ===
          document.querySelector<HTMLMetaElement>(
            'meta[name="harbor-style-nonce"]',
          )?.content,
      ),
    ),
  ).toBe(true);
  await expect
    .poll(
      async () =>
        (await page.locator(".view-lines").allInnerTexts())
          .join("\n")
          .replaceAll("\u00a0", " "),
      { timeout: 15000 },
    )
    .toContain('plain style="color:red" stays text')
    .catch(async (error: Error) => {
      await page.screenshot({
        path: path.join(artifacts, "render-failure.png"),
        fullPage: true,
      });
      await writeFile(
        path.join(artifacts, "render-failure.json"),
        JSON.stringify(
          await page.locator(".file-content").evaluate((e: HTMLElement) => ({
            html: e.outerHTML,
            width: e.offsetWidth,
            height: e.offsetHeight,
            violations: (window as any).fileCspViolations,
          })),
          null,
          2,
        ),
      );
      console.error("P004 owned render diagnostics:", artifacts);
      throw error;
    });
  expect(
    await page.evaluate(() => (window as any).harborFileExecuted),
  ).toBeUndefined();
  expect(await page.locator(".monaco-editor img").count()).toBe(0);
  if (process.argv.includes("--render-only")) {
    await page.screenshot({
      path: path.join(artifacts, "files-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.body.scrollWidth <= innerWidth))
      .toBe(true);
    await expect(page.locator(".monaco-editor")).toBeVisible();
    await page.screenshot({
      path: path.join(artifacts, "files-mobile.png"),
      fullPage: true,
    });
    return;
  }
  await editorRegressions(h);
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("Edited through the real Harbor editor\n");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect
    .poll(() => readFile(path.join(source, "tracked.txt"), "utf8"), {
      timeout: 30000,
    })
    .toBe("Edited through the real Harbor editor\n");
  await expect(page.locator(".file-operation")).toContainText("succeeded", {
    timeout: 30000,
  });
  const tree = await get(base + "/files/tree"),
    entry = tree.entries.find((e: any) => e.name === "tracked.txt"),
    first = await get(
      base + "/files/content?ref=" + encodeURIComponent(entry.ref),
    );
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("Draft survives a concurrent managed edit\n");
  const secondText = "Second managed client\n";
  await settle(
    await command(base + "/files/save", {
      ref: entry.ref,
      expectedRevision: first.revision,
      text: secondText,
    }),
  );
  const stale = await command(base + "/files/save", {
    ref: entry.ref,
    expectedRevision: first.revision,
    text: "obsolete",
  });
  expect(stale.status()).toBe(409);
  expect(await readFile(path.join(source, "tracked.txt"), "utf8")).toBe(
    secondText,
  );
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.locator(".files-dialog .inline-error")).toBeVisible();
  await expect(page.locator(".view-lines")).toContainText(
    "Draft survives a concurrent managed edit",
  );
  // API restart does not remove unsaved browser memory or create a new save intent.
  const oldApi = h.api;
  const apiExit = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(Error("API graceful file-stream shutdown exceeded 10 seconds")),
      10000,
    );
    oldApi.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  oldApi.kill("SIGTERM");
  await apiExit;
  h.api = h.start("apps/api/src/main.ts");
  await expect
    .poll(
      async () => {
        try {
          return (await context.request.get(origin + "/api/v1/me")).status();
        } catch {
          return 0;
        }
      },
      { timeout: 20000 },
    )
    .toBe(200);
  await expect(page.locator(".view-lines")).toContainText(
    "Draft survives a concurrent managed edit",
  );
  await page
    .getByRole("button", { name: "Refresh revision, keep draft", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save file", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect
    .poll(() => readFile(path.join(source, "tracked.txt"), "utf8"), {
      timeout: 30000,
    })
    .toBe("Draft survives a concurrent managed edit\n");
  await expect(page.locator(".file-operation")).toContainText("succeeded", {
    timeout: 30000,
  });
  const effectiveText = "Draft survives a concurrent managed edit\n";
  const status = await get(base + "/git/status");
  await settle(
    await command(base + "/git/stage", {
      expectedRevision: status.revision,
      selections: [{ ref: entry.ref, wholeFile: true }],
    }),
  );
  const staged = await get(base + "/git/status"),
    key = `${Date.now()}:${randomUUID()}`,
    body = {
      expectedRevision: staged.revision,
      selectedRefs: [entry.ref],
      message: "P004 exact reviewed change",
    };
  const committed = await settle(
    await command(base + "/git/commit", body, key),
  );
  expect(committed.result.commitOid).toMatch(/^[a-f0-9]{40}$/);
  const repeat = await command(base + "/git/commit", body, key);
  expect(repeat.status()).toBe(202);
  expect((await repeat.json()).operation.id).toBe(committed.id);
  expect((await get(base + "/git/status")).head.oid).toBe(
    committed.result.commitOid,
  );
  const content = await get(
    base + "/files/content?ref=" + encodeURIComponent(entry.ref),
  );
  const download = await context.request.get(
    origin +
      "/api/v1" +
      base +
      "/files/download?ref=" +
      encodeURIComponent(entry.ref) +
      "&revision=" +
      content.revision,
  );
  expect(content.status, JSON.stringify(content)).toBe("text");
  expect(download.status(), await download.text()).toBe(200);
  expect((await download.body()).toString()).toBe(effectiveText);
  const denied = await context.request.get(
    origin +
      "/api/v1" +
      base +
      "/files/content?ref=" +
      encodeURIComponent(
        local.id + ":" + Buffer.from("../control/key").toString("base64url"),
      ),
  );
  expect(denied.status()).toBe(409);
  const baseline = Array.from({ length: 24 }, (_, i) => `line ${i + 1}`);
  let fresh = await get(
    base + "/files/content?ref=" + encodeURIComponent(entry.ref),
  );
  await settle(
    await command(base + "/files/save", {
      ref: entry.ref,
      expectedRevision: fresh.revision,
      text: baseline.join("\n"),
    }),
  );
  let review = await get(base + "/git/status");
  await settle(
    await command(base + "/git/stage", {
      expectedRevision: review.revision,
      selections: [{ ref: entry.ref, wholeFile: true }],
    }),
  );
  review = await get(base + "/git/status");
  await settle(
    await command(base + "/git/commit", {
      expectedRevision: review.revision,
      selectedRefs: [entry.ref],
      message: "Baseline for UI hunk review",
    }),
  );
  baseline[1] = "SELECTED THROUGH UI";
  baseline[21] = "LEFT UNSTAGED";
  fresh = await get(
    base + "/files/content?ref=" + encodeURIComponent(entry.ref),
  );
  await settle(
    await command(base + "/files/save", {
      ref: entry.ref,
      expectedRevision: fresh.revision,
      text: baseline.join("\n"),
    }),
  );
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  const changedEntry = page
    .locator(".change-entry")
    .filter({ hasText: "tracked.txt" });
  await changedEntry.getByRole("button", { name: /Unstaged/ }).click();
  await expect(page.locator(".hunk-selection input")).toHaveCount(2);
  await page.locator(".hunk-selection input").first().check();
  await page
    .getByRole("button", { name: "Stage selected hunks", exact: true })
    .click();
  await expect
    .poll(async () => (await get(base + "/git/status")).entries[0].index, {
      timeout: 30000,
    })
    .toBe("M");
  await expect(page.locator(".file-operation")).toContainText("succeeded", {
    timeout: 30000,
  });
  await page
    .getByLabel("Commit message")
    .fill("Commit only the explicitly selected hunk");
  await expect(
    page.getByRole("button", {
      name: "Commit reviewed staged changes",
      exact: true,
    }),
  ).toBeDisabled();
  await changedEntry.getByRole("button", { name: /Staged/ }).click();
  await expect(page.locator(".hunk-selection")).toContainText(
    "SELECTED THROUGH UI",
  );
  await expect(page.locator(".hunk-selection")).not.toContainText(
    "LEFT UNSTAGED",
  );
  await page
    .getByLabel("Commit message")
    .fill("Commit only the explicitly selected hunk");
  await page
    .getByRole("button", {
      name: "Commit reviewed staged changes",
      exact: true,
    })
    .click();
  await expect(page.locator(".file-operation")).toContainText("succeeded", {
    timeout: 30000,
  });
  await expect
    .poll(async () => (await get(base + "/git/status")).entries[0].index, {
      timeout: 30000,
    })
    .toBe(" ");
  const remaining = await get(
    base + "/git/diff?ref=" + encodeURIComponent(entry.ref) + "&side=unstaged",
  );
  expect(remaining.oldText).toContain("SELECTED THROUGH UI");
  expect(remaining.oldText).not.toContain("LEFT UNSTAGED");
  expect(remaining.newText).toBe(baseline.join("\n"));
  expect(await page.evaluate(() => (window as any).fileCspViolations)).toEqual(
    [],
  );
  await page.getByRole("button", { name: "Close files", exact: true }).click();
  await openProjectTools(page);
  await page
    .getByRole("button", { name: "Files and changes", exact: true })
    .click();
  await page.getByRole("button", { name: "tracked.txt", exact: true }).click();
  await page.screenshot({
    path: path.join(artifacts, "files-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(artifacts, "files-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  // High-volume fixture/negative phases share the actual 200/10s IP budget.
  // Establish fresh phase windows; do not retry rejected user mutations.
  await new Promise((resolve) => setTimeout(resolve, 10500));
  await filesRecovery(h);
  await new Promise((resolve) => setTimeout(resolve, 10500));
  await filesReads(h);
}
