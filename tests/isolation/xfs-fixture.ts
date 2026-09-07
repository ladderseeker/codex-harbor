import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, realpath, writeFile, rm, chown } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, randomInt } from "node:crypto";
const exec = promisify(execFile);
export async function xfsFixture() {
  if (
    process.platform !== "linux" ||
    process.getuid?.() !== 0 ||
    !process.env.HARBOR_TEST_XFS_MOUNT
  )
    throw Error(
      "Dedicated Linux XFS verification mount/root authority required",
    );
  const mount = await realpath(process.env.HARBOR_TEST_XFS_MOUNT),
    controlRoot = await realpath(
      process.env.HARBOR_TEST_CONTROL_ROOT ?? "/var/lib/harbor-verification",
    );
  const id = "xfs-" + randomUUID(),
    base = join(mount, id),
    control = join(controlRoot, id),
    rootId = randomUUID();
  await mkdir(base, { mode: 0o700 });
  await mkdir(control, { mode: 0o700 });
  for (const name of ["projects", "pool"])
    await mkdir(join(base, name), { mode: 0o700 });
  await mkdir(join(control, "state"), { mode: 0o700 });
  const ids: number[] = [];
  for (let i = 0; i < 2; i++) {
    const project = randomInt(10000, 1000000000);
    const existing = (
      await exec(
        "xfs_quota",
        ["-x", "-c", `report -p -b -n -N -L ${project} -U ${project}`, mount],
        { timeout: 5000 },
      )
    ).stdout;
    if (existing.trim()) throw Error("Unexpected quota identifier collision");
    ids.push(project);
    const slot = join(base, "pool", "slot" + i);
    await mkdir(slot, { mode: 0o700 });
    await mkdir(join(slot, "workspace"), { mode: 0o700 });
    await chown(join(slot, "workspace"), 10001, 10001);
    await mkdir(join(slot, "native"), { mode: 0o700 });
    await exec(
      "xfs_quota",
      ["-x", "-c", `project -s -p ${slot} ${project}`, mount],
      { timeout: 5000 },
    );
    await exec(
      "xfs_quota",
      ["-x", "-c", `limit -p bhard=64m ihard=512 ${project}`, mount],
      { timeout: 5000 },
    );
  }
  const profile = {
    roots: [
      { id: rootId, path: join(base, "projects"), pool: join(base, "pool") },
    ],
    blockHardLimitBytes: 67108864,
    inodeHardLimit: 512,
    reserveBytes: 8388608,
    reserveInodes: 16,
  };
  const env = {
    ...process.env,
    HARBOR_XFS_PROFILE: JSON.stringify(profile),
    HARBOR_PROJECT_ROOTS: JSON.stringify([
      { id: rootId, name: "Owned XFS test root", path: join(base, "projects") },
    ]),
    HARBOR_LAUNCHER_STATE_DIR: join(control, "state"),
    HARBOR_STORAGE_SOCKET: join(control, "storage.sock"),
    HARBOR_STORAGE_CLIENT_UID: "0",
    HARBOR_EGRESS_DNS_PROFILE: "cloudflare-doh",
  };
  await writeFile(
    join(control, "manifest.json"),
    JSON.stringify({ id, mount, base, control, ids, profile }),
    { mode: 0o600 },
  );
  return {
    id,
    base,
    control,
    rootId,
    profile,
    ids,
    env,
    mount,
    async cleanup() {
      await rm(base, { recursive: true, force: true });
      for (const project of ids)
        await exec(
          "xfs_quota",
          ["-x", "-c", `limit -p bhard=0 ihard=0 ${project}`, mount],
          { timeout: 5000 },
        );
      await rm(control, { recursive: true, force: true });
    },
  };
}
