import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodexAdapter,
  CODEX_VERSION,
  RuntimeUncertainError,
  TurnAlreadyCompletedError,
} from "../../packages/codex-adapter/src/index.js";
const fixture = () =>
  spawn(process.execPath, ["tests/fixtures/codex/server.mjs"], {
    stdio: "pipe",
    env: { PATH: process.env.PATH },
  });
test("P001-04 fixture approvals are not unattended and answer once", async () => {
  let request: any;
  let complete: any;
  const adapter = new CodexAdapter(fixture(), {
    onRequest: (r) => (request = r),
    onEvent: (m, p) => {
      if (m === "turn/completed") complete = p;
    },
  });
  try {
    await adapter.initialize();
    const { thread } = await adapter.startThread({ cwd: "/workspace" });
    await adapter.startTurn(thread.id, "[approval]");
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(request);
    assert.equal(complete, undefined);
    await adapter.respond(request.id, { decision: "decline" });
    await assert.rejects(adapter.respond(request.id, { decision: "accept" }));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((complete as any).turn.status, "completed");
  } finally {
    adapter.close();
  }
});
test("P001-05 timeout is uncertain and never replayed", async () => {
  const adapter = new CodexAdapter(fixture(), {}, 150);
  try {
    await adapter.initialize();
    const { thread } = await adapter.startThread({ cwd: "/workspace" });
    await assert.rejects(
      adapter.startTurn(thread.id, "[timeout]"),
      RuntimeUncertainError,
    );
  } finally {
    adapter.close();
  }
});
test("P001-08 pinned real runtime initializes and serves non-model account/model contracts", async () => {
  const home = await mkdtemp(join(tmpdir(), "harbor-contract-"));
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
    const init = await adapter.initialize();
    assert.equal(typeof init.userAgent, "string");
    const account = await adapter.readAccount();
    assert.equal(account.account, null);
    const models = await adapter.listModels();
    assert.ok(Array.isArray(models.data));
  } finally {
    adapter?.close();
    await rm(home, { recursive: true, force: true });
  }
});
test("P001-06 cancellation confirms interrupted and emits no delayed completion", async () => {
  const events: Record<string, unknown>[] = [];
  const adapter = new CodexAdapter(fixture(), {
    onEvent: (m, p) => {
      if (m === "turn/completed") events.push(p);
    },
  });
  try {
    await adapter.initialize();
    const { thread } = await adapter.startThread({ cwd: "/workspace" });
    const { turn } = await adapter.startTurn(thread.id, "[activation-delay]");
    await adapter.interruptTurn(thread.id, turn.id);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(events.length, 1);
    assert.equal((events[0]!.turn as any).status, "interrupted");
  } finally {
    adapter.close();
  }
});
test("P001-05 process loss rejects ambiguous acknowledgement", async () => {
  const adapter = new CodexAdapter(fixture());
  try {
    await adapter.initialize();
    const { thread } = await adapter.startThread({ cwd: "/workspace" });
    await assert.rejects(
      adapter.startTurn(thread.id, "[crash-before-ack]"),
      RuntimeUncertainError,
    );
  } finally {
    adapter.close();
  }
});
test("P001 private fixture cannot launch from production even with marker", async () => {
  const { createRuntime } = await import(
    "../../packages/codex-adapter/src/runtime.js"
  );
  const mode = process.env.NODE_ENV,
    marker = process.env.HARBOR_FIXTURE_MODE;
  process.env.NODE_ENV = "production";
  process.env.HARBOR_FIXTURE_MODE = "private-test";
  try {
    await assert.rejects(
      createRuntime({
        sessionId: "session",
        projectId: "project",
        workspacePath: "/unopened",
        generation: 1,
        fixture: true,
      }),
      /disabled/,
    );
  } finally {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    if (marker === undefined) delete process.env.HARBOR_FIXTURE_MODE;
    else process.env.HARBOR_FIXTURE_MODE = marker;
  }
});

test("P001-06 completed target during activation wait sends no interrupt", async () => {
  const child = fixture();
  const originalWrite = child.stdin.write.bind(child.stdin);
  let interrupts = 0;
  child.stdin.write = ((chunk: any, ...rest: any[]) => {
    if (JSON.parse(String(chunk)).method === "turn/interrupt") interrupts++;
    return (originalWrite as any)(chunk, ...rest);
  }) as typeof child.stdin.write;
  const adapter = new CodexAdapter(child);
  try {
    await adapter.initialize();
    const { thread } = await adapter.startThread({ cwd: "/workspace" });
    const { turn } = await adapter.startTurn(
      thread.id,
      "[activation-completed]",
    );
    await assert.rejects(
      adapter.interruptTurn(thread.id, turn.id),
      TurnAlreadyCompletedError,
    );
    assert.equal(interrupts, 0);
    assert.equal((await adapter.readAccount()).account, null);
  } finally {
    await adapter.closeAndWait();
  }
});
test("P002 cancellation rechecks authority after delayed activation and writes no interrupt after revocation", async () => {
  let allowed = true,
    interrupts = 0;
  const process = fixture();
  const write = process.stdin.write.bind(process.stdin);
  process.stdin.write = ((chunk: any, ...args: any[]) => {
    if (String(chunk).includes('"method":"turn/interrupt"')) interrupts++;
    return (write as any)(chunk, ...args);
  }) as any;
  const adapter = new CodexAdapter(process, {}, 1000, async (send) => {
    if (!allowed) throw Error("revoked");
    return send();
  });
  try {
    await adapter.initialize();
    const { thread } = await adapter.startThread({ cwd: "/workspace" });
    const { turn } = await adapter.startTurn(thread.id, "[activation-delay]");
    allowed = false;
    await assert.rejects(adapter.interruptTurn(thread.id, turn.id), /revoked/);
    assert.equal(interrupts, 0);
  } finally {
    adapter.close();
  }
});
test("P002 rejected pre-send approval preserves the native request for an authorized answer", async () => {
  let allowed = true,
    pending: any,
    answers = 0;
  const child = fixture(),
    write = child.stdin.write.bind(child.stdin);
  child.stdin.write = ((chunk: any, ...args: any[]) => {
    if (String(chunk).includes('"decision"')) answers++;
    return (write as any)(chunk, ...args);
  }) as any;
  const adapter = new CodexAdapter(
    child,
    {
      onRequest: (r) => {
        pending = r;
      },
    },
    1000,
    async (send) => {
      if (!allowed) throw Error("revoked");
      return send();
    },
  );
  try {
    await adapter.initialize();
    const { thread } = await adapter.startThread({ cwd: "/workspace" });
    await adapter.startTurn(thread.id, "[approval]");
    for (let n = 0; !pending && n < 100; n++)
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(pending);
    allowed = false;
    await assert.rejects(
      adapter.respond(pending.id, { decision: "accept" }),
      /revoked/,
    );
    assert.equal(answers, 0);
    allowed = true;
    await adapter.respond(pending.id, { decision: "decline" });
    assert.equal(answers, 1);
  } finally {
    adapter.close();
  }
});

test("P005 adapter emits exact scoped localImage and rejects caller paths", async () => {
  const home = await mkdtemp(join(tmpdir(), "harbor-attachment-contract-"));
  const trace = join(home, "trace.jsonl");
  const child = spawn(process.execPath, ["tests/fixtures/codex/server.mjs"], {
    stdio: "pipe",
    env: { PATH: process.env.PATH, HARBOR_FIXTURE_TRACE_FILE: trace },
  });
  const adapter = new CodexAdapter(child, {});
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  try {
    await adapter.initialize();
    const { thread } = await adapter.startThread({ cwd: "/workspace" });
    await assert.rejects(
      adapter.startTurn(thread.id, "read", {
        attachments: [{ id, kind: "image", path: "/etc/passwd" }],
      }),
      /reference/,
    );
    await adapter.startTurn(thread.id, "read", {
      attachments: [{ id, kind: "image", path: `/attachments/${id}` }],
    });
    const records = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const turns = records.filter((x) => x.method === "turn/start");
    assert.equal(turns.length, 1);
    assert.deepEqual(turns[0].attachmentTypes, ["text", "localImage"]);
    assert.deepEqual(turns[0].attachmentPaths, [`/attachments/${id}`]);
  } finally {
    adapter.close();
    await rm(home, { recursive: true, force: true });
  }
});
