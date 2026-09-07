import { expect, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { transaction } from "../../packages/storage/src/index.ts";
import { pruneScheduleHistory } from "../../packages/schedules/src/capacity.ts";
export async function scheduleBoundsE2e(o: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  projectId: string;
  sessionId: string;
  csrf: string;
  post: (route: string, data: unknown, key?: string) => Promise<any>;
}) {
  const { db, post } = o;
  const config = {
    rule: { kind: "cron", expression: "0 0 * * *", timezone: "UTC" },
    workspaceMode: "existing",
    sessionId: o.sessionId,
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const headers = () => ({
    Origin: o.origin,
    "X-CSRF-Token": o.csrf,
    "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
  });
  const input = {
    title: "Reserved schedule controls",
    projectId: o.projectId,
    prompt: "P008 [approval] controls at ordinary capacity",
    config,
    grantDays: 1,
  };
  const schedule = await post("/schedules", input);
  const occurrence = (
    await post(`/schedules/${schedule.id}/runs`, { expectedRevision: 1 })
  ).occurrence;
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
    .toBe("attention");
  // Explicitly seed already-retained ordinary command history; the actual API enforces admission.
  await db.query(
    `INSERT INTO schedule_commands(schedule_id,slot,actor_hash,idempotency_key,request_hash,result,retry_until)
 SELECT $1,'ordinary:owned-bound-'||n,'owned-bound-fixture',gen_random_uuid()::text,'owned','{}',clock_timestamp()+interval '1 day'
 FROM generate_series(1,128-(SELECT count(*)::integer FROM schedule_commands WHERE schedule_id=$1 AND slot LIKE 'ordinary:%')) n`,
    [schedule.id],
  );
  const edit = await o.context.request.put(
    o.origin + `/api/v1/schedules/${schedule.id}`,
    {
      headers: headers(),
      data: {
        expectedRevision: 1,
        schedule: { ...input, title: "Must not replace title" },
      },
    },
  );
  expect(edit.status(), await edit.text()).toBe(429);
  expect(
    (await db.query("SELECT title FROM schedules WHERE id=$1", [schedule.id]))
      .rows[0].title,
  ).toBe(input.title);
  const pauseKey = `${Date.now()}:${randomUUID()}`;
  await post(
    `/schedules/${schedule.id}/pause`,
    { expectedRevision: 1 },
    pauseKey,
  );
  const cancelKey = `${Date.now()}:${randomUUID()}`;
  const cancelled = await post(
    `/schedules/${schedule.id}/runs/${occurrence.id}/cancel`,
    { expectedAttempt: 1 },
    cancelKey,
  );
  for (let i = 0; i < 4; i++) {
    await post(`/schedules/${schedule.id}/pause`, { expectedRevision: 1 });
    const retry = await post(
      `/schedules/${schedule.id}/runs/${occurrence.id}/cancel`,
      { expectedAttempt: 1 },
    );
    expect(retry.operation.id).toBe(cancelled.operation.id);
  }
  expect(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM schedule_commands WHERE schedule_id=$1",
          [schedule.id],
        )
      ).rows[0].count,
    ),
  ).toBe(130);
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
    (
      await post(
        `/schedules/${schedule.id}/runs/${occurrence.id}/cancel`,
        { expectedAttempt: 1 },
        cancelKey,
      )
    ).operation.id,
  ).toBe(cancelled.operation.id);
  // Retention is enforced against actual persisted records, including control references.
  const history = await post("/schedules", {
    ...input,
    title: "Bounded schedule history",
    prompt: "P008 history quota",
  });
  const protectedId = randomUUID();
  await db.query(
    `INSERT INTO schedule_occurrences(id,schedule_id,config_revision,rule_revision,kind,intended_at,snapshot,state,workspace_id,session_id,turn_id,storage_operation_id,cancel_operation_id,ended_at)
 SELECT CASE WHEN n=1 THEN $2::uuid ELSE gen_random_uuid() END,$1,1,1,'manual',clock_timestamp()-(n*interval '1 second'),'{}','succeeded',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),clock_timestamp() FROM generate_series(1,256) n`,
    [history.id, protectedId],
  );
  const admitted = (
    await post(`/schedules/${history.id}/runs`, { expectedRevision: 1 })
  ).occurrence;
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM schedule_occurrences WHERE id=$1", [
            admitted.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("succeeded");
  expect(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM schedule_occurrences WHERE schedule_id=$1",
          [history.id],
        )
      ).rows[0].count,
    ),
  ).toBe(256);
  const page = await (
    await o.context.request.get(
      o.origin + `/api/v1/schedules/${history.id}/runs?limit=50`,
    )
  ).json();
  expect(page.occurrences).toHaveLength(50);
  expect(page.nextCursor).toBeTruthy();
  const next = await (
    await o.context.request.get(
      o.origin +
        `/api/v1/schedules/${history.id}/runs?limit=50&cursor=${encodeURIComponent(page.nextCursor)}`,
    )
  ).json();
  expect(next.occurrences).toHaveLength(50);
  expect(
    new Set([...page.occurrences, ...next.occurrences].map((v) => v.id)).size,
  ).toBe(100);
  await db.query(
    "UPDATE schedule_occurrences SET ended_at=clock_timestamp()-interval '91 days' WHERE schedule_id=$1",
    [history.id],
  );
  await db.query(
    "INSERT INTO schedule_commands(schedule_id,slot,actor_hash,occurrence_id,idempotency_key,request_hash,result,retry_until) VALUES($1,$2,'owned-bound-fixture',$3,$4,'owned','{}',clock_timestamp()+interval '1 day')",
    [history.id, `cancel:${protectedId}:1`, protectedId, randomUUID()],
  );
  await transaction(db, pruneScheduleHistory);
  expect(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM schedule_occurrences WHERE schedule_id=$1",
          [history.id],
        )
      ).rows[0].count,
    ),
  ).toBe(1);
  expect(
    (
      await db.query(
        "SELECT id FROM schedule_occurrences WHERE schedule_id=$1",
        [history.id],
      )
    ).rows[0].id,
  ).toBe(protectedId);
  const expiredPage = await (
    await o.context.request.get(
      o.origin + `/api/v1/schedules/${history.id}/runs`,
    )
  ).json();
  expect(expiredPage.occurrences).toHaveLength(0);
  await post(`/schedules/${history.id}/pause`, { expectedRevision: 1 });
  // Per-project enabled capacity is independent of global/retained history capacity.
  const active = Number(
    (
      await db.query(
        "SELECT count(*) FROM schedules WHERE project_id=$1 AND state='enabled'",
        [o.projectId],
      )
    ).rows[0].count,
  );
  const created: string[] = [];
  for (let i = active; i < 16; i++)
    created.push(
      (
        await post("/schedules", {
          ...input,
          title: `Enabled bound ${i}`,
          prompt: "P008 enabled bound",
        })
      ).id,
    );
  const before = Number(
    (
      await db.query("SELECT count(*) FROM schedules WHERE project_id=$1", [
        o.projectId,
      ])
    ).rows[0].count,
  );
  const full = await o.context.request.post(o.origin + "/api/v1/schedules", {
    headers: headers(),
    data: { ...input, title: "Enabled over capacity" },
  });
  expect(full.status(), await full.text()).toBe(429);
  expect(
    Number(
      (
        await db.query("SELECT count(*) FROM schedules WHERE project_id=$1", [
          o.projectId,
        ])
      ).rows[0].count,
    ),
  ).toBe(before);
  for (const id of created)
    await post(`/schedules/${id}/pause`, { expectedRevision: 1 });
}
