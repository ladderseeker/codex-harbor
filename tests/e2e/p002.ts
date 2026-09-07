import { stat, writeFile } from "node:fs/promises";
import { digest } from "../../packages/policy/src/index.ts";
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
  pauseSupervisor,
  resumeSupervisor,
}: {
  page: Page;
  context: BrowserContext;
  origin: string;
  csrf: string;
  db: pg.Pool;
  projectId: string;
  logs: () => string;
  artifacts: string;
  pauseSupervisor(): void;
  resumeSupervisor(): void;
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
  // Independent P002 conversations receive distinct managed checkouts so its
  // concurrent approval/cancel assertions do not contend on P003's Local lease.
  const localWorkspace = (
    await (
      await context.request.get(
        origin + `/api/v1/projects/${projectId}/workspaces`,
      )
    ).json()
  ).workspaces.find((w: any) => w.kind === "local");
  await expect
    .poll(
      async () =>
        (
          await (
            await context.request.get(
              origin + `/api/v1/projects/${projectId}/workspaces`,
            )
          ).json()
        ).workspaces.find((w: any) => w.id === localWorkspace.id)
          .writerSessionId,
      { timeout: 30000 },
    )
    .toBe(null);
  const isolatedWorkspaces: string[] = [];
  for (const name of ["P002 broader profile", "P002 writable approval"]) {
    const result = await owner(`/projects/${projectId}/workspaces`, {
      name,
      kind: "copy",
      sourceWorkspaceId: localWorkspace.id,
      dirtyPolicy: "snapshot",
    });
    expect(result.status()).toBe(200);
    const w = (await result.json()).workspace;
    await expect
      .poll(
        async () =>
          (
            await (
              await context.request.get(origin + `/api/v1/workspaces/${w.id}`)
            ).json()
          ).workspace.state,
        { timeout: 30000 },
      )
      .toBe("ready");
    isolatedWorkspaces.push(w.id);
  }
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
    expect(
      (
        await client.get(origin + `/api/v1/projects/${projectId}/workspaces`)
      ).status(),
    ).toBe(403);
    expect(
      (await send(`/workspaces/${localWorkspace.id}/release`, {})).status(),
    ).toBe(403);
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
          workspaceId: isolatedWorkspaces.shift(),
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
    for (const actorKind of ["token", "browser"] as const) {
      const anchor = (
        await (
          await send(`/sessions/${session.id}/turns`, {
            ...settings,
            text: "[approval]",
          })
        ).json()
      ).operation;
      await expect
        .poll(async () => (await snapshot(session.id)).session.state, {
          timeout: 30000,
        })
        .toBe("waiting_approval");
      const queuedTarget = (
        await (
          await send(`/sessions/${session.id}/turns`, {
            ...settings,
            text: "queued owner work",
          })
        ).json()
      ).operation;
      const grant = await (
        await owner("/security/api-tokens", {
          name: "Queued expiry",
          scopes: ["cancel"],
          projectIds: [projectId],
          permissionProfile: "read-only",
          expiresInDays: 1,
        })
      ).json();
      const cookieContext =
        actorKind === "browser"
          ? await context.browser()!.newContext({ ignoreHTTPSErrors: true })
          : undefined;
      let cookieActor = "",
        cookieCsrf = "";
      if (cookieContext) {
        const view = await cookieContext.newPage();
        await view.goto(origin + "/auth/login");
        await view
          .getByRole("button", { name: "Sign in as owner", exact: true })
          .click();
        cookieCsrf = (
          await (await cookieContext.request.get(origin + "/api/v1/me")).json()
        ).csrfToken;
        cookieActor = digest(
          (await cookieContext.cookies()).find(
            (c) => c.name === "__Host-harbor",
          )!.value,
        );
      }
      const controlClient = await request.newContext({
          ignoreHTTPSErrors: true,
          extraHTTPHeaders: { Authorization: "Bearer " + grant.secret },
        }),
        hold = await db.connect();
      let paused = false;
      try {
        pauseSupervisor();
        paused = true;
        const cancelled = await (
          cookieContext ? cookieContext.request : controlClient
        ).post(origin + `/api/v1/turns/${queuedTarget.id}/cancel`, {
          headers: {
            "Idempotency-Key": key(),
            ...(cookieContext
              ? { Origin: origin, "X-CSRF-Token": cookieCsrf }
              : {}),
          },
          data: {},
        });
        expect(cancelled.status()).toBe(202);
        const control = (await cancelled.json()).operation;
        await db.query(
          actorKind === "token"
            ? "UPDATE api_tokens SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1"
            : "UPDATE browser_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE hash=$1",
          [actorKind === "token" ? grant.token.id : cookieActor],
        );
        await hold.query("BEGIN");
        await hold.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
          session.id,
        ]);
        resumeSupervisor();
        paused = false;
        await expect
          .poll(
            async () =>
              Number(
                (
                  await db.query(
                    "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query='SELECT id FROM sessions WHERE id=$1 FOR UPDATE'",
                  )
                ).rows[0].count,
              ),
            { timeout: 10000 },
          )
          .toBeGreaterThan(0);
        await expect
          .poll(
            async () =>
              (
                await db.query(
                  actorKind === "token"
                    ? "SELECT expires_at<=clock_timestamp() AS expired FROM api_tokens WHERE id=$1"
                    : "SELECT expires_at<=clock_timestamp() AS expired FROM browser_sessions WHERE hash=$1",
                  [actorKind === "token" ? grant.token.id : cookieActor],
                )
              ).rows[0].expired,
            { timeout: 5000 },
          )
          .toBe(true);
        await hold.query("ROLLBACK");
        await expect
          .poll(
            async () =>
              (
                await db.query("SELECT state FROM operations WHERE id=$1", [
                  control.id,
                ])
              ).rows[0].state,
          )
          .toBe("failed");
        expect(
          (
            await db.query("SELECT state FROM operations WHERE id=$1", [
              queuedTarget.id,
            ])
          ).rows[0].state,
        ).toBe("queued");
      } finally {
        if (paused) resumeSupervisor();
        await hold.query("ROLLBACK");
        hold.release();
        await controlClient.dispose();
        await cookieContext?.close();
      }
      await owner(`/turns/${queuedTarget.id}/cancel`, {});
      const approval = (await snapshot(session.id)).approvals.find(
        (a: any) => a.state === "pending",
      );
      await owner(`/approvals/${approval.id}/answer`, {
        generation: approval.generation,
        decision: "decline",
      });
      await expect
        .poll(
          async () =>
            (
              await db.query("SELECT state FROM operations WHERE id=$1", [
                anchor.id,
              ])
            ).rows[0].state,
          { timeout: 30000 },
        )
        .toBe("succeeded");
    }
    const wider = (
      await (
        await owner("/sessions", {
          ...settings,
          projectId,
          workspaceId: isolatedWorkspaces.shift(),
          permissionProfile: "workspace-write",
        })
      ).json()
    ).session;
    const widerTurn = (
      await (
        await owner(`/sessions/${wider.id}/turns`, {
          ...settings,
          permissionProfile: "workspace-write",
          text: "[approval]",
        })
      ).json()
    ).operation;
    await expect
      .poll(async () => (await snapshot(wider.id)).session.state, {
        timeout: 30000,
      })
      .toBe("waiting_approval");
    const cancelOnly = await (
      await owner("/security/api-tokens", {
        name: "Read-only cancellation ceiling",
        scopes: ["cancel"],
        projectIds: [projectId],
        permissionProfile: "read-only",
        expiresInDays: 1,
      })
    ).json();
    const narrower = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: "Bearer " + cancelOnly.secret },
    });
    try {
      expect(
        (
          await narrower.post(origin + `/api/v1/turns/${widerTurn.id}/cancel`, {
            headers: { "Idempotency-Key": key() },
            data: {},
          })
        ).status(),
      ).toBe(202);
      await expect
        .poll(
          async () =>
            (await snapshot(wider.id)).operations.find(
              (o: any) => o.id === widerTurn.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("interrupted");
    } finally {
      await narrower.dispose();
    }
    const shortBrowser = await context
      .browser()!
      .newContext({ ignoreHTTPSErrors: true });
    const shortPage = await shortBrowser.newPage(),
      projectHold = await db.connect();
    let pendingProject: Promise<any> | undefined;
    try {
      await shortPage.goto(origin + "/auth/login");
      await shortPage
        .getByRole("button", { name: "Sign in as owner", exact: true })
        .click();
      const identity = await (
          await shortBrowser.request.get(origin + "/api/v1/me")
        ).json(),
        cookie = (await shortBrowser.cookies()).find(
          (c) => c.name === "__Host-harbor",
        )!;
      const actorHash = digest(cookie.value),
        folder = "expired-registration-" + randomUUID();
      const base = path.dirname(
        (
          await db.query("SELECT canonical_path FROM projects WHERE id=$1", [
            projectId,
          ])
        ).rows[0].canonical_path,
      );
      await db.query(
        "UPDATE browser_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE hash=$1",
        [actorHash],
      );
      await projectHold.query("BEGIN");
      await projectHold.query("SELECT pg_advisory_xact_lock(740012)");
      pendingProject = shortBrowser.request.post(origin + "/api/v1/projects", {
        headers: {
          Origin: origin,
          "X-CSRF-Token": identity.csrfToken,
          "Idempotency-Key": key(),
        },
        data: {
          name: "Expired owner project",
          rootId: root.id,
          path: folder,
          create: true,
        },
      });
      await expect
        .poll(async () =>
          Number(
            (
              await db.query(
                "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query='SELECT pg_advisory_xact_lock(740012)'",
              )
            ).rows[0].count,
          ),
        )
        .toBeGreaterThan(0);
      await expect
        .poll(
          async () =>
            (
              await db.query(
                "SELECT expires_at<=clock_timestamp() AS expired FROM browser_sessions WHERE hash=$1",
                [actorHash],
              )
            ).rows[0].expired,
          { timeout: 5000 },
        )
        .toBe(true);
      await projectHold.query("ROLLBACK");
      expect((await pendingProject).status()).toBe(401);
      expect(
        await stat(path.join(base, folder)).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(
        (
          await db.query(
            "SELECT 1 FROM projects WHERE name='Expired owner project'",
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await projectHold.query("ROLLBACK");
      projectHold.release();
      await pendingProject;
      await shortBrowser.close();
    }
    for (const replay of [false, true]) {
      const authorityToken = await (
        await owner("/security/api-tokens", {
          name: "P002 command lock expiry",
          scopes: ["read", "execute"],
          projectIds: [projectId],
          permissionProfile: "read-only",
          expiresInDays: 1,
        })
      ).json();
      const authorityClient = await request.newContext({
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { Authorization: "Bearer " + authorityToken.secret },
      });
      const k = key(),
        body = {
          projectId,
          model: "fixture",
          effort: "medium",
          permissionProfile: "read-only",
        },
        held = await db.connect();
      let response: Promise<any> | undefined;
      try {
        if (replay)
          expect(
            (
              await authorityClient.post(origin + "/api/v1/sessions", {
                headers: { "Idempotency-Key": k },
                data: body,
              })
            ).status(),
          ).toBe(200);
        const beforeCount = Number(
          (await db.query("SELECT count(*) FROM sessions")).rows[0].count,
        );
        await db.query(
          "UPDATE api_tokens SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",
          [authorityToken.token.id],
        );
        await held.query("BEGIN");
        await held.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          ["pat:" + authorityToken.token.id + "/api/v1/sessions" + k],
        );
        response = authorityClient.post(origin + "/api/v1/sessions", {
          headers: { "Idempotency-Key": k },
          data: body,
        });
        await expect
          .poll(async () =>
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock(hashtextextended%'",
                )
              ).rows[0].count,
            ),
          )
          .toBeGreaterThan(0);
        await expect
          .poll(
            async () =>
              (
                await db.query(
                  "SELECT expires_at<=clock_timestamp() AS expired FROM api_tokens WHERE id=$1",
                  [authorityToken.token.id],
                )
              ).rows[0].expired,
            { timeout: 5000 },
          )
          .toBe(true);
        await held.query("ROLLBACK");
        expect((await response).status()).toBe(401);
        expect(
          Number(
            (await db.query("SELECT count(*) FROM sessions")).rows[0].count,
          ),
        ).toBe(beforeCount);
      } finally {
        await held.query("ROLLBACK");
        held.release();
        await response;
        await authorityClient.dispose();
      }
    }
    for (const mode of ["revoke", "expire"] as const)
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
          if (mode === "revoke") {
            expect(
              (
                await owner(
                  `/security/api-tokens/${controlToken.token.id}/revoke`,
                  {},
                )
              ).status(),
            ).toBe(200);
          } else {
            await db.query(
              "UPDATE api_tokens SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",
              [controlToken.token.id],
            );
            const actorHold = await db.connect();
            try {
              await actorHold.query("BEGIN");
              await actorHold.query(
                "SELECT id FROM api_tokens WHERE id=$1 FOR UPDATE",
                [controlToken.token.id],
              );
              await hold.query("ROLLBACK");
              await expect
                .poll(
                  async () =>
                    Number(
                      (
                        await db.query(
                          "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM api_tokens WHERE id=%FOR SHARE%'",
                        )
                      ).rows[0].count,
                    ),
                  { timeout: 10000 },
                )
                .toBeGreaterThan(0);
              await expect
                .poll(
                  async () =>
                    (
                      await actorHold.query(
                        "SELECT expires_at<=clock_timestamp() AS expired FROM api_tokens WHERE id=$1",
                        [controlToken.token.id],
                      )
                    ).rows[0].expired,
                  { timeout: 5000 },
                )
                .toBe(true);
            } finally {
              await actorHold.query("ROLLBACK");
              actorHold.release();
            }
          }
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
          workspaceId: isolatedWorkspaces.shift(),
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
    await new Promise((resolve) => setTimeout(resolve, 10500));
    // A burst can straddle one fixed-window boundary. Exceed both windows'
    // finite capacity within ten seconds, with bounded concurrency and no retry.
    let limited = false,
      sent = 0;
    const began = Date.now(),
      statuses: Record<number, number> = {};
    let elapsedMs = 0;
    try {
      while (!limited && sent < 405 && Date.now() - began < 9000) {
        const count = Math.min(8, 405 - sent);
        const responses = await Promise.all(
          Array.from({ length: count }, () =>
            rateClient.get(origin + "/api/v1/projects", {
              timeout: Math.max(1, 9000 - (Date.now() - began)),
            }),
          ),
        );
        sent += count;
        for (const response of responses) {
          const status = response.status();
          statuses[status] = (statuses[status] ?? 0) + 1;
          expect(
            [200, 429],
            "Only authenticated reads or rate rejection",
          ).toContain(status);
          if (status === 429) {
            expect((await response.json()).error.retryable).toBe(true);
            limited = true;
          }
        }
      }
    } finally {
      elapsedMs = Date.now() - began;
      await writeFile(
        path.join(artifacts, "p002-rate-burst.json"),
        JSON.stringify({ sent, elapsedMs, statuses }, null, 2),
      );
      await rateClient.dispose();
    }
    const evidence = JSON.stringify({ sent, elapsedMs, statuses });
    expect(
      statuses[200] ?? 0,
      "Successful authenticated reads: " + evidence,
    ).toBeGreaterThan(0);
    expect(elapsedMs, "Bounded rate burst: " + evidence).toBeLessThan(10000);
    expect(
      limited,
      "Rate rejection within at most two windows: " + evidence,
    ).toBe(true);
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
