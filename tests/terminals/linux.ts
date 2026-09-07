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

const api = await request.newContext({ ignoreHTTPSErrors: true });
let pool: pg.Pool | undefined;
const admitted: any[] = [];
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
  let supervisor = start("apps/supervisor/src/main.ts");
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

  const create = async (w: any, profile: string) => {
    const r = await api.post(origin + `/api/v1/workspaces/${w.id}/terminals`, {
      headers: {
        ...headers,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data: { permissionProfile: profile, cols: 80, rows: 24 },
    });
    assert.equal(r.status(), 202, await r.text());
    const t = (await r.json()).terminal;
    admitted.push(t);
    for (let i = 0; i < 300; i++) {
      const fresh = (
        await pool!.query("SELECT * FROM terminals WHERE id=$1", [t.id])
      ).rows[0];
      if (fresh.state === "running") return { ...t, raw: fresh };
      if (
        [
          "failed",
          "uncertain",
          "interrupted",
          "terminated",
          "shell_exited",
        ].includes(fresh.state)
      )
        throw Error(
          "Native terminal admission: " +
            fresh.state +
            "/" +
            fresh.failure_code +
            ":" +
            (
              await pool!.query(
                "SELECT bytes FROM terminal_output WHERE terminal_id=$1 ORDER BY sequence",
                [t.id],
              )
            ).rows
              .map((row) => row.bytes.toString())
              .join("")
              .slice(-2048),
        );
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Native terminal readiness deadline");
  };
  const localTerminal = await create(local, "read-only");
  const derivedTerminal = await create(one, "workspace-write");
  const output = async (t: any) =>
    (
      await pool!.query(
        "SELECT bytes FROM terminal_output WHERE terminal_id=$1 ORDER BY sequence",
        [t.id],
      )
    ).rows
      .map((r) => r.bytes.toString())
      .join("");
  const control = async (t: any) => {
    const current = (
      await (await api.get(origin + `/api/v1/terminals/${t.id}`)).json()
    ).terminal;
    return (
      await command(`/terminals/${t.id}/control`, {
        generation: t.generation,
        expectedEpoch: current.controllerEpoch,
        acknowledgeUncertainInput: true,
      })
    ).control;
  };
  const input = async (t: any, text: string) => {
    const c = await control(t);
    const r = await api.post(origin + `/api/v1/terminals/${t.id}/input`, {
      headers,
      data: {
        version: 1,
        generation: t.generation,
        controllerId: c.controllerId,
        epoch: c.epoch,
        sequence: 1,
        data: Buffer.from(text).toString("base64"),
      },
    });
    assert.equal(r.status(), 200, await r.text());
  };
  const contains = async (t: any, marker: string) => {
    for (let i = 0; i < 200; i++) {
      if ((await output(t)).includes(marker)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error(
      "Missing native terminal marker " +
        marker +
        ": " +
        (await output(t)).slice(-2000),
    );
  };
  const node = (source: string) =>
    `node -e 'eval(Buffer.from("${Buffer.from(source).toString("base64")}","base64").toString())'\n`;
  await input(
    localTerminal,
    node(
      confinementProbe +
        `;assert.equal(fs.existsSync(process.env.CODEX_HOME+'/auth.json'),false);assert.equal(process.env.HARBOR_MODEL_BASE_URL,undefined);assert.throws(()=>fs.writeFileSync('/workspace/read-only-escape','x'));assert.equal(fs.readFileSync('/workspace/tracked.txt','utf8'),'dirty Local remains');console.log('LOCAL_POLICY_OK')`,
    ),
  );
  await contains(localTerminal, "LOCAL_POLICY_OK");
  await contains(
    localTerminal,
    "PASS nonroot/read-only/capabilities/no-new-privileges/cgroup/IPv4/IPv6 isolation",
  );
  const derived = (
    await pool.query("SELECT * FROM workspaces WHERE id=$1", [one.id])
  ).rows[0];
  await exec(
    "cc",
    [
      "-O2",
      "tests/isolation/quota-probe.c",
      "-o",
      join(derived.canonical_path, "quota-probe"),
    ],
    { timeout: 10000 },
  );
  await input(
    derivedTerminal,
    node(
      `const fs=require('fs'),assert=require('assert');assert.equal(fs.readFileSync('/workspace/tracked.txt','utf8'),'committed Local');assert.equal(fs.statSync('/workspace').ino,fs.statSync('/harbor/workspaces/${one.id}').ino);assert.equal(fs.existsSync('/git-common/HEAD'),true);fs.writeFileSync('/workspace/terminal-written.txt','derived only');assert.equal(fs.existsSync(process.env.CODEX_HOME+'/auth.json'),false);console.log('DERIVED_POLICY_OK')`,
    ),
  );
  await contains(derivedTerminal, "DERIVED_POLICY_OK");
  await exec(
    "cc",
    [
      "-O2",
      "tests/terminals/namespace-probe.c",
      "-o",
      join(derived.canonical_path, "namespace-probe"),
    ],
    { timeout: 10000 },
  );
  await input(derivedTerminal, "/workspace/namespace-probe\n");
  await contains(
    derivedTerminal,
    "PASS terminal user/mount namespace and mount denied",
  );
  await input(
    derivedTerminal,
    "/workspace/quota-probe inheritance /workspace\n",
  );
  await contains(
    derivedTerminal,
    "PASS inherited project ID; filesystem quota-escape ioctls denied",
  );
  assert.equal(
    await readFile(
      join(derived.canonical_path, "terminal-written.txt"),
      "utf8",
    ),
    "derived only",
  );
  await assert.rejects(
    stat(join(stored.canonical_path, "terminal-written.txt")),
  );
  for (const t of [localTerminal, derivedTerminal]) {
    const names = (
      await exec("docker", [
        "ps",
        "-aq",
        "--filter",
        `label=org.codex-harbor.instance=${fixture.id}`,
        "--filter",
        `name=^harbor-${fixture.id}-terminal-${t.id}-${t.generation}$`,
      ])
    ).stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    assert.equal(names.length, 1);
    const info = JSON.parse(
      (await exec("docker", ["inspect", names[0]!])).stdout,
    )[0];
    assert.equal(info.HostConfig.NetworkMode, "none");
    assert.equal(info.HostConfig.ReadonlyRootfs, true);
    for (const mount of info.Mounts.filter(
      (m: any) =>
        m.Destination === "/workspace" ||
        m.Destination === "/git-common" ||
        m.Destination.startsWith("/harbor/workspaces/"),
    ))
      assert.equal(mount.RW, t.profile === "workspace-write");
    assert.equal(info.Config.Labels["org.codex-harbor.purpose"], "terminal");
    assert.ok(
      info.Mounts.every((m: any) =>
        [
          "/workspace",
          "/home/runner/.codex",
          "/git-common",
          `/harbor/workspaces/${one.id}`,
        ].includes(m.Destination),
      ),
    );
    assert.equal(
      info.Config.Env.some((value: string) =>
        /^(OPENAI_API_KEY|HARBOR_MODEL_BASE_URL|DATABASE_URL)=/.test(value),
      ),
      false,
    );
  }
  assert.equal(
    (
      await exec("docker", [
        "ps",
        "-aq",
        "--filter",
        `label=org.codex-harbor.instance=${fixture.id}`,
        "--filter",
        "label=org.codex-harbor.owner=egress",
      ])
    ).stdout.trim(),
    "",
  );
  await input(
    derivedTerminal,
    node(
      `const fs=require('fs'),assert=require('assert');const file='/workspace/quota-owned';const fd=fs.openSync(file,'w');let code;try{for(let i=0;i<80;i++)fs.writeSync(fd,Buffer.alloc(1048576,97));}catch(e){code=e.code;}finally{fs.closeSync(fd);fs.unlinkSync(file);}assert.ok(['EDQUOT','ENOSPC'].includes(code));console.log('TERMINAL_QUOTA_OK')`,
    ),
  );
  await contains(derivedTerminal, "TERMINAL_QUOTA_OK");
  await input(derivedTerminal, "sleep 60 >/dev/null 2>&1 & exit 0\n");
  for (let i = 0; i < 150; i++) {
    if (
      (
        await pool.query("SELECT state FROM terminals WHERE id=$1", [
          derivedTerminal.id,
        ])
      ).rows[0].state === "shell_exited"
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    (
      await pool.query("SELECT state,retired FROM terminals WHERE id=$1", [
        derivedTerminal.id,
      ])
    ).rows[0].state,
    "shell_exited",
  );
  assert.equal(
    (
      await pool.query("SELECT writer_owner_id FROM workspaces WHERE id=$1", [
        one.id,
      ])
    ).rows[0].writer_owner_id,
    derivedTerminal.id,
  );
  const terminate = async (t: any) => {
    const r = await api.post(origin + `/api/v1/terminals/${t.id}/terminate`, {
      headers: {
        ...headers,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data: { generation: t.generation },
    });
    assert.equal(r.status(), 202, await r.text());
    for (let i = 0; i < 200; i++) {
      if (
        (await pool!.query("SELECT retired FROM terminals WHERE id=$1", [t.id]))
          .rows[0].retired
      )
        return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Terminal retirement unconfirmed");
  };
  await terminate(derivedTerminal);
  assert.equal(
    (
      await pool.query("SELECT writer_owner_id FROM workspaces WHERE id=$1", [
        one.id,
      ])
    ).rows[0].writer_owner_id,
    null,
  );
  assert.equal(
    (
      await pool.query("SELECT state FROM terminals WHERE id=$1", [
        localTerminal.id,
      ])
    ).rows[0].state,
    "running",
  );
  const localName = `harbor-${fixture.id}-terminal-${localTerminal.id}-${localTerminal.generation}`;
  await exec("docker", ["kill", localName]);
  for (let i = 0; i < 200; i++) {
    if (
      (
        await pool.query("SELECT retired FROM terminals WHERE id=$1", [
          localTerminal.id,
        ])
      ).rows[0].retired
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const dead = (
    await pool.query("SELECT * FROM terminals WHERE id=$1", [localTerminal.id])
  ).rows[0];
  assert.equal(dead.state, "interrupted");
  assert.equal(dead.retired, true);
  assert.equal(Number(dead.generation), Number(localTerminal.generation));
  assert.equal(
    (
      await pool.query("SELECT writer_owner_id FROM workspaces WHERE id=$1", [
        local.id,
      ])
    ).rows[0].writer_owner_id,
    null,
  );
  const crashTerminal = await create(one, "workspace-write");
  supervisor.kill("SIGSTOP");
  await input(crashTerminal, "printf 'NO_%s\\n' REPLAY_AFTER_CRASH\n");
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM terminal_input WHERE terminal_id=$1",
        [crashTerminal.id],
      )
    ).rows[0].state,
    "accepted",
  );
  const stopped = new Promise<void>((resolve) =>
    supervisor.once("exit", () => resolve()),
  );
  supervisor.kill("SIGKILL");
  await stopped;
  supervisor = start("apps/supervisor/src/main.ts");
  for (let i = 0; i < 300; i++) {
    if (
      (
        await pool.query("SELECT retired FROM terminals WHERE id=$1", [
          crashTerminal.id,
        ])
      ).rows[0].retired
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const crash = (
    await pool.query("SELECT * FROM terminals WHERE id=$1", [crashTerminal.id])
  ).rows[0];
  assert.equal(crash.state, "interrupted");
  assert.equal(crash.retired, true);
  assert.equal(crash.input_uncertain, true);
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM terminal_input WHERE terminal_id=$1",
        [crashTerminal.id],
      )
    ).rows[0].state,
    "uncertain",
  );
  assert.equal(
    (await output(crashTerminal)).includes("NO_REPLAY_AFTER_CRASH"),
    false,
  );
  assert.equal(
    (
      await pool.query("SELECT writer_owner_id FROM workspaces WHERE id=$1", [
        one.id,
      ])
    ).rows[0].writer_owner_id,
    null,
  );
  assert.equal(
    (
      await exec("docker", [
        "ps",
        "-aq",
        "--filter",
        `label=org.codex-harbor.instance=${fixture.id}`,
        "--filter",
        "label=org.codex-harbor.purpose=terminal",
      ])
    ).stdout.trim(),
    "",
  );
  passed = true;
} finally {
  const failures: unknown[] = [];
  for (const p of children.reverse()) {
    if (p.exitCode !== null || p.signalCode !== null) continue;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          p.kill("SIGKILL");
          reject(Error("Owned child stop deadline"));
        }, 10000);
        p.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        p.kill("SIGTERM");
      });
    } catch (e) {
      failures.push(e);
    }
  }
  for (const t of admitted)
    try {
      await retireRuntimeIdentity({
        instanceId: fixture.id,
        projectId: t.projectId,
        sessionId: "terminal-" + t.id,
      });
    } catch (e) {
      failures.push(e);
    }
  await api.dispose();
  await pool?.end();
  try {
    compose(["down", "--volumes"]);
  } catch (e) {
    failures.push(e);
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "Owned terminal cleanup unconfirmed; retain manifest",
    );
  await fixture.cleanup();
  if (passed) {
    const sourceAtEnd = sourceDigest();
    assert.deepEqual(sourceAtStart, sourceAtEnd);
    await mkdir(".test-runs", { recursive: true });
    const artifact = `.test-runs/${fixture.id}-terminals-linux.json`;
    await writeFile(
      artifact,
      JSON.stringify(
        {
          status: "passed",
          sourceAtStart,
          sourceAtEnd,
          node: process.version,
          kernel: (await exec("uname", ["-srmo"])).stdout.trim(),
          docker: (
            await exec("docker", ["version", "--format", "{{.Server.Version}}"])
          ).stdout.trim(),
          runnerImage: (
            await exec("docker", [
              "image",
              "inspect",
              "codex-harbor-runner:0.153.4",
              "--format",
              "{{.Id}}",
            ])
          ).stdout.trim(),
          scope:
            "Real pinned no-account PTY through API/supervisor/root broker; Local read-only and Git-derived writable mounts, no network/gateway/credentials, quotas, background retirement and independent terminal ownership; no live account required",
        },
        null,
        2,
      ),
    );
    console.log("Linux terminal evidence " + artifact);
  }
}
