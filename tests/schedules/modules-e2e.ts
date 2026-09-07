/** Real Harbor maintenance admission; only administrator state transition is driven directly. */
import { expect, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { installedModuleStatus } from "../../packages/storage/src/deployment-modules.ts";
export async function scheduleModulesE2e(o: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  csrf: string;
  projectId: string;
  sessionId: string;
  post: (route: string, data: unknown, key?: string) => Promise<any>;
  restartSupervisor: (whileStopped?: () => Promise<void>) => Promise<void>;
}) {
  const schedule = await o.post("/schedules", {
    title: "Maintenance retained occurrence",
    projectId: o.projectId,
    prompt: "P008 maintenance settles once",
    config: {
      rule: { kind: "cron", expression: "* * * * *", timezone: "UTC" },
      workspaceMode: "existing",
      sessionId: o.sessionId,
      model: "fixture",
      effort: "medium",
      permissionProfile: "read-only",
    },
  });
  let occurrence: any;
  try {
    await o.restartSupervisor(async () => {
      occurrence = (
        await o.post(`/schedules/${schedule.id}/runs`, {
          expectedRevision: 1,
        })
      ).occurrence;
      await o.db.query(
        "UPDATE deployment_state SET maintenance=true,epoch=epoch+1 WHERE id",
      );
    });
    const rejected = await o.context.request.post(
      o.origin + `/api/v1/schedules/${schedule.id}/runs`,
      {
        headers: {
          Origin: o.origin,
          "X-CSRF-Token": o.csrf,
          "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
        },
        data: { expectedRevision: 1 },
      },
    );
    expect(rejected.status()).toBe(503);
    // Wait across several actual supervisor ticks, then inspect both durable phases.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const row = (
      await o.db.query(
        "SELECT state,turn_id FROM schedule_occurrences WHERE id=$1",
        [occurrence.id],
      )
    ).rows[0];
    expect(row.state).toBe("accepted");
    expect(
      (await o.db.query("SELECT id FROM operations WHERE id=$1", [row.turn_id]))
        .rowCount,
    ).toBe(0);
    const status = await installedModuleStatus(o.db);
    expect(status.queuedScheduleOccurrences).toBeGreaterThan(0);
    expect(status.activeScheduleEffects).toBe(0);
    await o.db.query(
      "UPDATE deployment_state SET maintenance=false,epoch=epoch+1 WHERE id",
    );
    await expect
      .poll(
        async () =>
          (
            await o.db.query(
              "SELECT state FROM schedule_occurrences WHERE id=$1",
              [occurrence.id],
            )
          ).rows[0].state,
        { timeout: 15000 },
      )
      .toBe("succeeded");
    expect(
      (await o.db.query("SELECT id FROM operations WHERE id=$1", [row.turn_id]))
        .rowCount,
    ).toBe(1);
  } finally {
    await o.db.query(
      "UPDATE deployment_state SET maintenance=false,epoch=epoch+1 WHERE id",
    );
    await o.post(`/schedules/${schedule.id}/pause`, { expectedRevision: 1 });
  }
}
