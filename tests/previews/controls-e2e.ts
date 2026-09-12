import {
  expect,
  request,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
/** Actual admission limits and hostile project browser code; fixture-owned records. */
export async function previewControls(h: {
  db: Pool;
  context: BrowserContext;
  popup: Page;
  origin: string;
  csrf: string;
  previewId: string;
}) {
  const p = (
    await h.db.query("SELECT * FROM previews WHERE id=$1", [h.previewId])
  ).rows[0];
  const post = async (path: string, data: unknown, status: number) => {
    const r = await h.context.request.post(h.origin + "/api/v1" + path, {
      headers: {
        Origin: h.origin,
        "X-CSRF-Token": h.csrf,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data,
    });
    expect(r.status(), path).toBe(status);
    return r.json();
  };
  const valid = {
    workspaceId: p.workspace_id,
    name: "Bounded input",
    script: "dev",
    port: 3456,
    permissionProfile: "read-only",
  };
  for (const bad of [
    { script: "../dev" },
    { port: 80 },
    { port: 65536 },
    { name: "x".repeat(161) },
    { upstream: "http://169.254.169.254" },
    { env: { HOME: "/" } },
    { script: "x".repeat(65) },
  ])
    await post("/previews", { ...valid, ...bad }, 400);
  const hostile = await h.popup.evaluate(async (origin) => {
    let api = false;
    try {
      await fetch(origin + "/api/v1/me", { credentials: "include" });
    } catch {
      api = true;
    }
    const worker = await new Promise<boolean>((resolve) => {
      try {
        const w = new Worker(
          URL.createObjectURL(
            new Blob(['postMessage("unexpected")'], {
              type: "text/javascript",
            }),
          ),
        );
        const timer = setTimeout(() => {
          w.terminate();
          resolve(false);
        }, 1500);
        w.onmessage = () => {
          clearTimeout(timer);
          w.terminate();
          resolve(false);
        };
        w.onerror = (e) => {
          e.preventDefault();
          clearTimeout(timer);
          w.terminate();
          resolve(true);
        };
      } catch {
        resolve(true);
      }
    });
    return { api, worker, opener: window.opener === null };
  }, h.origin);
  expect(hostile).toEqual({ api: true, worker: true, opener: true });
  const token = await post(
    "/security/api-tokens",
    {
      name: "Preview limited controls",
      scopes: ["previews:read", "previews:manage"],
      projectIds: [p.project_id],
      permissionProfile: "read-only",
      expiresInDays: 1,
    },
    200,
  );
  const limited = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: "Bearer " + token.secret },
  });
  try {
    expect(
      (
        await limited.post(h.origin + "/api/v1/previews", {
          headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
          data: valid,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await limited.post(h.origin + `/api/v1/previews/${p.id}/open`, {
          headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
          data: { expectedGeneration: Number(p.generation) },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await limited.dispose();
  }
  const openingIds: string[] = [];
  for (let i = 0; i < 8; i++) {
    const opening = await post(
      `/previews/${p.id}/open`,
      { expectedGeneration: Number(p.generation) },
      200,
    );
    openingIds.push(opening.bootstrapPath.split("/").at(-1));
  }
  await post(
    `/previews/${p.id}/open`,
    { expectedGeneration: Number(p.generation) },
    429,
  );
  // Exact fixture-created opening rows are expired; no retained grant is removed.
  await h.db.query(
    "UPDATE preview_openings SET expires_at=clock_timestamp()-interval '1 second' WHERE id=ANY($1)",
    [openingIds],
  );
  const expired = await h.context.request.get(
    h.origin + `/api/v1/preview-openings/${openingIds[0]}`,
  );
  expect(expired.status()).toBe(410);
  const seed = Array.from({ length: 31 }, () => randomUUID());
  try {
    for (const id of seed)
      await h.db.query(
        "INSERT INTO previews(id,project_id,workspace_id,name,script,port,hostname,permission_profile,actor_hash) VALUES($1,$2,$3,'inert quota fixture','dev',3456,$4,'read-only',$5)",
        [id, p.project_id, p.workspace_id, "seed-" + id, p.actor_hash],
      );
    await post("/previews", valid, 429);
  } finally {
    await h.db.query("DELETE FROM previews WHERE id=ANY($1)", [seed]);
  }
}
