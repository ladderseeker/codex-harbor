import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { png } from "../fixtures/png.ts";
export async function attachmentWorkspaces(
  context: BrowserContext,
  page: Page,
  origin: string,
  csrf: string,
  db: Pool,
  traceFile: string,
) {
  const headers = () => ({
    Origin: origin,
    "X-CSRF-Token": csrf,
    "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
  });
  const get = async (route: string) =>
    (await context.request.get(origin + "/api/v1" + route)).json();
  const command = async (route: string, data: unknown) => {
    const result = await context.request.post(origin + "/api/v1" + route, {
      headers: headers(),
      data,
    });
    expect([200, 202], await result.text()).toContain(result.status());
    return result.json();
  };
  const root = (await get("/project-roots")).roots[0];
  const { project } = await command("/projects", {
    name: "Derived attachment project",
    rootId: root.id,
    path: "attachment-" + randomUUID(),
    create: true,
  });
  const local = (await get(`/projects/${project.id}/workspaces`)).workspaces[0];
  const { workspace: copy } = await command(
    `/projects/${project.id}/workspaces`,
    {
      name: "Attachment copy",
      kind: "copy",
      sourceWorkspaceId: local.id,
      dirtyPolicy: "snapshot",
    },
  );
  await expect
    .poll(async () => (await get(`/workspaces/${copy.id}`)).workspace.state, {
      timeout: 40000,
    })
    .toBe("ready");
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const { session } = await command("/sessions", {
    projectId: project.id,
    workspaceId: copy.id,
    title: "Derived image input",
    ...settings,
  });
  const { session: other } = await command("/sessions", {
    projectId: project.id,
    workspaceId: local.id,
    title: "Separate Local input",
    ...settings,
  });
  const bytes = png(),
    hash = createHash("sha256").update(bytes).digest("hex");
  const { attachment } = await command(`/sessions/${session.id}/attachments`, {
    name: "derived.png",
    mediaType: "image/png",
    size: bytes.length,
    sha256: hash,
  });
  const uploaded = await context.request.put(
    origin + `/api/v1/attachments/${attachment.id}/content`,
    {
      headers: { ...headers(), "Content-Type": "application/octet-stream" },
      data: bytes,
    },
  );
  expect(uploaded.status(), await uploaded.text()).toBe(200);
  await command(`/sessions/${session.id}/draft`, {
    text: "[approval] Inspect the derived workspace image",
    attachmentIds: [attachment.id],
    expectedRevision: 0,
  });
  await page.goto(origin + "/?conversation=" + session.id);
  await expect(page.getByLabel("Message Codex")).toHaveValue(
    "[approval] Inspect the derived workspace image",
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve once", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const operation = (
    await db.query(
      "SELECT * FROM operations WHERE session_id=$1 AND kind='turn'",
      [session.id],
    )
  ).rows[0];
  expect(
    (
      await db.query(
        "SELECT project_id,operation_id,state FROM attachments WHERE id=$1",
        [attachment.id],
      )
    ).rows[0],
  ).toEqual({
    project_id: project.id,
    operation_id: operation.id,
    state: "attached",
  });
  const trace = (await readFile(traceFile, "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(
    trace.filter((entry) =>
      entry.attachmentPaths?.includes("/attachments/" + attachment.id),
    ),
  ).toHaveLength(1);
  expect((await get(`/sessions/${other.id}/attachments`)).attachments).toEqual(
    [],
  );
  const denied = await context.request.post(
    origin + `/api/v1/sessions/${other.id}/turns`,
    {
      headers: headers(),
      data: {
        ...settings,
        text: "Do not reuse sibling files",
        attachmentIds: [attachment.id],
      },
    },
  );
  expect(denied.status()).toBe(409);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT writer_session_id FROM workspaces WHERE id=$1",
            [copy.id],
          )
        ).rows[0].writer_session_id,
      { timeout: 30000 },
    )
    .toBe(null);
  await page.reload();
  await expect(
    page.getByRole("img", { name: "Attachment: derived.png", exact: true }),
  ).toBeVisible();
  expect(
    (
      await db.query("SELECT workspace_id FROM sessions WHERE id=$1", [
        session.id,
      ])
    ).rows[0].workspace_id,
  ).toBe(copy.id);
  // Recovery accepts deliberate NEW references and preserves original uncertain attachments.
  const image2 = png(),
    hash2 = createHash("sha256").update(image2).digest("hex");
  const { attachment: uncertainAttachment } = await command(
    `/sessions/${session.id}/attachments`,
    {
      name: "uncertain.png",
      mediaType: "image/png",
      size: image2.length,
      sha256: hash2,
    },
  );
  expect(
    (
      await context.request.put(
        origin + `/api/v1/attachments/${uncertainAttachment.id}/content`,
        {
          headers: { ...headers(), "Content-Type": "application/octet-stream" },
          data: image2,
        },
      )
    ).status(),
  ).toBe(200);
  const { operation: original } = await command(
    `/sessions/${session.id}/turns`,
    {
      ...settings,
      text: "[crash] Preserve attachment provenance",
      attachmentIds: [uncertainAttachment.id],
    },
  );
  await expect
    .poll(async () => (await get(`/sessions/${session.id}/recovery`)).state, {
      timeout: 30000,
    })
    .toBe("uncertain");
  const recoveryState = await get(`/sessions/${session.id}/recovery`);
  await command(`/sessions/${session.id}/recovery`, {
    expectedGeneration: recoveryState.generation,
  });
  await expect
    .poll(
      async () =>
        (await get(`/sessions/${session.id}/recovery`)).recovery?.state,
      { timeout: 30000 },
    )
    .toBe("ready");
  const ready = await get(`/sessions/${session.id}/recovery`);
  const { attachment: newAttachment } = await command(
    `/sessions/${session.id}/attachments`,
    {
      name: "deliberate-new.png",
      mediaType: "image/png",
      size: image2.length,
      sha256: hash2,
    },
  );
  expect(
    (
      await context.request.put(
        origin + `/api/v1/attachments/${newAttachment.id}/content`,
        {
          headers: { ...headers(), "Content-Type": "application/octet-stream" },
          data: image2,
        },
      )
    ).status(),
  ).toBe(200);
  const continuation = {
    ...settings,
    text: "Deliberate new image after recovery",
    attachmentIds: [newAttachment.id],
    recoveryId: ready.recovery.id,
    expectedGeneration: ready.generation,
    acknowledgeUnknownEffects: true,
  };
  const continuedHeaders = headers();
  const firstContinuation = await context.request.post(
    origin + `/api/v1/sessions/${session.id}/recovery/continue`,
    { headers: continuedHeaders, data: continuation },
  );
  expect(firstContinuation.status(), await firstContinuation.text()).toBe(202);
  const continued = (await firstContinuation.json()).operation;
  const repeat = await context.request.post(
    origin + `/api/v1/sessions/${session.id}/recovery/continue`,
    { headers: continuedHeaders, data: continuation },
  );
  expect((await repeat.json()).operation.id).toBe(continued.id);
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM operations WHERE id=$1", [
            continued.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("succeeded");
  expect(
    (await db.query("SELECT state FROM operations WHERE id=$1", [original.id]))
      .rows[0].state,
  ).toBe("uncertain");
  expect(
    (
      await db.query("SELECT operation_id FROM attachments WHERE id=$1", [
        uncertainAttachment.id,
      ])
    ).rows[0].operation_id,
  ).toBe(original.id);
  expect(
    (
      await db.query("SELECT operation_id FROM attachments WHERE id=$1", [
        newAttachment.id,
      ])
    ).rows[0].operation_id,
  ).toBe(continued.id);
  const preserved = (await get(`/sessions/${session.id}/attachments`))
    .attachments;
  const snapshot = await get(`/sessions/${session.id}/snapshot`);
  await command(`/sessions/${session.id}/metadata`, {
    expectedRevision: snapshot.session.metadataRevision,
    archived: true,
  });
  expect(
    (await get(`/sessions/${session.id}/attachments`)).attachments,
  ).toEqual(preserved);
  expect(
    await (
      await context.request.get(
        origin + `/api/v1/attachments/${uncertainAttachment.id}/content`,
      )
    ).body(),
  ).toEqual(image2);
  console.log(
    "P003/P005/P007 derived attachment association, exact inputs, session isolation, deliberate recovery continuation and archive preservation passed.",
  );
}
