import { withWorkspaceReceipt } from "./workspace-receipts.ts";
import { spawn } from "node:child_process";
import { mkdir, chmod, realpath, stat, rmdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixedGitHelper } from "../git/launcher.ts";
import type {
  WorkspaceCommand,
  WorkspaceIdentity,
} from "../../packages/workspaces/src/types.ts";
async function identity(canonical: string): Promise<WorkspaceIdentity> {
  const s = await stat(canonical, { bigint: true });
  return { canonical, device: s.dev.toString(), inode: s.ino.toString() };
}
async function paths(input: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "python3",
      [fileURLToPath(new URL("./workspace-paths.py", import.meta.url))],
      {
        env: {
          PATH: process.env.PATH,
          HARBOR_XFS_PROFILE: process.env.HARBOR_XFS_PROFILE,
          HARBOR_LAUNCHER_STATE_DIR: process.env.HARBOR_LAUNCHER_STATE_DIR,
        },
        stdio: "pipe",
      },
    );
    let out = "";
    p.stderr.resume();
    p.stdout.on("data", (b) => {
      out += b;
      if (out.length > 16384) p.kill("SIGKILL");
    });
    const t = setTimeout(() => p.kill("SIGKILL"), 12000);
    p.on("error", () => {
      clearTimeout(t);
      reject(Error("Managed workspace storage unavailable"));
    });
    p.on("exit", (code) => {
      clearTimeout(t);
      try {
        const v = JSON.parse(out);
        if (code || v.error) throw Error(v.error ?? "Workspace storage failed");
        resolve(v);
      } catch (e) {
        reject(e);
      }
    });
    p.stdin.end(JSON.stringify(input));
  });
}
export async function executeWorkspace(
  command: WorkspaceCommand,
  fixture = false,
): Promise<any> {
  if (
    (command as unknown as { restoredAuthorityRevoked?: boolean })
      .restoredAuthorityRevoked
  )
    throw Error("Restored operation authority revoked");
  if (
    fixture &&
    !(
      process.env.NODE_ENV === "test" &&
      process.env.HARBOR_FIXTURE_MODE === "private-test"
    )
  )
    throw Error("Private fixture required");
  if (["workspaceInspect", "workspaceValidate"].includes(command.action))
    return executeUnreceipted(command, fixture);
  return withWorkspaceReceipt(
    command,
    fixture,
    (checkpoint) => executeUnreceipted(command, fixture, checkpoint),
    async (target) => {
      const roots = JSON.parse(process.env.HARBOR_PROJECT_ROOTS ?? "[]"),
        root = roots.find((r: any) => r.id === command.rootId);
      if (!root) throw Error("Workspace root unavailable");
      if (fixture) {
        try {
          const current = await identity(target.canonical);
          if (
            current.device !== target.device ||
            current.inode !== target.inode
          )
            throw Error("Staging identity changed");
          await rm(target.canonical, { recursive: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rmdir(path.dirname(target.canonical)).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
        if (target.common)
          await rm(
            path.join(
              target.common.canonical,
              "worktrees",
              command.workspaceId,
            ),
            { recursive: true, force: true },
          );
      } else
        await paths({
          ...command,
          action: "abandon",
          source: {
            relativePath: path.relative(root.path, target.canonical),
            device: target.device,
            inode: target.inode,
          },
          identity: target,
        });
    },
    async () => {
      if (!fixture) await paths({ ...command, action: "sync" });
    },
    async (result) => {
      if (fixture) return { device: result.device, inode: result.inode };
      const root = JSON.parse(process.env.HARBOR_PROJECT_ROOTS ?? "[]").find(
        (r: any) => r.id === command.rootId,
      );
      return paths({
        ...command,
        action: "fingerprint",
        source: {
          relativePath: path.relative(root.path, result.canonical),
          device: result.device,
          inode: result.inode,
        },
        identity: result,
      });
    },
  );
}
async function executeUnreceipted(
  command: WorkspaceCommand,
  fixture = false,
  checkpoint?: (
    target: WorkspaceIdentity,
    phase?: "prepared" | "removing",
  ) => Promise<void>,
): Promise<any> {
  if (
    fixture &&
    !(
      process.env.NODE_ENV === "test" &&
      process.env.HARBOR_FIXTURE_MODE === "private-test"
    )
  )
    throw Error("Private fixture required");
  if (
    !command ||
    ![
      "workspaceCreate",
      "workspaceInspect",
      "workspaceValidate",
      "workspaceRemove",
    ].includes(command.action) ||
    !["local", "worktree", "copy"].includes(command.kind) ||
    typeof command.relativePath !== "string" ||
    command.relativePath.length > 300
  )
    throw Error("Invalid workspace command");
  const roots: { id: string; path: string }[] = JSON.parse(
    process.env.HARBOR_PROJECT_ROOTS ?? "[]",
  );
  const root = roots.find((r) => r.id === command.rootId);
  if (!root || !/^[a-f0-9-]{36}$/.test(command.workspaceId))
    throw Error("Workspace identity invalid");
  const relative = command.source?.relativePath ?? command.relativePath;
  if (
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((p) => !p || p === "." || p === "..")
  )
    throw Error("Workspace path denied");
  const sourcePath = path.join(root.path, relative),
    canonical = await realpath(sourcePath);
  if (canonical !== sourcePath)
    throw Error("Workspace canonical identity changed");
  const source = await identity(canonical),
    expected = command.source ?? command.identity;
  if (
    !expected ||
    source.device !== expected.device ||
    source.inode !== expected.inode ||
    (command.identity && command.identity.canonical !== canonical)
  )
    throw Error("Workspace identity changed");
  const projectName = command.relativePath.split("/")[0]!;
  if (!fixture && !relative.startsWith(projectName + "/"))
    throw Error("Cross project source denied");
  let common = command.identity?.common;
  if (common) {
    const expectedCommon = fixture
      ? path.join(path.dirname(path.dirname(canonical)), "git-common")
      : path.join(root.path, projectName, "git-common");
    if (common.canonical !== expectedCommon || command.kind !== "worktree")
      throw Error("Common metadata identity denied");
  }

  if (!fixture) await paths({ ...command, action: "validate" });
  if (command.action === "workspaceValidate") return { valid: true };
  if (command.action === "workspaceInspect")
    return fixedGitHelper({
      action: "inspect",
      workspaceId: command.workspaceId,
      source,
      common,
    });
  if (command.action === "workspaceRemove") {
    if (command.kind === "local")
      throw Error("Local workspace removal forbidden");
    const inspection = await fixedGitHelper({
      action: "inspect",
      workspaceId: command.workspaceId,
      source,
      common,
    });
    if (
      inspection.dirty ||
      (command.kind === "copy" &&
        inspection.snapshotHash !== command.sourceSnapshot)
    )
      throw Error("Workspace changed before removal");
    await checkpoint?.({ ...source, common }, "removing");
    if (fixture) {
      const allowed = path.join(root.path, ".harbor-workspaces");
      if (
        !canonical.startsWith(allowed + path.sep) ||
        path.basename(path.dirname(canonical)) !== command.workspaceId
      )
        throw Error("Workspace removal identity denied");
      if (common)
        await rm(
          path.join(common.canonical, "worktrees", command.workspaceId),
          { recursive: true, force: true },
        );
      await rm(canonical, { recursive: true });
      await rmdir(path.dirname(canonical));
      return { removed: true };
    }
    return paths({ ...command, action: "remove" });
  }
  if (command.kind === "copy" && command.sourceSnapshot) {
    const inspection = await fixedGitHelper({
      action: "inspect",
      workspaceId: command.workspaceId,
      source,
    });
    if (inspection.snapshotHash !== command.sourceSnapshot)
      throw Error("Source changed before copy");
  }
  let target: WorkspaceIdentity;
  if (fixture) {
    const projectId = command.relativePath.replaceAll("/", "_");
    const parent = path.join(root.path, ".harbor-workspaces", projectId);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const directory = path.join(parent, command.workspaceId);
    await mkdir(directory, { mode: 0o700, recursive: true });
    const checkout = path.join(directory, "checkout");
    await mkdir(checkout, { mode: 0o777, recursive: true });
    if ((await (await import("node:fs/promises")).readdir(checkout)).length)
      throw Error("Workspace staging not empty");
    await chmod(checkout, 0o777);
    target = await identity(checkout);
    if (command.kind === "worktree") {
      const directory = path.join(parent, "git-common");
      await mkdir(directory, { recursive: true, mode: 0o777 });
      await chmod(directory, 0o777);
      common = await identity(directory);
    }
  } else {
    const prepared = await paths({ ...command, action: "prepare" });
    target = prepared;
    common = prepared.common;
  }
  await checkpoint?.({ ...target, common });
  try {
    const result = await fixedGitHelper({
      action: command.kind === "worktree" ? "worktree" : "copy",
      workspaceId: command.workspaceId,
      source,
      target,
      common,
      revision: command.revision,
    });
    return { ...target, common, ...result };
  } catch (error) {
    throw error;
  }
}
