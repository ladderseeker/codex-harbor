import { sourceDigest } from "../../scripts/source-digest.js";
import {
  spawn,
  execFile,
  execFileSync,
  type ChildProcess,
} from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import {
  readFile,
  stat,
  statfs,
  writeFile,
  mkdir,
  chmod,
  rename,
  rmdir,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { request } from "@playwright/test";
import pg from "pg";
import { confinementProbe, gatewayProbe } from "./probes.js";
import { localComposeFiles } from "../../infra/compose.js";
import { xfsFixture } from "./xfs-fixture.js";
import { retireRuntimeIdentity } from "../../infra/runner/authority.js";
import { launchRunner } from "../../infra/runner/launcher.js";
import { CodexAdapter } from "../../packages/codex-adapter/src/index.js";
import {
  validateManagedProject,
  clearManagedCredentials,
  inspectManagedStorage,
} from "../../infra/storage/client.js";
const sourceAtStart = sourceDigest();
let passed = false;
let nativeTerminal: string | undefined;
const exec = promisify(execFile),
  fixture = await xfsFixture(),
  children: ChildProcess[] = [];
const freePort = async () => {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
};
const [dbPort, apiPort, httpsPort, oidcPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
]);
const origin = `https://localhost:${httpsPort}`,
  password = randomBytes(24).toString("hex");
const env = {
  ...fixture.env,
  NODE_ENV: "test",
  HARBOR_FIXTURE_MODE: "private-test",
  HARBOR_INSTANCE_ID: fixture.id,
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
};
Object.assign(process.env, env);
const compose = (args: string[]) =>
  execFileSync("docker", ["compose", ...localComposeFiles(), ...args], {
    env,
    stdio: "pipe",
    timeout: 120000,
  });
const start = (file: string) => {
  const p = spawn(process.execPath, ["--import", "tsx", file], {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errors = "";
  p.stderr?.on("data", (b) => (errors = (errors + b.toString()).slice(-2000)));
  p.on("exit", (code) => {
    if (code)
      console.error(
        file + " failed: " + errors.replaceAll(password, "[redacted]"),
      );
  });
  children.push(p);
  return p;
};
let adapter: CodexAdapter | undefined, second: CodexAdapter | undefined;
const api = await request.newContext({ ignoreHTTPSErrors: true });
let pool: pg.Pool | undefined;
try {
  const unsafeSocketParent = join(fixture.control, "unsafe-socket");
  await mkdir(unsafeSocketParent, { mode: 0o777 });
  await chmod(unsafeSocketParent, 0o777);
  await assert.rejects(
    exec(process.execPath, ["--import", "tsx", "infra/storage/server.ts"], {
      env: {
        ...env,
        HARBOR_STORAGE_SOCKET: join(unsafeSocketParent, "storage.sock"),
      },
      timeout: 5000,
    }),
    "Unsafe storage socket parent must fail admission",
  );
  compose(["up", "-d", "--wait"]);
  start("infra/storage/server.ts");
  let storageReady = false;
  for (let i = 0; i < 100; i++) {
    try {
      storageReady = (await stat(env.HARBOR_STORAGE_SOCKET)).isSocket();
    } catch {}
    if (storageReady) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(storageReady, "Trusted storage IPC did not become ready");
  start("tests/fixtures/oidc/server.ts");
  start("apps/api/src/main.ts");
  for (let i = 0; i < 100; i++) {
    try {
      if ((await api.get(origin + "/api/v1/me")).status() === 401) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await api.get(origin + "/api/v1/me")).status(), 401);
  const login = await api.get(origin + "/auth/login", { maxRedirects: 0 });
  const authorize = new URL(login.headers().location!);
  const choose = `http://127.0.0.1:${oidcPort}/choose?query=${encodeURIComponent(authorize.searchParams.toString())}&subject=owner`;
  const choice = await api.get(choose, { maxRedirects: 0 });
  assert.equal(choice.status(), 302);
  assert.equal(
    (await api.get(choice.headers().location!, { maxRedirects: 0 })).status(),
    302,
  );
  const me = await (await api.get(origin + "/api/v1/me")).json();
  const created = await api.post(origin + "/api/v1/projects", {
    headers: {
      Origin: origin,
      "x-csrf-token": me.csrfToken,
      "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
    },
    data: {
      rootId: fixture.rootId,
      path: "alpha",
      name: "XFS alpha",
      create: true,
    },
  });
  assert.equal(created.status(), 200, await created.text());
  const project = (await created.json()).project;
  pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const stored = (
    await pool.query(
      "SELECT canonical_path,device,inode FROM projects WHERE id=$1",
      [project.id],
    )
  ).rows[0];
  assert.equal((await stat(stored.canonical_path)).mode & 0o777, 0o700);
  assert.equal((await stat(stored.canonical_path)).uid, 10001);
  await exec(
    "gcc",
    [
      "-static",
      "-O2",
      "tests/isolation/quota-probe.c",
      "-o",
      join(stored.canonical_path, "quota-probe"),
    ],
    { timeout: 30000 },
  );
  const sessionId = randomUUID(),
    config = {
      sessionId,
      projectId: project.id,
      workspacePath: stored.canonical_path,
      workspaceDevice: stored.device,
      workspaceInode: stored.inode,
      generation: 1,
      instanceId: fixture.id,
      permissionProfile: "workspace-write" as const,
    };
  const completed = new Map<string, string>();
  const child = await launchRunner(config);
  adapter = new CodexAdapter(child, {
    onEvent(method, params) {
      if (method === "turn/completed") {
        const turn = params.turn as { id: string; status: string };
        completed.set(turn.id, turn.status);
      }
    },
  });
  await adapter.initialize();
  const name = `harbor-${fixture.id}-${sessionId}-1`;
  for (const script of [confinementProbe])
    console.log(
      (
        await exec("docker", ["exec", name, "node", "-e", script], {
          timeout: 30000,
        })
      ).stdout.trim(),
    );
  const listeners = (await exec("ss", ["-ltnH"])).stdout
    .split("\n")
    .filter((line) => line.includes(`:${httpsPort} `));
  assert.equal(listeners.length, 1);
  assert.match(listeners[0]!, /127\.0\.0\.1:/);
  for (const [mode, directory] of [
    ["inheritance", "/workspace"],
    ["bytes", "/workspace"],
    ["inodes", "/workspace"],
    ["inheritance", "/home/runner/.codex"],
    ["bytes", "/home/runner/.codex"],
    ["inodes", "/home/runner/.codex"],
  ])
    console.log(
      (
        await exec(
          "docker",
          ["exec", name, "/workspace/quota-probe", mode!, directory!],
          { timeout: 20000 },
        )
      ).stdout.trim(),
    );
  const filesystem = await statfs(fixture.mount);
  assert.ok(
    filesystem.bavail * filesystem.bsize > 128 * 1024 * 1024,
    "Quota failures must not be global disk exhaustion",
  );
  await exec("docker", ["exec", "-d", name, "sleep", "60"], { timeout: 5000 });
  assert.ok(
    (await adapter.inspectProcesses()).processes.some(
      (p) => p.executable === "sleep",
    ),
  );
  await exec(
    "docker",
    [
      "exec",
      name,
      "node",
      "-e",
      "require('fs').writeFileSync('/home/runner/.codex/native-canary','durable-native-state')",
    ],
    { timeout: 5000 },
  );
  console.log(
    "Before native thread",
    await inspectManagedStorage(fixture.rootId, "alpha/workspace"),
  );
  const { thread } = await adapter.startThread({
    cwd: "/workspace",
    permissionProfile: "workspace-write",
  });
  console.log("Native thread started");
  const begun = await adapter.startTurn(
    thread.id,
    "Reply hello without tools.",
  );
  console.log("Native turn acknowledged");
  await adapter.interruptTurn(thread.id, begun.turn.id).catch(() => undefined);
  for (let i = 0; i < 100 && !completed.has(begun.turn.id); i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.ok(
    ["interrupted", "failed"].includes(completed.get(begun.turn.id) ?? ""),
    "Accountless native turn must reach authoritative terminal state",
  );
  console.log(
    "Accountless native terminal state",
    completed.get(begun.turn.id),
  );
  assert.ok(
    (await adapter.inspectProcesses()).processes.some(
      (p) => p.executable === "sleep",
    ),
    "Background process must remain visible after native terminal state",
  );
  await adapter.closeAndWait();
  assert.equal((await adapter.inspectProcesses()).status, "runtime_gone");
  await exec("sync", ["-f", stored.canonical_path]);
  let usage = await inspectManagedStorage(fixture.rootId, "alpha/workspace");
  for (let i = 0; i < 100 && usage.inodeLimit - usage.usedInodes < 16; i++) {
    await new Promise((r) => setTimeout(r, 100));
    usage = await inspectManagedStorage(fixture.rootId, "alpha/workspace");
  }
  console.log("Native restart storage", usage);

  second = new CodexAdapter(
    await launchRunner({
      ...config,
      generation: 2,
      permissionProfile: "read-only",
    }),
  );
  await second.initialize();
  const next = `harbor-${fixture.id}-${sessionId}-2`;
  assert.equal(
    (
      await exec(
        "docker",
        [
          "exec",
          next,
          "node",
          "-e",
          "process.stdout.write(require('fs').readFileSync('/home/runner/.codex/native-canary','utf8'))",
        ],
        { timeout: 5000 },
      )
    ).stdout,
    "durable-native-state",
  );
  console.log(
    (
      await exec(
        "docker",
        ["exec", next, "/workspace/quota-probe", "readonly", "/workspace"],
        { timeout: 5000 },
      )
    ).stdout.trim(),
  );
  const resumed = await second.resumeThread(thread.id, {
    cwd: "/workspace",
    permissionProfile: "read-only",
  });
  assert.equal(resumed.thread.id, thread.id);
  let gatewayFailure: unknown;
  try {
    console.log(
      (
        await exec("docker", ["exec", next, "node", "-e", gatewayProbe], {
          timeout: 30000,
        })
      ).stdout.trim(),
    );
  } catch (error) {
    gatewayFailure = error;
  }
  await second.closeAndWait();
  const relocated = stored.canonical_path + "-relocated";
  await rename(stored.canonical_path, relocated);
  await mkdir(stored.canonical_path, { mode: 0o700 });
  try {
    await assert.rejects(
      launchRunner({ ...config, generation: 3 }),
      /identity|changed|replaced/i,
    );
  } finally {
    await rmdir(stored.canonical_path);
    await rename(relocated, stored.canonical_path);
  }
  const beforePressure = await inspectManagedStorage(
    fixture.rootId,
    "alpha/workspace",
  );
  await exec("xfs_quota", [
    "-x",
    "-c",
    `limit -p ihard=${beforePressure.usedInodes + 4} ${fixture.ids[0]}`,
    fixture.mount,
  ]);
  await assert.rejects(
    validateManagedProject(fixture.rootId, "alpha/workspace"),
    "Insufficient reserved headroom must refuse execution admission",
  );
  assert.equal(
    (await inspectManagedStorage(fixture.rootId, "alpha/workspace")).status,
    "known",
  );
  await exec("xfs_quota", [
    "-x",
    "-c",
    `limit -p ihard=512 ${fixture.ids[0]}`,
    fixture.mount,
  ]);
  await retireRuntimeIdentity({
    instanceId: fixture.id,
    projectId: project.id,
    sessionId,
  });
  await assert.rejects(launchRunner({ ...config, generation: 2 }), /Stale/);
  const remainingSlot = join(fixture.base, "pool", "slot1");
  await exec("xfs_quota", [
    "-x",
    "-c",
    `project -s -p ${remainingSlot} ${fixture.ids[0]}`,
    fixture.mount,
  ]);
  await assert.rejects(
    validateManagedProject(fixture.rootId, "alpha/workspace"),
  );
  await exec("xfs_quota", [
    "-x",
    "-c",
    `project -s -p ${remainingSlot} ${fixture.ids[1]}`,
    fixture.mount,
  ]);
  const native = join(fixture.base, "projects", "alpha", "native", sessionId);
  await writeFile(join(native, "auth.json"), "synthetic-test-only", {
    mode: 0o600,
  });
  await clearManagedCredentials(fixture.rootId, "alpha/workspace");
  await assert.rejects(readFile(join(native, "auth.json")));
  assert.equal(
    await readFile(join(native, "native-canary"), "utf8"),
    "durable-native-state",
  );
  if (gatewayFailure) throw gatewayFailure;
  console.log(
    "PASS real API allocation → UID10001 writable/read-only runner; XFS hard bytes/inodes; quota-inheritance denial; process inspection; native thread resume; duplicate project-ID denial; credential-cache-only cleanup",
  );
  passed = true;
} finally {
  const failures: unknown[] = [];
  for (const runtime of [adapter, second]) {
    try {
      await runtime?.closeAndWait();
    } catch (error) {
      failures.push(error);
    }
  }
  await pool?.end();
  await api.dispose();
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill("SIGTERM");
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(Error("Owned service shutdown deadline"));
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    compose(["down", "--volumes"]);
  } catch {
    failures.push(Error("Owned Compose teardown unavailable"));
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "Owned cleanup unconfirmed; quota manifest retained for recovery",
    );
  await fixture.cleanup();
  if (passed) {
    const sourceAtEnd = sourceDigest();
    assert.deepEqual(
      sourceAtEnd,
      sourceAtStart,
      "Source changed during Linux isolation lane",
    );
    const versions: Record<string, string> = { node: process.version };
    for (const [key, command, args] of [
      ["kernel", "uname", ["-srmo"]],
      ["docker", "docker", ["version", "--format", "{{.Server.Version}}"]],
      ["compose", "docker", ["compose", "version", "--short"]],
      ["xfs", "xfs_quota", ["-V"]],
      [
        "runnerImage",
        "docker",
        [
          "image",
          "inspect",
          "codex-harbor-runner:0.153.4",
          "--format",
          "{{.Id}}",
        ],
      ],
      [
        "gatewayImage",
        "docker",
        ["image", "inspect", "codex-harbor-egress:1", "--format", "{{.Id}}"],
      ],
    ] as const)
      versions[key] = (
        await exec(command, [...args], { timeout: 5000 })
      ).stdout.trim();
    await mkdir(".test-runs", { recursive: true });
    const artifact = `.test-runs/${fixture.id}-linux.json`;
    await writeFile(
      artifact,
      JSON.stringify(
        {
          status: "passed",
          at: new Date().toISOString(),
          command: "pnpm test:isolation",
          sourceAtStart,
          sourceAtEnd,
          versions,
          nativeTerminal,
          liveAccount: "separate mandatory gate",
        },
        null,
        2,
      ),
    );
    console.log("Linux evidence", artifact);
  }
}
