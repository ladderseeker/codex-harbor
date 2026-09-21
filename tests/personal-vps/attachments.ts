import {
  expect,
  type APIResponse,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { png } from "../fixtures/png.ts";
export type AttachmentContext = {
  context: BrowserContext;
  page: Page;
  origin: string;
  post: (
    route: string,
    data: unknown,
    headers?: Record<string, string>,
  ) => Promise<APIResponse>;
  projectId: string;
  workspaceId: string;
  artifacts: string;
  databaseUrl: string;
  nativeHome: string;
};
export async function runAttachments(h: AttachmentContext) {
  const db = new Pool({ connectionString: h.databaseUrl });
  const me = await (
    await h.context.request.get(h.origin + "/api/v1/me")
  ).json();
  const intentKey = () => `${Date.now()}:${randomUUID()}`;
  const headers = () => ({
    Origin: h.origin,
    "X-CSRF-Token": me.csrfToken,
    "Idempotency-Key": intentKey(),
    "Content-Type": "application/octet-stream",
  });
  const expectStatus = async (response: APIResponse, expected: number) => {
    let diagnostic = "";
    if (response.status() !== expected) {
      const body = await response.json().catch(() => undefined);
      // Retain only bounded public error fields, never headers or payload contents.
      const clean = (value: unknown) =>
        typeof value === "string"
          ? value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 300)
          : undefined;
      diagnostic = JSON.stringify({
        status: response.status(),
        error: {
          code: clean(body?.error?.code),
          message: clean(body?.error?.message),
        },
      });
    }
    expect(response.status(), diagnostic).toBe(expected);
  };
  const get = async (p: string) => {
    const r = await h.context.request.get(h.origin + "/api/v1" + p);
    await expectStatus(r, 200);
    return r.json();
  };
  const create = async (title: string) => {
    const r = await h.post("/sessions", {
      projectId: h.projectId,
      workspaceId: h.workspaceId,
      title,
      model: "fixture",
      effort: "medium",
      permissionProfile: "workspace-write",
    });
    await expectStatus(r, 200);
    return (await r.json()).session.id as string;
  };
  const session = await create("P024 attachments"),
    other = await create("P024 other conversation");
  const files = [
    { name: "synthetic.png", type: "image/png", bytes: png(true) },
    {
      name: "synthetic.jpg",
      type: "image/jpeg",
      bytes: await sharp(png()).jpeg().toBuffer(),
    },
    {
      name: "opaque.pdf",
      type: "application/octet-stream",
      bytes: Buffer.from([0, 255, 37, 80, 68, 70]),
    },
  ];
  const ids: string[] = [];
  try {
    const metadata = (file: (typeof files)[number]) => ({
      name: file.name,
      mediaType: file.type,
      size: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
    });
    const denied = await h.post(
      `/sessions/${session}/attachments`,
      metadata(files[0]),
      { "X-CSRF-Token": "invalid" },
    );
    await expectStatus(denied, 403);
    await expectStatus(
      await h.post(`/sessions/${session}/attachments`, metadata(files[0]), {
        Origin: "https://evil.example",
      }),
      403,
    );
    await expectStatus(
      await h.post(`/sessions/${session}/attachments`, {
        ...metadata(files[0]),
        size: 10485761,
      }),
      400,
    );
    for (const file of files) {
      const staged = await h.post(
        `/sessions/${session}/attachments`,
        metadata(file),
      );
      await expectStatus(staged, 200);
      const id = (await staged.json()).attachment.id;
      ids.push(id);
      const put = () =>
        h.context.request.put(h.origin + `/api/v1/attachments/${id}/content`, {
          headers: headers(),
          data: file.bytes,
        });
      await expectStatus(await put(), 200);
      await expectStatus(await put(), 200);
      const download = await h.context.request.get(
        h.origin + `/api/v1/attachments/${id}/content`,
      );
      await expectStatus(download, 200);
      expect(download.headers()["content-disposition"]).toContain(
        "attachment;",
      );
      expect(download.headers()["x-content-type-options"]).toBe("nosniff");
      const preview = await h.context.request.get(
        h.origin + `/api/v1/attachments/${id}/preview`,
      );
      await expectStatus(
        preview,
        file.type === "application/octet-stream" ? 415 : 200,
      );
      if (file.type === "application/octet-stream")
        expect(await download.body()).toEqual(file.bytes);
    }
    const badBytes = Buffer.from("<svg onload='unsafe' />");
    const invalid = await h.post(`/sessions/${session}/attachments`, {
      name: "invalid.png",
      mediaType: "image/png",
      size: badBytes.length,
      sha256: createHash("sha256").update(badBytes).digest("hex"),
    });
    await expectStatus(invalid, 200);
    const invalidId = (await invalid.json()).attachment.id;
    await expectStatus(
      await h.context.request.put(
        h.origin + `/api/v1/attachments/${invalidId}/content`,
        { headers: headers(), data: badBytes },
      ),
      400,
    );
    await expectStatus(
      await h.context.request.get(
        h.origin + `/api/v1/attachments/${ids[0]}/content`,
        { headers: { Authorization: "Bearer invalid" } },
      ),
      403,
    );
    // Reserve the entire conversation budget, then prove normalized growth is
    // rechecked under the same global quota lock before any content is committed.
    const quotaSession = await create("P024 normalized reservation");
    const small = { ...files[0], bytes: png() };
    const reservation = await h.post(
      `/sessions/${quotaSession}/attachments`,
      metadata(small),
    );
    await expectStatus(reservation, 200);
    const reservationId = (await reservation.json()).attachment.id;
    let remaining = 104857600 - small.bytes.length;
    while (remaining > 0) {
      const size = Math.min(10485760, remaining);
      const r = await h.post(`/sessions/${quotaSession}/attachments`, {
        name: "reserved.bin",
        mediaType: "application/octet-stream",
        size,
        sha256: "0".repeat(64),
      });
      await expectStatus(r, 200);
      remaining -= size;
    }
    const raw = small.bytes;
    const normalizedRejected = await h.context.request.put(
      h.origin + `/api/v1/attachments/${reservationId}/content`,
      { headers: headers(), data: raw },
    );
    await expectStatus(normalizedRejected, 429);
    expect(
      (await get(`/sessions/${quotaSession}/attachments`)).attachments.find(
        (a: any) => a.id === reservationId,
      ).state,
    ).toBe("uploading");
    const settings = {
      model: "fixture",
      effort: "medium",
      permissionProfile: "workspace-write",
    };
    await expectStatus(
      await h.post(`/sessions/${other}/turns`, {
        ...settings,
        text: "",
        attachmentIds: ids,
      }),
      409,
    );
    const draft = await h.post(`/sessions/${session}/draft`, {
      text: "",
      attachmentIds: ids,
      expectedRevision: 0,
    });
    await expectStatus(draft, 200);
    const revision = (await draft.json()).draft.revision;
    await expectStatus(
      await h.post(`/sessions/${session}/draft`, {
        text: "stale",
        attachmentIds: ids,
        expectedRevision: 0,
      }),
      409,
    );
    expect(
      (await get(`/sessions/${session}/draft`)).draft.attachmentIds,
    ).toEqual(ids);
    const key = intentKey(),
      body = {
        ...settings,
        text: "",
        attachmentIds: ids,
        draftRevision: revision,
      };
    const accepted = await h.post(`/sessions/${session}/turns`, body, {
      "Idempotency-Key": key,
    });
    await expectStatus(accepted, 202);
    const operation = (await accepted.json()).operation;
    const retry = await h.post(`/sessions/${session}/turns`, body, {
      "Idempotency-Key": key,
    });
    await expectStatus(retry, 202);
    expect((await retry.json()).operation.id).toBe(operation.id);
    await expect
      .poll(
        async () => (await get(`/operations/${operation.id}`)).operation.state,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    const rows = (
      await db.query(
        "SELECT id,content,digest,device,inode FROM attachments WHERE id=ANY($1::uuid[]) ORDER BY id",
        [ids],
      )
    ).rows;
    const directory = (
      await db.query(
        "SELECT canonical,device,inode FROM session_attachment_storage WHERE session_id=$1",
        [session],
      )
    ).rows[0];
    expect(directory.canonical).toBe(
      join(h.nativeHome, "..", "home", "attachments", session),
    );
    for (const row of rows) {
      const path = join(directory.canonical, row.id),
        info = await stat(path, { bigint: true });
      expect(String(info.ino)).toBe(row.inode);
      expect(String(info.dev)).toBe(row.device);
      expect(Number(info.mode) & 0o777).toBe(0o444);
      expect(await readFile(path)).toEqual(row.content);
    }
    const delivered = JSON.parse(
      await readFile(
        join(h.nativeHome, `test-attachments-${session}.json`),
        "utf8",
      ),
    );
    expect(delivered.images).toHaveLength(2);
    expect(delivered.files).toHaveLength(1);
    expect(delivered.files[0].hex).toBe(files[2].bytes.toString("hex"));
    expect(
      (await get(`/sessions/${session}/draft`)).draft.attachmentIds,
    ).toEqual([]);
    expect(
      (await get(`/sessions/${session}/attachments`)).attachments
        .filter((a: any) => ids.includes(a.id))
        .every((a: any) => a.state === "attached"),
    ).toBe(true);
    // Exercise the running supervisor's periodic maintenance, not a direct helper.
    // Keep one expired unreferenced file beside the fresh draft so that its
    // session is actually visited during the same collection cycle.
    const expiredSession = await create("P024 expired staged draft"),
      protectedSession = await create("P024 fresh protected draft"),
      gcBytes = Buffer.from("P024 synthetic staging retention");
    const gcFile = async (sessionId: string, name: string) => {
      const staged = await h.post(`/sessions/${sessionId}/attachments`, {
        name,
        mediaType: "application/octet-stream",
        size: gcBytes.length,
        sha256: createHash("sha256").update(gcBytes).digest("hex"),
      });
      await expectStatus(staged, 200);
      const id = (await staged.json()).attachment.id as string;
      await expectStatus(
        await h.context.request.put(
          h.origin + `/api/v1/attachments/${id}/content`,
          {
            headers: headers(),
            data: gcBytes,
          },
        ),
        200,
      );
      return id;
    };
    const expiredId = await gcFile(expiredSession, "expired.bin"),
      protectedId = await gcFile(protectedSession, "protected.bin"),
      unreferencedId = await gcFile(protectedSession, "unreferenced.bin");
    const oldDraft = await h.post(`/sessions/${expiredSession}/draft`, {
      text: "Expired private staging draft",
      attachmentIds: [expiredId],
      expectedRevision: 0,
    });
    await expectStatus(oldDraft, 200);
    const oldRevision = (await oldDraft.json()).draft.revision;
    const freshDraft = await h.post(`/sessions/${protectedSession}/draft`, {
      text: "Fresh private staging draft",
      attachmentIds: [protectedId],
      expectedRevision: 0,
    });
    await expectStatus(freshDraft, 200);
    const freshRevision = (await freshDraft.json()).draft.revision;
    const aging = await db.connect();
    try {
      await aging.query("BEGIN");
      await aging.query(
        "UPDATE attachments SET created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE id=ANY($1::uuid[])",
        [[expiredId, protectedId, unreferencedId]],
      );
      await aging.query(
        "UPDATE conversation_drafts SET updated_at=now()-interval '25 hours' WHERE session_id=$1",
        [expiredSession],
      );
      await aging.query("COMMIT");
    } catch (error) {
      await aging.query("ROLLBACK");
      throw error;
    } finally {
      aging.release();
    }
    await expect
      .poll(
        async () => {
          const collected = await db.query(
            "SELECT count(*)::int AS n FROM attachments WHERE id=ANY($1::uuid[]) AND state='expired' AND content IS NULL",
            [[expiredId, unreferencedId]],
          );
          const cleared = await db.query(
            "SELECT text,attachment_ids,revision FROM conversation_drafts WHERE session_id=$1",
            [expiredSession],
          );
          return { collected: collected.rows[0].n, draft: cleared.rows[0] };
        },
        {
          timeout: 90000,
          intervals: [1000],
          message:
            "The actual personal supervisor must collect expired attachments and drafts",
        },
      )
      .toEqual({
        collected: 2,
        draft: {
          text: "",
          attachment_ids: [],
          revision: String(oldRevision + 1),
        },
      });
    expect(
      (
        await db.query("SELECT state,content FROM attachments WHERE id=$1", [
          protectedId,
        ])
      ).rows[0],
    ).toEqual({ state: "staged", content: gcBytes });
    expect(
      (
        await db.query(
          "SELECT text,attachment_ids,revision FROM conversation_drafts WHERE session_id=$1",
          [protectedSession],
        )
      ).rows[0],
    ).toEqual({
      text: "Fresh private staging draft",
      attachment_ids: [protectedId],
      revision: String(freshRevision),
    });
    await expectStatus(
      await h.context.request.get(
        h.origin + `/api/v1/attachments/${expiredId}/content`,
      ),
      404,
    );
    const protectedDownload = await h.context.request.get(
      h.origin + `/api/v1/attachments/${protectedId}/content`,
    );
    await expectStatus(protectedDownload, 200);
    expect(await protectedDownload.body()).toEqual(gcBytes);
    await writeFile(
      join(h.artifacts, "p024-attachments.json"),
      JSON.stringify(
        {
          status: "passed",
          scope:
            "Real owner API, PostgreSQL, supervisor, immutable personal publication; native boundary is a deterministic fixture",
          checks: [
            "origin/csrf",
            "file boundary",
            "PNG/JPEG normalization",
            "opaque byte identity",
            "preview/download policy",
            "retry",
            "draft CAS",
            "cross-session rejection",
            "file-only turn",
            "native fixture reads",
            "publication inode and mode",
            "real supervisor staged/draft expiry and fresh draft protection",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await db.end();
  }
}
