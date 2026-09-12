import { expect, request, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";

/** Execution precedes HTTP readiness; revocation denies new work, not settlement. */
export async function previewReadiness(h: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  csrf: string;
  workspaceId: string;
  workspacePath: string;
  port: number;
  artifacts: string;
  restartApi: () => Promise<void>;
}) {
  const post = async (route: string, data: unknown, status = 200) => {
    const response = await h.context.request.post(
      h.origin + "/api/v1" + route,
      {
        headers: {
          Origin: h.origin,
          "X-CSRF-Token": h.csrf,
          "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
        },
        data,
      },
    );
    expect(response.status()).toBe(status);
    return response.json();
  };
  const { preview } = await post(
    "/previews",
    {
      workspaceId: h.workspaceId,
      name: "Accepted delayed readiness",
      script: "delayed",
      port: h.port,
      permissionProfile: "workspace-write",
    },
    201,
  );
  const token = await post("/security/api-tokens", {
    name: "Readiness source actor",
    scopes: ["previews:read", "previews:manage", "execute"],
    projectIds: [preview.projectId],
    permissionProfile: "workspace-write",
    expiresInDays: 1,
  });
  const api = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: "Bearer " + token.secret },
  });
  const marker = path.join(h.workspacePath, ".preview-readiness-allowed");
  const executed = path.join(h.workspacePath, ".preview-execution-started");
  const row = async () =>
    (await h.db.query("SELECT * FROM previews WHERE id=$1", [preview.id]))
      .rows[0];
  try {
    expect(
      (
        await api.post(h.origin + `/api/v1/previews/${preview.id}/start`, {
          headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
          data: { expectedRevision: preview.revision },
        })
      ).status(),
    ).toBe(202);
    // The serialized launch tick flushes logs after readiness. Observe the
    // actual fixture script's write inside its approved write workspace instead.
    await expect
      .poll(async () => readFile(executed, "utf8").catch(() => ""), {
        timeout: 20000,
      })
      .toBe("PREVIEW_EXECUTED\n");
    const started = await row();
    expect(started.state).toBe("starting");
    expect(started.retired).toBe(false);
    await post(`/security/api-tokens/${token.token.id}/revoke`, {});
    expect(
      (await api.get(h.origin + `/api/v1/previews/${preview.id}`)).status(),
    ).toBe(401);
    await writeFile(marker, "owned public readiness barrier\n");
    await expect
      .poll(async () => (await row()).state, { timeout: 20000 })
      .toBe("ready");
    const ready = await row();
    expect(ready.generation).toBe(started.generation);
    expect(ready.retired).toBe(false);
    const opening = await post(`/previews/${preview.id}/open`, {
      expectedGeneration: Number(ready.generation),
    });
    const viewer = await h.context.newPage();
    try {
      await viewer.goto(h.origin + opening.bootstrapPath);
      await expect(
        viewer.getByRole("heading", { name: "Private application" }),
      ).toBeVisible();
      await expect(viewer.locator("#event")).toHaveText("preview event");
      await h.restartApi();
      await viewer.reload();
      await expect(
        viewer.getByRole("heading", { name: "Private application" }),
      ).toBeVisible();
      await expect(viewer.locator("#event")).toHaveText("preview event");
      const after = await row();
      for (const field of [
        "generation",
        "runner_id",
        "relay_id",
        "lease_epoch",
      ])
        expect(after[field]).toBe(ready[field]);
      expect(after.state).toBe("ready");
      expect(
        (
          await h.context.request.get(
            h.origin + `/api/v1/previews/${preview.id}`,
          )
        ).status(),
      ).toBe(200);
      expect(
        Number(
          (
            await h.db.query(
              "SELECT count(*) FROM preview_logs WHERE preview_id=$1 AND convert_from(bytes,'UTF8') LIKE '%PREVIEW_EXECUTED%'",
              [preview.id],
            )
          ).rows[0].count,
        ),
      ).toBe(1);
    } finally {
      await viewer.close();
    }
    await post(
      `/previews/${preview.id}/stop`,
      { expectedGeneration: Number(ready.generation) },
      202,
    );
    await expect
      .poll(async () => (await row()).retired, { timeout: 20000 })
      .toBe(true);
    await writeFile(
      path.join(h.artifacts, "readiness-cases.json"),
      JSON.stringify(
        {
          status: "passed",
          nativeExecutionBeforeSourceRevocation: true,
          revokedSourceNewAccessDenied: true,
          capturedExecutionBecameReady: true,
          apiRestartRetainedGenerationAndStream: true,
          exactlyOneExecutionMarker: true,
          currentOwnerStopRetired: true,
          generation: Number(ready.generation),
        },
        null,
        2,
      ),
    );
  } finally {
    await api.dispose();
    await rm(marker, { force: true });
    await rm(executed, { force: true });
  }
}
