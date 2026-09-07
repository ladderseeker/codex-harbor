import { expect, request, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
export async function scheduleAuthorityE2e(o: {
  context: BrowserContext;
  db: Pool;
  origin: string;
  projectId: string;
  sessionId: string;
  post: (route: string, data: unknown, key?: string) => Promise<any>;
  pauseSupervisor: () => void;
  resumeSupervisor: () => void;
}) {
  const { db, origin, post } = o;
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const input = {
    title: "Token scheduled grant",
    projectId: o.projectId,
    prompt: "P008 denied grant must not dispatch",
    config: {
      rule: { kind: "cron", expression: "0 0 * * *", timezone: "UTC" },
      workspaceMode: "existing",
      sessionId: o.sessionId,
      ...settings,
    },
    grantDays: 1,
  };
  const createToken = (
    scopes: string[],
    projectIds = [o.projectId],
    permissionProfile = "read-only",
  ) =>
    post("/security/api-tokens", {
      name: "Schedule acceptance",
      scopes,
      projectIds,
      permissionProfile,
      expiresInDays: 1,
    });
  const grant = await createToken([
    "schedules:read",
    "schedules:manage",
    "execute",
  ]);
  const client = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: "Bearer " + grant.secret },
  });
  const send = (
    route: string,
    data: unknown,
    key = `${Date.now()}:${randomUUID()}`,
  ) =>
    client.post(origin + "/api/v1" + route, {
      headers: { "Idempotency-Key": key },
      data,
    });
  try {
    const createdResponse = await send("/schedules", input);
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = await createdResponse.json();
    expect(
      (await client.get(origin + `/api/v1/schedules/${created.id}`)).status(),
    ).toBe(200);
    // Public readers never acquire a schedule's internal execute actor, even if its ID is known.
    const forged = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        Authorization: `Bearer schedule:${created.grantId}:${randomUUID()}`,
      },
    });
    try {
      expect((await forged.get(origin + "/api/v1/schedules")).status()).toBe(
        401,
      );
    } finally {
      await forged.dispose();
    }
    const denied = await createToken(["schedules:read"]);
    const readOnly = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: "Bearer " + denied.secret },
    });
    try {
      expect(
        (
          await readOnly.post(origin + `/api/v1/schedules/${created.id}/runs`, {
            data: { expectedRevision: 1 },
            headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
          })
        ).status(),
      ).toBe(403);
    } finally {
      await readOnly.dispose();
    }
    const foreign = (
      await post("/projects", {
        name: "Other schedule project",
        rootId: (
          await (
            await o.context.request.get(origin + "/api/v1/project-roots")
          ).json()
        ).roots[0].id,
        path: "schedule-foreign-" + randomUUID(),
        create: true,
      })
    ).project;
    expect(
      (await send("/schedules", { ...input, projectId: foreign.id })).status(),
    ).toBe(403);
    expect(
      (
        await send("/schedules", {
          ...input,
          config: { ...input.config, permissionProfile: "workspace-write" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await client.get(origin + `/api/v1/schedules?projectId=${foreign.id}`)
      ).status(),
    ).toBe(403);
    // Pause the owned supervisor, admit exactly one occurrence through the public API,
    // revoke its source PAT, then prove preparation/turn admission is denied after restart.
    o.pauseSupervisor();
    let accepted: any;
    try {
      const r = await send(`/schedules/${created.id}/runs`, {
        expectedRevision: 1,
      });
      expect(r.status(), await r.text()).toBe(202);
      accepted = (await r.json()).occurrence;
      await post(`/security/api-tokens/${grant.token.id}/revoke`, {});
    } finally {
      o.resumeSupervisor();
    }
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT state FROM schedule_occurrences WHERE id=$1",
              [accepted.id],
            )
          ).rows[0]?.state,
        { timeout: 30000 },
      )
      .toBe("failed");
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM operations t JOIN schedule_occurrences o ON o.turn_id=t.id WHERE o.id=$1",
            [accepted.id],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
    expect(
      (
        await client.get(origin + `/api/v1/schedules/${created.id}/runs`)
      ).status(),
    ).toBe(401);

    // Actual source-token expiry while preparation waits on the session row:
    // the transaction must validate again after the wait and admit zero turn rows.
    const expiring = await createToken([
      "schedules:read",
      "schedules:manage",
      "execute",
    ]);
    const expiryClient = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: "Bearer " + expiring.secret },
    });
    const expiredSend = (route: string, data: unknown) =>
      expiryClient.post(origin + "/api/v1" + route, {
        headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
        data,
      });
    const lock = await db.connect();
    try {
      const r = await expiredSend("/schedules", {
        ...input,
        title: "Post-lock source expiry",
      });
      expect(r.status(), await r.text()).toBe(201);
      const schedule = await r.json();
      o.pauseSupervisor();
      let occurrence: any;
      try {
        const run = await expiredSend(`/schedules/${schedule.id}/runs`, {
          expectedRevision: 1,
        });
        expect(run.status(), await run.text()).toBe(202);
        occurrence = (await run.json()).occurrence;
        await lock.query("BEGIN");
        await lock.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
          o.sessionId,
        ]);
        await db.query(
          "UPDATE api_tokens SET expires_at=clock_timestamp()+interval '4 seconds' WHERE id=$1",
          [expiring.token.id],
        );
      } finally {
        o.resumeSupervisor();
      }
      await expect
        .poll(
          async () =>
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT %FROM sessions%FOR UPDATE%'",
                )
              ).rows[0].count,
            ),
          { timeout: 3000 },
        )
        .toBeGreaterThan(0);
      await expect
        .poll(
          async () =>
            (
              await db.query(
                "SELECT expires_at<=clock_timestamp() AS expired FROM api_tokens WHERE id=$1",
                [expiring.token.id],
              )
            ).rows[0].expired,
          { timeout: 6000 },
        )
        .toBe(true);
      await lock.query("COMMIT");
      await expect
        .poll(
          async () =>
            (
              await db.query(
                "SELECT state FROM schedule_occurrences WHERE id=$1",
                [occurrence.id],
              )
            ).rows[0]?.state,
          { timeout: 30000 },
        )
        .toBe("failed");
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
    } finally {
      await lock.query("ROLLBACK").catch(() => {});
      lock.release();
      await expiryClient.dispose();
    }
  } finally {
    await client.dispose();
  }
}
