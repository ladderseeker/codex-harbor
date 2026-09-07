/** Actual managed-XFS schedule preparation; optional dedicated-account full native occurrence. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { request } from "@playwright/test";
import { createPool } from "../../packages/storage/src/index.ts";
import { localComposeFiles } from "../../infra/compose.ts";
import { retireRuntimeIdentity } from "../../infra/runner/authority.ts";
import { xfsFixture } from "../isolation/xfs-fixture.ts";
import { sourceDigest } from "../../scripts/source-digest.ts";
const live = process.argv.includes("--schedules-live");
const key = live ? process.env.HARBOR_TEST_OPENAI_API_KEY : undefined;
if (live && !key)
  throw Error("Dedicated live key required before starting any resource");
const sourceAtStart = sourceDigest();
const fixture = await xfsFixture();
const port = async () => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return value;
};
const [dbPort, apiPort, httpsPort, oidcPort] = await Promise.all([
  port(),
  port(),
  port(),
  port(),
]);
const password = randomBytes(24).toString("hex"),
  origin = `https://localhost:${httpsPort}`;
const env: NodeJS.ProcessEnv = {
  ...fixture.env,
  NODE_ENV: "test",
  HARBOR_INSTANCE_ID: fixture.id,
  HARBOR_FIXTURE_MODE: "private-test",
  HARBOR_DATABASE_PASSWORD: password,
  HARBOR_DATABASE_PORT: String(dbPort),
  HARBOR_API_PORT: String(apiPort),
  HARBOR_HTTPS_PORT: String(httpsPort),
  HARBOR_PORT: String(apiPort),
  HARBOR_ORIGIN: origin,
  DATABASE_URL: `postgres://harbor:${password}@127.0.0.1:${dbPort}/harbor`,
  OIDC_PORT: String(oidcPort),
  HARBOR_OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
  HARBOR_OIDC_CLIENT_ID: fixture.id,
  HARBOR_OWNER_SUBJECT: "owner",
  HARBOR_PERMISSION_CEILING: "workspace-write",
  HARBOR_MODELS: live
    ? (process.env.HARBOR_TEST_CODEX_MODEL ?? "gpt-5.4")
    : "fixture",
  HARBOR_CONTROL_SOCKET: path.join(fixture.control, "supervisor.sock"),
  HARBOR_CREDENTIAL_KEY_FILE: path.join(fixture.control, "key"),
  HARBOR_FIXTURE_STATE_DIR: path.join(fixture.control, "fixture-state"),
};
delete env.HARBOR_TEST_OPENAI_API_KEY;
delete env.HARBOR_SCHEDULE_TEST_CLOCK;
delete env.HARBOR_MANAGED_RELEASE;
Object.assign(process.env, env);
const compose = (args: string[]) =>
  execFileSync("docker", ["compose", ...localComposeFiles(), ...args], {
    env,
    stdio: "pipe",
    timeout: 120000,
  });
const children: ChildProcess[] = [];
const start = (file: string, production = false) => {
  const childEnv = { ...env };
  if (production) delete childEnv.HARBOR_FIXTURE_MODE;
  const child = spawn(process.execPath, ["--import", "tsx", file], {
    env: childEnv,
    stdio: "ignore",
  });
  children.push(child);
  return child;
};
const stop = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 25000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
};
const wait = async <T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 30000,
) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (accept(value)) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw Error("Bounded managed schedule observation deadline exceeded");
};
let api = await request.newContext({ ignoreHTTPSErrors: true });
const db = createPool(env.DATABASE_URL!);
let passed = false,
  cleanupConfirmed = false,
  modelRequests = 0;
try {
  await writeFile(env.HARBOR_CREDENTIAL_KEY_FILE!, randomBytes(32), {
    mode: 0o600,
  });
  await mkdir(env.HARBOR_FIXTURE_STATE_DIR!, { mode: 0o700 });
  compose(["up", "-d", "--wait"]);
  start("infra/storage/server.ts");
  await wait(
    async () => stat(env.HARBOR_STORAGE_SOCKET!),
    (value) => value.isSocket(),
  );
  start("tests/fixtures/oidc/server.ts");
  start("apps/api/src/main.ts");
  const supervisor = start("apps/supervisor/src/main.ts", live);
  await wait(
    async () => (await api.get(origin + "/api/v1/me")).status(),
    (status) => status === 401,
  );
  const login = async () => {
    const first = await api.get(origin + "/auth/login", { maxRedirects: 0 });
    const auth = new URL(first.headers().location!);
    const chosen = await api.get(
      `http://127.0.0.1:${oidcPort}/choose?query=${encodeURIComponent(auth.searchParams.toString())}&subject=owner`,
      { maxRedirects: 0 },
    );
    assert.equal(chosen.status(), 302);
    assert.equal(
      (await api.get(chosen.headers().location!, { maxRedirects: 0 })).status(),
      302,
    );
    return (await api.get(origin + "/api/v1/me")).json();
  };
  let me = await login();
  const post = async (route: string, data: unknown) => {
    const response = await api.post(origin + "/api/v1" + route, {
      headers: {
        Origin: origin,
        "X-CSRF-Token": me.csrfToken,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data,
    });
    assert.ok(
      [200, 201, 202].includes(response.status()),
      `Managed schedule API status ${response.status()} code ${((await response.json().catch(() => ({}))) as any).error?.code ?? "none"}`,
    );
    return response.json();
  };
  const project = (
    await post("/projects", {
      name: "Managed scheduled project",
      rootId: fixture.rootId,
      path: "scheduled",
      create: true,
    })
  ).project;
  if (live) await post("/security/runtime-credentials", { apiKey: key });
  const capability = await wait(
    async () => (await api.get(origin + "/api/v1/capabilities")).json(),
    (value) => value.models?.length > 0,
    60000,
  );
  const model = capability.models.find((m: any) => m.id === env.HARBOR_MODELS);
  assert.ok(
    model,
    "Configured dedicated model is not discovered; no fallback model selected",
  );
  const effort = model.efforts.includes("low") ? "low" : model.efforts[0];
  assert.ok(effort);
  const local = (
    await db.query(
      "SELECT * FROM workspaces WHERE project_id=$1 AND kind='local'",
      [project.id],
    )
  ).rows[0];
  const marker = "P008 managed source bytes\n";
  await writeFile(path.join(local.canonical_path, "source.txt"), marker);
  // Use actual wall time, not the private calendar clock; close the authenticated client before due.
  const instant = new Date(
    Math.ceil((Date.now() + 15000) / 60000) * 60000,
  ).toISOString();
  const schedule = await post("/schedules", {
    title: "Managed unattended occurrence",
    projectId: project.id,
    prompt: live
      ? "Reply exactly HARBOR_SCHEDULE_LIVE_OK. Do not use tools."
      : "P008 managed fixture occurrence",
    config: {
      rule: { kind: "once", local: instant.slice(0, 16), timezone: "UTC" },
      workspaceMode: "standalone",
      sourceWorkspaceId: local.id,
      sourcePolicy: "snapshot",
      model: model.id,
      effort,
      permissionProfile: "read-only",
    },
    grantDays: 1,
  });
  await api.dispose();
  const occurrence = await wait(
    async () =>
      (
        await db.query(
          "SELECT * FROM schedule_occurrences WHERE schedule_id=$1 AND kind='recurring'",
          [schedule.id],
        )
      ).rows[0],
    (value) => value?.state === "succeeded",
    180000,
  );
  const workspace = (
    await db.query("SELECT * FROM workspaces WHERE id=$1", [
      occurrence.workspace_id,
    ])
  ).rows[0];
  assert.notEqual(workspace.id, local.id);
  assert.equal(workspace.kind, "copy");
  assert.equal(workspace.state, "ready");
  assert.equal(
    await readFile(path.join(workspace.canonical_path, "source.txt"), "utf8"),
    marker,
  );
  assert.equal((await stat(workspace.canonical_path)).uid, 10001);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM operations WHERE id=$1 AND kind='turn'",
          [occurrence.turn_id],
        )
      ).rows[0].count,
    ),
    1,
  );
  modelRequests = live ? 1 : 0;
  api = await request.newContext({ ignoreHTTPSErrors: true });
  me = await login();
  const history = await (
    await api.get(origin + `/api/v1/schedules/${schedule.id}/runs`)
  ).json();
  assert.equal(history.occurrences[0].state, "succeeded");
  const snapshot = await (
    await api.get(origin + `/api/v1/sessions/${occurrence.session_id}/snapshot`)
  ).json();
  if (live)
    assert.ok(
      snapshot.messages.some(
        (m: any) =>
          m.role === "assistant" && m.text.includes("HARBOR_SCHEDULE_LIVE_OK"),
      ),
    );
  await stop(supervisor);
  passed = true;
} catch (error) {
  // Only lifecycle state/codes and child exit status; never credentials, prompts,
  // command bodies, private paths, or raw process output.
  const diagnostic = await db
    .query(
      `SELECT
    (SELECT jsonb_agg(jsonb_build_object('state',state,'reason',reason)) FROM schedules) AS schedules,
    (SELECT jsonb_agg(jsonb_build_object('state',state,'reason',reason)) FROM schedule_occurrences) AS occurrences,
    (SELECT jsonb_agg(jsonb_build_object('state',state,'failureCode',failure_code)) FROM workspace_storage_operations) AS storage,
    (SELECT jsonb_agg(jsonb_build_object('state',state,'failureCode',failure_code)) FROM workspaces) AS workspaces,
    (SELECT jsonb_agg(jsonb_build_object('kind',kind,'state',state)) FROM operations) AS operations
  `,
    )
    .then((result) => result.rows[0])
    .catch(() => ({ database: "unavailable" }));
  console.error(
    JSON.stringify({
      diagnostic,
      children: children.map((child) => ({
        exitCode: child.exitCode,
        signal: child.signalCode,
      })),
    }),
  );
  throw error;
} finally {
  for (const child of children.toReversed()) await stop(child);
  if (live) {
    const identities = (
      await db.query(
        "SELECT id,project_id FROM sessions UNION ALL SELECT b.runtime_id,p.id FROM runtime_bootstrap b CROSS JOIN LATERAL (SELECT id FROM projects ORDER BY created_at LIMIT 1) p",
      )
    ).rows;
    for (const identity of identities)
      await retireRuntimeIdentity({
        instanceId: fixture.id,
        projectId: identity.project_id,
        sessionId: identity.id,
      });
  }
  cleanupConfirmed = true;
  await api.dispose();
  await db.end();
  compose(["down", "--volumes"]);
  if (cleanupConfirmed) await fixture.cleanup();
  if (passed) {
    const sourceAtEnd = sourceDigest();
    assert.deepEqual(sourceAtEnd, sourceAtStart);
    await mkdir(".test-runs", { recursive: true });
    const file = `.test-runs/${fixture.id}-schedules-${live ? "live" : "managed"}.json`;
    await writeFile(
      file,
      JSON.stringify(
        {
          status: "passed",
          sourceAtStart,
          sourceAtEnd,
          node: process.version,
          modelRequests,
          cleanupConfirmed,
          scope: live
            ? "P008-07 real pinned confined Codex scheduled turn; real API/PG/supervisor/managed XFS; external OIDC fixture; no browser open"
            : "P008 actual managed XFS source-copy schedule through API/PG/supervisor; external OIDC/Codex fixtures; native model/isolation inherited separately",
        },
        null,
        2,
      ),
    );
    console.log("Schedule Linux evidence " + file);
  }
}
