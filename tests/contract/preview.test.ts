import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { CodexAdapter } from "../../packages/codex-adapter/src/index.ts";

// External protocol boundary only. Native startup/isolation is independently
// established by the actual Linux application lane, not by this fixture.
const fixture = () =>
  spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
import readline from 'node:readline';
const out=x=>process.stdout.write(JSON.stringify(x)+'\\n');let active,request;
for await(const line of readline.createInterface({input:process.stdin})){
 const q=JSON.parse(line);if(q.method==='initialized')continue;
 out({method:'fixture/request',params:{method:q.method,params:q.params}});
 if(q.method==='initialize')out({id:q.id,result:{userAgent:'preview-contract'}});
 else if(q.method==='account/read')out({id:q.id,result:{account:null}});
 else if(q.method==='command/exec'){active=q.params.processId;request=q.id;}
 else if(q.method==='command/exec/write'&&q.params.processId===active&&q.params.deltaBase64==='')out({id:q.id,result:{}});
 else out({id:q.id,error:{code:-32600,message:'unsupported'}});
}`,
    ],
    { stdio: "pipe", env: { PATH: process.env.PATH } },
  );

test("preview fixed non-PTY command, zero-byte identity and no conversation/input capability", async () => {
  const seen: any[] = [];
  let grants = 0;
  const adapter = new CodexAdapter(
    fixture(),
    {
      onEvent: (method, p) => {
        if (method === "fixture/request") seen.push(p);
      },
    },
    150,
    async (send) => {
      grants++;
      return send();
    },
    ["/workspace"],
    "preview",
    true,
  );
  try {
    await adapter.initialize();
    assert.equal((await adapter.readAccount()).account, null);
    const id = randomUUID();
    const started = await adapter.startPreview({
      processId: id,
      script: "dev:preview",
      port: 3456,
      permissionProfile: "read-only",
    });
    void started.completion.catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    await adapter.probePreview();
    const command = seen.find((v) => v.method === "command/exec").params;
    assert.deepEqual(command.command, [
      "/usr/local/bin/npm",
      "run",
      "dev:preview",
    ]);
    assert.equal(command.tty, false);
    assert.equal(command.streamStdin, true);
    assert.equal(command.env.PORT, "3456");
    assert.equal(command.env.HOST, "127.0.0.1");
    assert.equal(command.env.NODE_OPTIONS, null);
    assert.notEqual(
      command.env.NPM_CONFIG_USERCONFIG,
      command.env.NPM_CONFIG_GLOBALCONFIG,
    );
    assert.deepEqual(command.sandboxPolicy, {
      type: "externalSandbox",
      networkAccess: "restricted",
    });
    assert.ok(command.timeoutMs > 150);
    assert.equal(grants, 1);
    assert.ok(
      seen.filter((v) => v.method === "command/exec/write").length >= 2,
    );
    for (const probe of seen.filter((v) => v.method === "command/exec/write"))
      assert.deepEqual(probe.params, { processId: id, deltaBase64: "" });
    const before = seen.length;
    for (const action of [
      () => adapter.startThread({ cwd: "/workspace" }),
      () => adapter.resumeThread("x", { cwd: "/workspace" }),
      () => adapter.startTurn("x", "no model"),
      () => adapter.loginWithApiKey("fixture-secret"),
      () => adapter.logoutAccount(),
      () => adapter.interruptTurn("x", "y"),
      () => adapter.writeTerminal(Buffer.from("no input")),
      () => adapter.resizeTerminal(80, 24),
      () =>
        adapter.startPreview({
          processId: randomUUID(),
          script: "dev",
          port: 3456,
          permissionProfile: "read-only",
        }),
    ])
      await assert.rejects(async () => action());
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(seen.length, before);
    assert.equal(grants, 1);
  } finally {
    await adapter.closeAndWait();
  }
});
test("preview final launch authority rejection writes no command and cannot replay on the same transport", async () => {
  const seen: string[] = [];
  const adapter = new CodexAdapter(
    fixture(),
    {
      onEvent: (m, p) => {
        if (m === "fixture/request") seen.push(String(p.method));
      },
    },
    150,
    async () => {
      throw Error("authority expired");
    },
    ["/workspace"],
    "preview",
    true,
  );
  try {
    await adapter.initialize();
    await assert.rejects(
      adapter.startPreview({
        processId: randomUUID(),
        script: "dev",
        port: 3000,
        permissionProfile: "read-only",
      }),
      /authority expired/,
    );
    await assert.rejects(
      adapter.startPreview({
        processId: randomUUID(),
        script: "dev",
        port: 3000,
        permissionProfile: "read-only",
      }),
      /already used/,
    );
    assert.deepEqual(seen, ["initialize"]);
  } finally {
    await adapter.closeAndWait();
  }
});
