import { expect, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
/** The real fixture app emits stdout only after an authorized HTTP request. */
export async function previewOutputFlood(h: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  csrf: string;
  previewId: string;
  artifacts: string;
}) {
  const row = async () =>
    (await h.db.query("SELECT * FROM previews WHERE id=$1", [h.previewId]))
      .rows[0];
  const post = async (suffix: string, data: unknown, status: number) => {
    const r = await h.context.request.post(
      h.origin + `/api/v1/previews/${h.previewId}` + suffix,
      {
        headers: {
          Origin: h.origin,
          "X-CSRF-Token": h.csrf,
          "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
        },
        data,
      },
    );
    expect(r.status()).toBe(status);
    return r.json();
  };
  await post("/start", { expectedRevision: (await row()).revision }, 202);
  await expect
    .poll(async () => (await row()).state, { timeout: 30000 })
    .toBe("ready");
  const active = await row(),
    opening = await post(
      "/open",
      { expectedGeneration: Number(active.generation) },
      200,
    ),
    page = await h.context.newPage();
  try {
    await page.goto(h.origin + opening.bootstrapPath);
    await expect(
      page.getByRole("heading", { name: "Private application", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        async () => (await fetch("/__fixture_log_flood")).status,
      ),
    ).toBe(200);
    await expect
      .poll(async () => (await row()).retired, { timeout: 20000 })
      .toBe(true);
    const final = await row();
    expect(final.failure_code).toBe("LOG_LIMIT");
    expect(final.output_lost).toBe(true);
    expect(final.generation).toBe(active.generation);
    const bounds = (
      await h.db.query(
        "SELECT coalesce(sum(octet_length(bytes)),0)::int total,coalesce(max(octet_length(bytes)),0)::int chunk FROM preview_logs WHERE preview_id=$1",
        [h.previewId],
      )
    ).rows[0];
    expect(bounds.total).toBeLessThanOrEqual(1048576);
    expect(bounds.chunk).toBeLessThanOrEqual(16384);
    expect(
      Number(
        (
          await h.db.query(
            "SELECT count(*) FROM preview_readers WHERE owner_id=$1",
            [h.previewId],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
    await writeFile(
      h.artifacts + "/output-cases.json",
      JSON.stringify(
        {
          status: "passed",
          actualApplicationStdoutFlood: true,
          retiredWithVisibleLoss: true,
          noGenerationReplay: true,
          retainedBytes: bounds.total,
          largestChunk: bounds.chunk,
        },
        null,
        2,
      ),
    );
  } finally {
    await page.close();
  }
}
