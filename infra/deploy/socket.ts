import { createConnection } from "node:net";
import { lstat, unlink } from "node:fs/promises";
/** Only a root-controlled managed-instance socket can be recovered after a crash. */
export async function recoverManagedSocket(socket: string, uid: number) {
  const instance = process.env.HARBOR_INSTANCE_ID;
  if (
    !process.env.HARBOR_MANAGED_RELEASE ||
    process.getuid?.() !== 0 ||
    !instance ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(instance) ||
    socket !== `/run/codex-harbor/${instance}/storage.sock`
  )
    throw Error("Explicit owned socket recovery required");
  const before = await lstat(socket, { bigint: true });
  if (
    !before.isSocket() ||
    Number(before.uid) !== uid ||
    (Number(before.mode) & 0o177) !== 0
  )
    throw Error("Unrecognized storage socket");
  const absent = await new Promise<boolean>((resolve) => {
    const client = createConnection(socket);
    client.setTimeout(1000);
    client.once("connect", () => {
      client.destroy();
      resolve(false);
    });
    client.once("timeout", () => {
      client.destroy();
      resolve(false);
    });
    client.once("error", (e: NodeJS.ErrnoException) =>
      resolve(e.code === "ECONNREFUSED"),
    );
  });
  if (!absent) throw Error("Storage socket live or uncertain");
  const after = await lstat(socket, { bigint: true });
  if (after.dev !== before.dev || after.ino !== before.ino)
    throw Error("Storage socket changed");
  await unlink(socket);
}
