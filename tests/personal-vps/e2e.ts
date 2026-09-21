import { runAttachments } from "./attachments.ts";
import {
  installedLiveConfig,
  runInstalledAttachments,
} from "./installed-attachments.ts";
import { writeFileSync } from "node:fs";
import { runConcurrency } from "./concurrency.ts";
import {
  personalPreviewFixture,
  checkPersonalPreview,
} from "./preview-fixture.ts";
/** P015 deterministic acceptance: actual nonroot Harbor; only external OIDC/Codex simulated. */
import {
  spawn,
  execFileSync,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import {
  mkdir,
  mkdtemp,
  cp,
  chmod,
  chown,
  readFile,
  writeFile,
  rm,
  stat,
  lstat,
} from "node:fs/promises";
import { createServer as httpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium, expect } from "@playwright/test";
import { sourceDigest } from "../../scripts/source-digest.ts";
if (process.platform !== "linux" || process.getuid?.() !== 0)
  throw Error("P015 E2E needs the trusted Linux administrator test lane");
const concurrency = process.argv.includes("--concurrency");
const attachments = process.argv.includes("--attachments");
const installedLive = process.argv.includes("--installed-attachments-live");
if ([concurrency, attachments, installedLive].filter(Boolean).length > 1)
  throw Error("Choose exactly one personal acceptance mode");
const liveConfig = installedLive ? await installedLiveConfig() : undefined;
const source = process.cwd(),
  digest = sourceDigest();
const id = "harbor-p015-" + randomBytes(5).toString("hex");
const run = await mkdtemp("/var/lib/harbor-p015-test-");
const artifacts = path.join(source, ".test-runs", id);
const release = path.join(run, "release"),
  state = path.join(run, "state"),
  project = path.join(run, "project");
const node = path.join(run, "node"),
  binary = liveConfig?.binary ?? path.join(run, "codex"),
  cert = path.join(run, "cert.pem"),
  key = path.join(run, "key.pem");
const children: ChildProcess[] = [];
const serviceUnits = new Map<ChildProcess, string>();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let proxy: ReturnType<typeof httpsServer> | undefined;
let previewFixture:
  | Awaited<ReturnType<typeof personalPreviewFixture>>
  | undefined;
let userCreated = false,
  databaseCreated = false;
async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
async function stop(p: ChildProcess) {
  const unit = serviceUnits.get(p);
  if (unit) {
    const absent = async () => {
      try {
        await lstat(`/sys/fs/cgroup/system.slice/${unit}`);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        throw error;
      }
    };
    const stopped = spawnSync("systemctl", ["stop", unit], {
      stdio: "ignore",
      timeout: 35000,
    });
    if (stopped.status !== 0) {
      const loaded = spawnSync(
        "systemctl",
        ["show", unit, "--property=LoadState", "--value"],
        { encoding: "utf8", timeout: 10000 },
      );
      if (loaded.stdout?.trim() !== "not-found" || !(await absent()))
        throw Error("Owned service retirement unconfirmed; resources retained");
    }
    // KillMode=control-group must retire retained native children before deleting
    // the dedicated home/credential. A vanished --collect unit is safe only when
    // its exact cgroup has also disappeared.
    await expect.poll(absent, { timeout: 10000 }).toBe(true);
    serviceUnits.delete(p);
  } else if (p.exitCode === null && p.signalCode === null) p.kill("SIGTERM");
  if (p.exitCode !== null || p.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Owned test child failed to retire")),
      20000,
    );
    p.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
try {
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    path.join(artifacts, "owned-resources.json"),
    JSON.stringify(
      { id, run, user: id, databaseContainer: id, sourceDigest: digest },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await chmod(run, 0o755);
  await mkdir(release);
  await mkdir(state, { mode: 0o711 });
  await chmod(state, 0o711);
  await mkdir(project, { mode: 0o700 });
  for (const entry of [
    "apps",
    "packages",
    "infra",
    "tests",
    "node_modules",
    "package.json",
    "tsconfig.json",
  ])
    await cp(path.join(source, entry), path.join(release, entry), {
      recursive: true,
      verbatimSymlinks: true,
    });
  await cp(process.execPath, node);
  await chmod(node, 0o755);
  await mkdir(path.join(state, "home"), { mode: 0o700 });
  await mkdir(path.join(state, "codex"), { mode: 0o700 });
  await mkdir(path.join(state, "control"), { mode: 0o700 });
  execFileSync("useradd", [
    "--system",
    "--user-group",
    "--no-create-home",
    "--home-dir",
    path.join(state, "home"),
    "--shell",
    "/usr/sbin/nologin",
    id,
  ]);
  userCreated = true;
  const uid = Number(
      execFileSync("id", ["-u", id], { encoding: "utf8" }).trim(),
    ),
    gid = Number(execFileSync("id", ["-g", id], { encoding: "utf8" }).trim());
  for (const child of [
    project,
    ...["home", "codex", "control"].map((name) => path.join(state, name)),
  ])
    await chown(child, uid, gid);
  if (liveConfig) {
    const credential = path.join(state, "codex", "auth.json");
    await cp(path.join(liveConfig.credentialHome, "auth.json"), credential);
    await chmod(credential, 0o600);
    await chown(credential, uid, gid);
  }
  if (!liveConfig) {
    const fixture = path.join(release, "external-codex.mjs");
    await writeFile(
      fixture,
      `import { startPersonalPreviewApp } from "./tests/personal-vps/preview-app.mjs"; let personalDevApp;
` +
        (
          await readFile(
            path.join(source, "tests/fixtures/codex/server.mjs"),
            "utf8",
          )
        )
          .replace(
            'from "./markdown.mjs"',
            'from "./tests/fixtures/codex/markdown.mjs"',
          )
          .replace("let authenticated = false;", "let authenticated = true;")
          .replace(
            "const stateFile = process.env.HARBOR_FIXTURE_STATE_FILE;",
            'const stateFile = process.env.CODEX_HOME + "/test-history-" + process.env.HARBOR_CONVERSATION_ID + ".json";',
          )
          .replace(
            "const text = p.input[0].text;",
            `const text = p.input[0].text;
          if (p.input.length > 1) {
            const images=p.input.filter(i=>i.type==='localImage').map(i=>({path:i.path,size:readFileSync(i.path).length}));
            const files=p.input.filter(i=>i.type==='text' && i.text.startsWith('An attached file')).map(i=>{const match=i.text.match(/JSON-encoded path ("(?:[^"\\\\]|\\\\.)*") with display name/);if(!match)throw Error('invalid file input');const path=JSON.parse(match[1]);return {path,hex:readFileSync(path).toString('hex')};});
            writeFileSync(process.env.CODEX_HOME+'/test-attachments-'+process.env.HARBOR_CONVERSATION_ID+'.json',JSON.stringify({images,files}));
          }`,
          )
          .replace(
            '"Fixture response: " + text',
            '(text.includes("[write-canary]") ? (writeFileSync(process.cwd() + "/canary.txt", "P015 original folder"), personalDevApp ||= startPersonalPreviewApp(Number(process.env.PORT)), "Fixture response: " + text) : "Fixture response: " + text)',
          ),
    );
    // This wrapper is explicitly the external deterministic protocol boundary, never native sandbox evidence.
    await writeFile(
      binary,
      `#!${node}\nif(process.argv.includes('--version')) console.log('codex-cli 0.153.4'); else import(${JSON.stringify(fixture)});\n`,
      { mode: 0o755 },
    );
    // Validate the relocated external fixture before starting Harbor services.
    const fixtureReplies = execFileSync(binary, ["app-server"], {
      uid,
      gid,
      env: {
        PATH: `${run}:/usr/bin:/bin`,
        CODEX_HOME: path.join(state, "codex"),
      },
      input:
        JSON.stringify({ id: 1, method: "initialize", params: {} }) +
        "\n" +
        JSON.stringify({ id: 2, method: "account/read", params: {} }) +
        "\n",
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 65536,
    })
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      fixtureReplies.find((reply) => reply.id === 2)?.result.account,
    ).toEqual({
      type: "apiKey",
    });
  }
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  await chmod(key, 0o600);
  const [
    dbPort,
    apiPort,
    httpsPort,
    oidcPort,
    previewGatewayPort,
    previewTlsPort,
    developmentPort,
  ] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
  const origin = `https://localhost:${httpsPort}`,
    password = randomBytes(24).toString("hex"),
    rootId = randomUUID();
  const env: NodeJS.ProcessEnv = {
    PATH: `${run}:/usr/bin:/bin`,
    NODE_ENV: "production",
    HOME: path.join(state, "home"),
    NODE_EXTRA_CA_CERTS: cert,
    DATABASE_URL: `postgres://harbor:${password}@127.0.0.1:${dbPort}/harbor`,
    HARBOR_PERSONAL_PREVIEW_PORT: String(previewGatewayPort),
    HARBOR_PERSONAL_PREVIEWS: JSON.stringify([
      {
        name: "Development app",
        port: developmentPort,
        origin: `https://127.0.0.1:${previewTlsPort}`,
      },
    ]),
    HARBOR_PERSONAL_VPS_MODE: "personal",
    HARBOR_PERSONAL_VPS_STATE_DIR: state,
    HARBOR_PERSONAL_VPS_CODEX_HOME: path.join(state, "codex"),
    HARBOR_PERSONAL_VPS_CODEX_BINARY: binary,
    HARBOR_HOST: "127.0.0.1",
    HARBOR_PORT: String(apiPort),
    HARBOR_ORIGIN: origin,
    HARBOR_OIDC_ISSUER: `https://127.0.0.1:${oidcPort}`,
    HARBOR_OIDC_CLIENT_ID: id,
    HARBOR_OWNER_SUBJECT: "owner",
    HARBOR_PROJECT_ROOTS: JSON.stringify([
      { id: rootId, name: "Original project", path: project },
    ]),
    HARBOR_PERMISSION_CEILING: "workspace-write",
    HARBOR_MODELS: liveConfig?.model ?? "fixture",
    HARBOR_INSTANCE_ID: id,
  };
  if (liveConfig) {
    delete env.HARBOR_PERSONAL_PREVIEWS;
    delete env.HARBOR_PERSONAL_PREVIEW_PORT;
  }
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      id,
      "--label",
      `org.codex-harbor.instance=${id}`,
      "-p",
      `127.0.0.1:${dbPort}:5432`,
      "-e",
      "POSTGRES_USER=harbor",
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      "POSTGRES_DB=harbor",
      "postgres:17.6-bookworm",
    ],
    { stdio: "ignore" },
  );
  databaseCreated = true;
  await expect
    .poll(
      () => {
        try {
          execFileSync("docker", ["exec", id, "pg_isready", "-U", "harbor"], {
            stdio: "ignore",
          });
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 60000 },
    )
    .toBe(true);
  let logTail = "";
  const start = (file: string, external = false) => {
    const supervisorRole = file === "apps/supervisor/src/main.ts";
    const unit = `${id}-${supervisorRole ? "supervisor" : "api"}-${randomBytes(4).toString("hex")}.service`;
    const envFile = path.join(run, "service.env");
    if (!external)
      writeFileSync(
        envFile,
        Object.entries(env)
          .filter((entry) => entry[1] !== undefined)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join("\n") + "\n",
        { mode: 0o600 },
      );
    const p = spawn(
      !external ? "systemd-run" : node,
      !external
        ? [
            "--unit",
            unit,
            "--collect",
            "--wait",
            "--pipe",
            "--quiet",
            "--service-type=exec",
            `--uid=${uid}`,
            `--gid=${gid}`,
            `--property=Delegate=${supervisorRole ? "yes" : "no"}`,
            `--property=ProtectControlGroups=${supervisorRole ? "no" : "yes"}`,
            "--property=UMask=0077",
            "--property=NoNewPrivileges=yes",
            "--property=PrivateTmp=yes",
            "--property=ProtectSystem=strict",
            "--property=ProtectHome=read-only",
            "--property=ProtectKernelTunables=yes",
            "--property=ProtectKernelModules=yes",
            `--property=ReadWritePaths=${["home", "codex", "control"]
              .map((name) => path.join(state, name))
              .concat(project)
              .join(" ")}`,
            "--property=InaccessiblePaths=-/run/docker.sock -/var/run/docker.sock",
            `--property=MemoryMax=${supervisorRole ? "4G" : "1G"}`,
            `--property=CPUQuota=${supervisorRole ? "150%" : "100%"}`,
            `--property=TasksMax=${supervisorRole ? "512" : "256"}`,
            "--property=KillMode=control-group",
            `--property=WorkingDirectory=${release}`,
            `--property=EnvironmentFile=${envFile}`,
            "--property=TimeoutStopSec=30",
            node,
            "--import",
            "tsx",
            file,
          ]
        : ["--import", "tsx", file],
      {
        cwd: release,
        env: external
          ? {
              ...env,
              NODE_ENV: "test",
              HARBOR_FIXTURE_MODE: "private-test",
              OIDC_PORT: String(oidcPort),
              OIDC_CLIENT_ID: id,
              OIDC_REDIRECT_URI: origin + "/auth/callback",
              OIDC_TLS_CERT: cert,
              OIDC_TLS_KEY: key,
            }
          : env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (!external) {
      serviceUnits.set(p, unit);
      writeFileSync(
        path.join(artifacts, "owned-units.json"),
        JSON.stringify(
          [...serviceUnits.values()].map((name) => ({
            unit: name,
            cgroup: `/sys/fs/cgroup/system.slice/${name}`,
          })),
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
    children.push(p);
    p.stdout?.on("data", (b) => {
      logTail = (logTail + b).slice(-16000);
    });
    p.stderr?.on("data", (b) => {
      logTail = (logTail + b).slice(-16000);
    });
    return p;
  };
  start("tests/fixtures/oidc/server.ts", true);
  await new Promise((r) => setTimeout(r, 800));
  let api = start("apps/api/src/main.ts"),
    supervisor = start("apps/supervisor/src/main.ts");
  proxy = httpsServer(
    { cert: await readFile(cert), key: await readFile(key) },
    (req, res) => {
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port: apiPort,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  await new Promise<void>((r) => proxy!.listen(httpsPort, "127.0.0.1", r));
  previewFixture = await personalPreviewFixture({
    appPort: developmentPort,
    gatewayPort: previewGatewayPort,
    tlsPort: previewTlsPort,
    cert: await readFile(cert),
    key: await readFile(key),
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await expect
    .poll(
      async () => {
        try {
          return (await context.request.get(origin + "/health")).status();
        } catch {
          return 0;
        }
      },
      { timeout: 60000 },
    )
    .toBe(200)
    .catch(() => {
      throw Error(
        "Harbor startup failed: " +
          (installedLive ? "live diagnostics suppressed" : logTail)
            .replaceAll(password, "[redacted]")
            .replace(/postgres:\/\/[^\s]+/g, "[database redacted]"),
      );
    });
  expect((await context.request.get(origin + "/api/v1/me")).status()).toBe(401);
  let page = await context.newPage();
  await page.goto(origin + "/auth/login");
  await page
    .getByRole("button", { name: "Sign in as denied identity" })
    .click();
  expect(new URL(page.url()).pathname).toBe("/auth/callback");
  await page.goto(origin + "/auth/login");
  await page.getByRole("button", { name: "Sign in as owner" }).click();
  await page.waitForURL(origin + "/");
  const me = await (await context.request.get(origin + "/api/v1/me")).json();
  const post = (route: string, data: unknown, headers = {}) =>
    context.request.post(origin + "/api/v1" + route, {
      data,
      headers: {
        Origin: origin,
        "X-CSRF-Token": me.csrfToken,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
        ...headers,
      },
    });
  expect(
    (await post("/projects", {}, { Origin: "https://evil.example" })).status(),
  ).toBe(403);
  expect(
    (await post("/projects", {}, { "X-CSRF-Token": "invalid" })).status(),
  ).toBe(403);
  for (const route of [
    "/schedules",
    "/tokens",
    "/security/runtime-credentials",
    "/workspaces/11111111-1111-4111-8111-111111111111/terminals",
  ])
    expect((await post(route, {})).status()).toBe(409);
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .first()
    .click();
  await page.getByLabel("Approved root").selectOption(rootId);
  await page.getByLabel("Project name").fill("Original project");
  await page
    .getByRole("button", { name: "Browse folders", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use this folder", exact: true })
    .click();
  await expect(page.getByLabel("Folder path")).toHaveValue(".");
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .last()
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await context.request.get(origin + "/api/v1/capabilities")
          ).json()
        ).account?.authenticated,
      { timeout: 30000 },
    )
    .toBe(true);
  const registered = (
    await (await context.request.get(origin + "/api/v1/projects")).json()
  ).projects[0];
  const registeredWorkspaces = await (
    await context.request.get(
      origin + `/api/v1/projects/${registered.id}/workspaces`,
    )
  ).json();
  expect(registeredWorkspaces.workspaces[0].relativePath).toBe("");
  const filesystem = await Promise.all(
    [
      state,
      ...["home", "codex", "control"].map((name) => path.join(state, name)),
    ].map(async (file) => {
      const info = await stat(file);
      const container = file === state;
      expect(info.uid).toBe(container ? 0 : uid);
      expect(info.mode & 0o777).toBe(container ? 0o711 : 0o700);
      return {
        path: path.relative(run, file),
        uid: info.uid,
        mode: (info.mode & 0o777).toString(8),
      };
    }),
  );
  const effectiveUnits = await Promise.all(
    [...serviceUnits].map(async ([, unit]) => {
      const fields = [
        "MainPID",
        "ControlGroup",
        "User",
        "Group",
        "UMask",
        "NoNewPrivileges",
        "PrivateTmp",
        "ProtectSystem",
        "ProtectHome",
        "ProtectKernelTunables",
        "ProtectKernelModules",
        "ProtectControlGroups",
        "Delegate",
        "ReadWritePaths",
        "InaccessiblePaths",
        "KillMode",
        "MemoryMax",
        "CPUQuotaPerSecUSec",
        "TasksMax",
      ];
      const output = execFileSync(
        "systemctl",
        ["show", unit, ...fields.map((field) => "--property=" + field)],
        { encoding: "utf8" },
      );
      const properties = Object.fromEntries(
        output
          .trim()
          .split("\n")
          .map((line) => {
            const i = line.indexOf("=");
            return [line.slice(0, i), line.slice(i + 1)];
          }),
      );
      expect(properties.ControlGroup).toBe(`/system.slice/${unit}`);
      expect(properties.UMask).toBe("0077");
      for (const field of [
        "NoNewPrivileges",
        "PrivateTmp",
        "ProtectKernelTunables",
        "ProtectKernelModules",
      ])
        expect(properties[field]).toBe("yes");
      expect(properties.ProtectSystem).toBe("strict");
      expect(properties.ProtectHome).toBe("read-only");
      expect(properties.KillMode).toBe("control-group");
      expect(properties.Delegate).toBe(
        unit.includes("-supervisor-") ? "yes" : "no",
      );
      expect(properties.ProtectControlGroups).toBe(
        unit.includes("-supervisor-") ? "no" : "yes",
      );
      expect(properties.ReadWritePaths.split(" ").sort()).toEqual(
        ["home", "codex", "control"]
          .map((name) => path.join(state, name))
          .concat(project)
          .sort(),
      );
      const status = await readFile(
        `/proc/${Number(properties.MainPID)}/status`,
        "utf8",
      );
      expect(status).toMatch(
        new RegExp(`^Uid:\\s+${uid}\\s+${uid}\\s+${uid}\\s+${uid}$`, "m"),
      );
      expect(status).toMatch(/^Umask:\s+0077$/m);
      expect(status).toMatch(/^NoNewPrivs:\s+1$/m);
      return {
        unit,
        properties,
        observedProcess: { uid, umask: "0077", noNewPrivileges: true },
      };
    }),
  );
  await writeFile(
    path.join(artifacts, "installed-service-boundary.json"),
    JSON.stringify(
      { sourceDigest: digest, filesystem, effectiveUnits },
      null,
      2,
    ),
  );
  if (liveConfig) {
    await runInstalledAttachments({
      context,
      page,
      origin,
      post,
      projectId: registered.id,
      workspaceId: registeredWorkspaces.workspaces[0].id,
      artifacts,
      databaseUrl: env.DATABASE_URL!,
      nativeHome: env.HARBOR_PERSONAL_VPS_CODEX_HOME!,
      model: liveConfig.model,
      sourceDigest: digest,
    });
    console.log(
      `P024 installed full-stack live attachments passed: ${artifacts}`,
    );
  } else if (attachments) {
    await runAttachments({
      context,
      page,
      origin,
      post,
      projectId: registered.id,
      workspaceId: registeredWorkspaces.workspaces[0].id,
      artifacts,
      databaseUrl: env.DATABASE_URL!,
      nativeHome: env.HARBOR_PERSONAL_VPS_CODEX_HOME!,
    });
    console.log(`P024 deterministic personal attachments passed: ${artifacts}`);
  } else if (concurrency) {
    await runConcurrency({
      context,
      page,
      origin,
      post,
      projectId: registered.id,
      workspaceId: registeredWorkspaces.workspaces[0].id,
      projectPath: project,
      artifacts,
      databaseUrl: env.DATABASE_URL!,
      stopSupervisor: () => stop(supervisor),
      restartSupervisor: async (limits, settled) => {
        await stop(supervisor);
        const readiness = new Pool({ connectionString: env.DATABASE_URL });
        const previousGeneration = Number(
          (await readiness.query("SELECT generation FROM harbor_meta")).rows[0]
            .generation,
        );
        if (limits) {
          env.HARBOR_MAX_ACTIVE_TURNS = String(limits.active);
          env.HARBOR_MAX_CONVERSATION_RUNTIMES = String(limits.runtimes);
        }
        supervisor = start("apps/supervisor/src/main.ts");
        try {
          await expect
            .poll(
              async () => {
                if (supervisor.exitCode !== null)
                  throw Error("Concurrency supervisor failed to restart");
                const generation = Number(
                  (await readiness.query("SELECT generation FROM harbor_meta"))
                    .rows[0].generation,
                );
                if (generation <= previousGeneration) return false;
                if (settled) {
                  // Maintenance and invalid workspace tests intentionally forbid
                  // discovery. Require their exact new dispatcher result instead.
                  const operation = (
                    await readiness.query(
                      "SELECT state,queue_reason FROM operations WHERE id=$1",
                      [settled.operationId],
                    )
                  ).rows[0];
                  return (
                    operation?.state === settled.state &&
                    (settled.queueReason === undefined ||
                      operation.queue_reason === settled.queueReason)
                  );
                }
                const capabilities = (
                  await readiness.query("SELECT data FROM runtime_capabilities")
                ).rows[0]?.data;
                return (
                  capabilities?.account?.authenticated === true &&
                  capabilities?.data?.some(
                    (model: any) =>
                      model.model === "fixture" &&
                      model.supportedReasoningEfforts?.some(
                        (effort: any) => effort.reasoningEffort === "medium",
                      ),
                  )
                );
              },
              { timeout: 30000 },
            )
            .toBe(true);
        } finally {
          await readiness.end();
        }
      },
    });
    console.log(
      `P018 deterministic nonroot application acceptance passed: ${artifacts}`,
    );
  } else {
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    await page
      .getByLabel("Permissions", { exact: true })
      .selectOption("workspace-write");
    await page
      .getByLabel("Message Codex")
      .fill("[delay] [write-canary] initial");
    const accepted = page.waitForResponse(
      (response) =>
        response.url().includes("/turns") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect((await accepted).status()).toBe(202);
    await page.close();
    await expect
      .poll(
        async () => {
          try {
            return await readFile(path.join(project, "canary.txt"), "utf8");
          } catch {
            return "";
          }
        },
        { timeout: 30000 },
      )
      .toBe("P015 original folder");
    expect((await stat(path.join(project, "canary.txt"))).uid).toBe(uid);
    page = await context.newPage();
    await page.goto(origin);
    await page.locator(".conversation-link").first().click();
    await expect(page.locator("body")).toContainText("Fixture response", {
      timeout: 30000,
    });
    await page.getByLabel("Message Codex").fill("P015 continuation");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator("body")).toContainText(
      "Fixture response: P015 continuation",
      { timeout: 30000 },
    );
    await checkPersonalPreview(
      page,
      context,
      `https://127.0.0.1:${previewTlsPort}`,
      developmentPort,
    );
    // Exercise the personal gateway itself: no production clock hook or altered
    // browser-session timestamps. Secrets below live only in this test's memory.
    const previewOrigin = `https://127.0.0.1:${previewTlsPort}`;
    const workspaceId = registeredWorkspaces.workspaces[0].id;
    const prepare = async (client = context, csrf = me.csrfToken) => {
      const response = await client.request.post(
        origin + "/api/v1/personal-preview-openings",
        {
          data: { workspaceId, port: developmentPort },
          headers: {
            Origin: origin,
            "X-CSRF-Token": csrf,
            "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
          },
        },
      );
      expect(response.status()).toBe(200);
      return (await response.json()).bootstrapPath as string;
    };
    const ticketFor = async (bootstrapPath: string, client = context) => {
      const response = await client.request.get(origin + bootstrapPath);
      expect(response.status()).toBe(200);
      const ticket = /name="ticket" value="([A-Za-z0-9_-]{43})"/.exec(
        await response.text(),
      )?.[1];
      if (!ticket)
        throw Error("Preview bootstrap did not contain its bounded ticket");
      return ticket;
    };
    const exchange = (ticket: string, client = context) =>
      client.request.post(previewOrigin + "/__harbor/exchange", {
        data: new URLSearchParams({ ticket }).toString(),
        headers: {
          Origin: origin,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
    const viewerCookie = (await context.cookies(previewOrigin)).find(
      (cookie) => cookie.name === "__Host-harbor-personal-preview",
    );
    if (!viewerCookie) throw Error("Preview viewer cookie missing");
    const rawViewer = `${viewerCookie.name}=${viewerCookie.value}`;
    const view = (cookie: string, client = context) =>
      client.request.get(previewOrigin, {
        headers: { Origin: previewOrigin, Cookie: cookie },
      });
    expect((await view(rawViewer)).status()).toBe(200);
    expect(
      (
        await post("/personal-preview-openings", { workspaceId, port: apiPort })
      ).status(),
    ).toBe(409);
    const replayTicket = await ticketFor(await prepare());
    expect((await exchange(replayTicket)).status()).toBe(200);
    expect((await exchange(replayTicket)).status()).toBe(403);
    const mobilePreview = await context.newPage();
    await mobilePreview.setViewportSize({ width: 390, height: 844 });
    await mobilePreview.goto(origin + (await prepare()));
    await expect(
      mobilePreview.getByRole("heading", {
        name: "Private development application",
      }),
    ).toBeVisible();
    expect(
      await mobilePreview.evaluate(
        () => document.body.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mobilePreview.screenshot({
      path: path.join(artifacts, "preview-mobile.png"),
      fullPage: true,
    });
    await mobilePreview.close();
    const otherContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const otherPage = await otherContext.newPage();
    await otherPage.goto(origin + "/auth/login");
    await otherPage.getByRole("button", { name: "Sign in as owner" }).click();
    await otherPage.waitForURL(origin + "/");
    const otherMe = await (
      await otherContext.request.get(origin + "/api/v1/me")
    ).json();
    const otherTicket = await ticketFor(
      await prepare(otherContext, otherMe.csrfToken),
      otherContext,
    );
    expect((await exchange(otherTicket, otherContext)).status()).toBe(200);
    const otherCookie = (await otherContext.cookies(previewOrigin)).find(
      (cookie) => cookie.name === "__Host-harbor-personal-preview",
    );
    if (!otherCookie) throw Error("Separate viewer cookie missing");
    const revokedViewer = `${otherCookie.name}=${otherCookie.value}`;
    expect((await view(revokedViewer, otherContext)).status()).toBe(200);
    expect(
      (
        await otherContext.request.post(origin + "/api/v1/security/logout", {
          data: {},
          headers: {
            Origin: origin,
            "X-CSRF-Token": otherMe.csrfToken,
            "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
          },
        })
      ).status(),
    ).toBe(200);
    expect((await view(revokedViewer, otherContext)).status()).toBe(403);
    expect((await view(rawViewer)).status()).toBe(200);
    await otherContext.close();
    const expiringTicket = await ticketFor(await prepare());
    await new Promise((resolve) => setTimeout(resolve, 31000));
    expect((await exchange(expiringTicket)).status()).toBe(403);
    console.log(
      "Personal preview short gates passed: ticket replay/expiry, logout revocation, mobile render and denied control port",
    );
    const remainingViewerLife = Math.max(
      0,
      viewerCookie.expires * 1000 - Date.now() + 1500,
    );
    console.log("Waiting for real 15-minute viewer expiry; no clock override");
    const viewerExpiryWaitStarted = Date.now();
    await new Promise((resolve) => setTimeout(resolve, remainingViewerLife));
    const viewerExpiryWaitActualMs = Date.now() - viewerExpiryWaitStarted;
    // Send the retained secret explicitly so this tests server expiry even though
    // an ordinary browser has already deleted its expired cookie.
    expect((await view(rawViewer)).status()).toBe(403);
    const renewedTicket = await ticketFor(await prepare());
    expect((await exchange(renewedTicket)).status()).toBe(200);
    expect(
      (
        await context.request.get(previewOrigin, {
          headers: { Origin: previewOrigin },
        })
      ).status(),
    ).toBe(200);
    expect((await view(rawViewer)).status()).toBe(403);
    console.log("Personal preview actual viewer expiry passed");
    await page.locator(".session-row.selected .session-rename").click();
    await page.getByRole("button", { name: "Status", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Stop processes",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Stop processes", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Development processes are available",
      }),
    ).toHaveCount(0);
    await expect
      .poll(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${developmentPort}`);
          return response.status;
        } catch {
          return 0;
        }
      })
      .toBe(0);
    const stoppedTicket = await ticketFor(await prepare());
    expect((await exchange(stoppedTicket)).status()).toBe(200);
    const stoppedResponse = await context.request.get(previewOrigin, {
      headers: { Origin: previewOrigin },
    });
    expect(stoppedResponse.status()).toBe(403);
    expect(await stoppedResponse.text()).toContain("Preview unavailable");
    console.log("Personal preview stopped-server feedback passed");
    await page
      .getByRole("dialog", { name: "Conversation status", exact: true })
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.screenshot({
      path: path.join(artifacts, "conversation-desktop.png"),
      fullPage: true,
    });
    await page.locator(".rail-footer summary").click();
    await page.getByRole("button", { name: /Codex account/ }).click();
    await expect(
      page.getByText("Codex subscription account ready", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "API key", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: path.join(artifacts, "account-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(artifacts, "account-mobile.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    const closeNavigation = page.getByRole("button", {
      name: "Close navigation",
      exact: true,
    });
    if (await page.locator(".sidebar.is-open").count())
      await closeNavigation.last().click();
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: path.join(artifacts, "conversation-mobile.png"),
      fullPage: true,
    });
    await stop(supervisor);
    await stop(api);
    api = start("apps/api/src/main.ts");
    supervisor = start("apps/supervisor/src/main.ts");
    await expect
      .poll(
        async () => {
          try {
            return (await context.request.get(origin + "/health")).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
    expect(
      (
        await context.request.get(`https://127.0.0.1:${previewTlsPort}`, {
          headers: { Origin: `https://127.0.0.1:${previewTlsPort}` },
        })
      ).status(),
    ).toBe(403);
    await page.reload();
    await expect(page.locator("body")).toContainText(
      "Fixture response: P015 continuation",
      { timeout: 30000 },
    );
    await writeFile(
      path.join(artifacts, "result.json"),
      JSON.stringify(
        {
          passed: true,
          sourceDigest: digest,
          profile: "personal-vps",
          previewExpiry: {
            clockOverride: false,
            requestedWaitMs: remainingViewerLife,
            actualWaitMs: viewerExpiryWaitActualMs,
            expiredGrantRejectedAndRenewedGrantAccepted: true,
          },
          externalBoundaries: "deterministic OIDC and Codex",
          uid,
          limits: [
            "No subscription inference",
            "No native sandbox or systemd/SSH-disconnect inference",
          ],
          checks: [
            "owner authentication",
            "CSRF/Origin",
            "unsupported API denial",
            "root-self original-path write",
            "browser close continuation",
            "restart history",
            "authenticated separate-origin personal preview, large asset and vite-hmr WebSocket",
            "preview cookie stripping, foreign origin and restart grant denial",
            "ticket replay and actual 30-second expiry",
            "viewer logout revocation and actual 15-minute expiry",
            "mobile preview and unreachable-server feedback",
            "desktop/mobile",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      `P015 deterministic nonroot application acceptance passed: ${artifacts}`,
    );
  }
} finally {
  await browser?.close();
  await previewFixture?.close();
  for (const p of [...children].reverse()) await stop(p);
  if (proxy) await new Promise<void>((r) => proxy!.close(() => r()));
  if (databaseCreated)
    execFileSync("docker", ["rm", "-f", "-v", id], { stdio: "ignore" });
  if (userCreated) execFileSync("userdel", [id], { stdio: "ignore" });
  await rm(run, { recursive: true, force: true });
  await writeFile(
    path.join(artifacts, "owned-cleanup.json"),
    JSON.stringify(
      {
        completed: true,
        servicesStopped: true,
        runRemoved: true,
        copiedCredentialRemoved: Boolean(liveConfig),
        databaseRemoved: databaseCreated,
        userRemoved: userCreated,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
