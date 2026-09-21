import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "../../packages/codex-adapter/src/runtime.ts";
import { type CodexAdapter } from "../../packages/codex-adapter/src/index.ts";
import { inspectRecoveredLocalRuntime } from "../../packages/codex-adapter/src/local-runtime.ts";

type CommandIdentity = {
  namespacePid: number;
  hostPid: number;
  namespacePids: number[];
  birthTick?: string;
  executable?: string;
  executablePath?: string;
};

async function processBirthTick(pid: number) {
  try {
    const contents = await readFile(`/proc/${pid}/stat`, "utf8");
    // comm may contain spaces/parentheses. Field 22 follows state (field 3).
    const tail = contents.slice(contents.lastIndexOf(") ") + 2).split(/\s+/);
    assert.match(tail[19] ?? "", /^\d+$/, "Process birth identity unavailable");
    return tail[19];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Independent kernel evidence, not the adapter inspection under test. Native
 * sandbox PIDs can be namespace-local (for example 2), never host PIDs. */
async function mapOwnedCommand(
  namespacePid: number,
  identity: ReturnType<CodexAdapter["ownedIdentity"]>,
  expectedCommand: string[],
): Promise<CommandIdentity | undefined> {
  if (process.platform !== "linux")
    return {
      namespacePid,
      hostPid: namespacePid,
      namespacePids: [namespacePid],
    };
  const expectedExecutable = await stat(expectedCommand[0], { bigint: true });
  const cgroup = identity?.cgroup;
  assert.ok(cgroup, "Linux native test requires an exact owned cgroup");
  const verifyScope = async () => {
    assert.ok(cgroup.path.startsWith("/sys/fs/cgroup/"));
    assert.equal(await realpath(cgroup.path), cgroup.path);
    const info = await stat(cgroup.path, { bigint: true });
    assert.equal(String(info.dev), cgroup.device);
    assert.equal(String(info.ino), cgroup.inode);
    assert.equal(
      (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
      cgroup.bootId,
    );
  };
  const census = async () => {
    const directories = [cgroup.path],
      pids = new Set<number>();
    for (let index = 0; index < directories.length; index++) {
      const directory = directories[index];
      for (const line of (
        await readFile(join(directory, "cgroup.procs"), "utf8")
      )
        .trim()
        .split("\n")) {
        if (!line) continue;
        const pid = Number(line);
        assert.ok(Number.isSafeInteger(pid) && pid > 0);
        pids.add(pid);
      }
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        assert.equal(
          entry.isSymbolicLink(),
          false,
          "Unexpected cgroup symlink",
        );
        if (entry.isDirectory()) directories.push(join(directory, entry.name));
      }
      assert.ok(
        directories.length <= 256,
        "Owned test cgroup traversal exceeded bound",
      );
    }
    return pids;
  };
  await verifyScope();
  const matches: CommandIdentity[] = [];
  for (const hostPid of await census()) {
    try {
      const birthTick = await processBirthTick(hostPid);
      if (!birthTick) continue;
      const status = await readFile(`/proc/${hostPid}/status`, "utf8");
      const namespacePids = /^NSpid:\s+(.+)$/m
        .exec(status)?.[1]
        .trim()
        .split(/\s+/)
        .map(Number);
      if (namespacePids?.at(-1) !== namespacePid) continue;
      const [executable, command] = await Promise.all([
        readFile(`/proc/${hostPid}/comm`, "utf8"),
        readFile(`/proc/${hostPid}/cmdline`, "utf8"),
      ]);
      const argv = command.split("\0").filter(Boolean);
      if (
        argv.length !== expectedCommand.length ||
        argv.some((part, index) => part !== expectedCommand[index])
      )
        continue;
      const [executablePath, executableInfo] = await Promise.all([
        readlink(`/proc/${hostPid}/exe`),
        stat(`/proc/${hostPid}/exe`, { bigint: true }),
      ]);
      if (
        executableInfo.dev !== expectedExecutable.dev ||
        executableInfo.ino !== expectedExecutable.ino
      )
        continue;
      assert.equal(
        namespacePids[0],
        hostPid,
        "Cgroup PIDs and /proc view must share the host namespace",
      );
      if ((await processBirthTick(hostPid)) !== birthTick) continue;
      matches.push({
        namespacePid,
        hostPid,
        namespacePids,
        birthTick,
        executable: executable.trim(),
        executablePath,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await verifyScope();
  assert.ok(
    matches.length <= 1,
    "Owned namespace PID maps to multiple expected commands",
  );
  const match = matches[0];
  return match &&
    (await census()).has(match.hostPid) &&
    (await processBirthTick(match.hostPid)) === match.birthTick
    ? match
    : undefined;
}

async function eventually(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 20_000;
  do {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail(message);
}

test(
  "P018 pinned native idle, descendants, targeted retirement and sandbox",
  { timeout: 90_000 },
  async () => {
    assert.ok(
      process.env.HARBOR_LOCAL_CONTRACT_BINARY,
      "UNVERIFIED P018-09: HARBOR_LOCAL_CONTRACT_BINARY must name the complete pinned native distribution; no default or fixture fallback",
    );
    const original = { ...process.env };
    const parent = fileURLToPath(
      new URL("../../.test-runs/p018/tests/native/", import.meta.url),
    );
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const root = await realpath(await mkdtemp(join(parent, "run-")));
    const lifecycle: Array<Record<string, unknown>> = [];
    let finished = false;
    const pidPresent = async (pid: number) => {
      const { stdout } = await promisify(execFile)(
        "/bin/ps",
        ["-axo", "pid="],
        {
          timeout: 3000,
          maxBuffer: 4_194_304,
        },
      );
      // Read-only independent evidence; never signal a recovered PID.
      return stdout.split("\n").some((line) => Number(line.trim()) === pid);
    };
    const identityPresent = async (identity: CommandIdentity) =>
      process.platform === "linux"
        ? (await processBirthTick(identity.hostPid)) === identity.birthTick
        : pidPresent(identity.hostPid);
    const home = join(root, "home"),
      workspace = join(root, "workspace"),
      outside = join(root, "outside.txt");
    await mkdir(home, { mode: 0o700 });
    await mkdir(workspace, { mode: 0o700 });
    await writeFile(outside, "preserve");
    delete process.env.HARBOR_PERSONAL_VPS_MODE;
    delete process.env.HARBOR_FIXTURE_MODE;
    process.env.HARBOR_LOCAL_MODE = "personal";
    process.env.HARBOR_LOCAL_CODEX_HOME = home;
    process.env.HARBOR_LOCAL_CODEX_BINARY =
      process.env.HARBOR_LOCAL_CONTRACT_BINARY;
    const owned: CodexAdapter[] = [];
    const identities: Array<{ groupId: number; host: string }> = [];
    const start = async (name: string, generation: number) =>
      createRuntime({
        sessionId: name,
        projectId: "p018-contract",
        workspacePath: workspace,
        generation,
        onTransport: (adapter) => {
          owned.push(adapter);
        },
        onOwnedIdentity: async (identity) => {
          identities.push(identity);
          // The callback must complete before any native child can exist.
          assert.equal(await inspectRecoveredLocalRuntime(identity), "unknown");
        },
      });
    type CommandResult = { exitCode: number; stdout: string; stderr: string };
    const command = (
      adapter: CodexAdapter,
      args: string[],
      write = false,
      retained = false,
    ) =>
      (
        adapter as unknown as {
          request(
            method: string,
            params: object,
            timeout?: number,
          ): Promise<CommandResult>;
        }
      ).request(
        "command/exec",
        {
          command: args,
          cwd: workspace,
          timeoutMs: retained ? 60_000 : 8000,
          sandboxPolicy: write
            ? {
                type: "workspaceWrite",
                writableRoots: [workspace],
                networkAccess: true,
                excludeTmpdirEnvVar: true,
                excludeSlashTmp: true,
              }
            : { type: "readOnly", networkAccess: false },
        },
        retained ? 65_000 : 15_000,
      );
    try {
      const a = await start("p018-a", 11),
        b = await start("p018-b", 12);
      assert.equal((await a.readAccount()).account, null);
      assert.equal((await b.readAccount()).account, null);
      assert.notDeepEqual(a.ownedIdentity(), b.ownedIdentity());
      const [ta, tb] = await Promise.all([
        a.startThread({ cwd: workspace }),
        b.startThread({ cwd: workspace }),
      ]);
      assert.notEqual(ta.thread.id, tb.thread.id);
      for (const adapter of [a, b])
        await eventually(async () => {
          const inspection = await adapter.inspectProcesses();
          return (
            inspection.status === "known" && inspection.processes.length === 0
          );
        }, "Pinned native runtime never became ordinary idle after startup helpers");
      const denied = await command(a, [
        "/bin/sh",
        "-c",
        'printf changed > "$1"',
        "sh",
        outside,
      ]);
      assert.notEqual(denied.exitCode, 0);
      assert.equal(await readFile(outside, "utf8"), "preserve");
      const deniedWorkspace = await command(a, [
        "/usr/bin/touch",
        join(workspace, "denied"),
      ]);
      assert.notEqual(deniedWorkspace.exitCode, 0);
      await assert.rejects(readFile(join(workspace, "denied")));
      // Real owned background descendants; these are not fixture classification flags.
      // Retained command responses remain pending while the native jobs run.
      // A completed shell command may kill its background children itself.
      const sleepCommand = [
        "/bin/sh",
        "-c",
        "echo $$ > sleep.pid; exec /bin/sleep 60",
      ];
      const sleeping = command(a, sleepCommand, true, true);
      void sleeping.catch(() => undefined);
      let sleepPid = 0;
      await eventually(async () => {
        sleepPid = Number(
          await readFile(join(workspace, "sleep.pid"), "utf8").catch(() => "0"),
        );
        return Number.isSafeInteger(sleepPid) && sleepPid > 1;
      }, "Native retained sleep did not publish its exact test PID");
      let sleepIdentity: CommandIdentity | undefined;
      await eventually(async () => {
        sleepIdentity = await mapOwnedCommand(sleepPid, a.ownedIdentity(), [
          "/bin/sleep",
          "60",
        ]);
        return sleepIdentity !== undefined;
      }, "Could not independently map sandbox sleep PID to its owned host identity");
      assert.ok(sleepIdentity);
      const expectedSleep = sleepIdentity;
      const sleepIdentityPresent = () => identityPresent(expectedSleep);
      assert.equal(await sleepIdentityPresent(), true);
      lifecycle.push({
        event: "retained-nonpty-command-alive",
        command: sleepCommand,
        ...expectedSleep,
        guardian: a.ownedIdentity(),
        at: new Date().toISOString(),
      });
      await eventually(
        async () =>
          (await a.inspectProcesses()).processes.some(
            (p) => p.pid === expectedSleep.hostPid,
          ),
        "Native background sleep escaped owned inspection",
      );
      const previewNonce = randomUUID();
      const server = join(workspace, `server-${previewNonce}.mjs`);
      const readiness = join(workspace, `preview-${previewNonce}.json`);
      const previewText = `P018_NATIVE_PREVIEW_${previewNonce}`;
      await writeFile(
        server,
        `import {createServer} from "node:http"; import {writeFileSync} from "node:fs";
const nonce = ${JSON.stringify(previewNonce)};
if (process.argv[2] !== nonce) throw Error("Unexpected test preview nonce");
const s = createServer((q,r) => r.end(${JSON.stringify(previewText)}));
s.listen(0, "127.0.0.1", () => writeFileSync(${JSON.stringify(readiness)}, JSON.stringify({nonce, namespacePid: process.pid, port: s.address().port})));
setTimeout(() => s.close(), 60000);`,
      );
      const previewCommand = [process.execPath, server, previewNonce];
      const serving = command(b, previewCommand, true, true);
      void serving.catch(() => undefined);
      let previewReady:
        | { nonce: string; namespacePid: number; port: number }
        | undefined;
      await eventually(async () => {
        try {
          previewReady = JSON.parse(await readFile(readiness, "utf8"));
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code === "ENOENT" ||
            error instanceof SyntaxError
          )
            return false;
          throw error;
        }
        return (
          previewReady?.nonce === previewNonce &&
          Number.isSafeInteger(previewReady.namespacePid) &&
          previewReady.namespacePid > 0 &&
          Number.isSafeInteger(previewReady.port) &&
          previewReady.port > 0 &&
          previewReady.port <= 65535
        );
      }, "Native preview failed to publish its nonce, namespace PID and bound port");
      assert.ok(previewReady);
      const port = previewReady.port;
      assert.equal(
        await (await fetch(`http://127.0.0.1:${port}`)).text(),
        previewText,
      );
      let previewIdentity: CommandIdentity | undefined;
      await eventually(async () => {
        previewIdentity = await mapOwnedCommand(
          previewReady!.namespacePid,
          b.ownedIdentity(),
          previewCommand,
        );
        return previewIdentity !== undefined;
      }, "Could not independently map sandbox preview PID to its owned host identity");
      assert.ok(previewIdentity);
      const expectedPreview = previewIdentity;
      assert.equal(await identityPresent(expectedPreview), true);
      lifecycle.push({
        event: "retained-preview-command-alive",
        command: previewCommand,
        ...expectedPreview,
        port,
        guardian: b.ownedIdentity(),
        at: new Date().toISOString(),
      });
      await eventually(
        async () =>
          (await b.inspectProcesses()).processes.some(
            (p) => p.pid === expectedPreview.hostPid,
          ),
        "Native preview escaped owned inspection",
      );
      await a.closeAndWait();
      const sleepSurvived = await sleepIdentityPresent();
      lifecycle.push({
        event: "after-close-and-wait",
        ...expectedSleep,
        present: sleepSurvived,
        at: new Date().toISOString(),
      });
      await eventually(
        async () => !(await sleepIdentityPresent()),
        "Retained native nonPTY command survived fulfilled retirement",
      );
      lifecycle.push({
        event: "host-sleep-identity-absent",
        ...expectedSleep,
        at: new Date().toISOString(),
      });
      assert.equal((await a.inspectProcesses()).status, "runtime_gone");
      assert.equal(
        await inspectRecoveredLocalRuntime(a.ownedIdentity()),
        "absent",
      );
      assert.equal(
        await inspectRecoveredLocalRuntime(b.ownedIdentity()),
        "unknown",
      );
      assert.equal(
        await (await fetch(`http://127.0.0.1:${port}`)).text(),
        previewText,
      );
      assert.equal(
        await identityPresent(expectedPreview),
        true,
        "Sibling preview host identity retired with another conversation",
      );
      lifecycle.push({
        event: "preview-preserved-after-sibling-retirement",
        ...expectedPreview,
        at: new Date().toISOString(),
      });
      assert.ok(
        (await b.listModels()).data.length > 0,
        "Sibling runtime stopped with targeted retirement",
      );
      await b.closeAndWait();
      await eventually(
        async () => !(await identityPresent(expectedPreview)),
        "Retained native preview host identity survived fulfilled retirement",
      );
      lifecycle.push({
        event: "host-preview-identity-absent",
        ...expectedPreview,
        at: new Date().toISOString(),
      });
      assert.equal(
        await inspectRecoveredLocalRuntime(b.ownedIdentity()),
        "absent",
      );
      await assert.rejects(fetch(`http://127.0.0.1:${port}`));
      assert.equal(
        await inspectRecoveredLocalRuntime({
          ...identities[0],
          host: "untrusted-other-host",
        }),
        "unknown",
      );
      assert.equal(
        await inspectRecoveredLocalRuntime({
          groupId: 1,
          host: identities[0].host,
        }),
        "unknown",
      );
      finished = true;
    } finally {
      const results = await Promise.allSettled(
        owned.map((adapter) => adapter.closeAndWait()),
      );
      for (const key of Object.keys(process.env))
        if (!(key in original)) delete process.env[key];
      Object.assign(process.env, original);
      const evidence = JSON.stringify(
        {
          platform: process.platform,
          completed: finished,
          lifecycle,
          adapterRetirementCallsFulfilled: results.every(
            (result) => result.status === "fulfilled",
          ),
        },
        null,
        2,
      );
      await writeFile(join(root, "lifecycle.json"), evidence);
      // Keep the independent namespace/host mapping after successful resource cleanup.
      await writeFile(
        join(parent, `${basename(root)}-lifecycle.json`),
        evidence,
      );
      // Retain the exact owned resources if absence could not be established.
      if (finished && results.every((result) => result.status === "fulfilled"))
        await rm(root, { recursive: true, force: true });
      else if (results.some((result) => result.status === "rejected"))
        throw Error(
          "P018 native cleanup unconfirmed; owned run directory retained",
        );
    }
  },
);
