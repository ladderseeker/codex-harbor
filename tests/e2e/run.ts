if (process.argv.includes("--workspaces")) {
  await import("../workspaces/e2e.ts");
  process.exit(process.exitCode ?? 0);
}
import { authorityExpiry } from "./authority-expiry.ts";
import { p002 } from "./p002.ts";
import { sourceDigest } from "../../scripts/source-digest.ts";
import { localComposeFiles } from "../../infra/compose.ts";
import { maintain } from "../../packages/storage/src/maintenance.ts";
import { checkKey } from "../../packages/policy/src/index.ts";
import { Ajv2020 } from "ajv/dist/2020.js";
import pg from "pg";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
import { chromium, expect, request as apiRequest } from "@playwright/test";
const sourceAtStart = sourceDigest();
const children: ChildProcess[] = [];
let diagnosticText = "";
let rotationBearer = "";
const serve = process.argv.includes("--serve");
const dir = await mkdtemp(
    path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "harbor-e2e-",
    ),
  ),
  instance = "harbor-e2e-" + randomBytes(5).toString("hex");
async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
const [dbPort, apiPort, httpsPort, oidcPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
]);
const rootId = randomUUID(),
  origin = `https://localhost:${httpsPort}`,
  password = randomBytes(24).toString("hex");
const artifacts = path.resolve(".test-runs", instance);
const env = {
  ...process.env,
  NODE_ENV: "test",
  HARBOR_FIXTURE_MODE: "private-test",
  HARBOR_INSTANCE_ID: instance,
  HARBOR_DATABASE_PASSWORD: password,
  HARBOR_DATABASE_PORT: String(dbPort),
  HARBOR_API_PORT: String(apiPort),
  HARBOR_HTTPS_PORT: String(httpsPort),
  HARBOR_PORT: String(apiPort),
  HARBOR_ORIGIN: origin,
  DATABASE_URL: `postgres://harbor:${password}@127.0.0.1:${dbPort}/harbor`,
  OIDC_PORT: String(oidcPort),
  HARBOR_OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
  HARBOR_OIDC_CLIENT_ID: instance,
  HARBOR_OWNER_SUBJECT: "owner",
  HARBOR_PROJECT_ROOTS: JSON.stringify([
    { id: rootId, name: "Test root", path: path.join(dir, "project-roots") },
  ]),
  HARBOR_MODELS: "fixture",
  HARBOR_CONTROL_SOCKET: path.join(dir, "control", "supervisor.sock"),
  HARBOR_CREDENTIAL_KEY_FILE: path.join(dir, "control", "key"),
  HARBOR_FIXTURE_INIT_DELAY_MS: "0",
  HARBOR_FIXTURE_STATE_DIR: path.join(dir, "fixture-state"),
  HARBOR_FIXTURE_TRACE_FILE: path.join(dir, "dispatch-trace.jsonl"),
  HARBOR_PERMISSION_CEILING: "workspace-write",
};
const compose = (args: string[]) =>
  execFileSync("docker", ["compose", ...localComposeFiles(), ...args], {
    env,
    stdio: "pipe",
    timeout: 120000,
  });
const start = (file: string) => {
  const p = spawn(process.execPath, ["--import", "tsx", file], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (b: Buffer) => {
    diagnosticText = (diagnosticText + b.toString()).slice(-131072);
  };
  p.stdout?.on("data", capture);
  p.stderr?.on("data", capture);
  let diagnostics = "";
  p.stderr?.on("data", (b) => {
    diagnostics = (diagnostics + b.toString()).slice(-4000);
  });
  p.on("exit", (code) => {
    if (code)
      console.error(
        file + " failed: " + diagnostics.replaceAll(password, "[redacted]"),
      );
  });
  children.push(p);
  return p;
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  await mkdir(path.join(dir, "project-roots"), { mode: 0o700 });
  await mkdir(path.join(dir, "control"), { mode: 0o700 });
  await writeFile(env.HARBOR_CREDENTIAL_KEY_FILE, randomBytes(32), {
    mode: 0o600,
  });
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({ instance, dbPort, apiPort, httpsPort, oidcPort, rootId }),
  );
  compose(["up", "-d", "--wait"]);
  start("tests/fixtures/oidc/server.ts");
  await new Promise((r) => setTimeout(r, 300));
  let api = start("apps/api/src/main.ts");
  let supervisor = start("apps/supervisor/src/main.ts");
  if (serve) {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`http://127.0.0.1:${apiPort}/api/v1/me`))
              .status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(401);
    console.log(
      `Private development instance ready: ${origin}/auth/login\nSign in as owner with the isolated fixture identity provider. State is disposable and removed on shutdown.\nInstance: ${instance}`,
    );
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } else {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await expect
      .poll(
        async () => {
          try {
            return (await context.request.get(origin + "/api/v1/me")).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(401);
    for (const route of [
      "/",
      "/assets/absent.js",
      "/api/v1/projects",
      "/api/v1/sessions/" + randomUUID() + "/events",
    ])
      expect((await context.request.get(origin + route)).status()).toBe(401);
    await page.goto(origin + "/auth/login");
    await page
      .getByRole("button", { name: "Sign in as denied identity" })
      .click();
    await expect(page.locator("body")).toContainText("OWNER_DENIED");
    await page.goto(origin + "/auth/login");
    await page
      .getByRole("button", { name: "Sign in as owner", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add project", exact: true }).first(),
    ).toBeVisible();
    const me = await (await context.request.get(origin + "/api/v1/me")).json();
    const apiDocument = await (
      await context.request.get(origin + "/api/v1/openapi.json")
    ).json();
    const validator = new Ajv2020({ strict: false, validateFormats: false });
    const assertResponse = (
      route: string,
      method: string,
      status: number,
      data: unknown,
    ) => {
      const schema =
        apiDocument.paths[route][method].responses[String(status)].content[
          "application/json"
        ].schema;
      const validate = validator.compile({
        ...schema,
        components: apiDocument.components,
      });
      expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
    };
    assertResponse("/me", "get", 200, me);
    assertResponse(
      "/capabilities",
      "get",
      200,
      await (await context.request.get(origin + "/api/v1/capabilities")).json(),
    );
    const headers = { Origin: origin, "X-CSRF-Token": me.csrfToken };
    const command = async (
      route: string,
      body: unknown,
      key = `${Date.now()}:${randomUUID()}`,
    ) =>
      context.request.post(origin + "/api/v1" + route, {
        data: body,
        headers: { ...headers, "Idempotency-Key": key },
      });
    for (const token of [undefined, "invalid"]) {
      const response = await context.request.post(
        origin + "/api/v1/security/emergency-stop",
        {
          data: {},
          headers: {
            Origin: origin,
            "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
            ...(token ? { "X-CSRF-Token": token } : {}),
          },
        },
      );
      expect(response.status()).toBe(403);
    }
    const syntheticKey = "test-only-key-" + randomBytes(20).toString("hex");
    const credentialIntent = `${Date.now()}:${randomUUID()}`;
    const credentialResult = await command(
      "/security/runtime-credentials",
      { apiKey: syntheticKey },
      credentialIntent,
    );
    expect(credentialResult.status()).toBe(200);
    expect(JSON.stringify(await credentialResult.json())).not.toContain(
      syntheticKey,
    );
    expect(
      (
        await command(
          "/security/runtime-credentials",
          { apiKey: syntheticKey },
          credentialIntent,
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await command(
          "/security/runtime-credentials",
          { apiKey: syntheticKey + "changed" },
          credentialIntent,
        )
      ).status(),
    ).toBe(409);
    expect(
      (
        await context.request.post(origin + "/api/v1/projects", {
          data: {},
          headers: {
            Origin: "https://evil.example",
            "X-CSRF-Token": me.csrfToken,
          },
        })
      ).status(),
    ).toBe(403);
    await page
      .getByRole("button", { name: "Add project", exact: true })
      .first()
      .click();
    await page.getByLabel("Project name").fill("Acceptance project");
    await page.getByLabel("Folder path").fill("project");
    await page.getByLabel("Create a new folder").check();
    await page
      .getByRole("button", { name: "Add project", exact: true })
      .last()
      .click();
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    await page.getByLabel("Message Codex").fill("P001 initial text");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator("body")).toContainText("Fixture response", {
      timeout: 30000,
    });
    await page.screenshot({
      path: path.join(artifacts, "conversation-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("Message Codex")).toBeVisible();
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);

    await page.screenshot({
      path: path.join(artifacts, "conversation-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: path.join(artifacts, "conversation-mobile-navigation.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Close navigation", exact: true })
      .last()
      .click();
    await expect(page.getByLabel("Message Codex")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    const sessions = await (
      await context.request.get(origin + "/api/v1/sessions")
    ).json();
    const id = sessions.sessions[0].id;
    const snapshot = async () =>
      (
        await context.request.get(origin + `/api/v1/sessions/${id}/snapshot`)
      ).json();
    const key = `${Date.now()}:${randomUUID()}`,
      payload = {
        text: "[delay] persisted work",
        model: "fixture",
        effort: "medium",
        permissionProfile: "read-only",
      };
    const first = await command(`/sessions/${id}/turns`, payload, key);
    expect(first.status()).toBe(202);
    const firstBody = await first.json();
    expect(
      await (await command(`/sessions/${id}/turns`, payload, key)).json(),
    ).toEqual(firstBody);
    expect(
      (
        await command(
          `/sessions/${id}/turns`,
          { ...payload, text: "different" },
          key,
        )
      ).status(),
    ).toBe(409);
    await page.close();
    api.kill("SIGTERM");
    await new Promise((r) => api.once("exit", r));
    api = start("apps/api/src/main.ts");
    await expect
      .poll(
        async () => {
          try {
            return (await snapshot()).operations.find(
              (o: any) => o.id === firstBody.operation.id,
            ).state;
          } catch {
            return "unavailable";
          }
        },
        { timeout: 30000 },
      )
      .toBe("succeeded");
    const reopened = await context.newPage();
    await reopened.goto(origin + "/?conversation=" + id);
    await expect(reopened.locator("body")).toContainText("persisted work");
    const approvalOp = await (
      await command(`/sessions/${id}/turns`, { ...payload, text: "[approval]" })
    ).json();
    await expect
      .poll(
        async () =>
          (await snapshot()).approvals.filter(
            (a: any) => a.operationId === approvalOp.operation.id,
          ).length,
        { timeout: 30000 },
      )
      .toBe(1);
    const approval = (await snapshot()).approvals.find(
      (a: any) => a.operationId === approvalOp.operation.id,
    );
    await reopened.screenshot({
      path: path.join(artifacts, "approval-desktop.png"),
      fullPage: true,
    });
    const answers = await Promise.all([
      command(`/approvals/${approval.id}/answer`, {
        generation: approval.generation,
        decision: "accept",
      }),
      command(`/approvals/${approval.id}/answer`, {
        generation: approval.generation,
        decision: "accept",
      }),
    ]);
    expect(answers.map((a) => a.status()).sort()).toEqual([202, 409]);
    expect(
      (
        await command("/projects", {
          name: "Escape",
          rootId,
          path: "../escape",
          create: true,
        })
      ).status(),
    ).toBe(403);
    await expect
      .poll(
        async () =>
          (await snapshot()).operations.find(
            (o: any) => o.id === approvalOp.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    const delayed = await (
      await command(`/sessions/${id}/turns`, {
        ...payload,
        text: "[delay] [background] cancel me",
      })
    ).json();
    await expect
      .poll(
        async () =>
          (await snapshot()).operations.find(
            (o: any) => o.id === delayed.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("running");
    expect(
      (await command("/security/runtime-credentials/remove", {})).status(),
    ).toBe(409);
    expect(
      (await command(`/turns/${delayed.operation.id}/cancel`, {})).status(),
    ).toBe(202);
    await expect
      .poll(
        async () =>
          (await snapshot()).operations.find(
            (o: any) => o.id === delayed.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("interrupted");
    expect(
      (await command(`/turns/${delayed.operation.id}/cancel`, {})).status(),
    ).toBe(409);
    await expect
      .poll(async () => (await snapshot()).processes.status, { timeout: 30000 })
      .toBe("known");
    await expect(
      reopened.getByRole("list", {
        name: "Processes observed after interruption",
      }),
    ).toContainText("PID 42: sleep");
    const hostile = await (
      await command(`/sessions/${id}/turns`, { ...payload, text: "[hostile]" })
    ).json();
    await expect
      .poll(
        async () =>
          (await snapshot()).operations.find(
            (o: any) => o.id === hostile.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    await expect(reopened.locator("body")).toContainText(
      "<script>window.compromised=true</script>",
    );
    expect(
      await reopened.evaluate(() => Reflect.get(window, "compromised")),
    ).toBeUndefined();
    const oversized = await command(`/sessions/${id}/turns`, {
      ...payload,
      text: "x".repeat(32769),
    });
    expect(oversized.status()).toBe(400);
    const stale = await command(`/approvals/${approval.id}/answer`, {
      generation: approval.generation - 1,
      decision: "accept",
    });
    expect(stale.status()).toBe(409);
    // Separate regression scenarios explicitly acknowledge prior unknown effects through
    // the owner recovery API; no database lease bypass is used.
    const releasePriorWorkspace = async () => {
      await expect
        .poll(
          async () => {
            const projectId = sessions.sessions[0].projectId;
            const workspaces = (
              await (
                await context.request.get(
                  origin + `/api/v1/projects/${projectId}/workspaces`,
                )
              ).json()
            ).workspaces;
            const held = workspaces.find(
              (w: any) => w.kind === "local" && w.writerSessionId,
            );
            if (!held) return true;
            const prior = await (
              await context.request.get(
                origin + `/api/v1/sessions/${held.writerSessionId}/snapshot`,
              )
            ).json();
            if (
              prior.operations.some((o: any) =>
                [
                  "dispatching",
                  "running",
                  "waiting_approval",
                  "waiting_input",
                ].includes(o.state),
              )
            )
              return false;
            const release = await command(`/workspaces/${held.id}/release`, {
              acknowledgeUnknownEffects: true,
              expectedSessionId: held.writerSessionId,
              expectedGeneration: held.writerGeneration,
            });
            expect([200, 409]).toContain(release.status());
            return false;
          },
          { timeout: 30000 },
        )
        .toBe(true);
    };
    const newSession = async () => {
      await releasePriorWorkspace();
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
      const response = await command("/sessions", {
        projectId: sessions.sessions[0].projectId,
        model: "fixture",
        effort: "medium",
        permissionProfile: "read-only",
      });
      expect(response.status()).toBe(200);
      return (await response.json()).session.id as string;
    };
    const getSnapshot = async (sessionId: string) =>
      (
        await context.request.get(
          origin + `/api/v1/sessions/${sessionId}/snapshot`,
        )
      ).json();
    const inputSession = await newSession();
    const input = await (
      await command(`/sessions/${inputSession}/turns`, {
        ...payload,
        text: "[input]",
      })
    ).json();
    await expect
      .poll(async () => (await getSnapshot(inputSession)).approvals.length, {
        timeout: 30000,
      })
      .toBe(1);
    const inputApproval = (await getSnapshot(inputSession)).approvals[0];
    expect(
      (
        await command(`/approvals/${inputApproval.id}/answer`, {
          generation: inputApproval.generation,
          decision: "accept",
        })
      ).status(),
    ).toBe(400);
    await reopened.goto(origin + "/?conversation=" + inputSession);
    await reopened
      .getByRole("button", { name: "Decline", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await getSnapshot(inputSession)).operations.find(
            (o: any) => o.id === input.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("interrupted");
    const beforeCredentialChange = (await snapshot()).operations[0];
    const replacementIntent = `${Date.now()}:${randomUUID()}`;
    await expect
      .poll(
        async () =>
          (
            await command(
              "/security/runtime-credentials",
              { apiKey: syntheticKey + "replacement" },
              replacementIntent,
            )
          ).status(),
        { timeout: 30000 },
      )
      .toBe(200);
    expect(
      (await snapshot()).operations.find(
        (o: any) => o.id === beforeCredentialChange.id,
      ).state,
    ).toBe(beforeCredentialChange.state);
    const testDb = new pg.Pool({ connectionString: env.DATABASE_URL });
    try {
      await authorityExpiry(
        testDb,
        {
          HARBOR_OIDC_ISSUER: env.HARBOR_OIDC_ISSUER,
          HARBOR_OWNER_SUBJECT: env.HARBOR_OWNER_SUBJECT,
          HARBOR_IDLE_SECONDS: 300,
        },
        sessions.sessions[0].projectId,
      );
      rotationBearer = await p002({
        page: reopened,
        context,
        origin,
        csrf: me.csrfToken,
        db: testDb,
        projectId: sessions.sessions[0].projectId,
        logs: () => diagnosticText,
        artifacts,
        pauseSupervisor: () => {
          supervisor.kill("SIGSTOP");
        },
        resumeSupervisor: () => {
          supervisor.kill("SIGCONT");
        },
      });
      const interruptCrashSession = await newSession();
      const interruptCrash = await (
        await command(`/sessions/${interruptCrashSession}/turns`, {
          ...payload,
          text: "[interrupt-crash]",
        })
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(interruptCrashSession)).operations.find(
              (o: any) => o.id === interruptCrash.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("running");
      const afterInterruptCrash = await (
        await command(`/sessions/${interruptCrashSession}/turns`, payload)
      ).json();
      await testDb.query(
        "CREATE FUNCTION test_fail_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='cancel' AND NEW.state='failed' THEN RAISE EXCEPTION 'injected cancel settlement commit failure'; END IF; RETURN NEW; END $$",
      );
      await testDb.query(
        "CREATE CONSTRAINT TRIGGER test_fail_cancel AFTER UPDATE ON operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_fail_cancel()",
      );
      const crashCancel = await (
        await command(`/turns/${interruptCrash.operation.id}/cancel`, {})
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(interruptCrashSession)).operations.find(
              (o: any) => o.id === interruptCrash.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("uncertain");
      expect(
        (await getSnapshot(interruptCrashSession)).operations.find(
          (o: any) => o.id === crashCancel.operation.id,
        ).state,
      ).toBe("dispatching");
      await testDb.query("DROP TRIGGER test_fail_cancel ON operations");
      await testDb.query("DROP FUNCTION test_fail_cancel()");
      await expect
        .poll(
          async () =>
            (await getSnapshot(interruptCrashSession)).operations.find(
              (o: any) => o.id === crashCancel.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("failed");
      const crashSnapshot = await getSnapshot(interruptCrashSession);
      expect(
        crashSnapshot.operations.find(
          (o: any) => o.id === interruptCrash.operation.id,
        ).state,
      ).toBe("uncertain");
      expect(
        crashSnapshot.operations.find(
          (o: any) => o.id === afterInterruptCrash.operation.id,
        ).state,
      ).toBe("queued");
      expect(
        crashSnapshot.operations.some(
          (o: any) => o.kind === "cancel" && o.state === "dispatching",
        ),
      ).toBe(false);

      const ownerContext = async () => {
        const isolated = await browser!.newContext({ ignoreHTTPSErrors: true });
        const viewer = await isolated.newPage();
        await viewer.goto(origin + "/auth/login");
        await viewer
          .getByRole("button", { name: "Sign in as owner", exact: true })
          .click();
        const identity = await (
          await isolated.request.get(origin + "/api/v1/me")
        ).json();
        return {
          isolated,
          viewer,
          post: (route: string, data: unknown) =>
            isolated.request.post(origin + "/api/v1" + route, {
              data,
              headers: {
                Origin: origin,
                "X-CSRF-Token": identity.csrfToken,
                "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
              },
            }),
        };
      };
      const expiring = await ownerContext();
      const expiryCookie = (await expiring.isolated.cookies()).find(
        (cookie) => cookie.name === "__Host-harbor",
      )!;
      await testDb.query(
        "UPDATE browser_sessions SET expires_at=now()-interval '1 second' WHERE hash=$1",
        [createHash("sha256").update(expiryCookie.value).digest("hex")],
      );
      for (const route of ["/api/v1/me", `/api/v1/sessions/${id}/events`])
        expect(
          (await expiring.isolated.request.get(origin + route)).status(),
        ).toBe(401);
      await expiring.isolated.close();
      const logoutSession = await newSession(),
        runningOwner = await ownerContext();
      const continueTurn = await (
        await runningOwner.post(`/sessions/${logoutSession}/turns`, {
          ...payload,
          text: "[delay] survives logout",
        })
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(logoutSession)).operations.find(
              (o: any) => o.id === continueTurn.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("running");
      expect((await runningOwner.post("/security/logout", {})).status()).toBe(
        200,
      );
      expect(
        (
          await runningOwner.isolated.request.get(origin + "/api/v1/me")
        ).status(),
      ).toBe(401);
      await expect
        .poll(
          async () =>
            (await getSnapshot(logoutSession)).operations.find(
              (o: any) => o.id === continueTurn.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("succeeded");
      await runningOwner.isolated.close();
      const queueExpirySession = await newSession(),
        queuedOwner = await ownerContext();
      const blocker = await (
        await command(`/sessions/${queueExpirySession}/turns`, {
          ...payload,
          text: "[delay]",
        })
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(queueExpirySession)).operations.find(
              (o: any) => o.id === blocker.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("running");
      const expiryQueued = await (
        await queuedOwner.post(`/sessions/${queueExpirySession}/turns`, payload)
      ).json();
      const queuedCookie = (await queuedOwner.isolated.cookies()).find(
        (cookie) => cookie.name === "__Host-harbor",
      )!;
      await testDb.query(
        "UPDATE browser_sessions SET expires_at=now()-interval '1 second' WHERE hash=$1",
        [createHash("sha256").update(queuedCookie.value).digest("hex")],
      );
      await expect
        .poll(
          async () =>
            (await getSnapshot(queueExpirySession)).operations.find(
              (o: any) => o.id === expiryQueued.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("failed");
      await queuedOwner.isolated.close();
      const offlineSession = await newSession();
      await command(`/sessions/${offlineSession}/turns`, {
        ...payload,
        text: "[approval]",
      });
      await expect
        .poll(
          async () => (await getSnapshot(offlineSession)).approvals.length,
          { timeout: 30000 },
        )
        .toBe(1);
      await testDb.query(
        "UPDATE approvals SET deadline=now()-interval '1 second' WHERE session_id=$1",
        [offlineSession],
      );
      await expect
        .poll(
          async () => (await getSnapshot(offlineSession)).approvals[0].state,
          { timeout: 30000 },
        )
        .toBe("expired");
      await expect
        .poll(
          async () =>
            (await getSnapshot(offlineSession)).messages.some((m: any) =>
              m.text.includes("Approval declined"),
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      const retentionSession = await newSession();
      const retentionTime = Date.now(),
        futureKey = `${retentionTime + 240000}:${randomUUID()}`;
      const retained = await (
        await command(`/sessions/${retentionSession}/turns`, payload, futureKey)
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(retentionSession)).operations.find(
              (o: any) => o.id === retained.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("succeeded");
      await maintain(testDb, new Date(retentionTime + 86400000 + 60000));
      expect(
        await (
          await command(
            `/sessions/${retentionSession}/turns`,
            payload,
            futureKey,
          )
        ).json(),
      ).toEqual(retained);
      await maintain(testDb, new Date(retentionTime + 86400000 + 300001));
      expect(
        (await testDb.query("SELECT 1 FROM intents WHERE key=$1", [futureKey]))
          .rowCount,
      ).toBe(0);
      expect(() =>
        checkKey(futureKey, retentionTime + 86400000 + 300001),
      ).toThrow();
      await reopened.goto(origin + "/?conversation=" + retentionSession);
      await expect(reopened.getByLabel("Message Codex")).toBeVisible();
      const duringGap = await (
        await command(`/sessions/${retentionSession}/turns`, {
          ...payload,
          text: "[delay] replay gap",
        })
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(retentionSession)).operations.find(
              (o: any) => o.id === duringGap.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("running");
      api.kill("SIGTERM");
      await new Promise((r) => api.once("exit", r));
      await expect
        .poll(
          async () =>
            (
              await testDb.query("SELECT state FROM operations WHERE id=$1", [
                duringGap.operation.id,
              ])
            ).rows[0].state,
          { timeout: 30000 },
        )
        .toBe("succeeded");
      await testDb.query(
        "UPDATE events SET created_at=now()-interval '8 days' WHERE session_id=$1",
        [retentionSession],
      );
      await maintain(testDb);
      api = start("apps/api/src/main.ts");
      await expect
        .poll(
          async () => {
            try {
              return (
                await context.request.get(origin + "/api/v1/me")
              ).status();
            } catch {
              return 0;
            }
          },
          { timeout: 30000 },
        )
        .toBe(200);
      await expect(reopened.locator("body")).toContainText("replay gap", {
        timeout: 30000,
      });
      const afterGap = await (
        await command(`/sessions/${retentionSession}/turns`, {
          ...payload,
          text: "after retained replay gap",
        })
      ).json();
      await expect(reopened.locator("body")).toContainText(
        "Fixture response: after retained replay gap",
        { timeout: 30000 },
      );
      expect(
        (await getSnapshot(retentionSession)).operations.find(
          (o: any) => o.id === afterGap.operation.id,
        ).state,
      ).toBe("succeeded");
      const persisted = await testDb.query(
        "SELECT row_to_json(i)::text AS value FROM intents i UNION ALL SELECT row_to_json(e)::text FROM events e UNION ALL SELECT row_to_json(o)::text FROM operations o UNION ALL SELECT row_to_json(c)::text FROM runtime_credentials c",
      );
      expect(JSON.stringify(persisted.rows)).not.toContain(syntheticKey);
      assertResponse(
        "/sessions/{id}/snapshot",
        "get",
        200,
        await getSnapshot(retentionSession),
      );
      await testDb.query(
        "CREATE TABLE test_commit_faults(id uuid PRIMARY KEY)",
      );
      await testDb.query(
        "CREATE FUNCTION test_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='operation.succeeded' AND EXISTS(SELECT 1 FROM test_commit_faults WHERE id::text=NEW.data->>'operationId') THEN RAISE EXCEPTION 'injected deferred commit failure'; END IF; RETURN NEW; END $$",
      );
      await testDb.query(
        "CREATE CONSTRAINT TRIGGER test_fail_completion AFTER INSERT ON events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_fail_completion()",
      );
      const commitSession = await newSession();
      const prior = await (
        await command(`/sessions/${commitSession}/turns`, payload)
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(commitSession)).operations.find(
              (o: any) => o.id === prior.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("succeeded");
      const failing = await (
        await command(`/sessions/${commitSession}/turns`, {
          ...payload,
          text: "[delay] commit fault",
        })
      ).json();
      await testDb.query("INSERT INTO test_commit_faults(id) VALUES($1)", [
        failing.operation.id,
      ]);
      await expect
        .poll(
          async () =>
            (await getSnapshot(commitSession)).operations.find(
              (o: any) => o.id === failing.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("uncertain");
      expect(
        (await getSnapshot(commitSession)).operations.find(
          (o: any) => o.id === prior.operation.id,
        ).state,
      ).toBe("succeeded");
      await testDb.query("DROP TRIGGER test_fail_completion ON events");
      await testDb.query("DROP FUNCTION test_fail_completion()");
      await testDb.query("DROP TABLE test_commit_faults");
    } finally {
      await testDb.end();
    }
    const switching = await newSession();
    const beforeSwitch = await (
      await command(`/sessions/${switching}/turns`, payload)
    ).json();
    await expect
      .poll(
        async () =>
          (await getSnapshot(switching)).operations.find(
            (o: any) => o.id === beforeSwitch.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    const switched = await (
      await command(`/sessions/${switching}/turns`, {
        ...payload,
        permissionProfile: "workspace-write",
      })
    ).json();
    await expect
      .poll(
        async () =>
          (await getSnapshot(switching)).operations.find(
            (o: any) => o.id === switched.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    expect(
      (await getSnapshot(switching)).operations.find(
        (o: any) => o.id === beforeSwitch.operation.id,
      ).state,
    ).toBe("succeeded");
    const inputFlood = await newSession();
    await command(`/sessions/${inputFlood}/turns`, {
      ...payload,
      text: "[input-flood]",
    });
    await expect
      .poll(async () => (await getSnapshot(inputFlood)).session.state, {
        timeout: 30000,
      })
      .toBe("uncertain");
    expect(
      (await getSnapshot(inputFlood)).approvals.filter((a: any) =>
        ["pending", "answering"].includes(a.state),
      ),
    ).toHaveLength(0);
    const floodSession = await newSession();
    await command(`/sessions/${floodSession}/turns`, {
      ...payload,
      text: "[flood]",
    });
    await expect
      .poll(async () => (await getSnapshot(floodSession)).session.state, {
        timeout: 30000,
      })
      .toBe("uncertain");
    expect(
      (await command(`/sessions/${floodSession}/turns`, payload)).status(),
    ).toBe(409);
    const stuckSession = await newSession();
    const stuck = await (
      await command(`/sessions/${stuckSession}/turns`, {
        ...payload,
        text: "[timeout]",
      })
    ).json();
    await expect
      .poll(
        async () =>
          (await getSnapshot(stuckSession)).operations.find(
            (o: any) => o.id === stuck.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("dispatching");
    const queuedB = await (
      await command(`/sessions/${stuckSession}/turns`, payload)
    ).json();
    const queuedC = await (
      await command(`/sessions/${stuckSession}/turns`, payload)
    ).json();
    supervisor.kill("SIGKILL");
    await new Promise((r) => supervisor.once("exit", r));
    supervisor = start("apps/supervisor/src/main.ts");
    await expect
      .poll(async () => (await getSnapshot(stuckSession)).session.state, {
        timeout: 30000,
      })
      .toBe("uncertain");
    await command(`/turns/${queuedB.operation.id}/cancel`, {});
    await expect
      .poll(
        async () =>
          (await getSnapshot(stuckSession)).operations.find(
            (o: any) => o.id === queuedB.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("interrupted");
    expect((await getSnapshot(stuckSession)).session.state).toBe("uncertain");
    expect(
      (await getSnapshot(stuckSession)).operations.find(
        (o: any) => o.id === queuedC.operation.id,
      ).state,
    ).toBe("queued");
    expect(
      (await command(`/sessions/${stuckSession}/turns`, payload)).status(),
    ).toBe(409);
    await releasePriorWorkspace();
    const crash = await (
      await command(`/sessions/${id}/turns`, {
        ...payload,
        text: "[crash-before-ack]",
      })
    ).json();
    await expect
      .poll(
        async () =>
          (await snapshot()).operations.find(
            (o: any) => o.id === crash.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("uncertain");
    expect((await command(`/sessions/${id}/turns`, payload)).status()).toBe(
      409,
    );
    const initSession = await newSession();
    supervisor.kill("SIGTERM");
    await new Promise((r) => supervisor.once("exit", r));
    env.HARBOR_FIXTURE_INIT_DELAY_MS = "2000";
    await writeFile(env.HARBOR_FIXTURE_TRACE_FILE, "");
    supervisor = start("apps/supervisor/src/main.ts");
    const revokedContext = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const revokedPage = await revokedContext.newPage();
    await revokedPage.goto(origin + "/auth/login");
    await revokedPage
      .getByRole("button", { name: "Sign in as owner", exact: true })
      .click();
    const revokedMe = await (
      await revokedContext.request.get(origin + "/api/v1/me")
    ).json();
    const revokedCommand = (route: string, data: unknown) =>
      revokedContext.request.post(origin + "/api/v1" + route, {
        data,
        headers: {
          Origin: origin,
          "X-CSRF-Token": revokedMe.csrfToken,
          "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
        },
      });
    const neverSent = await (
      await revokedCommand(`/sessions/${initSession}/turns`, payload)
    ).json();
    await expect
      .poll(
        async () =>
          (await getSnapshot(initSession)).operations.find(
            (o: any) => o.id === neverSent.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("dispatching");
    expect((await revokedCommand("/security/logout", {})).status()).toBe(200);
    await expect
      .poll(
        async () =>
          (await getSnapshot(initSession)).operations.find(
            (o: any) => o.id === neverSent.operation.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("uncertain");
    expect((await readFile(env.HARBOR_FIXTURE_TRACE_FILE, "utf8")).trim()).toBe(
      "",
    );
    await revokedContext.close();
    const removalIntent = `${Date.now()}:${randomUUID()}`;
    await expect
      .poll(
        async () =>
          (
            await command(
              "/security/runtime-credentials/remove",
              {},
              removalIntent,
            )
          ).status(),
        { timeout: 30000 },
      )
      .toBe(200);
    expect(
      (
        await (
          await context.request.get(
            origin + "/api/v1/security/runtime-credentials",
          )
        ).json()
      ).configured,
    ).toBe(false);
    expect((await command("/security/emergency-stop", {})).status()).toBe(200);
    expect((await command("/security/logout", {})).status()).toBe(200);
    expect((await context.request.get(origin + "/api/v1/me")).status()).toBe(
      401,
    );
    const oldOwner = await browser.newContext({ ignoreHTTPSErrors: true }),
      oldOwnerPage = await oldOwner.newPage();
    await oldOwnerPage.goto(origin + "/auth/login");
    await oldOwnerPage
      .getByRole("button", { name: "Sign in as owner", exact: true })
      .click();
    expect((await oldOwner.request.get(origin + "/api/v1/me")).status()).toBe(
      200,
    );
    env.HARBOR_OWNER_SUBJECT = "denied";
    api.kill("SIGTERM");
    await new Promise((r) => api.once("exit", r));
    api = start("apps/api/src/main.ts");
    await expect
      .poll(
        async () => {
          try {
            return (await oldOwner.request.get(origin + "/api/v1/me")).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(401);
    expect(
      (
        await oldOwner.request.get(origin + `/api/v1/sessions/${id}/events`)
      ).status(),
    ).toBe(401);
    const machineAfterRotation = await apiRequest.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: "Bearer " + rotationBearer },
    });
    expect(
      (await machineAfterRotation.get(origin + "/api/v1/projects")).status(),
    ).toBe(401);
    await machineAfterRotation.dispose();
    const newOwner = await browser.newContext({ ignoreHTTPSErrors: true }),
      newOwnerPage = await newOwner.newPage();
    await newOwnerPage.goto(origin + "/auth/login");
    await newOwnerPage
      .getByRole("button", { name: "Sign in as denied identity", exact: true })
      .click();
    expect(
      (await (await newOwner.request.get(origin + "/api/v1/me")).json()).owner
        .subject,
    ).toBe("denied");
    await oldOwner.close();
    await newOwner.close();
    await writeFile(
      path.join(artifacts, "result.json"),
      JSON.stringify(
        {
          instance,
          status: "passed",
          sourceAtStart,
          sourceAtEnd: sourceDigest(),
          runtime: "0.153.4",
          browser: "Chromium1194",
          node: process.version,
          scope:
            "P001/P002 deterministic external-fixture acceptance; live/isolation separate",
        },
        null,
        2,
      ),
    );
    console.log("Secret-free screenshots and result: " + artifacts);
    console.log(
      "P001 deterministic E2E passed: real browser, Caddy, API, PostgreSQL, supervisor and external OIDC/Codex fixtures. Specialist/live gates separate.",
    );
  }
} finally {
  await browser?.close();
  for (const p of children) p.kill("SIGTERM");
  await Promise.all(
    children.map((p) =>
      p.exitCode !== null || p.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            p.once("exit", r);
            setTimeout(() => {
              p.kill("SIGKILL");
              r(undefined);
            }, 5000);
          }),
    ),
  );
  try {
    compose(["down", "--volumes", "--remove-orphans"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
