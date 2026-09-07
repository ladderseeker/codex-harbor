import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { realpath, stat, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FileCommand } from "../../packages/files/src/types.ts";
const exec = promisify(execFile);
export const FILE_IMAGE = "codex-harbor-files:2.39.5-p004";
const id = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const writeActions = new Set(["save", "stage", "unstage", "commit"]);
let active = 0;
function slotBase() {
  const base =
    process.env.HARBOR_LAUNCHER_STATE_DIR ??
    process.env.HARBOR_FIXTURE_STATE_DIR;
  if (!base) throw Error("File helper slot authority unavailable");
  return base;
}
async function slotCommand(action: "claim" | "release", operationId: string) {
  const base = slotBase(),
    info = await lstat(base);
  if (
    (await realpath(base)) !== base ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  )
    throw Error("Unsafe file helper slot authority");
  const result = await exec(
    "python3",
    [
      fileURLToPath(new URL("./slots.py", import.meta.url)),
      base,
      action,
      operationId,
      String(process.pid),
    ],
    { timeout: 5000, maxBuffer: 8192 },
  );
  return JSON.parse(result.stdout) as { claimed?: boolean; stale?: string[] };
}
async function permit(operationId: string) {
  const deadline = Date.now() + 5000;
  do {
    const result = await slotCommand("claim", operationId);
    if (result.claimed) return () => releaseOwnedSlots(operationId);
    // Only a dead broker older than every bounded launch/retirement phase is eligible.
    // The ledger remains reserved until exact labeled container absence is confirmed.
    for (const stale of result.stale ?? []) await retireFileHelper(stale);
    await new Promise((r) => setTimeout(r, 50));
  } while (Date.now() < deadline);
  throw Object.assign(Error("File helper capacity reached"), {
    code: "FILE_CAPACITY",
  });
}

const dockerEnv = () => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  DOCKER_HOST: process.env.DOCKER_HOST,
  DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
});
async function releaseOwnedSlots(operationId: string) {
  await slotCommand("release", operationId);
}

export async function retireFileHelper(operationId: string) {
  if (!id.test(operationId)) throw Error("Invalid file helper identity");
  const name = "harbor-file-" + operationId;
  const found = (
    await exec("docker", ["ps", "-aq", "--filter", `name=^/${name}$`], {
      env: dockerEnv(),
      timeout: 10000,
      maxBuffer: 4096,
    })
  ).stdout.trim();
  if (!found) {
    await releaseOwnedSlots(operationId);
    return;
  }
  if (!/^[a-f0-9]{12,64}$/.test(found))
    throw Error("File helper identity unavailable");
  const labels = JSON.parse(
    (
      await exec(
        "docker",
        ["inspect", "--format", "{{json .Config.Labels}}", found],
        { env: dockerEnv(), timeout: 10000, maxBuffer: 4096 },
      )
    ).stdout,
  );
  if (
    labels["org.codex-harbor.owner"] !== "file-helper" ||
    labels["org.codex-harbor.operation"] !== operationId
  )
    throw Error("File helper ownership mismatch");
  await exec("docker", ["rm", "--force", found], {
    env: dockerEnv(),
    timeout: 15000,
    maxBuffer: 4096,
  });
  if (
    (
      await exec("docker", ["ps", "-aq", "--filter", `id=${found}`], {
        env: dockerEnv(),
        timeout: 5000,
        maxBuffer: 4096,
      })
    ).stdout.trim()
  )
    throw Error("File helper retirement unconfirmed");
  await releaseOwnedSlots(operationId);
}
export async function fixedFileHelper(
  command: FileCommand,
  withDispatch?: (send: () => void) => Promise<void>,
  prepared?: (result: Record<string, unknown>) => Promise<void>,
): Promise<any> {
  const writable = writeActions.has(command.action),
    operationId = command.operationId ?? randomUUID();
  if (
    !id.test(command.workspaceId) ||
    !id.test(operationId) ||
    !id.test(command.projectId) ||
    !id.test(command.rootId)
  )
    throw Error("Invalid file helper identity");
  if (
    writable &&
    (!command.operationId || !Number.isSafeInteger(command.epoch))
  )
    throw Error("Durable file operation required");
  for (const identity of [command.identity, command.identity.common])
    if (identity) {
      if (identity.canonical.includes(",") || identity.canonical.includes("\n"))
        throw Error("Invalid file mount");
      const canonical = await realpath(identity.canonical),
        info = await stat(canonical, { bigint: true });
      if (
        canonical !== identity.canonical ||
        info.dev.toString() !== identity.device ||
        info.ino.toString() !== identity.inode
      )
        throw Error("File workspace identity changed");
    }
  if (active >= 20)
    throw Object.assign(Error("File helper queue capacity reached"), {
      code: "FILE_CAPACITY",
    });
  active++;
  let containerId: string | undefined,
    release: (() => Promise<void>) | undefined;
  try {
    release = await permit(operationId);
    const args = [
      "create",
      "--rm",
      "-i",
      "--name",
      "harbor-file-" + operationId,
      "--label",
      "org.codex-harbor.owner=file-helper",
      "--label",
      "org.codex-harbor.operation=" + operationId,
      "--network=none",
      "--user=10001:10001",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true",
      "--security-opt",
      `seccomp=${fileURLToPath(new URL("../runner/seccomp.json", import.meta.url))}`,
      "--pids-limit=64",
      "--memory=536870912",
      "--memory-swap=536870912",
      "--cpus=1",
      "--ipc=none",
      "--log-driver=none",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=67108864,mode=1777",
      "--mount",
      `type=bind,source=${command.identity.canonical},target=/workspace${writable ? "" : ",readonly"}`,
    ];
    if (command.identity.common)
      args.push(
        "--mount",
        `type=bind,source=${command.identity.common.canonical},target=/git-common${writable ? "" : ",readonly"}`,
      );
    args.push(FILE_IMAGE);
    containerId = (
      await exec("docker", args, {
        env: dockerEnv(),
        timeout: 15000,
        maxBuffer: 4096,
      })
    ).stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(containerId))
      throw Error("File helper identity unavailable");
    const child = spawn(
      "docker",
      ["start", "--attach", "--interactive", containerId],
      { env: dockerEnv(), stdio: "pipe" },
    );
    let output = Buffer.alloc(0),
      preparedSeen = false;
    let preparation: Promise<void> | undefined;
    const limit = command.action === "download" ? 23000000 : 4194304;
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      output = Buffer.concat([output, chunk]);
      if (output.length > limit) {
        child.kill("SIGKILL");
        return;
      }
      if (writable && !preparedSeen) {
        const newline = output.indexOf(10);
        if (newline < 0) return;
        let frame: any;
        try {
          frame = JSON.parse(output.subarray(0, newline).toString());
        } catch {
          child.kill("SIGKILL");
          return;
        }
        if (frame.phase !== "prepared") return;
        preparedSeen = true;
        output = output.subarray(newline + 1);
        const result = frame.result;
        if (
          !result ||
          (command.action === "commit" &&
            !/^[a-f0-9]{40}$/.test(result.commitOid)) ||
          (command.action !== "save" && !/^[a-f0-9]{40}$/.test(result.tree)) ||
          (command.action === "save" &&
            !/^[a-f0-9]{64}$/.test(result.sha256)) ||
          Buffer.byteLength(JSON.stringify(result)) > 1048576 ||
          !prepared
        ) {
          child.kill("SIGKILL");
          return;
        }
        preparation = prepared(result)
          .then(() => {
            child.stdin.end('{"publish":true}\n');
          })
          .catch(() => {
            child.kill("SIGKILL");
          });
      }
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 35000);
    try {
      return await new Promise((resolve, reject) => {
        child.on("error", () => reject(Error("File helper unavailable")));
        child.stdin.on("error", () =>
          reject(Error("File helper disconnected")),
        );
        child.on("close", (code) => {
          try {
            const result = JSON.parse(output.toString());
            if (code !== 0 || result.error)
              throw Object.assign(Error("File operation unavailable"), {
                confirmedRejected: result.phase === "before-publication",
                code:
                  typeof result.error === "string" &&
                  /^[A-Z_]{1,40}$/.test(result.error)
                    ? result.error
                    : "FILE_UNAVAILABLE",
              });
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
        const send = () => {
          const frame =
            JSON.stringify({
              action: command.action,
              workspaceId: command.workspaceId,
              operationId,
              payload: command.payload,
            }) + "\n";
          if (writable) child.stdin.write(frame);
          else child.stdin.end(frame);
        };
        if (withDispatch) void withDispatch(send).catch(reject);
        else send();
      });
    } finally {
      clearTimeout(timer);
      await preparation;
    }
  } finally {
    let retired = false;
    try {
      if (containerId) {
        await exec("docker", ["rm", "--force", containerId], {
          env: dockerEnv(),
          timeout: 15000,
          maxBuffer: 4096,
        }).catch(() => {});
      }
      await retireFileHelper(operationId);
      retired = true;
    } finally {
      if (release && retired) await release();
      active--;
    }
  }
}
