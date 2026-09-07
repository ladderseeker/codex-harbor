import { expect } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";

export async function scheduleReviewControlsE2e(o: {
  db: Pool;
  projectId: string;
  sessionId: string;
  post: (route: string, data: unknown, key?: string) => Promise<any>;
  pauseSupervisor: () => void;
  resumeSupervisor: () => void;
}) {
  const { db, post } = o;
  const input = {
    title: "Pause grant frontier",
    projectId: o.projectId,
    prompt: "P008 control frontier must not dispatch",
    config: {
      rule: { kind: "cron", expression: "0 0 * * *", timezone: "UTC" },
      workspaceMode: "existing",
      sessionId: o.sessionId,
      model: "fixture",
      effort: "medium",
      permissionProfile: "read-only",
    },
    grantDays: 1,
  };
  const schedule = await post("/schedules", input);
  const oldKey = `${Date.now()}:${randomUUID()}`;
  const oldResult = await post(
    `/schedules/${schedule.id}/pause`,
    { expectedRevision: 1 },
    oldKey,
  );
  o.pauseSupervisor();
  let occurrence: any;
  try {
    occurrence = (
      await post(`/schedules/${schedule.id}/runs`, { expectedRevision: 1 })
    ).occurrence;
    expect(
      await post(
        `/schedules/${schedule.id}/pause`,
        { expectedRevision: 1 },
        oldKey,
      ),
    ).toEqual(oldResult);
    expect(
      (
        await db.query(
          "SELECT g.revoked FROM schedule_grants g JOIN schedule_occurrences o ON o.grant_id=g.id WHERE o.id=$1",
          [occurrence.id],
        )
      ).rows[0].revoked,
    ).toBe(false);
    await post(`/schedules/${schedule.id}/pause`, { expectedRevision: 1 });
    expect(
      (
        await db.query(
          "SELECT g.revoked FROM schedule_grants g JOIN schedule_occurrences o ON o.grant_id=g.id WHERE o.id=$1",
          [occurrence.id],
        )
      ).rows[0].revoked,
    ).toBe(true);
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM schedule_commands WHERE schedule_id=$1 AND slot LIKE 'pause:%'",
            [schedule.id],
          )
        ).rows[0].count,
      ),
    ).toBe(2);
  } finally {
    o.resumeSupervisor();
  }
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM schedule_occurrences WHERE id=$1", [
            occurrence.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("cancelled");
  expect(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM operations t JOIN schedule_occurrences o ON o.turn_id=t.id WHERE o.id=$1",
          [occurrence.id],
        )
      ).rows[0].count,
    ),
  ).toBe(0);

  // Emergency is intentionally the final schedule phase in this fresh stack.
  const running = await post("/schedules", {
    ...input,
    title: "Emergency running history",
    prompt: "P008 [approval] emergency running grant",
  });
  const live = (
    await post(`/schedules/${running.id}/runs`, { expectedRevision: 1 })
  ).occurrence;
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM schedule_occurrences WHERE id=$1", [
            live.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("attention");
  const future = await post("/schedules", {
    ...input,
    title: "Emergency future",
  });
  o.pauseSupervisor();
  let accepted: any;
  try {
    accepted = (
      await post(`/schedules/${future.id}/runs`, { expectedRevision: 1 })
    ).occurrence;
    const before = (
      await db.query(
        "SELECT id,state,turn_id FROM schedule_occurrences WHERE id=ANY($1::uuid[]) ORDER BY id",
        [[live.id, accepted.id]],
      )
    ).rows;
    await post("/security/emergency-stop", {});
    expect(
      (
        await db.query(
          "SELECT id,state,turn_id FROM schedule_occurrences WHERE id=ANY($1::uuid[]) ORDER BY id",
          [[live.id, accepted.id]],
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await db.query(
          "SELECT state,reason FROM schedules WHERE id=ANY($1::uuid[])",
          [[running.id, future.id]],
        )
      ).rows,
    ).toEqual([
      { state: "paused", reason: "EMERGENCY_STOP" },
      { state: "paused", reason: "EMERGENCY_STOP" },
    ]);
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM schedule_grants WHERE NOT revoked",
          )
        ).rows[0].count,
      ),
    ).toBe(0);
  } finally {
    o.resumeSupervisor();
  }
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT state FROM operations WHERE id=(SELECT turn_id FROM schedule_occurrences WHERE id=$1)",
            [live.id],
          )
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toMatch(/^(interrupted|uncertain)$/);
  expect(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM operations WHERE id=(SELECT turn_id FROM schedule_occurrences WHERE id=$1)",
          [accepted.id],
        )
      ).rows[0].count,
    ),
  ).toBe(0);
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM schedule_occurrences WHERE id=$1", [
            accepted.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("cancelled");
}
