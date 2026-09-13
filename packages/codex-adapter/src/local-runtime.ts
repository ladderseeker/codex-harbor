import { execFile, spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import { CODEX_VERSION, type OwnedRuntimeProcess } from "./index.js";
import type { RuntimeConfig } from "./runtime.js";

const exec = promisify(execFile);
const inside = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

/** A live guardian signals its own group, never a recovered/stale PID. */
const guardian = `
const { spawn } = require('node:child_process');
const retire = () => { process.kill(-process.pid, 'SIGKILL'); };
process.on('SIGTERM', retire);
process.on('SIGINT', retire);
process.on('disconnect', retire);
const runtime = spawn(process.argv[1], ['-c', 'cli_auth_credentials_store="file"', 'app-server', '--listen', 'stdio://'], {
  stdio: [0, 1, 2], env: process.env,
});
runtime.on('error', retire);
runtime.on('exit', retire);
process.send({ runtimePid: runtime.pid });
`;

export async function launchLocalRuntime(
  config: RuntimeConfig,
): Promise<OwnedRuntimeProcess> {
  if (process.env.HARBOR_LOCAL_MODE !== "personal")
    throw Error("Personal local runtime mode is disabled");
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw Error("Personal local runtime requires macOS or Linux");
  if (
    (config.purpose ?? "conversation") !== "conversation" ||
    config.gitCommon ||
    config.attachmentProject ||
    config.attachmentDirectory
  )
    throw Error("Personal local runtime supports plain conversations only");
  const homeInput = process.env.HARBOR_LOCAL_CODEX_HOME;
  const binaryInput = process.env.HARBOR_LOCAL_CODEX_BINARY;
  if (
    !homeInput ||
    !binaryInput ||
    !isAbsolute(homeInput) ||
    !isAbsolute(binaryInput)
  )
    throw Error(
      "Personal local runtime requires explicit absolute home and binary paths",
    );
  const [home, binary, workspace, userHome] = await Promise.all([
    realpath(homeInput),
    realpath(binaryInput),
    realpath(config.workspacePath),
    realpath(homedir()),
  ]);
  const homeStat = await stat(home);
  if (
    !homeStat.isDirectory() ||
    (homeStat.mode & 0o077) !== 0 ||
    homeStat.uid !== process.getuid?.() ||
    home === userHome ||
    inside(join(userHome, ".codex"), home) ||
    inside(workspace, home) ||
    inside(home, workspace)
  )
    throw Error(
      "Personal Codex home must be private and separate from normal state and workspace",
    );
  const env: NodeJS.ProcessEnv = {
    PATH: [
      dirname(process.execPath),
      dirname(binary),
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(delimiter),
    HOME: home,
    CODEX_HOME: home,
    LANG: "en_US.UTF-8",
  };
  const version = await exec(binary, ["--version"], {
    env,
    timeout: 10_000,
    maxBuffer: 4096,
  });
  if (version.stdout.trim() !== `codex-cli ${CODEX_VERSION}`)
    throw Error(`Personal runtime requires Codex ${CODEX_VERSION}`);
  const child = spawn(process.execPath, ["-e", guardian, binary], {
    cwd: workspace,
    detached: true,
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    env,
  }) as OwnedRuntimeProcess;
  let runtimePid: number | undefined;
  child.on("message", (message) => {
    const pid = (message as { runtimePid?: unknown }).runtimePid;
    if (typeof pid === "number" && Number.isSafeInteger(pid)) runtimePid = pid;
  });
  const group = async () => {
    if (!child.pid) throw Error("Local runtime process identity unavailable");
    // Only list identities; never signal a PID obtained from a process listing.
    const { stdout } = await exec("/bin/ps", ["-axo", "pid=,pgid=,comm="], {
      timeout: 3_000,
      maxBuffer: 4_194_304,
    });
    return stdout.split("\n").flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      return match && Number(match[2]) === child.pid
        ? [{ pid: Number(match[1]), executable: match[3] }]
        : [];
    });
  };
  child.inspectOwned = async () => {
    try {
      const members = await group();
      return {
        status:
          members.length === 0
            ? "runtime_gone"
            : runtimePid
              ? "known"
              : "unavailable",
        generation: config.generation,
        processes: members.filter(
          ({ pid }) => pid !== child.pid && pid !== runtimePid,
        ),
      };
    } catch {
      return {
        status: "unavailable",
        generation: config.generation,
        processes: [],
      };
    }
  };
  let retirement: Promise<void> | undefined;
  child.closeOwned = () =>
    (retirement ??= (async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
      const deadline = Date.now() + 10_000;
      while ((await group()).length) {
        if (Date.now() >= deadline)
          throw Error("Personal runtime group retirement unconfirmed");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })());
  return child;
}
