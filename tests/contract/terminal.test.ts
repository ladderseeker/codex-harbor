import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CodexAdapter,
  CODEX_VERSION,
} from "../../packages/codex-adapter/src/index.ts";

test(
  "P006-01 pinned no-account PTY readiness, resize, byte output and delayed exit",
  { timeout: 45000 },
  async () => {
    const home = await realpath(
      await mkdtemp(join(tmpdir(), "harbor-terminal-contract-")),
    );
    const processId = randomUUID();
    const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home };
    let output = "";
    let writes = 0;
    let adapter: CodexAdapter | undefined;
    try {
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
        {
          onEvent: (method, params) => {
            if (method !== "command/exec/outputDelta") return;
            assert.equal(params.processId, processId);
            assert.equal(params.capReached, false);
            output += Buffer.from(
              params.deltaBase64 as string,
              "base64",
            ).toString("utf8");
          },
        },
        15000,
        async (send) => {
          writes++;
          return send();
        },
        [home],
        "terminal",
      );
      await adapter.initialize();
      const account = await adapter.readAccount();
      assert.equal(account.account, null);
      const started = await adapter.startTerminal({
        processId,
        permissionProfile: "workspace-write",
        cols: 80,
        rows: 24,
      });
      assert.ok(
        writes >= 2,
        "launch and exact readiness resize use authority guard",
      );
      await adapter.resizeTerminal(100, 30);
      const began = Date.now();
      await adapter.writeTerminal(
        Buffer.from(
          "stty size; printf 'PTY_READY\\n'; sleep 16; printf 'DELAYED_PTY_DONE\\n'; exit 7\n",
        ),
      );
      const result = await started.completion;
      assert.ok(
        Date.now() - began > 15000,
        "long-lived command outlives ordinary RPC deadline",
      );
      assert.equal(result.exitCode, 7);
      assert.match(output, /30 100/);
      assert.match(output, /PTY_READY/);
      assert.match(output, /DELAYED_PTY_DONE/);
      await assert.rejects(
        async () => adapter!.writeTerminal(Buffer.from("repeat\n")),
        /not running/,
      );
      await assert.rejects(
        () =>
          adapter!.startTerminal({
            processId: randomUUID(),
            permissionProfile: "read-only",
            cols: 80,
            rows: 24,
          }),
        /already used/,
      );
    } finally {
      if (adapter) await adapter.closeAndWait();
      await rm(home, { recursive: true, force: true });
    }
  },
);

test("terminal seccomp differs from the quota-safe base only by exact PTY unlock", async () => {
  const base = JSON.parse(
    await readFile(
      new URL("../../infra/runner/seccomp.json", import.meta.url),
      "utf8",
    ),
  );
  const terminal = JSON.parse(
    await readFile(
      new URL("../../infra/runner/seccomp-terminal.json", import.meta.url),
      "utf8",
    ),
  );
  const extra = terminal.syscalls.pop();
  assert.deepEqual(terminal, base);
  assert.deepEqual(extra, {
    comment:
      "Terminal-only PTY slave unlock; filesystem write ioctls remain denied.",
    names: ["ioctl"],
    action: "SCMP_ACT_ALLOW",
    args: [{ index: 1, value: 0x40045431, op: "SCMP_CMP_EQ" }],
  });
});
