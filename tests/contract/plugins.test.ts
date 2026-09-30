import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { CodexAdapter } from "../../packages/codex-adapter/src/index.js";
import { PERSONAL_RUNTIME_ARGS } from "../../packages/codex-adapter/src/local-runtime.js";

const exec = promisify(execFile);

/** Parse the enabled column of the `plugins` row of `codex features list`. */
function pluginsEnabled(listing: string) {
  const row = listing
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find((fields) => fields[0] === "plugins");
  assert.ok(row, "features list has a plugins row");
  assert.match(row.at(-1)!, /^(true|false)$/);
  return row.at(-1) === "true";
}

test(
  "P035-02 pinned runtime with personal arguments downloads no plugin catalog",
  { timeout: 60000, skip: !process.env.HARBOR_LOCAL_CONTRACT_BINARY },
  async () => {
    const binary = process.env.HARBOR_LOCAL_CONTRACT_BINARY!;
    // Codex refuses its PATH helpers under /tmp, so the run-owned home is persistent.
    const parent = new URL("../../.test-runs/p035-plugins/", import.meta.url);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const root = await realpath(
      await mkdtemp(join(fileURLToPath(parent), "run-")),
    );
    const home = join(root, "home"),
      workspace = join(root, "workspace");
    await mkdir(home, { mode: 0o700 });
    await mkdir(workspace);
    // No proxy, account or inherited configuration reaches the runtime.
    const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home };
    const child = spawn(binary, [...PERSONAL_RUNTIME_ARGS], {
      cwd: workspace,
      env,
      stdio: "pipe",
      detached: true,
    });
    // A failed spawn emits error without exit; either ends the wait.
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    const adapter = new CodexAdapter(child);
    try {
      // initialize also sends the initialized notification.
      const init = await adapter.initialize();
      assert.equal(typeof init.userAgent, "string");
      const models = await adapter.listModels();
      assert.ok(Array.isArray(models.data));
      assert.equal((await adapter.readAccount()).account, null);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      process.kill(-child.pid!, "SIGKILL");
      await exited;
      const scratch = await readdir(join(home, ".tmp")).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      // Covers plugins, plugins.sha, plugins-clone-* and the sync lock file.
      assert.deepEqual(
        scratch.filter(
          (name) => name.startsWith("plugins") || name.startsWith("git-"),
        ),
        [],
      );
      const features = async (args: string[]) =>
        (
          await exec(binary, [...args, "features", "list"], {
            cwd: workspace,
            env,
            timeout: 20000,
            maxBuffer: 1_048_576,
          })
        ).stdout;
      assert.ok(PERSONAL_RUNTIME_ARGS.includes("features.plugins=false"));
      assert.equal(
        pluginsEnabled(await features(["-c", "features.plugins=false"])),
        false,
      );
      assert.equal(pluginsEnabled(await features([])), true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {}
        await exited;
      }
      adapter.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
