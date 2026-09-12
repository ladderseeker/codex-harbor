import { releaseImage } from "../deploy/images.mjs";
import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { realpath, stat, lstat } from "node:fs/promises";
import { relative, isAbsolute, dirname, resolve } from "node:path";
import { provisionEgress } from "../egress/network.mjs";
import type { OwnedRuntimeProcess } from "../../packages/codex-adapter/src/index.js";
import { inspectRunnerProcesses } from "./processes.js";
import {
  prepareNativeStorage,
  type NativeStorage,
} from "../storage/admission.js";
import { withRunnerAuthority } from "./authority.js";
const exec = promisify(execFile);
const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const RUNNER_IMAGE = "codex-harbor-runner:0.153.4";
export type RunnerConfig = {
  purpose?: "conversation" | "terminal" | "preview";
  attachmentDirectory?: NativeStorage;
  attachmentProject?: NativeStorage;
  workspaceId?: string;
  gitCommon?: { canonical: string; device: string; inode: string };
  sessionId: string;
  projectId: string;
  workspacePath: string;
  generation: number;
  instanceId?: string;
  permissionProfile?: "read-only" | "workspace-write";
  workspaceDevice?: string;
  workspaceInode?: string;
};
/** This module is trusted supervisor code, never executed or mounted inside a project. */
export async function runnerArguments(
  config: RunnerConfig,
  native?: NativeStorage,
) {
  if (
    config.purpose &&
    !["conversation", "terminal", "preview"].includes(config.purpose)
  )
    throw Error("Unsupported runner purpose");
  if (
    config.purpose &&
    config.purpose !== "conversation" &&
    config.attachmentDirectory
  )
    throw Error(
      "Dedicated process runners cannot mount conversation attachments",
    );
  for (const id of [
    config.sessionId,
    config.projectId,
    config.instanceId ?? "local",
  ])
    if (!idPattern.test(id)) throw Error("Invalid runner identity");
  if (!Number.isSafeInteger(config.generation) || config.generation < 1)
    throw Error("Invalid runtime generation");
  const roots: { id: string; name: string; path: string }[] = JSON.parse(
    process.env.HARBOR_PROJECT_ROOTS ?? "[]",
  );
  const workspace = await realpath(config.workspacePath);
  if (workspace !== resolve(config.workspacePath))
    throw Error("Workspace canonical path changed");
  let allowed = false;
  for (const setting of roots) {
    const root = await realpath(setting.path);
    const sub = relative(root, workspace);
    if (sub && !sub.startsWith("..") && !isAbsolute(sub)) allowed = true;
  }
  if (!allowed || !(await stat(workspace)).isDirectory())
    throw Error("Workspace outside configured project root");
  const identity = await stat(workspace, { bigint: true });
  if (
    config.workspaceDevice !== identity.dev.toString() ||
    config.workspaceInode !== identity.ino.toString()
  )
    throw Error("Workspace identity changed or unavailable");
  // A runner cannot rename its mount point; each ancestor is administrator controlled.
  for (let ancestor = dirname(workspace); ; ancestor = dirname(ancestor)) {
    const metadata = await lstat(ancestor);
    if (
      metadata.isSymbolicLink() ||
      ![0, process.getuid?.()].includes(metadata.uid) ||
      metadata.uid === 10001 ||
      ((metadata.mode & 0o022) !== 0 && (metadata.mode & 0o1000) === 0)
    )
      throw Error("Untrusted workspace ancestor");
    if (ancestor === dirname(ancestor)) break;
  }
  if (config.gitCommon) {
    const common = config.gitCommon;
    if (common.canonical.includes(",") || common.canonical.includes("\n"))
      throw Error("Unsupported Git common path");
    if (
      !config.workspaceId ||
      !idPattern.test(config.workspaceId) ||
      dirname(workspace).split("/").at(-1) !== config.workspaceId ||
      dirname(dirname(workspace)).split("/").at(-1) !== "workspaces" ||
      common.canonical !== dirname(dirname(dirname(workspace))) + "/git-common"
    )
      throw Error("Git common mapping invalid");
    const identity = await stat(common.canonical, { bigint: true });
    if (
      (await realpath(common.canonical)) !== common.canonical ||
      identity.dev.toString() !== common.device ||
      identity.ino.toString() !== common.inode ||
      !identity.isDirectory()
    )
      throw Error("Git common identity changed");
  }
  if (native) {
    const identity = await stat(native.canonical, { bigint: true });
    if (
      (await realpath(native.canonical)) !== native.canonical ||
      identity.dev.toString() !== native.device ||
      identity.ino.toString() !== native.inode ||
      native.canonical.includes(",")
    )
      throw Error("Native history identity changed");
  }
  if (config.attachmentDirectory) {
    const project = config.attachmentProject;
    if (
      !project ||
      project.canonical.includes(",") ||
      project.canonical.includes("\n")
    )
      throw Error("Attachment project identity required");
    const projectIdentity = await lstat(project.canonical, { bigint: true });
    const projectBase = dirname(project.canonical);
    if (
      (await realpath(project.canonical)) !== project.canonical ||
      !projectIdentity.isDirectory() ||
      projectIdentity.dev.toString() !== project.device ||
      projectIdentity.ino.toString() !== project.inode ||
      (workspace !== project.canonical &&
        (!config.workspaceId ||
          !idPattern.test(config.workspaceId) ||
          workspace !==
            resolve(projectBase, "workspaces", config.workspaceId, "checkout")))
    )
      throw Error("Attachment project or workspace binding changed");
    const a = config.attachmentDirectory;
    const info = await lstat(a.canonical, { bigint: true });
    if (
      a.canonical !== resolve(projectBase, "attachments", config.sessionId) ||
      (await realpath(a.canonical)) !== a.canonical ||
      !info.isDirectory() ||
      info.uid !== 0n ||
      (info.mode & 0o022n) !== 0n ||
      info.dev.toString() !== a.device ||
      info.ino.toString() !== a.inode
    )
      throw Error("Attachment mount identity changed");
    const parent = await lstat(dirname(a.canonical));
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      parent.uid !== 0 ||
      (parent.mode & 0o022) !== 0
    )
      throw Error("Untrusted attachment mount ancestor");
  }
  if (workspace.includes(",")) throw Error("Unsupported workspace path");
  const name =
    `harbor-${config.instanceId ?? "local"}-${config.sessionId}-${config.generation}`.toLowerCase();
  return [
    "run",
    "--rm",
    "-i",
    "--name",
    name,
    "--label",
    "org.codex-harbor.owner=runner",
    "--label",
    `org.codex-harbor.purpose=${config.purpose ?? "conversation"}`,
    "--label",
    `org.codex-harbor.instance=${config.instanceId ?? "local"}`,
    "--log-driver",
    "local",
    "--log-opt",
    "max-size=1m",
    "--log-opt",
    "max-file=2",
    ...(config.gitCommon
      ? [
          "--mount",
          `type=bind,source=${config.gitCommon.canonical},target=/git-common${config.permissionProfile === "workspace-write" ? "" : ",readonly"}`,
          "--mount",
          `type=bind,source=${workspace},target=/harbor/workspaces/${config.workspaceId}${config.permissionProfile === "workspace-write" ? "" : ",readonly"}`,
        ]
      : []),
    "--user",
    "10001:10001",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--security-opt",
    `seccomp=${fileURLToPath(new URL(config.purpose === "terminal" ? "./seccomp-terminal.json" : "./seccomp.json", import.meta.url))}`,
    "--pids-limit",
    "128",
    "--memory",
    "512m",
    "--memory-swap",
    "512m",
    "--cpus",
    "1",
    "--network",
    "none",
    "--ipc",
    "none",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=64m,uid=10001,gid=10001,mode=1700",
    "--mount",
    `type=bind,source=${workspace},target=/workspace${config.permissionProfile === "workspace-write" ? "" : ",readonly"}`,
    "--mount",
    native
      ? `type=bind,source=${native.canonical},target=/home/runner/.codex`
      : `type=volume,source=harbor-${config.instanceId ?? "local"}-${config.projectId}-${config.sessionId}-codex,target=/home/runner/.codex`,
    ...(config.attachmentDirectory
      ? [
          "--mount",
          `type=bind,source=${config.attachmentDirectory.canonical},target=/attachments,readonly`,
        ]
      : []),
    "--env",
    "CODEX_HOME=/home/runner/.codex",
    "--env",
    "HOME=/home/runner",
    "--workdir",
    "/workspace",
    releaseImage("runner", RUNNER_IMAGE),
    "codex",
    "app-server",
    "--listen",
    "stdio://",
  ];
}
/** Starts the fixed restricted-egress profile. This also serves the actual Linux test lane. */
export async function startConfinedRunner(
  config: RunnerConfig,
  nativeInput?: NativeStorage | (() => Promise<NativeStorage>),
): Promise<ChildProcessWithoutNullStreams> {
  const info = await exec("docker", ["info", "--format", "{{.OSType}}"], {
    timeout: 10_000,
    maxBuffer: 4096,
  });
  if (info.stdout.trim() !== "linux")
    throw Error("A supported Linux container engine is required");
  await runnerArguments(config);
  return withRunnerAuthority(config, async () => {
    const native =
      typeof nativeInput === "function" ? await nativeInput() : nativeInput;
    if (!native) {
      const volume = `harbor-${config.instanceId ?? "local"}-${config.projectId}-${config.sessionId}-codex`;
      await exec(
        "docker",
        [
          "volume",
          "create",
          "--label",
          "org.codex-harbor.owner=native-history",
          "--label",
          `org.codex-harbor.instance=${config.instanceId ?? "local"}`,
          "--label",
          `org.codex-harbor.session=${config.sessionId}`,
          volume,
        ],
        { timeout: 10_000, maxBuffer: 4096 },
      );
      const volumeInfo = JSON.parse(
        (
          await exec("docker", ["volume", "inspect", volume], {
            timeout: 10_000,
            maxBuffer: 8192,
          })
        ).stdout,
      )[0];
      if (
        volumeInfo.Labels?.["org.codex-harbor.owner"] !== "native-history" ||
        volumeInfo.Labels?.["org.codex-harbor.session"] !== config.sessionId ||
        volumeInfo.Labels?.["org.codex-harbor.instance"] !==
          (config.instanceId ?? "local")
      )
        throw Error("Native history volume ownership mismatch");
    }
    const egress =
      config.purpose && config.purpose !== "conversation"
        ? null
        : await provisionEgress(config);
    try {
      // Revalidate after provisioning and before Docker resolves the administrator-controlled mount.
      const args = await runnerArguments(config, native);
      if (egress) {
        args[args.indexOf("--network") + 1] = egress.networkName;
        const imageIndex = args.indexOf(releaseImage("runner", RUNNER_IMAGE));
        if (imageIndex < 0)
          throw Error("Fixed runner image boundary unavailable");
        args.splice(
          imageIndex,
          0,
          "--env",
          `HARBOR_MODEL_BASE_URL=${egress.modelBaseUrl}`,
        );
      }
      args.push("--strict-config", "-c", 'cli_auth_credentials_store="file"');
      if (egress)
        args.push(
          "-c",
          'model_provider="harbor"',
          "-c",
          `model_providers.harbor={name="Harbor model gateway",base_url="${egress.modelBaseUrl}",wire_api="responses",requires_openai_auth=true,supports_websockets=false}`,
        );
      const child: OwnedRuntimeProcess = spawn("docker", args, {
        stdio: "pipe",
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DOCKER_HOST: process.env.DOCKER_HOST,
          DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
        },
      });
      const name = args[args.indexOf("--name") + 1]!;
      let cleanupPromise: Promise<void> | undefined;
      const cleanup = () =>
        (cleanupPromise ??= (async () => {
          try {
            await exec("docker", ["rm", "--force", name], {
              timeout: 15_000,
              maxBuffer: 4096,
            });
          } catch {
            const found = await exec(
              "docker",
              ["ps", "-aq", "--filter", `name=^/${name}$`],
              { timeout: 10_000, maxBuffer: 4096 },
            );
            if (found.stdout.trim())
              throw Error("Owned runner termination unconfirmed");
          }
          await egress?.cleanup();
        })());
      child.closeOwned = cleanup;
      child.inspectOwned = () => inspectRunnerProcesses(config);
      const cleanupEventually = () => {
        void cleanup().catch(() =>
          console.error(
            "Owned runner cleanup incomplete; explicit reconciliation required.",
          ),
        );
      };
      child.once("harbor:close", cleanupEventually);
      child.once("exit", cleanupEventually);
      child.once("error", cleanupEventually);
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      return child;
    } catch (error) {
      await egress?.cleanup();
      throw error;
    }
  });
}
export async function launchRunner(
  config: RunnerConfig,
): Promise<ChildProcessWithoutNullStreams> {
  const context = await exec(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { timeout: 10_000, maxBuffer: 4096 },
  );
  if (
    process.platform !== "linux" ||
    !context.stdout.trim().startsWith("unix://") ||
    (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://"))
  )
    throw Error(
      "Managed XFS launcher and Docker must share the same Linux host",
    );
  return startConfinedRunner(config, () =>
    prepareNativeStorage(config.workspacePath, config.sessionId),
  );
}
