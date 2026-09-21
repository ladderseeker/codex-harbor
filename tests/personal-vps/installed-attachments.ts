/** Installed personal profile acceptance: real browser, API, DB, supervisor and native model. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import { Pool } from "pg";
import sharp from "sharp";
import type { AttachmentContext } from "./attachments.ts";

export type InstalledLiveConfig = {
  binary: string;
  credentialHome: string;
  model: string;
};
export const pinnedBinarySha256 =
  "56ef98ab4032d317ab26e9b5e5a175650717351edb16ed9cde0cb6d1734d62da";
export async function installedLiveConfig(): Promise<InstalledLiveConfig> {
  const file = process.env.HARBOR_P024_INSTALLED_LIVE_CONFIG;
  assert.ok(file && isAbsolute(file), "Explicit live config required");
  const privatePath = async (candidate: string, directory: boolean) => {
    assert.ok(
      isAbsolute(candidate) && (await realpath(candidate)) === candidate,
    );
    const info = await lstat(candidate);
    assert.ok(
      (directory ? info.isDirectory() : info.isFile()) &&
        !info.isSymbolicLink() &&
        info.uid === 0 &&
        (info.mode & 0o077) === 0,
      "Root-owned private live input required",
    );
  };
  await privatePath(file, false);
  const config: InstalledLiveConfig = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(Object.keys(config).sort(), [
    "binary",
    "credentialHome",
    "model",
  ]);
  assert.match(config.model, /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
  await privatePath(config.credentialHome, true);
  assert.deepEqual(
    await readdir(config.credentialHome),
    ["auth.json"],
    "Fresh credential-only copy required",
  );
  await privatePath(join(config.credentialHome, "auth.json"), false);
  assert.ok(
    isAbsolute(config.binary) &&
      (await realpath(config.binary)) === config.binary,
  );
  const info = await lstat(config.binary);
  assert.ok(info.isFile() && info.uid === 0 && (info.mode & 0o022) === 0);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(config.binary)) hash.update(chunk);
  assert.equal(
    hash.digest("hex"),
    pinnedBinarySha256,
    "Pinned Linux native runtime required",
  );
  assert.equal(
    execFileSync(config.binary, ["--version"], {
      encoding: "utf8",
      timeout: 10000,
    }).trim(),
    "codex-cli 0.153.4",
  );
  return config;
}

export async function runInstalledAttachments(
  h: AttachmentContext & {
    model: string;
    sourceDigest: { algorithm: string; files: number; digest: string };
  },
) {
  const db = new Pool({ connectionString: h.databaseUrl });
  const deadline = Date.now() + 480000;
  let turnRequests = 0;
  const image = await sharp(
    Buffer.from(
      '<svg width="768" height="512"><rect width="768" height="512" fill="white"/><circle cx="210" cy="256" r="150" fill="#ff0000"/><rect x="460" y="106" width="270" height="300" fill="#0000ff"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const marker = "HARBOR_P024_INSTALLED_OPAQUE_92C7D1";
  const imageInput = {
    name: "colored-shapes.png",
    mimeType: "image/png",
    buffer: image,
  };
  const get = async (route: string) => {
    const response = await h.context.request.get(h.origin + "/api/v1" + route);
    expect(response.status()).toBe(200);
    return response.json();
  };
  const create = async (title: string) => {
    const response = await h.post("/sessions", {
      projectId: h.projectId,
      workspaceId: h.workspaceId,
      title,
      model: h.model,
      effort: "low",
      permissionProfile: "read-only",
    });
    expect(response.status()).toBe(200);
    return (await response.json()).session.id as string;
  };
  const send = async (
    session: string,
    text: string,
    files: { name: string; mimeType: string; buffer: Buffer }[],
    totalAttachments: number,
  ) => {
    assert.ok(
      turnRequests < 4 && Date.now() < deadline,
      "Bounded live turn budget exhausted",
    );
    await h.page.goto(h.origin + "/?conversation=" + session);
    const message = h.page.getByLabel("Message Codex");
    await expect(message).toBeEnabled({ timeout: 30000 });
    if (files.length) {
      await h.page.getByLabel("Choose attachment").setInputFiles(files);
      await expect(
        h.page.getByText("Selected for this message", { exact: true }),
      ).toHaveCount(files.length);
    }
    await message.fill(text);
    await expect(
      h.page.getByText("Draft saved for 24 hours.", { exact: true }),
    ).toBeVisible();
    const sendButton = h.page.getByRole("button", {
      name: "Send",
      exact: true,
    });
    await expect(sendButton).toBeEnabled();
    const responsePromise = h.page.waitForResponse(
      (response) =>
        response.url() === h.origin + `/api/v1/sessions/${session}/turns` &&
        response.request().method() === "POST",
    );
    turnRequests++;
    await sendButton.click();
    const accepted = await responsePromise;
    expect(accepted.status()).toBe(202);
    const operationId = (await accepted.json()).operation.id as string;
    await expect(message).toHaveValue("");
    await expect(
      h.page.locator(".attachment-list .attachment-row"),
    ).toHaveCount(0);
    await expect
      .poll(
        async () => (await get(`/operations/${operationId}`)).operation.state,
        { timeout: Math.min(150000, deadline - Date.now()), intervals: [1000] },
      )
      .toBe("succeeded");
    const snapshot = await get(`/sessions/${session}/snapshot`);
    const responseText = snapshot.messages
      .filter(
        (m: any) => m.role === "assistant" && m.operationId === operationId,
      )
      .map((m: any) => m.text)
      .join("\n");
    expect(responseText.length).toBeGreaterThan(0);
    expect(responseText.length).toBeLessThan(4096);
    const draft = (await get(`/sessions/${session}/draft`)).draft;
    expect(draft.text).toBe("");
    expect(draft.attachmentIds).toEqual([]);
    await h.page.reload();
    await expect(
      h.page.locator(".message-user .attachment-preview"),
    ).toHaveCount(totalAttachments);
    await expect(message).toHaveValue("");
    await expect(
      h.page.locator(".attachment-list .attachment-row"),
    ).toHaveCount(0);
    const rows = (
      await db.query(
        "SELECT a.id,a.content,a.inode,a.device,s.canonical FROM attachments a JOIN session_attachment_storage s ON s.session_id=a.session_id WHERE a.operation_id=$1 AND a.state='attached'",
        [operationId],
      )
    ).rows;
    expect(rows).toHaveLength(files.length);
    for (const row of rows) {
      const file = join(row.canonical, row.id);
      const info = await stat(file, { bigint: true });
      expect(Number(info.mode) & 0o777).toBe(0o444);
      expect(String(info.ino)).toBe(row.inode);
      expect(String(info.dev)).toBe(row.device);
      expect(await readFile(file)).toEqual(row.content);
    }
    return responseText;
  };
  try {
    const capabilities = await get("/capabilities");
    expect(capabilities.account?.authenticated).toBe(true);
    const attachedFirst = await create("Installed image-first acceptance");
    await send(attachedFirst, "", [imageInput], 1);
    const receipt = await send(
      attachedFirst,
      "Describe the colors and shapes in the attached image and read the attached opaque file. Reply in at most 60 words, including its exact ASCII contents. Do not modify anything.",
      [
        imageInput,
        {
          name: "receipt.bin",
          mimeType: "application/octet-stream",
          buffer: Buffer.from(marker),
        },
      ],
      3,
    );
    expect(receipt.toLowerCase()).toContain("red");
    expect(receipt.toLowerCase()).toContain("blue");
    expect(receipt.toLowerCase()).toContain("circle");
    expect(receipt).toContain(marker);
    const textFirst = await create("Installed text-first continuation");
    await send(
      textFirst,
      "Reply only READY. Do not use tools or modify files.",
      [],
      0,
    );
    const continuation = await send(
      textFirst,
      "Identify the colors and shapes of the attached image in at most 30 words. Do not modify anything.",
      [imageInput],
      1,
    );
    expect(continuation.toLowerCase()).toContain("red");
    expect(continuation.toLowerCase()).toContain("blue");
    expect(continuation.toLowerCase()).toContain("circle");
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM operations WHERE kind='turn' AND session_id=ANY($1::uuid[])",
            [[attachedFirst, textFirst]],
          )
        ).rows[0].n,
      ),
    ).toBe(4);
    const history = await get(
      `/history?projectId=${h.projectId}&order=queried`,
    );
    for (const id of [attachedFirst, textFirst])
      expect(history.sessions.some((s: any) => s.id === id)).toBe(true);
    await h.page.screenshot({
      path: join(h.artifacts, "p024-installed-live.png"),
      fullPage: true,
    });
    await writeFile(
      join(h.artifacts, "p024-installed-live.json"),
      JSON.stringify(
        {
          passed: true,
          sourceDigest: h.sourceDigest,
          runtimeVersion: "0.153.4",
          binarySha256: pinnedBinarySha256,
          model: h.model,
          effort: "low",
          turnRequests,
          externalFixtures: ["OIDC"],
          checks: [
            "image-only browser submission",
            "text/image/opaque exact native receipt",
            "text-first native image continuation",
            "accepted composer clears",
            "draft remains empty after reload",
            "persisted transcript and history attachments",
            "published inode/content/mode identity",
            "four accepted operations without replay",
          ],
          limits: [
            "Synthetic private projects and credential-only copied home",
            "No production conversation replay",
          ],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    await db.end();
  }
}
