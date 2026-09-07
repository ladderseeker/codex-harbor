import { stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import { createRuntime } from "../../packages/codex-adapter/src/runtime.js";
import { type CodexAdapter } from "../../packages/codex-adapter/src/index.js";
import { xfsFixture } from "../isolation/xfs-fixture.js";
import { createManagedProject } from "../../infra/storage/client.js";
const key = process.env.HARBOR_TEST_OPENAI_API_KEY;
if (!key) {
  console.error(
    "UNVERIFIED P001-08: dedicated HARBOR_TEST_OPENAI_API_KEY is unavailable; no model request was made.",
  );
  process.exitCode = 2;
} else {
  const fixture = await xfsFixture(),
    id = randomUUID();
  Object.assign(process.env, fixture.env);
  delete process.env.HARBOR_FIXTURE_MODE;
  let storage: ChildProcess | undefined;
  let adapter: CodexAdapter | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let modelStarted = false;
  try {
    storage = spawn(
      process.execPath,
      ["--import", "tsx", "infra/storage/server.ts"],
      {
        env: process.env,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = (await stat(fixture.env.HARBOR_STORAGE_SOCKET)).isSocket();
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "Trusted storage IPC unavailable");
    const provisioned = await createManagedProject(fixture.rootId, "live");
    const complete = new Map<string, any>();
    let approvals = 0;
    adapter = await createRuntime({
      sessionId: id,
      projectId: id,
      instanceId: fixture.id,
      generation: 1,
      workspacePath: provisioned.canonical,
      workspaceDevice: provisioned.device,
      workspaceInode: provisioned.inode,
      permissionProfile: "workspace-write",
      onEvent: (method, p) => {
        if (method === "turn/completed") {
          const turn = p.turn as any;
          complete.set(turn.id, turn);
        }
      },
      onRequest: (r) => {
        if (r.method.includes("requestApproval")) {
          approvals++;
          void adapter!
            .respond(r.id, { decision: "decline" })
            .catch(() => adapter!.close());
        } else adapter!.close();
      },
    });
    await adapter.loginWithApiKey(key);
    assert.equal((await adapter.readAccount()).account?.type, "apiKey");
    const models = await adapter.listModels();
    const model =
      process.env.HARBOR_TEST_CODEX_MODEL ??
      models.data.find((m: any) => m.isDefault)?.model;
    assert.ok(model, "No supported test model available");
    const { thread } = await adapter.startThread({
      cwd: "/workspace",
      model,
      permissionProfile: "workspace-write",
    });
    const deadline = Date.now() + 120_000;
    timeout = setTimeout(() => adapter?.close(), 120_000);
    const wait = async (turnId: string) => {
      while (!complete.has(turnId) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 100));
      assert.ok(complete.has(turnId), "Bounded live turn deadline exceeded");
      return complete.get(turnId);
    };
    modelStarted = true;
    const first = await adapter.startTurn(
      thread.id,
      "Reply exactly HARBOR_LIVE_OK. Do not call tools.",
      { model, effort: "low", permissionProfile: "workspace-write" },
    );
    assert.equal((await wait(first.turn.id)).status, "completed");
    const approval = await adapter.startTurn(
      thread.id,
      "Run sh -c 'sleep 20; printf smoke > smoke.txt' in the workspace. Request approval when necessary.",
      { model, effort: "low", permissionProfile: "workspace-write" },
    );
    await wait(approval.turn.id);
    assert.ok(
      approvals > 0,
      "Pinned live runtime did not produce required approval evidence",
    );
    const cancel = await adapter.startTurn(
      thread.id,
      "Run sleep 60 in the shell.",
      { model, effort: "low", permissionProfile: "workspace-write" },
    );
    await adapter.interruptTurn(thread.id, cancel.turn.id);
    assert.equal((await wait(cancel.turn.id)).status, "interrupted");
    console.log(
      "PASS P001-08 dedicated-account conversation, approval decline, and confirmed cancellation",
    );
  } catch (error) {
    console.error(
      `${modelStarted ? "FAIL" : "UNVERIFIED"} P001-08: ${error instanceof Error ? error.message : "runtime prerequisite failed"}`,
    );
    process.exitCode = modelStarted ? 1 : 2;
  } finally {
    if (timeout) clearTimeout(timeout);
    await adapter?.closeAndWait();
    if (storage && storage.exitCode === null && storage.signalCode === null) {
      const stopped = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          storage!.kill("SIGKILL");
          reject(Error("Owned storage service shutdown deadline"));
        }, 5000);
        storage!.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      storage.kill("SIGTERM");
      await stopped;
    }
    await fixture.cleanup();
  }
}
