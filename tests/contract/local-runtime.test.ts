import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchLocalRuntime } from "../../packages/codex-adapter/src/local-runtime.js";

test("personal runtime requires explicit opt-in, private state and conversation purpose", async () => {
  const original = { ...process.env };
  const root = await mkdtemp(join(tmpdir(), "harbor-local-runtime-"));
  const home = join(root, "home"),
    workspacePath = join(root, "workspace"),
    binary = join(root, "codex");
  await mkdir(home, { mode: 0o700 });
  await mkdir(workspacePath);
  await writeFile(
    binary,
    `#!${process.execPath}\nif (process.argv.includes('--version')) { console.log('codex-cli 0.153.4'); process.exit(0); }\nconsole.log(JSON.stringify({ home: process.env.CODEX_HOME, apiKey: process.env.OPENAI_API_KEY, inherited: process.env.HARBOR_SECRET }));\nrequire('node:child_process').spawn('/bin/sleep', ['300'], { stdio: 'ignore' });\nsetInterval(() => {}, 1000);\n`,
    { mode: 0o700 },
  );
  const config = {
    sessionId: "local",
    projectId: "local",
    workspacePath,
    generation: 1,
  };
  try {
    delete process.env.HARBOR_LOCAL_MODE;
    await assert.rejects(launchLocalRuntime(config), /disabled/);
    process.env.HARBOR_LOCAL_MODE = "personal";
    process.env.HARBOR_LOCAL_CODEX_HOME = home;
    process.env.HARBOR_LOCAL_CODEX_BINARY = binary;
    process.env.OPENAI_API_KEY = "must-not-inherit";
    process.env.HARBOR_SECRET = "must-not-inherit";
    await assert.rejects(
      launchLocalRuntime({ ...config, purpose: "terminal" }),
      /plain conversations/,
    );
    await assert.rejects(
      launchLocalRuntime({
        ...config,
        gitCommon: { canonical: workspacePath, device: "1", inode: "1" },
      }),
      /plain conversations/,
    );
    process.env.HARBOR_LOCAL_CODEX_HOME = workspacePath;
    await assert.rejects(launchLocalRuntime(config), /private and separate/);
    process.env.HARBOR_LOCAL_CODEX_HOME = home;
    const child = await launchLocalRuntime(config);
    try {
      const output = await new Promise<string>((resolve, reject) => {
        child.stdout.once("data", (data) => resolve(String(data)));
        child.once("error", reject);
      });
      assert.deepEqual(JSON.parse(output), { home: await realpath(home) });
      let inspection;
      for (let attempt = 0; attempt < 100; attempt++) {
        inspection = await child.inspectOwned!();
        if (
          inspection.processes.some((entry) =>
            entry.executable.includes("sleep"),
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(inspection?.status, "known");
      assert.ok(
        inspection?.processes.some((entry) =>
          entry.executable.includes("sleep"),
        ),
      );
      await child.closeOwned!();
      assert.equal((await child.inspectOwned!()).status, "runtime_gone");
      await child.closeOwned!();
    } finally {
      await child.closeOwned!();
    }
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "personal pinned native policy forbids sandbox escalation and denies read-only writes",
  { timeout: 30000, skip: !process.env.HARBOR_LOCAL_CONTRACT_BINARY },
  async () => {
    const original = { ...process.env };
    // Linux sandbox helper aliases require a persistent home outside /tmp.
    const parent = new URL(
      "../../.test-runs/local-native-contracts/",
      import.meta.url,
    );
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const { fileURLToPath } = await import("node:url");
    const root = await realpath(
      await mkdtemp(join(fileURLToPath(parent), "run-")),
    );
    const home = join(root, "home"),
      workspacePath = join(root, "workspace"),
      outside = join(root, "outside");
    await mkdir(home, { mode: 0o700 });
    await mkdir(workspacePath);
    await writeFile(outside, "preserve");
    process.env.HARBOR_LOCAL_MODE = "personal";
    process.env.HARBOR_LOCAL_CODEX_HOME = home;
    process.env.HARBOR_LOCAL_CODEX_BINARY =
      process.env.HARBOR_LOCAL_CONTRACT_BINARY;
    const { createRuntime } = await import(
      "../../packages/codex-adapter/src/runtime.js"
    );
    const adapter = await createRuntime({
      sessionId: "native-contract",
      projectId: "native-contract",
      generation: 1,
      workspacePath,
    });
    try {
      assert.equal((await adapter.readAccount()).account, null);
      const started = await adapter.startThread({
        cwd: workspacePath,
        permissionProfile: "read-only",
      });
      const policy = {
        granular: {
          sandbox_approval: false,
          rules: true,
          skill_approval: false,
          request_permissions: false,
          mcp_elicitations: false,
        },
      };
      assert.deepEqual(started.approvalPolicy, policy);
      assert.equal((started.sandbox as { type: string }).type, "readOnly");
      assert.equal(started.cwd, workspacePath);
      // Exercise native OS enforcement through the private test transport only.
      // command/exec is standalone: this proves explicit native read-only policy,
      // while thread response above establish the conversation configuration.
      const transport = adapter as unknown as {
        request(
          method: string,
          params: object,
        ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
      };
      const command = (args: string[]) =>
        transport.request("command/exec", {
          command: args,
          cwd: workspacePath,
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          timeoutMs: 5000,
        });
      const readable = await command(["/bin/cat", outside]);
      assert.equal(readable.exitCode, 0);
      assert.equal(readable.stdout, "preserve");
      const denied = await command([
        "/bin/sh",
        "-c",
        'printf overwrite > "$1"',
        "sh",
        outside,
      ]);
      assert.notEqual(denied.exitCode, 0);
      const { readFile, access } = await import("node:fs/promises");
      assert.equal(await readFile(outside, "utf8"), "preserve");
      const workspaceDenied = await command([
        "/usr/bin/touch",
        join(workspacePath, "denied"),
      ]);
      assert.notEqual(workspaceDenied.exitCode, 0);
      await assert.rejects(access(join(workspacePath, "denied")));
    } finally {
      await adapter.closeAndWait();
      assert.equal((await adapter.inspectProcesses()).status, "runtime_gone");
      for (const key of Object.keys(process.env))
        if (!(key in original)) delete process.env[key];
      Object.assign(process.env, original);
      await rm(root, { recursive: true, force: true });
    }
  },
);
