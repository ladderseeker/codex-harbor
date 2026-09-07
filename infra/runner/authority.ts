import {
  mkdir,
  readFile,
  open,
  rename,
  rmdir,
  realpath,
  stat,
} from "node:fs/promises";
import { resolve, relative, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { revokeEgress } from "../egress/network.mjs";
import type { RunnerConfig } from "./launcher.js";
const exec = promisify(execFile);
/** Fail closed on stale/crashed locks; only trusted operator recovery may remove one. */
export async function withRunnerAuthority<T>(
  config: RunnerConfig,
  launch: () => Promise<T>,
): Promise<T> {
  return authority(config, launch, false);
}
export async function retireRuntimeIdentity(config: {
  instanceId: string;
  projectId: string;
  sessionId: string;
}): Promise<void> {
  await authority(
    { ...config, generation: 0 } as RunnerConfig,
    async () => undefined,
    true,
  );
}
async function authority<T>(
  config: RunnerConfig,
  launch: () => Promise<T>,
  retire: boolean,
): Promise<T> {
  const setting = process.env.HARBOR_LAUNCHER_STATE_DIR;
  if (!setting || !isAbsolute(setting))
    throw Error("Private launcher authority directory required");
  const directory = await realpath(setting);
  const info = await stat(directory);
  if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
    throw Error("Launcher authority must be private and owned by launcher");
  const roots: { path: string }[] = JSON.parse(
    process.env.HARBOR_PROJECT_ROOTS ?? "[]",
  );
  for (const root of roots) {
    const sub = relative(await realpath(root.path), directory);
    if (!sub || (!sub.startsWith("..") && !isAbsolute(sub)))
      throw Error("Launcher authority cannot live inside project root");
  }
  const key = [
    config.instanceId ?? "local",
    config.projectId,
    config.sessionId,
  ].join("-");
  if (!/^[a-z0-9_-]+$/.test(key)) throw Error("Invalid launcher identity");
  const lock = join(directory, key + ".lock"),
    ledger = join(directory, key + ".json");
  await mkdir(lock, { mode: 0o700 });
  try {
    let previous: { generation: number; container: string } | undefined;
    try {
      previous = JSON.parse(await readFile(ledger, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      if (!retire && config.generation <= previous.generation)
        throw Error("Stale runtime generation");
      if (
        !Number.isSafeInteger(previous.generation) ||
        previous.generation < 1 ||
        previous.container !==
          `harbor-${config.instanceId ?? "local"}-${config.sessionId}-${previous.generation}`
      )
        throw Error("Launcher ledger identity invalid");
      // Inspect only the recorded container; absent is safe. Unexpected ownership is not.
      const listing = await exec(
        "docker",
        [
          "ps",
          "-a",
          "--filter",
          `name=^/${previous.container}$`,
          "--format",
          "{{.ID}}",
        ],
        { timeout: 10_000, maxBuffer: 4096 },
      );
      if (listing.stdout.trim()) {
        const inspect = await exec(
          "docker",
          [
            "inspect",
            "--format",
            "{{json .Config.Labels}}",
            previous.container,
          ],
          { timeout: 10_000, maxBuffer: 4096 },
        );
        const labels = JSON.parse(inspect.stdout);
        if (
          labels["org.codex-harbor.owner"] !== "runner" ||
          labels["org.codex-harbor.instance"] !== (config.instanceId ?? "local")
        )
          throw Error("Runner ownership mismatch");
        await exec("docker", ["rm", "--force", previous.container], {
          timeout: 15_000,
          maxBuffer: 4096,
        }).catch(() => undefined);
        const remaining = await exec(
          "docker",
          ["ps", "-aq", "--filter", `name=^/${previous.container}$`],
          { timeout: 10000, maxBuffer: 4096 },
        );
        if (remaining.stdout.trim())
          throw Error("Owned runtime removal unconfirmed");
      }
      await revokeEgress({ ...config, generation: previous.generation });
    }
    if (retire) return await launch();
    const container =
      `harbor-${config.instanceId ?? "local"}-${config.sessionId}-${config.generation}`.toLowerCase();
    const temporary = join(lock, "next");
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(
        JSON.stringify({ generation: config.generation, container }),
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, ledger);
    const dir = await open(directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
    // Persist fence before launch: failed launch is not automatically retried with same generation.
    return await launch();
  } finally {
    await rmdir(lock);
  }
}
