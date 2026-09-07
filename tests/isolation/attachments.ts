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
import { randomUUID, randomBytes, createHash } from "node:crypto";
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
import { prepareAttachments } from "../../packages/attachments/src/materialize.js";
import { png } from "../fixtures/png.js";
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
  HARBOR_MODELS: "fixture",
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
  // The model catalog is an external capability fixture; API, DB, broker and runner are real.
  await pool.query(
    "INSERT INTO runtime_capabilities(id,data) VALUES(true,$1)",
    [
      {
        data: [
          {
            id: "fixture",
            model: "fixture",
            displayName: "Fixture",
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
            inputModalities: ["text", "image"],
          },
        ],
        account: { authenticated: true, authMode: "apiKey" },
      },
    ],
  );
  const headers = () => ({
    Origin: origin,
    "X-CSRF-Token": me.csrfToken,
    "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
  });
  const command = async (route: string, data: unknown) => {
    const response = await api.post(origin + "/api/v1" + route, {
      headers: headers(),
      data,
    });
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const uploaded = async (title: string) => {
    const { session } = await command("/sessions", {
      projectId: project.id,
      title,
      ...settings,
    });
    const files = [
      { bytes: png(), mediaType: "image/png", name: "synthetic.png" },
      {
        bytes: Buffer.from("HARBOR_SYNTHETIC_TEXT"),
        mediaType: "text/plain",
        name: "../display-only.txt",
      },
    ];
    const ids: string[] = [];
    for (const file of files) {
      const { attachment } = await command(
        `/sessions/${session.id}/attachments`,
        {
          name: file.name,
          mediaType: file.mediaType,
          size: file.bytes.length,
          sha256: createHash("sha256").update(file.bytes).digest("hex"),
        },
      );
      const response = await api.put(
        origin + `/api/v1/attachments/${attachment.id}/content`,
        {
          headers: { ...headers(), "Content-Type": "application/octet-stream" },
          data: file.bytes,
        },
      );
      assert.equal(response.status(), 200, await response.text());
      ids.push(attachment.id);
    }
    const { operation } = await command(`/sessions/${session.id}/turns`, {
      ...settings,
      text: "Inspect the synthetic attachments",
      attachmentIds: ids,
    });
    return { session, operation, ids, files };
  };
  const first = await uploaded("Selected attachment session"),
    other = await uploaded("Other attachment session");
  await pool.query(
    "CREATE FUNCTION reject_attachment_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.device IS NOT NULL THEN RAISE EXCEPTION 'owned publication COMMIT fault'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER reject_attachment_publication AFTER UPDATE ON attachments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_attachment_publication()",
  );
  await assert.rejects(
    prepareAttachments(
      pool,
      first.session.id,
      first.operation.id,
      stored.canonical_path,
      false,
    ),
    /owned publication COMMIT fault/,
  );
  const physical = join(
    stored.canonical_path,
    "..",
    "attachments",
    first.session.id,
    first.ids[0]!,
  );
  const before = await stat(physical, { bigint: true });
  assert.equal(
    (
      await pool.query("SELECT device FROM attachments WHERE id=$1", [
        first.ids[0],
      ])
    ).rows[0].device,
    null,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM session_attachment_storage WHERE session_id=$1",
        [first.session.id],
      )
    ).rows[0].n,
    0,
  );
  await pool.query(
    "DROP TRIGGER reject_attachment_publication ON attachments; DROP FUNCTION reject_attachment_publication()",
  );
  const prepared = await prepareAttachments(
    pool,
    first.session.id,
    first.operation.id,
    stored.canonical_path,
    false,
  );
  const otherPrepared = await prepareAttachments(
    pool,
    other.session.id,
    other.operation.id,
    stored.canonical_path,
    false,
  );
  assert.equal((await stat(physical, { bigint: true })).ino, before.ino);
  assert.ok(prepared.directory && otherPrepared.directory);
  const configuration = {
    sessionId: first.session.id,
    projectId: project.id,
    workspacePath: stored.canonical_path,
    workspaceDevice: stored.device,
    workspaceInode: stored.inode,
    generation: 1,
    instanceId: fixture.id,
    permissionProfile: "workspace-write" as const,
    attachmentDirectory: prepared.directory,
    attachmentProject: prepared.project,
  };
  const completions = new Map<string, string>(),
    messages: string[] = [];
  adapter = new CodexAdapter(await launchRunner(configuration), {
    onEvent(method, params) {
      if (method === "turn/completed") {
        const turn = params.turn as { id: string; status: string };
        completions.set(turn.id, turn.status);
      }
      if (method === "item/agentMessage/delta")
        messages.push(String(params.delta ?? ""));
    },
    onRequest(request) {
      void adapter!
        .respond(request.id, { decision: "decline" })
        .catch(() => adapter!.close());
    },
  });
  await adapter.initialize();
  let nativeModel = "gpt-5.4";
  if (process.env.HARBOR_TEST_LIVE_ATTACHMENTS) {
    const key = process.env.HARBOR_TEST_OPENAI_API_KEY;
    assert.ok(key, "Dedicated live credential missing");
    await adapter.loginWithApiKey(key);
    const models = await adapter.listModels();
    const model = models.data.find(
      (m: any) =>
        m.inputModalities?.includes("image") &&
        m.inputModalities?.includes("text") &&
        (!process.env.HARBOR_TEST_CODEX_MODEL ||
          m.model === process.env.HARBOR_TEST_CODEX_MODEL),
    );
    assert.ok(model, "No supported real image/text model discovered");
    nativeModel = model.model;
  }
  const { thread } = await adapter.startThread({
    cwd: "/workspace",
    model: nativeModel,
    permissionProfile: "workspace-write",
  });
  assert.ok(thread.id);
  if (process.env.HARBOR_TEST_LIVE_ATTACHMENTS) {
    const result = await adapter.startTurn(
      thread.id,
      "Inspect the attached image and read the attached text file. Reply with the image pixel color and the exact text from the file. Do not modify anything.",
      {
        model: nativeModel,
        effort: "low",
        permissionProfile: "workspace-write",
        attachments: prepared.inputs,
      },
    );
    const deadline = Date.now() + 120000;
    while (!completions.has(result.turn.id) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      completions.get(result.turn.id),
      "completed",
      "Bounded real attachment turn must complete",
    );
    const response = messages.join("");
    assert.match(response, /red/i);
    assert.match(response, /HARBOR_SYNTHETIC_TEXT/);
  }
  const container = `harbor-${fixture.id}-${first.session.id}-1`;
  const probe = `const fs=require('fs'),assert=require('assert'),crypto=require('crypto');const entries=${JSON.stringify(first.ids)};assert.deepEqual(fs.readdirSync('/attachments').sort(),entries.sort());for(const id of entries){const bytes=fs.readFileSync('/attachments/'+id);assert.ok(bytes.length);assert.throws(()=>fs.writeFileSync('/attachments/'+id,'tampered'));assert.throws(()=>fs.unlinkSync('/attachments/'+id));}assert.throws(()=>fs.writeFileSync('/attachments/new','x'));assert.equal(fs.existsSync('/attachments/${other.ids[0]}'),false);assert.equal(fs.existsSync('${otherPrepared.directory.canonical}'),false);assert.equal(fs.existsSync('/var/run/docker.sock'),false);console.log('PASS actual nonroot session-only read-only attachment mount');`;
  console.log(
    (
      await exec("docker", ["exec", container, "node", "-e", probe], {
        timeout: 15000,
      })
    ).stdout.trim(),
  );
  await adapter.closeAndWait();
  adapter = undefined;
  const original = await readFile(physical);
  await chmod(physical, 0o644);
  await writeFile(physical, Buffer.alloc(original.length));
  await chmod(physical, 0o444);
  await assert.rejects(
    prepareAttachments(
      pool,
      first.session.id,
      first.operation.id,
      stored.canonical_path,
      false,
    ),
    /identity verification/,
  );
  await chmod(physical, 0o644);
  await writeFile(physical, original);
  await chmod(physical, 0o444);
  await prepareAttachments(
    pool,
    first.session.id,
    first.operation.id,
    stored.canonical_path,
    false,
  );
  const canonical = prepared.directory.canonical,
    moved = canonical + ".owned-moved";
  await rename(canonical, moved);
  await mkdir(canonical, { mode: 0o755 });
  try {
    await assert.rejects(
      prepareAttachments(
        pool,
        first.session.id,
        first.operation.id,
        stored.canonical_path,
        false,
      ),
      /identity verification/,
    );
  } finally {
    await rmdir(canonical);
    await rename(moved, canonical);
  }
  assert.deepEqual(await readFile(physical), original);
  assert.deepEqual(
    await readFile(join(otherPrepared.directory.canonical, other.ids[0]!)),
    png(),
  );
  passed = true;
  console.log(
    "PASS real API upload/PG association/XFS publication, failed COMMIT same-inode recovery, native initialization, content and directory identity fencing",
  );
} finally {
  const failures: unknown[] = [];
  if (adapter) {
    try {
      await adapter.closeAndWait();
    } catch (error) {
      failures.push(error);
    }
  }
  await pool?.end();
  await api.dispose();
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  try {
    compose(["down", "--volumes"]);
  } catch {
    failures.push(Error("Owned Compose teardown unavailable"));
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "Owned cleanup unconfirmed; manifest retained",
    );
  await fixture.cleanup();
  if (passed) {
    const sourceAtEnd = sourceDigest();
    assert.deepEqual(
      sourceAtEnd,
      sourceAtStart,
      "Source changed during Linux attachment lane",
    );
    await mkdir(".test-runs", { recursive: true });
    const artifact = `.test-runs/${fixture.id}-attachments-linux.json`;
    await writeFile(
      artifact,
      JSON.stringify(
        {
          status: "passed",
          command: process.env.HARBOR_TEST_LIVE_ATTACHMENTS
            ? "pnpm test:live --attachments"
            : "pnpm test:isolation --attachments",
          sourceAtStart,
          sourceAtEnd,
          versions: {
            node: process.version,
            kernel: (await exec("uname", ["-srmo"])).stdout.trim(),
            docker: (
              await exec("docker", [
                "version",
                "--format",
                "{{.Server.Version}}",
              ])
            ).stdout.trim(),
          },
          scope:
            "Real API/Postgres/trusted XFS publication and confined pinned Codex runner; external OIDC and capability catalog fixtures",
          liveAccount: process.env.HARBOR_TEST_LIVE_ATTACHMENTS
            ? "passed synthetic image color and exact text response"
            : "Separate mandatory gate",
        },
        null,
        2,
      ),
    );
    console.log("Linux attachment evidence", artifact);
  }
}
