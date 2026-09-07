import { workspaceCommand } from "../../infra/storage/workspace-client.js";
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
  unlink,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { request } from "@playwright/test";
import pg from "pg";
import { confinementProbe, gatewayProbe } from "../isolation/probes.js";
import { localComposeFiles } from "../../infra/compose.js";
import { xfsFixture } from "../isolation/xfs-fixture.js";
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
const start = (file: string, extra: Record<string, string> = {}) => {
  const p = spawn(process.execPath, ["--import", "tsx", file], {
    env: { ...env, ...extra },
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
let immutableFile: string | undefined;
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
  let storage = start("infra/storage/server.ts");
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
  start("apps/supervisor/src/main.ts");
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
  const headers = { Origin: origin, "x-csrf-token": me.csrfToken };
  const command = async (route: string, data: unknown) => {
    const r = await api.post(origin + "/api/v1" + route, {
      headers: {
        ...headers,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data,
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const ready = async (workspace: any) => {
    let current = workspace;
    for (let i = 0; i < 400 && current.state === "creating"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      current = (
        await (
          await api.get(origin + `/api/v1/workspaces/${workspace.id}`)
        ).json()
      ).workspace;
    }
    assert.equal(current.state, "ready");
    return current;
  };
  const local = (
    await (
      await api.get(origin + `/api/v1/projects/${project.id}/workspaces`)
    ).json()
  ).workspaces[0];
  const seed = [
    "run",
    "--rm",
    "--network=none",
    "--user=10001:10001",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--mount",
    `type=bind,source=${stored.canonical_path},target=/source`,
    "--entrypoint",
    "git",
    "codex-harbor-git:2.39.5-p003",
  ];
  await writeFile(
    join(stored.canonical_path, "tracked.txt"),
    "committed Local",
  );
  for (const args of [
    ["init", "/source"],
    ["-C", "/source", "add", "."],
    [
      "-C",
      "/source",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "Fixture",
    ],
  ])
    await exec("docker", [...seed, ...args], { timeout: 20000 });
  await writeFile(
    join(stored.canonical_path, "tracked.txt"),
    "dirty Local remains",
  );
  const one = await ready(
    (
      await command(`/projects/${project.id}/workspaces`, {
        name: "One",
        kind: "worktree",
        sourceWorkspaceId: local.id,
        dirtyPolicy: "exclude",
      })
    ).workspace,
  );
  const two = await ready(
    (
      await command(`/projects/${project.id}/workspaces`, {
        name: "Two",
        kind: "worktree",
        sourceWorkspaceId: local.id,
        dirtyPolicy: "exclude",
      })
    ).workspace,
  );
  assert.equal(one.state, "ready");
  assert.equal(two.state, "ready");
  const rows = (
    await pool.query("SELECT * FROM workspaces WHERE id=ANY($1::uuid[])", [
      [one.id, two.id],
    ])
  ).rows;
  const config = (
    w: any,
    sessionId: string,
    generation: number,
    permissionProfile: "read-only" | "workspace-write" = "workspace-write",
  ) => ({
    sessionId,
    projectId: project.id,
    workspaceId: w.id,
    workspacePath: w.canonical_path,
    workspaceDevice: w.device,
    workspaceInode: w.inode,
    gitCommon: {
      canonical: w.common_path,
      device: w.common_device,
      inode: w.common_inode,
    },
    generation,
    instanceId: fixture.id,
    permissionProfile,
  });
  const w1 = rows.find((w) => w.id === one.id),
    w2 = rows.find((w) => w.id === two.id),
    s1 = randomUUID(),
    s2 = randomUUID();
  const validateCommand = {
    action: "workspaceValidate" as const,
    rootId: fixture.env.HARBOR_PROJECT_ROOTS
      ? JSON.parse(fixture.env.HARBOR_PROJECT_ROOTS)[0].id
      : "",
    workspaceId: w1.id,
    relativePath: w1.relative_path,
    kind: "worktree" as const,
    source: {
      relativePath: w1.relative_path,
      device: w1.device,
      inode: w1.inode,
    },
    identity: {
      canonical: w1.canonical_path,
      device: w1.device,
      inode: w1.inode,
      common: {
        canonical: w1.common_path,
        device: w1.common_device,
        inode: w1.common_inode,
      },
    },
  };
  await workspaceCommand(validateCommand);
  await assert.rejects(
    workspaceCommand({
      ...validateCommand,
      identity: {
        ...validateCommand.identity,
        common: {
          ...validateCommand.identity.common,
          inode: String(BigInt(w1.common_inode) + 1n),
        },
      },
    }),
  );
  const retainedCommon = w1.common_path + ".owned-validation-canary";
  await rename(w1.common_path, retainedCommon);
  try {
    await symlink(retainedCommon, w1.common_path);
    await assert.rejects(workspaceCommand(validateCommand));
  } finally {
    await unlink(w1.common_path);
    await rename(retainedCommon, w1.common_path);
  }
  await workspaceCommand(validateCommand);
  console.log(
    "PASS managed validation rejects wrong common inode and symlink, original identity restored",
  );
  const terminals = new Map<string, string>();
  adapter = new CodexAdapter(await launchRunner(config(w1, s1, 1)), {
    onEvent: (m, p) => {
      if (m === "turn/completed") {
        const t = p.turn as any;
        terminals.set(t.id, t.status);
      }
    },
  });
  second = new CodexAdapter(await launchRunner(config(w2, s2, 1)));
  await Promise.all([adapter.initialize(), second.initialize()]);
  const names = [
    `harbor-${fixture.id}-${s1}-1`,
    `harbor-${fixture.id}-${s2}-1`,
  ];
  for (const [i, name] of names.entries()) {
    const other = i === 0 ? w2 : w1;
    const probe = `const fs=require('fs'),assert=require('assert');assert.equal(process.getuid(),10001);assert.equal(fs.readFileSync('/workspace/tracked.txt','utf8'),'committed Local');assert.equal(fs.existsSync('/harbor/workspaces/${other.id}'),false);assert.equal(fs.existsSync('/var/run/docker.sock'),false);assert.equal(fs.existsSync('${stored.canonical_path}'),false);fs.writeFileSync('/workspace/marker','${i}');assert.equal(fs.readFileSync('/harbor/workspaces/${i === 0 ? w1.id : w2.id}/marker','utf8'),'${i}');fs.writeFileSync('/git-common/common-marker-${i}','owned project');console.log('PASS selected checkout aliases and disjoint mounts')`;
    console.log(
      (
        await exec("docker", ["exec", name, "node", "-e", probe], {
          timeout: 20000,
        })
      ).stdout.trim(),
    );
  }
  assert.equal(await readFile(join(w1.canonical_path, "marker"), "utf8"), "0");
  assert.equal(await readFile(join(w2.canonical_path, "marker"), "utf8"), "1");
  assert.equal(
    await readFile(join(stored.canonical_path, "tracked.txt"), "utf8"),
    "dirty Local remains",
  );
  const thread = await adapter.startThread({ cwd: "/workspace" });
  const begun = await adapter.startTurn(
    thread.thread.id,
    "Reply hello without tools.",
  );
  await adapter
    .interruptTurn(thread.thread.id, begun.turn.id)
    .catch(() => undefined);
  for (let i = 0; i < 100 && !terminals.has(begun.turn.id); i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.ok(
    ["interrupted", "failed"].includes(terminals.get(begun.turn.id) ?? ""),
  );
  await adapter.closeAndWait();
  await second.closeAndWait();
  adapter = undefined;
  second = undefined;
  adapter = new CodexAdapter(
    await launchRunner(config(w1, s1, 2, "read-only")),
  );
  await adapter.initialize();
  assert.equal(
    (await adapter.resumeThread(thread.thread.id, { cwd: "/workspace" })).thread
      .id,
    thread.thread.id,
  );
  console.log(
    (
      await exec(
        "docker",
        [
          "exec",
          `harbor-${fixture.id}-${s1}-2`,
          "node",
          "-e",
          "const fs=require('fs'),a=require('assert');for(const p of ['/workspace/denied','/git-common/denied'])a.throws(()=>fs.writeFileSync(p,'x'));console.log('PASS read-only checkout and common metadata')",
        ],
        { timeout: 20000 },
      )
    ).stdout.trim(),
  );
  await adapter.closeAndWait();
  adapter = undefined;
  await rename(w1.canonical_path, w1.canonical_path + "-moved");
  await mkdir(w1.canonical_path, { mode: 0o700 });
  await assert.rejects(launchRunner(config(w1, s1, 3)), /identity/i);
  await rmdir(w1.canonical_path);
  await rename(w1.canonical_path + "-moved", w1.canonical_path);
  await exec(
    "gcc",
    [
      "-static",
      "-O2",
      "tests/isolation/quota-probe.c",
      "-o",
      join(w1.canonical_path, "quota-probe"),
    ],
    { timeout: 30000 },
  );
  adapter = new CodexAdapter(await launchRunner(config(w1, s1, 4)));
  await adapter.initialize();
  const quotaName = `harbor-${fixture.id}-${s1}-4`;
  for (const mode of ["inheritance", "bytes", "inodes"])
    console.log(
      (
        await exec(
          "docker",
          ["exec", quotaName, "/workspace/quota-probe", mode, "/workspace"],
          { timeout: 30000 },
        )
      ).stdout.trim(),
    );
  console.log(
    (
      await exec(
        "docker",
        [
          "exec",
          quotaName,
          "/workspace/quota-probe",
          "inheritance",
          "/git-common",
        ],
        { timeout: 30000 },
      )
    ).stdout.trim(),
  );
  await adapter.closeAndWait();
  adapter = undefined;
  const failed = (
    await command(`/projects/${project.id}/workspaces`, {
      name: "Invalid base",
      kind: "worktree",
      sourceWorkspaceId: local.id,
      revision: "0".repeat(40),
      dirtyPolicy: "exclude",
    })
  ).workspace;
  let failedState = "creating";
  for (let i = 0; i < 200 && failedState === "creating"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    failedState = (
      await (await api.get(origin + `/api/v1/workspaces/${failed.id}`)).json()
    ).workspace.state;
  }
  assert.equal(failedState, "failed");
  await assert.rejects(
    stat(join(fixture.base, "projects", "alpha", "workspaces", failed.id)),
  );
  const doomed = await ready(
    (
      await command(`/projects/${project.id}/workspaces`, {
        name: "Interrupted removal",
        kind: "worktree",
        sourceWorkspaceId: local.id,
        dirtyPolicy: "exclude",
      })
    ).workspace,
  );
  const doomedRow = (
    await pool.query("SELECT canonical_path FROM workspaces WHERE id=$1", [
      doomed.id,
    ])
  ).rows[0];
  immutableFile = join(doomedRow.canonical_path, "tracked.txt");
  await exec("chattr", ["+i", immutableFile]);
  const deletion = await api.delete(
    origin + `/api/v1/workspaces/${doomed.id}`,
    {
      headers: {
        ...headers,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data: {},
    },
  );
  assert.equal(deletion.status(), 200, await deletion.text());
  let removal: any;
  for (let i = 0; i < 200; i++) {
    removal = (
      await pool.query(
        "SELECT * FROM workspace_storage_operations WHERE workspace_id=$1 AND action='remove'",
        [doomed.id],
      )
    ).rows[0];
    if (removal) {
      try {
        const receipt = JSON.parse(
          await readFile(
            join(
              env.HARBOR_LAUNCHER_STATE_DIR,
              "workspace-receipts",
              removal.id + ".json",
            ),
            "utf8",
          ),
        );
        if (receipt.state === "removing") {
          try {
            await stat(
              join(
                fixture.base,
                "projects",
                "alpha",
                "git-common",
                "worktrees",
                doomed.id,
              ),
            );
          } catch {
            break;
          }
        }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    JSON.parse(
      await readFile(
        join(
          env.HARBOR_LAUNCHER_STATE_DIR,
          "workspace-receipts",
          removal.id + ".json",
        ),
        "utf8",
      ),
    ).state,
    "removing",
  );
  await assert.rejects(
    stat(
      join(
        fixture.base,
        "projects",
        "alpha",
        "git-common",
        "worktrees",
        doomed.id,
      ),
    ),
  );
  assert.equal(
    (await pool.query("SELECT state FROM workspaces WHERE id=$1", [doomed.id]))
      .rows[0].state,
    "removing",
  );
  // Actual process death after administrative deletion and failed checkout unlink.
  const exited = new Promise((r) => storage.once("exit", r));
  storage.kill("SIGKILL");
  await exited;
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM workspace_storage_operations WHERE id=$1",
        [removal.id],
      )
    ).rows[0].state,
    "dispatching",
  );
  assert.equal(await readFile(immutableFile, "utf8"), "committed Local");
  assert.equal(
    await readFile(join(stored.canonical_path, "tracked.txt"), "utf8"),
    "dirty Local remains",
  );
  await stat(w1.canonical_path);
  await stat(w2.canonical_path);
  const socketInfo = await stat(env.HARBOR_STORAGE_SOCKET);
  assert.ok(socketInfo.isSocket());
  await unlink(env.HARBOR_STORAGE_SOCKET);
  await exec("chattr", ["-i", immutableFile]);
  immutableFile = undefined;
  storage = start("infra/storage/server.ts");
  let removalState = "removing";
  for (let i = 0; i < 300 && removalState === "removing"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    removalState = (
      await pool.query("SELECT state FROM workspaces WHERE id=$1", [doomed.id])
    ).rows[0].state;
  }
  assert.equal(removalState, "removed");
  assert.equal(
    (
      await pool.query(
        "SELECT id,state FROM workspace_storage_operations WHERE workspace_id=$1 AND action='remove'",
        [doomed.id],
      )
    ).rows[0].id,
    removal.id,
  );
  await assert.rejects(stat(doomedRow.canonical_path));
  await stat(w1.canonical_path);
  await stat(w2.canonical_path);
  console.log(
    "PASS actual partial removal, storage SIGKILL/restart, exact receipt reconciliation and neighboring workspace preservation",
  );
  // Inject kernel syncfs EIO only into the owned trusted storage service's Python child.
  const barrierTools = join(fixture.control, "barrier-tools");
  await mkdir(barrierTools, { mode: 0o700 });
  await writeFile(
    join(barrierTools, "fault.c"),
    "#include <errno.h>\nint syncfs(int fd){errno=EIO;return -1;}\n",
  );
  await exec("gcc", [
    "-shared",
    "-fPIC",
    join(barrierTools, "fault.c"),
    "-o",
    join(barrierTools, "fault.so"),
  ]);
  await writeFile(
    join(barrierTools, "python3"),
    `#!/bin/sh\nLD_PRELOAD='${join(barrierTools, "fault.so")}' exec /usr/bin/python3 "$@"\n`,
    { mode: 0o700 },
  );
  const restartStorage = async (extra: Record<string, string> = {}) => {
    const stopped = new Promise((r) => storage.once("exit", r));
    storage.kill("SIGKILL");
    await stopped;
    assert.ok((await stat(env.HARBOR_STORAGE_SOCKET)).isSocket());
    await unlink(env.HARBOR_STORAGE_SOCKET);
    storage = start("infra/storage/server.ts", extra);
    for (let i = 0; i < 100; i++) {
      try {
        if ((await stat(env.HARBOR_STORAGE_SOCKET)).isSocket()) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error("Storage restart deadline");
  };
  await restartStorage({ PATH: barrierTools + ":" + process.env.PATH });
  const awaitingFlush = (
    await command(`/projects/${project.id}/workspaces`, {
      name: "Durability barrier",
      kind: "worktree",
      sourceWorkspaceId: local.id,
      dirtyPolicy: "exclude",
    })
  ).workspace;
  let applied: any, appliedOp: any;
  for (let i = 0; i < 300; i++) {
    appliedOp = (
      await pool.query(
        "SELECT * FROM workspace_storage_operations WHERE workspace_id=$1 AND action='create'",
        [awaitingFlush.id],
      )
    ).rows[0];
    if (appliedOp) {
      try {
        applied = JSON.parse(
          await readFile(
            join(
              env.HARBOR_LAUNCHER_STATE_DIR,
              "workspace-receipts",
              appliedOp.id + ".json",
            ),
            "utf8",
          ),
        );
        if (applied.state === "applied") break;
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(applied?.state, "applied");
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(
    (
      await pool.query("SELECT state FROM workspaces WHERE id=$1", [
        awaitingFlush.id,
      ])
    ).rows[0].state,
    "creating",
  );
  assert.equal(
    JSON.parse(
      await readFile(
        join(
          env.HARBOR_LAUNCHER_STATE_DIR,
          "workspace-receipts",
          appliedOp.id + ".json",
        ),
        "utf8",
      ),
    ).state,
    "applied",
  );
  const appliedIdentity = await stat(applied.result.canonical, {
    bigint: true,
  });
  const appliedFile = join(applied.result.canonical, "tracked.txt"),
    appliedBytes = await readFile(appliedFile);
  await writeFile(appliedFile, "simulated lost or corrupted pre-barrier data");
  await restartStorage();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(
    (
      await pool.query("SELECT state FROM workspaces WHERE id=$1", [
        awaitingFlush.id,
      ])
    ).rows[0].state,
    "creating",
  );
  assert.equal(
    JSON.parse(
      await readFile(
        join(
          env.HARBOR_LAUNCHER_STATE_DIR,
          "workspace-receipts",
          appliedOp.id + ".json",
        ),
        "utf8",
      ),
    ).state,
    "applied",
  );
  assert.equal(
    await readFile(appliedFile, "utf8"),
    "simulated lost or corrupted pre-barrier data",
  );
  await writeFile(appliedFile, appliedBytes);
  await ready(awaitingFlush);
  assert.equal(
    (await stat(applied.result.canonical, { bigint: true })).ino,
    appliedIdentity.ino,
  );
  assert.equal(
    JSON.parse(
      await readFile(
        join(
          env.HARBOR_LAUNCHER_STATE_DIR,
          "workspace-receipts",
          appliedOp.id + ".json",
        ),
        "utf8",
      ),
    ).state,
    "completed",
  );
  console.log(
    "PASS actual XFS syncfs barrier; EIO and applied-content mismatch remain pending; validated replay succeeds without recreating checkout",
  );
  nativeTerminal = "native initialize/resume across workspace-bound generation";
  passed = true;
  console.log(
    "PASS P003 actual Linux managed API worktrees, disjoint concurrent runners, read-only common mount, identity replacement, stable native resume and quota ioctl denial",
  );
} finally {
  const failures: unknown[] = [];
  if (immutableFile)
    try {
      await exec("chattr", ["-i", immutableFile]);
    } catch (error) {
      failures.push(error);
    }
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
      [
        "gitHelperImage",
        "docker",
        [
          "image",
          "inspect",
          "codex-harbor-git:2.39.5-p003",
          "--format",
          "{{.Id}}",
        ],
      ],
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
    const artifact = `.test-runs/${fixture.id}-workspaces-linux.json`;
    await writeFile(
      artifact,
      JSON.stringify(
        {
          status: "passed",
          at: new Date().toISOString(),
          command: "pnpm test:isolation --workspaces",
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
