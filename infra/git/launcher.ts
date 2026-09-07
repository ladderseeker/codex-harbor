import { releaseImage } from "../deploy/images.mjs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { WorkspaceIdentity } from "../../packages/workspaces/src/types.ts";
export const GIT_IMAGE = "codex-harbor-git:2.39.5-p003";
const exec = promisify(execFile);
let activeHelpers = 0;
export async function fixedGitHelper(config: {
  action: "inspect" | "worktree" | "copy";
  workspaceId: string;
  source: WorkspaceIdentity;
  target?: WorkspaceIdentity;
  common?: WorkspaceIdentity;
  revision?: string;
}): Promise<any> {
  if (
    !/^[a-f0-9-]{36}$/.test(config.workspaceId) ||
    (config.revision &&
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(config.revision))
  )
    throw Error("Invalid workspace helper identity");
  for (const item of [config.source, config.target, config.common])
    if (item) {
      if (item.canonical.includes(",") || item.canonical.includes("\n"))
        throw Error("Invalid mount path");
      const canonical = await realpath(item.canonical),
        identity = await stat(canonical, { bigint: true });
      if (
        canonical !== item.canonical ||
        identity.dev.toString() !== item.device ||
        identity.ino.toString() !== item.inode
      )
        throw Error("Workspace identity changed");
    }
  if (activeHelpers >= 4) throw Error("Workspace helper capacity reached");
  activeHelpers++;
  try {
    return await launchHelper(config);
  } finally {
    activeHelpers--;
  }
}
async function launchHelper(config: Parameters<typeof fixedGitHelper>[0]) {
  const name =
    "harbor-workspace-" +
    (config.action === "inspect" ? randomUUID() : config.workspaceId);
  const args = [
    "create",
    "--rm",
    "-i",
    "--name",
    name,
    "--label",
    "org.codex-harbor.owner=workspace-helper",
    "--label",
    `org.codex-harbor.workspace=${config.workspaceId}`,
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
    `type=bind,source=${config.source.canonical},target=/source,readonly`,
  ];
  if (config.target)
    args.push(
      "--mount",
      `type=bind,source=${config.target.canonical},target=/harbor/workspaces/${config.workspaceId}`,
    );
  if (config.common)
    args.push(
      "--mount",
      `type=bind,source=${config.common.canonical},target=/git-common${config.action === "inspect" ? ",readonly" : ""}`,
    );
  args.push(releaseImage("git", GIT_IMAGE));
  // Never start by a reusable name: a delayed predecessor cannot start a successor.
  const containerId = (
    await exec("docker", args, {
      timeout: 15000,
      maxBuffer: 4096,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DOCKER_HOST: process.env.DOCKER_HOST,
        DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
      },
    })
  ).stdout.trim();
  if (!/^[a-f0-9]{64}$/.test(containerId))
    throw Error("Helper container identity unavailable");
  const child = spawn(
    "docker",
    ["start", "--attach", "--interactive", containerId],
    {
      stdio: "pipe",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DOCKER_HOST: process.env.DOCKER_HOST,
        DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
      },
    },
  );
  let output = "";
  child.stderr.resume();
  child.stdout.on("data", (b) => {
    output += b;
    if (output.length > 16384) child.kill("SIGKILL");
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 35000);
  try {
    return await new Promise((resolve, reject) => {
      child.on("error", () => reject(Error("Workspace helper unavailable")));
      child.on("exit", (code) => {
        try {
          const result = JSON.parse(output);
          if (code !== 0 || result.error)
            throw Error(result.error ?? "Workspace helper failed");
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.on("error", () =>
        reject(Error("Workspace helper disconnected")),
      );
      child.stdin.end(
        JSON.stringify({
          action: config.action,
          workspaceId: config.workspaceId,
          revision: config.revision,
        }),
      );
    });
  } finally {
    clearTimeout(timer);
    await exec("docker", ["rm", "--force", containerId], {
      timeout: 10000,
      maxBuffer: 4096,
    }).catch(() => undefined);
    const remaining = await exec(
      "docker",
      ["ps", "-aq", "--filter", `name=^/${name}$`],
      { timeout: 5000, maxBuffer: 4096 },
    );
    if (remaining.stdout.trim())
      throw Error("Workspace helper retirement unconfirmed");
  }
}

export async function retireWorkspaceHelper(workspaceId: string) {
  if (!/^[a-f0-9-]{36}$/.test(workspaceId))
    throw Error("Invalid helper retirement identity");
  const name = "harbor-workspace-" + workspaceId;
  const exists = await exec(
    "docker",
    ["ps", "-aq", "--filter", `name=^/${name}$`],
    { timeout: 10000, maxBuffer: 4096 },
  );
  if (!exists.stdout.trim()) return;
  const labels = JSON.parse(
    (
      await exec(
        "docker",
        ["inspect", "--format", "{{json .Config.Labels}}", name],
        { timeout: 10000, maxBuffer: 4096 },
      )
    ).stdout,
  );
  if (
    labels["org.codex-harbor.owner"] !== "workspace-helper" ||
    labels["org.codex-harbor.workspace"] !== workspaceId
  )
    throw Error("Helper ownership mismatch");
  await exec("docker", ["rm", "--force", name], {
    timeout: 15000,
    maxBuffer: 4096,
  });
  if (
    (
      await exec("docker", ["ps", "-aq", "--filter", `name=^/${name}$`], {
        timeout: 10000,
        maxBuffer: 4096,
      })
    ).stdout.trim()
  )
    throw Error("Helper retirement unconfirmed");
}
