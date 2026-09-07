import {
  mkdir,
  open,
  readFile,
  rename,
  readdir,
  lstat,
  realpath,
} from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixedFileHelper, retireFileHelper } from "./launcher.ts";
import type { FileCommand } from "../../packages/files/src/types.ts";
const writes = new Set(["save", "stage", "unstage", "commit"]);
const active = new Set<string>();
async function paths(command: FileCommand, action: "validate" | "sync") {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "python3",
      [
        fileURLToPath(
          new URL("../storage/workspace-paths.py", import.meta.url),
        ),
      ],
      {
        stdio: "pipe",
        env: {
          PATH: process.env.PATH,
          HARBOR_XFS_PROFILE: process.env.HARBOR_XFS_PROFILE,
          HARBOR_LAUNCHER_STATE_DIR: process.env.HARBOR_LAUNCHER_STATE_DIR,
        },
      },
    );
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.on("error", () => {});
    const timeout = setTimeout(() => child.kill("SIGKILL"), 12000);
    child.on("error", () => {
      clearTimeout(timeout);
      reject(Error("File storage authority unavailable"));
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve()
        : reject(Error("File storage identity or durability unavailable"));
    });
    child.stdin.end(
      JSON.stringify({
        action,
        rootId: command.rootId,
        workspaceId: command.workspaceId,
        relativePath: command.relativePath,
        identity: command.identity,
      }),
    );
  });
}
async function validate(command: FileCommand, fixture: boolean) {
  if (
    fixture &&
    !(
      process.env.NODE_ENV === "test" &&
      process.env.HARBOR_FIXTURE_MODE === "private-test"
    )
  )
    throw Error("Private fixture required");
  const roots = JSON.parse(process.env.HARBOR_PROJECT_ROOTS ?? "[]"),
    root = roots.find((r: any) => r.id === command.rootId);
  if (!root) throw Error("File project root unavailable");
  const path = resolve(root.path, command.relativePath),
    sub = relative(root.path, path);
  if (
    !sub ||
    sub.startsWith("..") ||
    isAbsolute(sub) ||
    path !== command.identity.canonical
  )
    throw Error("File workspace mapping invalid");
  if (!fixture) await paths(command, "validate");
}
async function authority(fixture: boolean) {
  const base = fixture
    ? process.env.HARBOR_FIXTURE_STATE_DIR
    : process.env.HARBOR_LAUNCHER_STATE_DIR;
  if (!base) throw Error("File receipt authority unavailable");
  const info = await lstat(base);
  if (
    (await realpath(base)) !== base ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  )
    throw Error("File receipt authority unsafe");
  const directory = join(base, "file-receipts");
  await mkdir(directory, { mode: 0o700, recursive: true });
  // The new child directory entry must survive before any receipt/effect can.
  // Sync even when it already exists: a predecessor may have lost this barrier.
  const parent = await open(base, "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
  return directory;
}
async function persist(file: string, value: any) {
  const temporary = file + ".next",
    fd = await open(temporary, "w", 0o600);
  try {
    await fd.writeFile(JSON.stringify(value));
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(temporary, file);
  const directory = await open(resolve(file, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function executeFile(
  command: FileCommand,
  fixture = false,
  withDispatch?: (send: () => void) => Promise<void>,
): Promise<any> {
  await validate(command, fixture);
  if (!writes.has(command.action)) return fixedFileHelper(command);
  if (
    !command.operationId ||
    !/^[a-f0-9-]{36}$/.test(command.operationId) ||
    !Number.isSafeInteger(command.epoch)
  )
    throw Error("Durable file identity required");
  if (active.has(command.workspaceId))
    throw Error("File helper already active");
  active.add(command.workspaceId);
  try {
    const folder = await authority(fixture),
      file = join(folder, command.operationId + ".json"),
      hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    let old: any;
    try {
      old = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (old) {
      if (old.hash !== hash) throw Error("File intent conflict");
      await retireFileHelper(command.operationId);
      if (old.state === "completed") return old.result;
      if (old.state === "applied") {
        // An applied record is before the project barrier. Revalidate exact effect;
        // a content match without this authenticated record never proves execution.
        await validateApplied(command, old.result);
        if (!fixture) await paths(command, "sync");
        await persist(file, { hash, state: "completed", result: old.result });
        return old.result;
      }
      throw Object.assign(Error("File effect remains uncertain"), {
        code: "FILE_UNCERTAIN",
      });
    }
    if (
      (await readdir(folder)).filter((x) => x.endsWith(".json")).length >= 4096
    )
      throw Error("File receipt capacity reached");
    await persist(file, {
      hash,
      state: "dispatching",
      operationId: command.operationId,
      workspaceId: command.workspaceId,
      epoch: command.epoch,
    });
    const result = await fixedFileHelper(
      command,
      withDispatch,
      async (prepared) => {
        await persist(file, { hash, state: "prepared", result: prepared });
      },
    );
    await persist(file, { hash, state: "applied", result });
    await validateApplied(command, result);
    if (!fixture) await paths(command, "sync");
    await persist(file, { hash, state: "completed", result });
    return result;
  } finally {
    active.delete(command.workspaceId);
  }
}
async function validateApplied(command: FileCommand, result: any) {
  if (command.action === "save") {
    const actual = await fixedFileHelper({
      ...command,
      action: "content",
      operationId: undefined,
      payload: { ref: result.ref },
    });
    if (actual.revision !== result.revision)
      throw Object.assign(Error("Applied file identity changed"), {
        code: "FILE_APPLIED_CHANGED",
      });
  } else {
    await fixedFileHelper({
      ...command,
      action: "verify",
      operationId: undefined,
      payload: { result },
    });
  }
}
export async function inspectFileEffect(
  command: FileCommand,
  fixture = false,
): Promise<any> {
  await validate(command, fixture);
  if (!command.operationId) throw Error("Exact file operation required");
  if (active.has(command.workspaceId))
    throw Error("File operation still active");
  await retireFileHelper(command.operationId);
  const file = join(await authority(fixture), command.operationId + ".json");
  let record: any;
  try {
    record = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (
    record &&
    record.hash !==
      createHash("sha256").update(JSON.stringify(command)).digest("hex")
  )
    throw Error("File receipt identity mismatch");
  if (record?.state === "applied") {
    try {
      await validateApplied(command, record.result);
      if (!fixture) await paths(command, "sync");
      const completed = { ...record, state: "completed" };
      await persist(file, completed);
      record = completed;
    } catch {
      /* Mismatched or unflushed effects remain uncertain; never replay. */
    }
  }
  if (record?.state === "completed")
    return { status: "completed-receipt", result: record.result };
  let observation: any;
  try {
    observation = await fixedFileHelper({
      ...command,
      action: command.action === "save" ? "content" : "status",
      operationId: undefined,
      payload: command.action === "save" ? { ref: command.payload.ref } : {},
    });
    if (observation.text !== undefined) {
      observation.sha256 = createHash("sha256")
        .update(Buffer.from(observation.text, "utf8"))
        .digest("hex");
      delete observation.text;
    }
    if (observation.entries)
      observation = {
        head: observation.head,
        indexRevision: observation.indexRevision,
        revision: observation.revision,
      };
  } catch {
    observation = { status: "unavailable" };
  }
  return {
    status: "uncertain",
    receipt: record?.state ?? "missing",
    recorded: record?.result ?? null,
    observation,
  };
}
