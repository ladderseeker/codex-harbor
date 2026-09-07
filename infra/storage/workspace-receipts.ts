import {
  mkdir,
  readFile,
  open,
  rename,
  realpath,
  lstat,
  readdir,
  rm,
  rmdir,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { retireWorkspaceHelper } from "../git/launcher.ts";
import type {
  WorkspaceCommand,
  WorkspaceIdentity,
} from "../../packages/workspaces/src/types.ts";
const inflight = new Set<string>();
export async function withWorkspaceReceipt(
  command: WorkspaceCommand,
  fixture: boolean,
  execute: (
    checkpoint: (
      target: WorkspaceIdentity,
      phase?: "prepared" | "removing",
    ) => Promise<void>,
  ) => Promise<any>,
  discard: (target: WorkspaceIdentity) => Promise<void>,
  flush: () => Promise<void>,
  fingerprint: (result: any) => Promise<unknown>,
) {
  if (!command.operationId || !/^[-a-f0-9]{36}$/.test(command.operationId))
    throw Error("Durable workspace operation required");
  const base = fixture
    ? process.env.HARBOR_FIXTURE_STATE_DIR
    : process.env.HARBOR_LAUNCHER_STATE_DIR;
  if (!base) throw Error("Private workspace receipt authority unavailable");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const info = await lstat(base);
  if (
    (await realpath(base)) !== base ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  )
    throw Error("Unsafe workspace receipt authority");
  const folder = join(base, "workspace-receipts");
  await mkdir(folder, { mode: 0o700, recursive: true });
  const authorityDirectory = await open(base, "r");
  try {
    await authorityDirectory.sync();
  } finally {
    await authorityDirectory.close();
  }
  const file = join(folder, command.operationId + ".json"),
    hash = createHash("sha256")
      .update(JSON.stringify({ ...command, retryFailed: undefined }))
      .digest("hex");
  if (inflight.has(command.workspaceId))
    throw Error("Workspace storage operation already active");
  inflight.add(command.workspaceId);
  let record: any;
  const save = async (value: any) => {
    const temporary = file + ".next";
    const fd = await open(temporary, "w", 0o600);
    try {
      await fd.writeFile(JSON.stringify(value));
      await fd.sync();
    } finally {
      await fd.close();
    }
    await rename(temporary, file);
    const directory = await open(folder, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  };
  try {
    try {
      record = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (record && record.hash !== hash)
      throw Error("Workspace receipt intent conflict");
    if (record?.state === "completed") {
      await retireWorkspaceHelper(command.workspaceId);
      return record.result;
    }
    if (
      record?.state === "failed" &&
      command.action === "workspaceRemove" &&
      command.retryFailed
    ) {
      record = { hash, state: "pending" };
      await save(record);
    }
    if (record?.state === "failed")
      throw Object.assign(Error("Workspace storage operation failed"), {
        code: "WORKSPACE_STORAGE_FAILED",
      });
    if (record) {
      await retireWorkspaceHelper(command.workspaceId);
      if (record.state === "applied") {
        if (command.action === "workspaceRemove") {
          if (!record.target) throw Error("Removal identity unavailable");
          await discard(record.target);
        } else if (
          !record.fingerprint ||
          JSON.stringify(await fingerprint(record.result)) !==
            JSON.stringify(record.fingerprint)
        )
          throw Error("Applied workspace content unavailable");
        await flush();
        await save({ hash, state: "completed", result: record.result });
        return record.result;
      }
      if (command.action === "workspaceCreate") {
        if (record.target) await discard(record.target);
        else if (record.state !== "pending")
          throw Error("Workspace staging identity unavailable");
      } else if (
        command.action === "workspaceRemove" &&
        record.state === "removing"
      ) {
        if (!record.target) throw Error("Removal checkpoint unavailable");
        await discard(record.target);
        const result = { removed: true };
        await flush();
        await save({ hash, state: "completed", result });
        return result;
      }
    } else {
      if (
        (await readdir(folder)).filter((name) => name.endsWith(".json"))
          .length >= (command.action === "workspaceCreate" ? 2048 : 4096)
      )
        throw Object.assign(Error("Workspace receipt capacity reached"), {
          code: "WORKSPACE_STORAGE_FAILED",
        });
      await save({ hash, state: "pending" });
    }
    try {
      const result = await execute(async (target, phase = "prepared") => {
        record = { hash, state: phase, target };
        await save(record);
      });
      record = {
        hash,
        state: "applied",
        target: record?.target,
        result,
        fingerprint:
          command.action === "workspaceCreate"
            ? await fingerprint(result)
            : undefined,
      };
      await save(record);
      await retireWorkspaceHelper(command.workspaceId);
      await flush();
      await save({ hash, state: "completed", result });
      return result;
    } catch (error) {
      // A still-running helper or failed cleanup retains its prepared receipt for reconciliation.
      await retireWorkspaceHelper(command.workspaceId);
      if (["removing", "applied"].includes(record?.state)) throw error;
      if (command.action === "workspaceCreate" && record?.target)
        await discard(record.target);
      await flush();
      await save({ hash, state: "failed" });
      throw Object.assign(Error("Workspace storage operation failed"), {
        code: "WORKSPACE_STORAGE_FAILED",
      });
    }
  } finally {
    inflight.delete(command.workspaceId);
  }
}
