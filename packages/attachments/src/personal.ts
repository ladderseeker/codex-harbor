import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { NativeStorage } from "../../../infra/storage/admission.ts";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function personalAttachmentRoot(
  sessionId: string,
  workspace: string,
) {
  const home =
    process.env.HARBOR_PERSONAL_VPS_MODE === "personal"
      ? process.env.HARBOR_PERSONAL_VPS_CODEX_HOME
      : process.env.HARBOR_LOCAL_CODEX_HOME;
  if (
    !home ||
    !isAbsolute(home) ||
    !uuid.test(sessionId) ||
    (await realpath(home)) !== home
  )
    throw Error("Dedicated canonical native home required");
  const normal = join(await realpath(homedir()), ".codex");
  const inside = (p: string, c: string) => {
    const r = relative(p, c);
    return !r || (!r.startsWith("..") && !isAbsolute(r));
  };
  const root = join(dirname(home), "home", "attachments", sessionId);
  if (
    inside(normal, home) ||
    inside(home, root) ||
    home === (await realpath(homedir())) ||
    inside(workspace, root) ||
    inside(root, workspace) ||
    inside(workspace, home) ||
    inside(home, workspace)
  )
    throw Error(
      "Attachment state must be separate from workspace and normal native state",
    );
  return { home, root };
}
export async function validatePersonalAttachmentDirectory(
  directory: NativeStorage,
  sessionId: string,
  workspace: string,
) {
  const { root } = await personalAttachmentRoot(sessionId, workspace);
  const info = await lstat(root, { bigint: true });
  if (
    directory.canonical !== root ||
    (await realpath(root)) !== root ||
    !info.isDirectory() ||
    info.uid !== BigInt(process.getuid!()) ||
    (info.mode & 0o077n) !== 0n ||
    directory.device !== String(info.dev) ||
    directory.inode !== String(info.ino)
  )
    throw Error("Attachment directory identity verification failed");
  return root;
}
export async function publishPersonalAttachments(
  sessionId: string,
  workspace: string,
  directory: NativeStorage | undefined,
  files: Record<string, any>[],
) {
  const { home } = await personalAttachmentRoot(sessionId, workspace);
  return new Promise<{
    directory: NativeStorage;
    files: { id: string; device: string; inode: string }[];
  }>((resolve, reject) => {
    const child = spawn(
      "python3",
      [
        fileURLToPath(
          new URL(
            "../../../infra/storage/personal_attachments.py",
            import.meta.url,
          ),
        ),
      ],
      { stdio: "pipe", env: { PATH: process.env.PATH } },
    );
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
    child.stdout.on("data", (b) => {
      output += b;
      if (output.length > 8192) child.kill("SIGKILL");
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("Attachment publication unavailable"));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0)
          throw Error("Attachment publication or identity verification failed");
        resolve(JSON.parse(output));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(
      JSON.stringify({
        home,
        sessionId,
        workspace,
        directory,
        files: files.map((f) => ({
          id: f.id,
          digest: f.digest,
          content: f.content.toString("base64"),
          device: f.device,
          inode: f.inode,
        })),
      }),
    );
  });
}
