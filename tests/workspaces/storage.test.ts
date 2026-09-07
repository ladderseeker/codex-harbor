import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  stat,
  open,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { executeWorkspace } from "../../infra/storage/workspace-service.ts";
const exec = promisify(execFile);
test("P003 storage process death retires exact helper and reconciles prepared checkout", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "harbor-workspace-crash-")),
    ),
    source = join(root, "source"),
    state = join(root, "state"),
    id = randomUUID(),
    operationId = randomUUID();
  await mkdir(source, { mode: 0o755 });
  await mkdir(state, { mode: 0o700 });
  const file = await open(join(source, "large.bin"), "w", 0o644);
  await file.truncate(128 * 1024 * 1024);
  await file.close();
  const identity = await stat(source, { bigint: true });
  const environment = {
    NODE_ENV: "test",
    HARBOR_FIXTURE_MODE: "private-test",
    HARBOR_FIXTURE_STATE_DIR: state,
    HARBOR_PROJECT_ROOTS: JSON.stringify([{ id: "root", path: root }]),
  };
  const original = { ...process.env };
  Object.assign(process.env, environment);
  const command = {
    action: "workspaceCreate" as const,
    operationId,
    rootId: "root",
    relativePath: "source",
    workspaceId: id,
    kind: "copy" as const,
    source: {
      relativePath: "source",
      device: identity.dev.toString(),
      inode: identity.ino.toString(),
    },
  };
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "tests/workspaces/storage-worker.ts"],
    {
      env: { ...process.env, ...environment },
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  child.stdin.end(JSON.stringify(command));
  try {
    let receipt: any;
    for (let i = 0; i < 2000; i++) {
      try {
        receipt = JSON.parse(
          await readFile(
            join(state, "workspace-receipts", operationId + ".json"),
            "utf8",
          ),
        );
        if (receipt.state === "prepared") break;
      } catch {}
      await new Promise((r) => setTimeout(r, 2));
    }
    assert.equal(receipt?.state, "prepared");
    let running = false;
    for (let i = 0; i < 100 && !running; i++) {
      const result = await exec(
        "docker",
        ["ps", "-q", "--filter", `name=^/harbor-workspace-${id}$`],
        { timeout: 5000 },
      );
      running = !!result.stdout.trim();
      if (!running) await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(running, "Owned helper started before process-death injection");
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
    assert.equal(
      JSON.parse(
        await readFile(
          join(state, "workspace-receipts", operationId + ".json"),
          "utf8",
        ),
      ).state,
      "prepared",
    );
    const recovered = await executeWorkspace(command, true);
    assert.equal(
      (await stat(join(recovered.canonical, "large.bin"))).size,
      128 * 1024 * 1024,
    );
    assert.equal(
      (await stat(source, { bigint: true })).ino.toString(),
      identity.ino.toString(),
    );
    const replay = await executeWorkspace(command, true);
    assert.deepEqual(replay, JSON.parse(JSON.stringify(recovered)));
    assert.equal(
      (
        await exec(
          "docker",
          ["ps", "-aq", "--filter", `name=^/harbor-workspace-${id}$`],
          { timeout: 5000 },
        )
      ).stdout.trim(),
      "",
    );
  } finally {
    child.kill("SIGKILL");
    const { retireWorkspaceHelper } = await import(
      "../../infra/git/launcher.ts"
    );
    await retireWorkspaceHelper(id);
    await rm(root, { recursive: true, force: true });
    for (const key of Object.keys(environment)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("P003 partial checkout deletion resumes from its durable removal checkpoint after process death", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "harbor-removal-crash-")),
    ),
    source = join(root, "source"),
    state = join(root, "state"),
    id = randomUUID();
  await mkdir(source, { mode: 0o755 });
  await mkdir(state, { mode: 0o700 });
  const { writeFile, readdir } = await import("node:fs/promises");
  const { relative } = await import("node:path");
  for (let offset = 0; offset < 4000; offset += 100)
    await Promise.all(
      Array.from({ length: 100 }, (_, n) =>
        writeFile(join(source, String(offset + n).padStart(4, "0")), "data"),
      ),
    );
  const identity = await stat(source, { bigint: true }),
    original = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "test",
    HARBOR_FIXTURE_MODE: "private-test",
    HARBOR_FIXTURE_STATE_DIR: state,
    HARBOR_PROJECT_ROOTS: JSON.stringify([{ id: "root", path: root }]),
  });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const target = await executeWorkspace(
      {
        action: "workspaceCreate",
        operationId: randomUUID(),
        rootId: "root",
        relativePath: "source",
        workspaceId: id,
        kind: "copy",
        source: {
          relativePath: "source",
          device: String(identity.dev),
          inode: String(identity.ino),
        },
      },
      true,
    );
    const operationId = randomUUID(),
      command = {
        action: "workspaceRemove" as const,
        operationId,
        rootId: "root",
        relativePath: "source",
        workspaceId: id,
        kind: "copy" as const,
        identity: target,
        sourceSnapshot: target.snapshotHash,
        source: {
          relativePath: relative(root, target.canonical),
          device: target.device,
          inode: target.inode,
        },
      };
    child = spawn(
      process.execPath,
      ["--import", "tsx", "tests/workspaces/storage-worker.ts"],
      { env: process.env, stdio: ["pipe", "ignore", "ignore"] },
    );
    child.stdin!.end(JSON.stringify(command));
    let remaining = 4000;
    for (let i = 0; i < 3000; i++) {
      try {
        const receipt = JSON.parse(
          await readFile(
            join(state, "workspace-receipts", operationId + ".json"),
            "utf8",
          ),
        );
        if (receipt.state === "removing") {
          remaining = (await readdir(target.canonical)).length;
          if (remaining > 0 && remaining < 4000) break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1));
    }
    assert.ok(
      remaining > 0 && remaining < 4000,
      "Observed actual partial unlink before storage-process death",
    );
    child.kill("SIGKILL");
    await new Promise((r) => child!.once("exit", r));
    assert.equal(
      JSON.parse(
        await readFile(
          join(state, "workspace-receipts", operationId + ".json"),
          "utf8",
        ),
      ).state,
      "removing",
    );
    assert.deepEqual(await executeWorkspace(command, true), { removed: true });
    await assert.rejects(stat(target.canonical));
    assert.equal(await readFile(join(source, "0000"), "utf8"), "data");
    assert.deepEqual(await executeWorkspace(command, true), { removed: true });
  } finally {
    child?.kill("SIGKILL");
    const { retireWorkspaceHelper } = await import(
      "../../infra/git/launcher.ts"
    );
    await retireWorkspaceHelper(id);
    await rm(root, { recursive: true, force: true });
    for (const key of [
      "NODE_ENV",
      "HARBOR_FIXTURE_MODE",
      "HARBOR_FIXTURE_STATE_DIR",
      "HARBOR_PROJECT_ROOTS",
    ]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
