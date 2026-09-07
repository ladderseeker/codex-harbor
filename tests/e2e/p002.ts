import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  expect,
  request,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { request as httpsRequest } from "node:https";
import { randomUUID } from "node:crypto";
import type pg from "pg";
export async function p002({
  page,
  context,
  origin,
  csrf,
  db,
  projectId,
  logs,
  artifacts,
}: {
  page: Page;
  context: BrowserContext;
  origin: string;
  csrf: string;
  db: pg.Pool;
  projectId: string;
  logs: () => string;
  artifacts: string;
}) {
  const key = () => `${Date.now()}:${randomUUID()}`;
  const owner = async (route: string, body: unknown, k = key()) =>
    context.request.post(origin + "/api/v1" + route, {
      headers: { Origin: origin, "X-CSRF-Token": csrf, "Idempotency-Key": k },
      data: body,
    });
  await expect
    .poll(
      async () =>
        (
          await (
            await context.request.get(origin + "/api/v1/capabilities")
          ).json()
        ).models.length,
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  const root = (
    await (await context.request.get(origin + "/api/v1/project-roots")).json()
  ).roots[0];
  const otherProject = (
    await (
      await owner("/projects", {
        name: "P002 outside grant",
        rootId: root.id,
        path: "p002-other",
        create: true,
      })
    ).json()
  ).project;
  const otherSessionResponse = await owner("/sessions", {
    projectId: otherProject.id,
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  });
  expect(otherSessionResponse.status(), await otherSessionResponse.text()).toBe(
    200,
  );
  const otherSession = (await otherSessionResponse.json()).session;
  await page.getByRole("button", { name: "API tokens", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Token name").fill("   ");
  await modal
    .getByText("Allowed projects", { exact: true })
    .locator("..")
    .getByRole("checkbox")
    .first()
    .check();
  for (const scope of ["execute", "approve", "cancel"])
    await modal.getByLabel(`Token scope ${scope}`).check();
  await modal
    .getByRole("button", { name: "Create API token", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText(
    "Request does not match schema",
  );
  await expect(modal.getByLabel("Token name")).toBeEnabled();
  await modal.getByLabel("Token name").fill("P002 external client");
  await modal
    .getByRole("button", { name: "Create API token", exact: true })
    .click();
  const secret = await modal.getByLabel("One-time API token").inputValue();
  expect(secret).toMatch(/^hbr_[A-Za-z0-9_-]{43}$/);
  await modal.getByRole("button", { name: "Hide secret" }).click();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(secret);
  const metadata = await (
    await context.request.get(origin + "/api/v1/security/api-tokens")
  ).json();
  expect(JSON.stringify(metadata)).not.toContain(secret);
  const token = metadata.tokens.find(
    (t: any) => t.name === "P002 external client",
  );
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const client = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: "Bearer " + secret },
  });
  const send = (route: string, body: unknown, k = key()) =>
    client.post(origin + "/api/v1" + route, {
      headers: { "Idempotency-Key": k },
      data: body,
    });
  const snapshot = async (id: string) =>
    await (await client.get(origin + `/api/v1/sessions/${id}/snapshot`)).json();
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  let rotationSecret = "";
  try {
    expect(
      (await client.get(origin + "/api/v1/security/api-tokens")).status(),
    ).toBe(403);
    expect((await client.get(origin + "/")).status()).toBe(403);
    expect((await client.get(origin + "/api/v2/sessions")).status()).toBe(403);
    expect((await client.get(origin + "/api/v1/openapi.json")).status()).toBe(
      200,
    );
    const document = await (
      await client.get(origin + "/api/v1/openapi.json")
    ).json();
    const validate = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile({
      ...document.paths["/security/api-tokens"].get.responses[200].content[
        "application/json"
      ].schema,
      components: document.components,
    });
    expect(validate(metadata)).toBe(true);
    expect(
      document.paths["/sessions"].post.parameters.find(
        (p: any) => p.name === "Origin",
      ).required,
    ).toBe(false);
    expect(
      document.paths["/sessions"].post.parameters.find(
        (p: any) => p.name === "X-CSRF-Token",
      ).required,
    ).toBe(false);
    expect(
      (await (await client.get(origin + "/api/v1/capabilities")).json())
        .permissionProfiles,
    ).toEqual(["read-only"]);
    expect(
      (
        await send("/sessions", { ...settings, projectId: randomUUID() })
      ).status(),
    ).toBe(403);
    expect(
      (
        await send("/sessions", {
          ...settings,
          projectId,
          permissionProfile: "workspace-write",
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await (await client.get(origin + "/api/v1/projects")).json()
      ).projects.map((p: any) => p.id),
    ).toEqual([projectId]);
    expect(
      (
        await client.get(
          origin + `/api/v1/sessions/${otherSession.id}/snapshot`,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await client.get(origin + `/api/v1/sessions/${otherSession.id}/events`)
      ).status(),
    ).toBe(403);
    expect(
      (
        await (await client.get(origin + "/api/v1/sessions")).json()
      ).sessions.some((s: any) => s.id === otherSession.id),
    ).toBe(false);
    const session = (
      await (await send("/sessions", { ...settings, projectId })).json()
    ).session;
    const stream = (id: string) => {
      let text = "",
        resolve!: (value: string) => void;
      const ended = new Promise<string>((r) => (resolve = r));
      const req = httpsRequest(
        origin + `/api/v1/sessions/${id}/events`,
        {
          rejectUnauthorized: false,
          headers: { Authorization: "Bearer " + secret },
        },
        (res) => {
          res.on("data", (chunk) => {
            text += chunk.toString();
            if (text.length > 2097152) req.destroy();
          });
          res.on("end", () => resolve(text));
        },
      );
      req.on("error", () => resolve(text));
      req.end();
      return { ended, close: () => req.destroy(), text: () => text };
    };
    const events = stream(session.id),
      intent = key(),
      body = { ...settings, text: "P002 cookie-free streamed result" };
    const accepted = await (
      await send(`/sessions/${session.id}/turns`, body, intent)
    ).json();
    expect(
      await (await send(`/sessions/${session.id}/turns`, body, intent)).json(),
    ).toEqual(accepted);
    expect(
      (
        await send(
          `/sessions/${session.id}/turns`,
          { ...body, text: "changed" },
          intent,
        )
      ).status(),
    ).toBe(409);
    await expect
      .poll(
        async () =>
          (await snapshot(session.id)).operations.find(
            (o: any) => o.id === accepted.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    await expect
      .poll(() => events.text(), { timeout: 10000 })
      .toContain("P002 cookie-free streamed result");
    expect(
      (
        await client.get(origin + `/api/v1/operations/${accepted.operation.id}`)
      ).status(),
    ).toBe(200);
    events.close();
    expect(
      (
        await send(`/sessions/${session.id}/turns`, {
          ...settings,
          text: "bad",
          unknown: true,
        })
      ).status(),
    ).toBe(400);
    const stopping = await (
      await send(`/sessions/${session.id}/turns`, {
        ...settings,
        text: "[delay] P002 cancellation",
      })
    ).json();
    await expect
      .poll(
        async () =>
          (await snapshot(session.id)).operations.find(
            (o: any) => o.id === stopping.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("running");
    await db.query(
      "INSERT INTO intents(actor,route,key,request_hash,result) SELECT $1,'/test/p002-quota',$2||':'||gen_random_uuid()::text,'fixture','{}'::jsonb FROM generate_series(1,1000-(SELECT count(*)::int FROM intents WHERE actor=$1))",
      ["pat:" + token.id, String(Date.now())],
    );
    expect((await send(`/sessions/${session.id}/turns`, body)).status()).toBe(
      429,
    );
    expect(
      await (await send(`/sessions/${session.id}/turns`, body, intent)).json(),
    ).toEqual(accepted);
    expect(
      (await send(`/turns/${stopping.operation.id}/cancel`, {})).status(),
    ).toBe(202);
    await db.query(
      "DELETE FROM intents WHERE actor=$1 AND route='/test/p002-quota'",
      ["pat:" + token.id],
    );
    await expect
      .poll(
        async () =>
          (await snapshot(session.id)).operations.find(
            (o: any) => o.id === stopping.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("interrupted");
    const approvalTurn = await (
      await send(`/sessions/${session.id}/turns`, {
        ...settings,
        text: "[approval]",
      })
    ).json();
    await expect
      .poll(
        async () =>
          (await snapshot(session.id)).approvals.filter(
            (a: any) => a.state === "pending",
          ).length,
        { timeout: 30000 },
      )
      .toBe(1);
    const permittedApproval = (await snapshot(session.id)).approvals.find(
      (a: any) => a.state === "pending",
    );
    expect(
      (
        await send(`/approvals/${permittedApproval.id}/answer`, {
          generation: permittedApproval.generation,
          decision: "accept",
        })
      ).status(),
    ).toBe(202);
    await expect
      .poll(
        async () =>
          (await snapshot(session.id)).operations.find(
            (o: any) => o.id === approvalTurn.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    for (const control of ["approve", "cancel"] as const) {
      const controlToken = await (
        await owner("/security/api-tokens", {
          name: `P002 delayed ${control}`,
          scopes: ["read", control],
          projectIds: [projectId],
          permissionProfile: "read-only",
          expiresInDays: 1,
        })
      ).json();
      const controlClient = await request.newContext({
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { Authorization: "Bearer " + controlToken.secret },
      });
      const target = await (
        await send(`/sessions/${session.id}/turns`, {
          ...settings,
          text: "[approval]",
        })
      ).json();
      await expect
        .poll(
          async () =>
            (await snapshot(session.id)).approvals.filter(
              (a: any) => a.state === "pending",
            ).length,
          { timeout: 30000 },
        )
        .toBe(1);
      const before = await snapshot(session.id),
        waiting = before.approvals.find((a: any) => a.state === "pending");
      const hold = await db.connect();
      let controlResult: any;
      try {
        await hold.query("BEGIN");
        await hold.query("SELECT id FROM harbor_meta FOR UPDATE");
        const response = await controlClient.post(
          origin +
            "/api/v1" +
            (control === "approve"
              ? `/approvals/${waiting.id}/answer`
              : `/turns/${target.operation.id}/cancel`),
          {
            headers: { "Idempotency-Key": key() },
            data:
              control === "approve"
                ? { generation: waiting.generation, decision: "accept" }
                : {},
          },
        );
        expect(response.status()).toBe(202);
        controlResult = await response.json();
        await expect
          .poll(
            async () =>
              Number(
                (
                  await db.query(
                    "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT generation,emergency,identity_pin FROM harbor_meta FOR UPDATE%' ",
                  )
                ).rows[0].count,
              ),
            { timeout: 10000 },
          )
          .toBeGreaterThan(0);
        expect(
          (
            await owner(
              `/security/api-tokens/${controlToken.token.id}/revoke`,
              {},
            )
          ).status(),
        ).toBe(200);
      } finally {
        await hold.query("ROLLBACK");
        hold.release();
      }
      if (control === "approve")
        await expect
          .poll(
            async () =>
              (await snapshot(session.id)).approvals.find(
                (a: any) => a.id === waiting.id,
              ).state,
            { timeout: 10000 },
          )
          .toBe("pending");
      else
        await expect
          .poll(
            async () =>
              (await snapshot(session.id)).operations.find(
                (o: any) => o.id === controlResult.operation.id,
              ).state,
            { timeout: 10000 },
          )
          .toBe("failed");
      const unchanged = await snapshot(session.id);
      expect(unchanged.session.state).toBe("waiting_approval");
      expect(unchanged.session.generation).toBe(before.session.generation);
      expect(
        (
          await owner(`/approvals/${waiting.id}/answer`, {
            generation: waiting.generation,
            decision: "decline",
          })
        ).status(),
      ).toBe(202);
      await expect
        .poll(
          async () =>
            (await snapshot(session.id)).operations.find(
              (o: any) => o.id === target.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("succeeded");
      await controlClient.dispose();
    }
    const writable = (
      await (
        await owner("/sessions", {
          ...settings,
          projectId,
          permissionProfile: "workspace-write",
        })
      ).json()
    ).session;
    await owner(`/sessions/${writable.id}/turns`, {
      ...settings,
      permissionProfile: "workspace-write",
      text: "[approval]",
    });
    await expect
      .poll(async () => (await snapshot(writable.id)).approvals.length, {
        timeout: 30000,
      })
      .toBe(1);
    const approval = (await snapshot(writable.id)).approvals[0];
    expect(
      (
        await send(`/approvals/${approval.id}/answer`, {
          generation: approval.generation,
          decision: "accept",
        })
      ).status(),
    ).toBe(403);
    await owner(`/approvals/${approval.id}/answer`, {
      generation: approval.generation,
      decision: "decline",
    });
    await expect
      .poll(async () => (await snapshot(writable.id)).session.state, {
        timeout: 30000,
      })
      .toBe("succeeded");
    const restricted = await (
      await owner("/security/api-tokens", {
        name: "P002 read",
        scopes: ["read"],
        projectIds: [projectId],
        permissionProfile: "read-only",
        expiresInDays: 1,
      })
    ).json();
    const readClient = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: "Bearer " + restricted.secret },
    });
    expect(
      (
        await readClient.post(origin + `/api/v1/sessions/${session.id}/turns`, {
          headers: { "Idempotency-Key": key() },
          data: body,
        })
      ).status(),
    ).toBe(403);
    await db.query(
      "UPDATE api_tokens SET expires_at=now()-interval '1 second' WHERE id=$1",
      [restricted.token.id],
    );
    expect((await readClient.get(origin + "/api/v1/projects")).status()).toBe(
      401,
    );
    await readClient.dispose();
    const retryKey = key(),
      spec = {
        name: "P002 lost-response",
        scopes: ["read"],
        projectIds: [projectId],
        permissionProfile: "read-only",
        expiresInDays: 1,
      };
    const created = await (
        await owner("/security/api-tokens", spec, retryKey)
      ).json(),
      retried = await (
        await owner("/security/api-tokens", spec, retryKey)
      ).json();
    rotationSecret = created.secret;
    expect(retried.token.id).toBe(created.token.id);
    expect(retried.secret).toBeUndefined();
    expect(retried.secretUnavailable).toBe(true);
    const persisted = await db.query(
      "SELECT row_to_json(t)::text AS value FROM api_tokens t UNION ALL SELECT row_to_json(i)::text FROM intents i UNION ALL SELECT row_to_json(e)::text FROM events e UNION ALL SELECT row_to_json(o)::text FROM operations o",
    );
    for (const raw of [secret, restricted.secret, created.secret])
      expect(JSON.stringify(persisted.rows)).not.toContain(raw);
    const running = await (
      await send(`/sessions/${session.id}/turns`, {
        ...settings,
        text: "[delay] P002 running grant",
      })
    ).json();
    await expect
      .poll(
        async () =>
          (await snapshot(session.id)).operations.find(
            (o: any) => o.id === running.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("running");
    const queued = await (
        await send(`/sessions/${session.id}/turns`, body)
      ).json(),
      live = stream(session.id);
    await page.getByRole("button", { name: "API tokens", exact: true }).click();
    await page
      .getByRole("button", { name: "Revoke P002 external client", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "Token revoked",
    );
    await page.screenshot({
      path: path.join(artifacts, "p002-tokens-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: path.join(artifacts, "p002-tokens-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await Promise.race([
      live.ended,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("Revoked stream stayed open")), 5000),
      ),
    ]);
    expect((await client.get(origin + "/api/v1/projects")).status()).toBe(401);
    await expect
      .poll(
        async () =>
          (
            await db.query("SELECT state FROM operations WHERE id=$1", [
              running.operation.id,
            ])
          ).rows[0].state,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    await expect
      .poll(
        async () =>
          (
            await db.query("SELECT state FROM operations WHERE id=$1", [
              queued.operation.id,
            ])
          ).rows[0].state,
        { timeout: 30000 },
      )
      .toBe("failed");
    expect(
      (
        await db.query("SELECT generation FROM operations WHERE id=$1", [
          queued.operation.id,
        ])
      ).rows[0].generation,
    ).toBeNull();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    const anon = await request.newContext({ ignoreHTTPSErrors: true });
    expect((await anon.get(origin + "/api/v1/openapi.json")).status()).toBe(
      401,
    );
    expect(
      (
        await anon.get(origin + "/api/v1/projects?access_token=" + secret)
      ).status(),
    ).toBe(401);
    expect(
      (
        await anon.get(origin + "/api/v1/projects", {
          headers: { Authorization: "Bearer malformed" },
        })
      ).status(),
    ).toBe(401);
    await anon.dispose();
    const rateClient = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: "Bearer " + created.secret },
    });
    let limited = false;
    for (let i = 0; i < 205; i++) {
      const response = await rateClient.get(origin + "/api/v1/projects");
      if (response.status() === 429) {
        expect((await response.json()).error.retryable).toBe(true);
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
    await rateClient.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10500));
    for (const raw of [secret, restricted.secret, created.secret])
      expect(logs().includes(raw)).toBe(false);
  } finally {
    await client.dispose();
  }
  console.log(
    "P002-01–06 programmatic acceptance passed (real UI plus cookie-free HTTP/SSE).",
  );
  return rotationSecret;
}
