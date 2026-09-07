import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { stat, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { xfsFixture } from "../isolation/xfs-fixture.ts";
import { createManagedProject } from "../../infra/storage/client.ts";
import { workspaceCommand } from "../../infra/storage/workspace-client.ts";
import { createRuntime } from "../../packages/codex-adapter/src/runtime.ts";
import type { CodexAdapter } from "../../packages/codex-adapter/src/index.ts";
const key = process.env.HARBOR_TEST_OPENAI_API_KEY;
if (!key) {
  console.error(
    "UNVERIFIED P003: dedicated HARBOR_TEST_OPENAI_API_KEY unavailable; no live model request made.",
  );
  process.exitCode = 2;
} else {
  const fixture = await xfsFixture(),
    projectId = randomUUID();
  Object.assign(process.env, fixture.env);
  delete process.env.HARBOR_FIXTURE_MODE;
  const runtimes: CodexAdapter[] = [];
  let storage: ChildProcess | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    storage = spawn(
      process.execPath,
      ["--import", "tsx", "infra/storage/server.ts"],
      { env: process.env, stdio: "ignore" },
    );
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try {
        ready = (await stat(fixture.env.HARBOR_STORAGE_SOCKET)).isSocket();
      } catch {}
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "Storage service unavailable");
    const local = await createManagedProject(fixture.rootId, "parallel");
    await writeFile(
      join(local.canonical, "source.txt"),
      "P003 independent workspace fixture",
    );
    const workspaces = [];
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      const workspace = await workspaceCommand({
        action: "workspaceCreate",
        operationId: randomUUID(),
        rootId: fixture.rootId,
        relativePath: "parallel/workspace",
        workspaceId: id,
        kind: "copy",
        source: {
          relativePath: "parallel/workspace",
          device: local.device,
          inode: local.inode,
        },
      });
      workspaces.push({ id, ...workspace });
    }
    const completed = new Map<string, string>();
    for (const workspace of workspaces) {
      let adapter: CodexAdapter;
      adapter = await createRuntime({
        sessionId: randomUUID(),
        projectId,
        workspaceId: workspace.id,
        workspacePath: workspace.canonical,
        workspaceDevice: workspace.device,
        workspaceInode: workspace.inode,
        instanceId: fixture.id,
        generation: 1,
        permissionProfile: "workspace-write",
        onEvent: (m, p) => {
          if (m === "turn/completed") {
            const t = p.turn as any;
            completed.set(t.id, t.status);
          }
        },
        onRequest: (r) => {
          if (r.method.includes("requestApproval"))
            void adapter
              .respond(r.id, { decision: "accept" })
              .catch(() => adapter.close());
          else adapter.close();
        },
      });
      runtimes.push(adapter);
      await adapter.loginWithApiKey(key);
    }
    const models = await runtimes[0]!.listModels(),
      model =
        process.env.HARBOR_TEST_CODEX_MODEL ??
        models.data.find((m: any) => m.isDefault)?.model;
    assert.ok(model, "No supported live model");
    timer = setTimeout(() => runtimes.forEach((r) => r.close()), 120000);
    const threads = await Promise.all(
      runtimes.map((r) =>
        r.startThread({
          cwd: "/workspace",
          model,
          permissionProfile: "workspace-write",
        }),
      ),
    );
    const turns = await Promise.all(
      runtimes.map((r, i) =>
        r.startTurn(
          threads[i]!.thread.id,
          `Read source.txt, then write exactly P003_WORKSPACE_${i} with no newline to marker.txt in this workspace. Do not access any other folders.`,
          { model, effort: "low", permissionProfile: "workspace-write" },
        ),
      ),
    );
    const deadline = Date.now() + 120000;
    while (
      turns.some((t) => !completed.has(t.turn.id)) &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 100));
    for (const [i, turn] of turns.entries()) {
      assert.equal(completed.get(turn.turn.id), "completed");
      assert.equal(
        await readFile(join(workspaces[i]!.canonical, "marker.txt"), "utf8"),
        `P003_WORKSPACE_${i}`,
      );
    }
    console.log(
      "PASS P003 dedicated-account parallel native workspace turns and separate file effects",
    );
  } finally {
    if (timer) clearTimeout(timer);
    for (const runtime of runtimes) await runtime.closeAndWait();
    if (storage && storage.exitCode === null && storage.signalCode === null) {
      const exited = new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          storage!.kill("SIGKILL");
          reject(Error("Storage shutdown deadline"));
        }, 5000);
        storage!.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
      storage.kill("SIGTERM");
      await exited;
    }
    await fixture.cleanup();
  }
}
