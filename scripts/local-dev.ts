import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  lstat,
  realpath,
  mkdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { homedir } from "node:os";
import { localComposeFiles } from "../infra/compose.ts";
const children: ChildProcess[] = [];
const startupChildren = new Set<ChildProcess>();
let composeStarted = false;
let stopping = false;
let finish!: () => void;
const stopped = new Promise<void>((resolve) => {
  finish = resolve;
});
const signalChild = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  }
};
const stop = () => {
  stopping = true;
  for (const child of startupChildren) {
    signalChild(child, "SIGTERM");
    const timer = setTimeout(() => signalChild(child, "SIGKILL"), 5000);
    timer.unref();
    child.once("exit", () => clearTimeout(timer));
  }
  finish();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const running = () => {
  if (stopping) throw Error("Local startup cancelled");
};
async function run(
  command: string,
  args: string[],
  commandEnv = process.env,
  capture = false,
  cleanup = false,
  timeout = 120000,
) {
  if (!cleanup) running();
  const child = spawn(command, args, {
    env: commandEnv,
    detached: true,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  startupChildren.add(child);
  let output = "";
  child.stdout?.on("data", (data) => {
    output = (output + data.toString()).slice(-8192);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signalChild(child, "SIGKILL");
      reject(Error(`${command} timed out`));
    }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(Error(`${command} stopped (${code ?? "signal"})`));
    });
  }).finally(() => startupChildren.delete(child));
  if (!cleanup) running();
  return output.trim();
}
const requestedDir = path.resolve(
  process.env.HARBOR_LOCAL_STATE_DIR ?? ".harbor-local",
);
const parent = await realpath(path.dirname(requestedDir));
if (parent !== path.dirname(requestedDir))
  throw Error("Local state path parents must be canonical (no symbolic links)");
const dir = path.join(parent, path.basename(requestedDir));
const userHome = await realpath(homedir());
const normalCodex = await realpath(path.join(userHome, ".codex")).catch(() =>
  path.join(userHome, ".codex"),
);
const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("../") &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};
if (dir === userHome || inside(normalCodex, dir) || inside(dir, normalCodex))
  throw Error(
    "Local state must be separate from ordinary home and Codex state",
  );
async function privatePath(file: string, directory: boolean, optional = false) {
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0 ||
    (!directory && info.nlink !== 1)
  )
    throw Error(
      "Local state must contain owned private regular paths without links",
    );
}
await privatePath(dir, true, true);
await mkdir(dir, { recursive: false, mode: 0o700 }).catch(
  (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  },
);
await privatePath(dir, true);
const lock = path.join(dir, "launcher.lock");
try {
  await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
} catch {
  throw Error(
    "Local Harbor is already running, or its launcher.lock needs recovery after a crash. Check the recorded PID before removing that file.",
  );
}
let env: NodeJS.ProcessEnv = {};
const compose = (args: string[], cleanup = false) =>
  run(
    "docker",
    ["compose", ...localComposeFiles(), ...args],
    env,
    false,
    cleanup,
  );
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
try {
  running();
  for (const sub of ["codex-home", "control", "projects", "home"]) {
    const target = path.join(dir, sub);
    await privatePath(target, true, true);
    await mkdir(target, { mode: 0o700 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    await privatePath(target, true);
  }
  for (const file of [
    "instance.json",
    "owner-token",
    "control/key",
    "codex-home/auth.json",
    "codex-home/config.toml",
    "home/.codex",
  ])
    await privatePath(path.join(dir, file), file === "home/.codex", true);
  let saved: {
    instance: string;
    password: string;
    rootId: string;
    dbPort: number;
    apiPort: number;
    httpsPort: number;
    oidcPort: number;
  };
  try {
    saved = JSON.parse(await readFile(path.join(dir, "instance.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const [dbPort, apiPort, httpsPort, oidcPort] = await Promise.all(
      Array.from({ length: 4 }, freePort),
    );
    saved = {
      instance: "harbor-local-" + randomBytes(6).toString("hex"),
      password: randomBytes(24).toString("hex"),
      rootId: randomUUID(),
      dbPort,
      apiPort,
      httpsPort,
      oidcPort,
    };
    await writeFile(
      path.join(dir, "instance.json"),
      JSON.stringify(saved, null, 2),
      { mode: 0o600, flag: "wx" },
    );
  }
  for (const [file, value] of [
    ["owner-token", randomBytes(32).toString("hex")],
    ["control/key", randomBytes(32)],
  ] as const) {
    try {
      await writeFile(path.join(dir, file), value, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const binary =
    process.env.HARBOR_LOCAL_CODEX_BINARY ??
    (await run("which", ["codex"], process.env, true, false, 10000));
  if (!path.isAbsolute(binary))
    throw Error("HARBOR_LOCAL_CODEX_BINARY must be an absolute path");
  if (
    (await run(
      binary,
      ["--version"],
      {
        PATH: process.env.PATH,
        HOME: path.join(dir, "home"),
        CODEX_HOME: path.join(dir, "codex-home"),
      },
      true,
      false,
      10000,
    )) !== "codex-cli 0.153.4"
  )
    throw Error(
      "Local mode requires Codex 0.153.4. Set HARBOR_LOCAL_CODEX_BINARY to that binary; your normal Codex installation is left unchanged.",
    );
  const origin = `https://localhost:${saved.httpsPort}`;
  env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    DOCKER_HOST: process.env.DOCKER_HOST,
    DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
    HARBOR_HOST: "127.0.0.1",
    NODE_ENV: "development",
    HARBOR_LOCAL_MODE: "personal",
    HARBOR_LOCAL_CODEX_BINARY: binary,
    HARBOR_LOCAL_CODEX_HOME: path.join(dir, "codex-home"),
    HARBOR_LOCAL_OWNER_TOKEN_FILE: path.join(dir, "owner-token"),
    HARBOR_INSTANCE_ID: saved.instance,
    HARBOR_DATABASE_PASSWORD: saved.password,
    HARBOR_DATABASE_PORT: String(saved.dbPort),
    HARBOR_API_PORT: String(saved.apiPort),
    HARBOR_HTTPS_PORT: String(saved.httpsPort),
    HARBOR_PORT: String(saved.apiPort),
    HARBOR_ORIGIN: origin,
    DATABASE_URL: `postgres://harbor:${saved.password}@127.0.0.1:${saved.dbPort}/harbor`,
    OIDC_PORT: String(saved.oidcPort),
    HARBOR_OIDC_ISSUER: `http://127.0.0.1:${saved.oidcPort}`,
    HARBOR_OIDC_CLIENT_ID: saved.instance,
    HARBOR_OWNER_SUBJECT: "local-owner",
    HARBOR_PROJECT_ROOTS: JSON.stringify([
      {
        id: saved.rootId,
        name: "Local projects",
        path: path.join(dir, "projects"),
      },
    ]),
    HARBOR_MODELS: process.env.HARBOR_MODELS ?? "",
    HARBOR_MAX_ACTIVE_TURNS: process.env.HARBOR_MAX_ACTIVE_TURNS ?? "4",
    HARBOR_MAX_CONVERSATION_RUNTIMES:
      process.env.HARBOR_MAX_CONVERSATION_RUNTIMES ?? "4",
    HARBOR_CONTROL_SOCKET: path.join(dir, "control", "supervisor.sock"),
    HARBOR_CREDENTIAL_KEY_FILE: path.join(dir, "control", "key"),
    HARBOR_PERMISSION_CEILING: "read-only",
  };
  delete env.HARBOR_FIXTURE_MODE;
  if (process.argv.includes("--login")) {
    const loginEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: path.join(dir, "home"),
      CODEX_HOME: env.HARBOR_LOCAL_CODEX_HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      TERM: process.env.TERM,
    };
    await run(
      binary,
      ["-c", 'cli_auth_credentials_store="file"', "login"],
      loginEnv,
      false,
      false,
      900000,
    );
  }
  if (process.env.HARBOR_MODELS === undefined) {
    const discovered = JSON.parse(
      await run(
        process.execPath,
        ["--import", "tsx", "scripts/local-models.ts"],
        env,
        true,
        false,
        30000,
      ),
    );
    if (
      !Array.isArray(discovered) ||
      !discovered.length ||
      discovered.some(
        (id) => typeof id !== "string" || !/^[a-zA-Z0-9._-]+$/.test(id),
      )
    )
      throw Error(
        "Local Codex returned no usable models; sign in and restart Harbor",
      );
    env.HARBOR_MODELS = discovered.join(",");
  }
  await run("pnpm", ["build"]);
  composeStarted = true;
  await compose(["up", "-d", "--wait"]);
  for (const file of [
    "scripts/local-oidc.ts",
    "apps/api/src/main.ts",
    "apps/supervisor/src/main.ts",
  ]) {
    running();
    const child = spawn(process.execPath, ["--import", "tsx", file], {
      env,
      stdio: "inherit",
    });
    children.push(child);
    child.once("error", () => {
      process.exitCode = 1;
      finish();
    });
    child.once("exit", (code) => {
      if (!stopping) process.exitCode = code ?? 1;
      finish();
    });
    if (file === "scripts/local-oidc.ts") {
      let oidcReady = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        running();
        if (child.exitCode !== null || child.signalCode !== null)
          throw Error("Local owner provider stopped");
        try {
          if (
            (
              await fetch(
                env.HARBOR_OIDC_ISSUER + "/.well-known/openid-configuration",
              )
            ).ok
          ) {
            oidcReady = true;
            break;
          }
        } catch {
          /* starting */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!oidcReady) throw Error("Local owner provider did not become ready");
    }
  }
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    running();
    if (
      children.some(
        (child) => child.exitCode !== null || child.signalCode !== null,
      )
    )
      throw Error("Local Harbor process stopped during startup");
    try {
      if (
        (await fetch(`http://127.0.0.1:${saved.apiPort}/api/v1/me`)).status ===
        401
      ) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready)
    throw Error("Local Harbor did not become ready within 30 seconds");
  console.log(
    `Local Harbor: ${origin}/auth/login\nOwner token file: ${env.HARBOR_LOCAL_OWNER_TOKEN_FILE}\nCodex login: pnpm dev --local --login (stop this instance first).\nState persists in ${dir} and Docker volumes for ${saved.instance}. Ctrl+C stops services without deleting data.\nHTTPS uses the instance's local Caddy certificate.`,
  );
  await stopped;
} catch (error) {
  if (!stopping) throw error;
} finally {
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 5000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          }),
    ),
  );
  try {
    if (composeStarted) await compose(["stop"], true);
  } finally {
    await rm(lock, { force: true });
  }
}
