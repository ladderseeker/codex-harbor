import {
  lstat,
  realpath,
  readFile,
  unlink,
  chmod,
  chown,
  open,
  rename,
} from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { Config } from "../../apps/api/src/config.ts";
/** Same root-owned, private-group IPC boundary as installed credential/storage sockets. */
export async function preparePreviewSocket(c: Config) {
  const path = c.HARBOR_PREVIEW_SOCKET!;
  if (!isAbsolute(path)) throw Error("Private preview socket required");
  const parent = dirname(path),
    info = await lstat(parent),
    uid = Number(process.env.HARBOR_CONTROL_CLIENT_UID ?? process.getuid?.()),
    gid = Number(process.env.HARBOR_CONTROL_CLIENT_GID ?? uid),
    instance = process.env.HARBOR_INSTANCE_ID ?? "harbor";
  if (
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    [10001, 10002, 10003].includes(uid) ||
    !Number.isSafeInteger(gid) ||
    gid < 0
  )
    throw Error("Invalid preview client identity");
  if (
    (await realpath(parent)) !== parent ||
    info.uid !== process.getuid?.() ||
    (info.mode & (uid === process.getuid?.() ? 0o077 : 0o027)) !== 0 ||
    (uid !== process.getuid?.() &&
      (process.getuid?.() !== 0 || info.gid !== gid || !(info.mode & 0o010)))
  )
    throw Error("Unsafe preview socket parent");
  for (let p = parent; ; p = dirname(p)) {
    const entry = await lstat(p);
    if (
      ![0, process.getuid?.()].includes(entry.uid) ||
      entry.isSymbolicLink() ||
      ((entry.mode & 0o022) !== 0 && (entry.mode & 0o1000) === 0)
    )
      throw Error("Untrusted preview socket ancestor");
    if (p === dirname(p)) break;
  }
  for (const root of c.roots) {
    const canonical = await realpath(root.path);
    if (parent === canonical || parent.startsWith(canonical + "/"))
      throw Error("Preview socket cannot be inside a project");
  }
  const marker = path + ".owner";
  try {
    const entry = await lstat(path),
      owner = JSON.parse(await readFile(marker, "utf8"));
    if (
      !entry.isSocket() ||
      entry.uid !== uid ||
      owner.instance !== instance ||
      owner.inode !== entry.ino ||
      owner.device !== entry.dev
    )
      throw Error("Preview socket ownership mismatch");
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return async () => {
    await chmod(path, 0o600);
    if (uid !== process.getuid?.()) await chown(path, uid, gid);
    const entry = await lstat(path),
      temp = marker + ".next";
    const f = await open(temp, "w", 0o600);
    try {
      await f.writeFile(
        JSON.stringify({ instance, inode: entry.ino, device: entry.dev }),
      );
      await f.sync();
    } finally {
      await f.close();
    }
    await rename(temp, marker);
    const directory = await open(parent, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  };
}
