import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
export interface PersonalCgroupIdentity {
  path: string;
  device: string;
  inode: string;
  bootId: string;
  generation: number;
}
const mount = "/sys/fs/cgroup";
const boot = () =>
  readFile("/proc/sys/kernel/random/boot_id", "utf8").then((value) =>
    value.trim(),
  );
const inside = (root: string, path: string) => {
  const r = relative(root, path);
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
};
let delegation: Promise<string> | undefined;
/** Use only the service's own delegated subtree; never accept an arbitrary path. */
async function delegatedRoot() {
  return (delegation ??= (async () => {
    if (process.platform !== "linux")
      throw Error("Personal cgroups require Linux");
    const membership = await readFile("/proc/self/cgroup", "utf8");
    const entry = membership.split("\n").find((line) => line.startsWith("0::"));
    if (!entry) throw Error("Personal runtime requires unified cgroup v2");
    const root = join(mount, entry.slice(3));
    if (!inside(mount, root) || (await realpath(root)) !== root)
      throw Error("Personal cgroup delegation unavailable");
    await readFile(join(root, "cgroup.controllers"), "utf8");
    const manager = join(root, `harbor-manager-${process.pid}-${randomUUID()}`);
    await mkdir(manager);
    try {
      await writeFile(join(manager, "cgroup.procs"), String(process.pid));
    } catch (error) {
      await rmdir(manager).catch(() => {});
      throw error;
    }
    return root;
  })());
}
function valid(identity: PersonalCgroupIdentity) {
  return (
    identity &&
    typeof identity.path === "string" &&
    inside(mount, identity.path) &&
    /\/conversation-[a-zA-Z0-9_-]{1,64}-[1-9][0-9]*-[0-9a-f-]{36}$/.test(
      identity.path,
    ) &&
    typeof identity.device === "string" &&
    /^\d+$/.test(identity.device) &&
    typeof identity.inode === "string" &&
    /^\d+$/.test(identity.inode) &&
    typeof identity.bootId === "string" &&
    /^[0-9a-f-]{36}$/.test(identity.bootId) &&
    Number.isSafeInteger(identity.generation) &&
    identity.generation > 0
  );
}
async function same(identity: PersonalCgroupIdentity) {
  if (
    !valid(identity) ||
    process.platform !== "linux" ||
    (await boot()) !== identity.bootId
  )
    throw Error("Personal cgroup identity unavailable");
  const info = await stat(identity.path, { bigint: true });
  if (
    !info.isDirectory() ||
    String(info.dev) !== identity.device ||
    String(info.ino) !== identity.inode ||
    (await realpath(identity.path)) !== identity.path
  )
    throw Error("Personal cgroup identity changed");
}
async function populated(identity: PersonalCgroupIdentity) {
  await same(identity);
  const events = await readFile(join(identity.path, "cgroup.events"), "utf8");
  const value = /^populated ([01])$/m.exec(events)?.[1];
  if (value === undefined)
    throw Error("Personal cgroup population unavailable");
  return value === "1";
}
async function tree(root: string) {
  const paths = [root];
  for (let i = 0; i < paths.length; i++) {
    for (const entry of await readdir(paths[i]!, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error("Unexpected cgroup link");
      if (entry.isDirectory()) paths.push(join(paths[i]!, entry.name));
    }
    if (paths.length > 256)
      throw Error("Personal cgroup inspection bound exceeded");
  }
  return paths;
}
export async function inspectRecoveredCgroup(
  identity: unknown,
  host: unknown,
): Promise<"absent" | "unknown"> {
  if (
    host !== hostname() ||
    process.platform !== "linux" ||
    !valid(identity as PersonalCgroupIdentity)
  )
    return "unknown";
  const owned = identity as PersonalCgroupIdentity;
  try {
    // A verified host reboot proves every process from the previous boot absent.
    if ((await boot()) !== owned.bootId) return "absent";
    return (await populated(owned)) ? "unknown" : "absent";
  } catch {
    return "unknown";
  }
}
export async function createPersonalCgroup(
  sessionId: string,
  generation: number,
) {
  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId) ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  )
    throw Error("Invalid personal runtime identity");
  const root = await delegatedRoot();
  const path = join(
    root,
    `conversation-${sessionId}-${generation}-${randomUUID()}`,
  );
  await mkdir(path);
  const info = await stat(path, { bigint: true });
  const identity: PersonalCgroupIdentity = {
    path,
    device: String(info.dev),
    inode: String(info.ino),
    bootId: await boot(),
    generation,
  };
  // Missing kernel support/delegation never falls back to process-group inference.
  try {
    await access(join(path, "cgroup.kill"), constants.W_OK);
    await readFile(join(path, "cgroup.events"), "utf8");
  } catch (error) {
    await rmdir(path).catch(() => {});
    throw error;
  }
  let removed = false;
  return {
    identity,
    async admit(pid: number) {
      await same(identity);
      await writeFile(join(path, "cgroup.procs"), String(pid));
      const placed = await readFile(`/proc/${pid}/cgroup`, "utf8");
      if (!placed.split("\n").includes(`0::${path.slice(mount.length)}`))
        throw Error("Personal guardian cgroup placement unconfirmed");
    },
    async inspect() {
      if (removed) return { gone: true, processes: [] };
      await same(identity);
      const census = await stableCgroupCensus({
        populated: () => populated(identity),
        members: async () => {
          await same(identity);
          const pids = new Set<number>();
          for (const directory of await tree(path))
            for (const line of (
              await readFile(join(directory, "cgroup.procs"), "utf8")
            )
              .trim()
              .split("\n")) {
              if (!line) continue;
              const pid = Number(line);
              if (!Number.isSafeInteger(pid) || pid < 1)
                throw Error("Invalid cgroup process identity");
              pids.add(pid);
            }
          return [...pids];
        },
        executable: (pid) =>
          readFile(`/proc/${pid}/comm`, "utf8").then((name) =>
            name.trim().slice(0, 256),
          ),
      });
      await same(identity);
      return census;
    },
    async retire() {
      if (removed) return;
      await same(identity);
      await writeFile(join(path, "cgroup.kill"), "1");
      const deadline = Date.now() + 10_000;
      while (await populated(identity)) {
        if (Date.now() >= deadline)
          throw Error("Personal cgroup retirement unconfirmed");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await same(identity);
      // Keep the empty identity until durable membership release commits.
    },
    async cleanup() {
      if (removed) return;
      await same(identity);
      if (await populated(identity))
        throw Error("Cannot remove populated personal cgroup");
      for (const directory of (await tree(path)).reverse())
        await rmdir(directory);
      removed = true;
    },
  };
}

/** A disappearing parent may have left a new child: never silently drop its PID.
 * Re-sample the complete membership on both sides of process metadata reads.
 * Only the kernel population flag can establish absence, including empty scans.
 */
export async function stableCgroupCensus(source: {
  populated(): Promise<boolean>;
  members(): Promise<number[]>;
  executable(pid: number): Promise<string>;
}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await source.populated())) return { gone: true, processes: [] };
    try {
      const before = new Set(await source.members());
      if (!before.size) continue;
      const processes = [];
      for (const pid of before)
        processes.push({ pid, executable: await source.executable(pid) });
      const after = new Set(await source.members());
      if (!(await source.populated())) return { gone: true, processes: [] };
      if (
        before.size === after.size &&
        [...before].every((pid) => after.has(pid))
      )
        return { gone: false, processes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!(await source.populated())) return { gone: true, processes: [] };
  throw Error("Personal cgroup census changed; process ownership is unknown");
}
