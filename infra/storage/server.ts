import { executeWorkspace } from "./workspace-service.ts";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmod, lstat, chown, realpath } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
const socket = process.env.HARBOR_STORAGE_SOCKET;
if (
  !socket?.startsWith("/") ||
  process.platform !== "linux" ||
  process.getuid?.() !== 0
)
  throw Error(
    "Trusted storage service requires private Linux root service configuration",
  );
const uid = Number(process.env.HARBOR_STORAGE_CLIENT_UID),
  gid = Number(
    process.env.HARBOR_STORAGE_CLIENT_GID ??
      process.env.HARBOR_STORAGE_CLIENT_UID,
  );
if (
  !Number.isSafeInteger(uid) ||
  uid < 0 ||
  [10001, 10002].includes(uid) ||
  !Number.isSafeInteger(gid) ||
  gid < 0
)
  throw Error("Explicit trusted API client UID/GID required");
const parent = dirname(socket);
if ((await realpath(parent)) !== resolve(parent))
  throw Error("Canonical storage socket parent required");
const parentInfo = await lstat(parent);
if (
  parentInfo.uid !== 0 ||
  (parentInfo.mode & 0o007) !== 0 ||
  (parentInfo.mode & 0o020) !== 0 ||
  (uid !== 0 && (parentInfo.gid !== gid || (parentInfo.mode & 0o010) === 0))
)
  throw Error(
    "Storage socket parent must be root-controlled and privately traversable by API",
  );
for (let ancestor = parent; ; ancestor = dirname(ancestor)) {
  const info = await lstat(ancestor);
  if (
    info.isSymbolicLink() ||
    info.uid !== 0 ||
    ((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0)
  )
    throw Error("Untrusted storage socket ancestry");
  if (ancestor === dirname(ancestor)) break;
}
const profile = JSON.parse(process.env.HARBOR_XFS_PROFILE ?? "null");
if (!profile?.roots) throw Error("Storage profile required");
for (const root of profile.roots)
  for (const path of [root.path, root.pool]) {
    const sub = relative(await realpath(path), parent);
    if (!sub || (!sub.startsWith("..") && !isAbsolute(sub)))
      throw Error("Storage socket cannot live within project or pool roots");
  }
try {
  await lstat(socket);
  throw Error(
    "Storage socket already exists; explicit owned-instance recovery required",
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const server = createServer((req, res) => {
  let body = "";
  if (req.method !== "POST" || !["/", "/workspace"].includes(req.url ?? "")) {
    res.writeHead(404).end();
    return;
  }
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 8192) req.destroy();
  });
  req.on("end", () => {
    if (req.url === "/workspace") {
      let command;
      try {
        command = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      void executeWorkspace(command)
        .then((result) =>
          res
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify(result)),
        )
        .catch((error) =>
          res.writeHead(409, { "content-type": "application/json" }).end(
            JSON.stringify({
              error: "Managed workspace operation unavailable",
              code:
                error?.code === "WORKSPACE_STORAGE_FAILED"
                  ? "WORKSPACE_STORAGE_FAILED"
                  : "WORKSPACE_STORAGE_UNAVAILABLE",
            }),
          ),
        );
      return;
    }
    const child = spawn(
      "python3",
      [fileURLToPath(new URL("./quota.py", import.meta.url))],
      {
        stdio: "pipe",
        env: {
          PATH: process.env.PATH,
          HARBOR_XFS_PROFILE: process.env.HARBOR_XFS_PROFILE,
          HARBOR_LAUNCHER_STATE_DIR: process.env.HARBOR_LAUNCHER_STATE_DIR,
        },
      },
    );
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 12_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 8192) child.kill("SIGKILL");
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      res.writeHead(503).end();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      res
        .writeHead(code === 0 ? 200 : 503, {
          "content-type": "application/json",
        })
        .end(code === 0 ? output : '{"error":"managed_storage_unavailable"}');
    });
    child.stdin.end(body);
  });
});
server.listen(socket, async () => {
  await chmod(socket, 0o600);
  await chown(socket, uid, gid);
});
