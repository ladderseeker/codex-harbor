import { expect, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
export async function scheduleLifecycleE2e(o: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  projectId: string;
  post: (route: string, data: unknown, key?: string) => Promise<any>;
  restartSupervisor: () => Promise<void>;
  closeViewer: () => Promise<void>;
  openViewer: () => Promise<void>;
}) {
  const { db, post } = o;
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const session = async (title: string) =>
    (await post("/sessions", { projectId: o.projectId, title, ...settings }))
      .session;
  const schedule = async (id: string, prompt: string, missedPolicy = "skip") =>
    post("/schedules", {
      title: prompt.slice(0, 100),
      projectId: o.projectId,
      prompt,
      config: {
        rule: { kind: "cron", expression: "* * * * *", timezone: "UTC" },
        workspaceMode: "existing",
        sessionId: id,
        missedPolicy,
        ...settings,
      },
      grantDays: 1,
    });
  const occurrence = async (id: string) =>
    (await db.query("SELECT * FROM schedule_occurrences WHERE id=$1", [id]))
      .rows[0];
  const wait = async (id: string, state: string) =>
    expect
      .poll(async () => (await occurrence(id))?.state, { timeout: 45000 })
      .toBe(state);
  const history = async (id: string) =>
    (
      await db.query(
        "SELECT * FROM schedule_occurrences WHERE schedule_id=$1 ORDER BY intended_at,id",
        [id],
      )
    ).rows;
  // Browser logout/closure cannot revoke an already-running unattended grant.
  const delayedSession = await session("Pause does not cancel running work");
  const delayed = await schedule(
    delayedSession.id,
    "P008 [delay] pause keeps active grant",
  );
  const run = (
    await post(`/schedules/${delayed.id}/runs`, { expectedRevision: 1 })
  ).occurrence;
  await wait(run.id, "running");
  await post("/security/logout", {});
  await o.closeViewer();
  await wait(run.id, "succeeded");
  await o.openViewer();
  await post(`/schedules/${delayed.id}/pause`, { expectedRevision: 1 });
  expect(
    (await db.query("SELECT state FROM schedules WHERE id=$1", [delayed.id]))
      .rows[0].state,
  ).toBe("paused");
  // A real owner turn keeps its reservation; unattended work cannot overtake it.
  const manualSession = await session("Manual work keeps priority");
  const overlapping = await schedule(
    manualSession.id,
    "P008 must not overtake manual work",
  );
  const manual = (
    await post(`/sessions/${manualSession.id}/turns`, {
      text: "P008 [delay] manual priority",
      ...settings,
    })
  ).operation;
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM operations WHERE id=$1", [
            manual.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("running");
  const overlap = (
    await post(`/schedules/${overlapping.id}/runs`, { expectedRevision: 1 })
  ).occurrence;
  await wait(overlap.id, "skipped");
  const overlapRow = await occurrence(overlap.id);
  expect(["WORKSPACE_BUSY", "SCHEDULE_OVERLAP"]).toContain(overlapRow.reason);
  expect(
    Number(
      (
        await db.query("SELECT count(*) FROM operations WHERE id=$1", [
          overlapRow.turn_id,
        ])
      ).rows[0].count,
    ),
  ).toBe(0);
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM operations WHERE id=$1", [
            manual.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("succeeded");
  await post(`/schedules/${overlapping.id}/pause`, { expectedRevision: 1 });
  // Explicit cancellation is a distinct bounded command; exact lost-response retry reconciles.
  const cancelledSession = await session("Schedule cancellation");
  const cancelled = await schedule(
    cancelledSession.id,
    "P008 [delay] explicit cancel",
  );
  const cancelRun = (
    await post(`/schedules/${cancelled.id}/runs`, { expectedRevision: 1 })
  ).occurrence;
  await wait(cancelRun.id, "running");
  const key = `${Date.now()}:${randomUUID()}`;
  const stopped = await post(
    `/schedules/${cancelled.id}/runs/${cancelRun.id}/cancel`,
    { expectedAttempt: 1 },
    key,
  );
  const stopRetry = await post(
    `/schedules/${cancelled.id}/runs/${cancelRun.id}/cancel`,
    { expectedAttempt: 1 },
    key,
  );
  expect(stopRetry.operation.id).toBe(stopped.operation.id);
  await wait(cancelRun.id, "cancelled");
  await post(`/schedules/${cancelled.id}/pause`, { expectedRevision: 1 });
  // Offline approval remains a real native request and expires through ordinary supervisor denial.
  const approvalSession = await session("Offline scheduled approval");
  const approval = await schedule(
    approvalSession.id,
    "P008 [approval] offline permission request",
  );
  const approvalRun = (
    await post(`/schedules/${approval.id}/runs`, { expectedRevision: 1 })
  ).occurrence;
  await wait(approvalRun.id, "attention");
  const pending = (
    await db.query("SELECT * FROM approvals WHERE operation_id=$1", [
      (await occurrence(approvalRun.id)).turn_id,
    ])
  ).rows[0];
  expect(pending.state).toBe("pending");
  expect(pending.deadline.getTime() - Date.now()).toBeLessThanOrEqual(300000);
  await o.closeViewer();
  // Shorten only this run-owned persisted deadline; no authentication/lease clock substitution.
  await db.query(
    "UPDATE approvals SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1",
    [pending.id],
  );
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM approvals WHERE id=$1", [
            pending.id,
          ])
        ).rows[0].state,
      { timeout: 15000 },
    )
    .toBe("expired");
  await wait(approvalRun.id, "succeeded");
  await o.openViewer();
  await post(`/schedules/${approval.id}/pause`, { expectedRevision: 1 });
  // Runtime loss after actual turn/start is uncertain, never an automatic scheduled retry.
  const crashSession = await session("Scheduled delivery uncertainty");
  const crash = await schedule(
    crashSession.id,
    "P008 [crash-before-ack] uncertain native send",
  );
  const crashRun = (
    await post(`/schedules/${crash.id}/runs`, { expectedRevision: 1 })
  ).occurrence;
  await wait(crashRun.id, "uncertain");
  const original = (await occurrence(crashRun.id)).turn_id;
  await o.restartSupervisor();
  await expect
    .poll(
      async () =>
        (await db.query("SELECT state FROM schedules WHERE id=$1", [crash.id]))
          .rows[0].state,
      { timeout: 30000 },
    )
    .toBe("attention");
  expect(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM operations WHERE session_id=$1 AND kind='turn'",
          [crashSession.id],
        )
      ).rows[0].count,
    ),
  ).toBe(1);
  const generation = (
    await db.query("SELECT generation FROM sessions WHERE id=$1", [
      crashSession.id,
    ])
  ).rows[0].generation;
  const recovery = (
    await post(`/sessions/${crashSession.id}/recovery`, {
      expectedGeneration: Number(generation),
    })
  ).recovery;
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM session_recoveries WHERE id=$1", [
            recovery.id,
          ])
        ).rows[0]?.state,
      { timeout: 30000 },
    )
    .toBe("ready");
  const recovered = (
    await db.query(
      "SELECT fence_generation AS generation FROM session_recoveries WHERE id=$1",
      [recovery.id],
    )
  ).rows[0];
  const fresh = (
    await post(`/sessions/${crashSession.id}/recovery/continue`, {
      recoveryId: recovery.id,
      expectedGeneration: Number(recovered.generation),
      acknowledgeUnknownEffects: true,
      text: "P008 explicit fresh owner continuation",
      ...settings,
    })
  ).operation;
  await expect
    .poll(
      async () =>
        (await db.query("SELECT state FROM operations WHERE id=$1", [fresh.id]))
          .rows[0]?.state,
      { timeout: 30000 },
    )
    .toBe("succeeded");
  expect(fresh.id).not.toBe(original);
  expect(
    (
      await db.query(
        "SELECT state,uncertainty_acknowledged_at FROM operations WHERE id=$1",
        [original],
      )
    ).rows[0],
  ).toMatchObject({ state: "uncertain" });
  await expect
    .poll(
      async () => (await occurrence(crashRun.id)).acknowledged_at !== null,
      { timeout: 15000 },
    )
    .toBe(true);
  expect((await occurrence(crashRun.id)).state).toBe("uncertain");
  // Default downtime policy records a bounded range and never dispatches old minutes.
  const missedSession = await session("Default missed minutes skip");
  const missed = await schedule(
    missedSession.id,
    "P008 missed minutes remain skipped",
  );
  await db.query("UPDATE schedule_test_clock SET now_at=$1", [
    new Date(
      Date.parse(missed.preview[0].instant) + 10 * 60000 + 61000,
    ).toISOString(),
  ]);
  await expect
    .poll(
      async () =>
        (await history(missed.id)).filter((r) => r.kind === "range").length,
      { timeout: 15000 },
    )
    .toBe(1);
  expect(
    (await history(missed.id)).filter((r) => r.kind === "recurring"),
  ).toHaveLength(0);
  expect(
    Number(
      (
        await db.query("SELECT count(*) FROM operations WHERE session_id=$1", [
          missedSession.id,
        ])
      ).rows[0].count,
    ),
  ).toBe(0);
  await post(`/schedules/${missed.id}/pause`, { expectedRevision: 1 });
  // Frozen catch-up batch chooses latest three, not a refilled queue as wall time advances.
  const catchupSession = await session("Bounded catch-up");
  const catchup = await schedule(
    catchupSession.id,
    "P008 bounded catch-up",
    "catch_up",
  );
  await db.query("UPDATE schedule_test_clock SET now_at=$1", [
    new Date(Date.parse(catchup.preview[0].instant) + 10 * 60000).toISOString(),
  ]);
  await expect
    .poll(
      async () =>
        (await history(catchup.id)).filter(
          (r) => r.kind === "recurring" && r.state === "succeeded",
        ).length,
      { timeout: 45000 },
    )
    .toBe(3);
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT catch_up FROM schedules WHERE id=$1", [
            catchup.id,
          ])
        ).rows[0].catch_up,
      { timeout: 15000 },
    )
    .toBe(null);
  const outcomes = await history(catchup.id);
  expect(outcomes.filter((r) => r.kind === "range")).toHaveLength(1);
  expect(outcomes.find((r) => r.kind === "range").snapshot.count).toBe(null);
  const before = (
    await db.query("SELECT cursor_at FROM schedules WHERE id=$1", [catchup.id])
  ).rows[0].cursor_at;
  await db.query(
    "UPDATE schedule_test_clock SET now_at=now_at-interval '1 minute'",
  );
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT reason FROM schedules WHERE id=$1", [
            catchup.id,
          ])
        ).rows[0].reason,
      { timeout: 15000 },
    )
    .toBe("CLOCK_MOVED_BACKWARD");
  expect(
    (
      await db.query("SELECT cursor_at FROM schedules WHERE id=$1", [
        catchup.id,
      ])
    ).rows[0].cursor_at.toISOString(),
  ).toBe(before.toISOString());
}
