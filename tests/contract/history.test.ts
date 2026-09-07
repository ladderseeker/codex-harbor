import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodexAdapter,
  CODEX_VERSION,
} from "../../packages/codex-adapter/src/index.ts";
test("P007-07 pinned native thread start/read contract on a fresh unauthenticated home", async () => {
  const home = await mkdtemp(join(tmpdir(), "harbor-history-contract-"));
  let adapter: CodexAdapter | undefined;
  try {
    const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home };
    assert.equal(
      execFileSync("codex", ["--version"], { env, encoding: "utf8" }).trim(),
      `codex-cli ${CODEX_VERSION}`,
    );
    adapter = new CodexAdapter(
      spawn("codex", ["app-server", "--listen", "stdio://"], {
        env,
        cwd: home,
        stdio: "pipe",
      }),
    );
    await adapter.initialize();
    const { thread } = await adapter.startThread({
      cwd: home,
      permissionProfile: "read-only",
    });
    assert.equal(typeof thread.id, "string");
    // No model turn is requested. A never-materialized native thread may reject
    // includeTurns; Harbor records this as unavailable rather than empty history.
    try {
      const result = await adapter.readThread(thread.id);
      assert.equal(result.thread.id, thread.id);
      assert.ok(Array.isArray(result.thread.turns));
    } catch (error) {
      assert.equal((error as Error).message, "Codex request rejected");
    }
    assert.equal((await adapter.readAccount()).account, null);
  } finally {
    if (adapter) await adapter.closeAndWait();
    await rm(home, { recursive: true, force: true });
  }
});
test("P007-02 adapter reads persisted native history after owned process replacement", async () => {
  const home = await mkdtemp(join(tmpdir(), "harbor-history-fixture-"));
  const state = join(home, "native.json");
  let adapter: CodexAdapter | undefined;
  const start = () =>
    new CodexAdapter(
      spawn(process.execPath, ["tests/fixtures/codex/server.mjs"], {
        env: { PATH: process.env.PATH, HARBOR_FIXTURE_STATE_FILE: state },
        stdio: "pipe",
      }),
    );
  try {
    adapter = start();
    await adapter.initialize();
    const { thread } = await adapter.startThread({ cwd: "/workspace" });
    const { turn } = await adapter.startTurn(
      thread.id,
      "durable native history",
    );
    await new Promise((r) => setTimeout(r, 200));
    await adapter.closeAndWait();
    adapter = start();
    await adapter.initialize();
    const read = await adapter.readThread(thread.id);
    assert.equal(read.thread.id, thread.id);
    assert.equal(read.thread.turns[0].id, turn.id);
    assert.equal(read.thread.turns[0].status, "completed");
    assert.ok(
      read.thread.turns[0].items.some(
        (item: any) => item.type === "agentMessage",
      ),
    );
    const resumed = await adapter.resumeThread(thread.id, {
      cwd: "/workspace",
    });
    assert.equal(resumed.thread.id, thread.id);
  } finally {
    if (adapter) await adapter.closeAndWait();
    await rm(home, { recursive: true, force: true });
  }
});
