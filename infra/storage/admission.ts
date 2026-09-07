import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relative, isAbsolute } from "node:path";
export type NativeStorage = {
  canonical: string;
  device: string;
  inode: string;
};
export async function prepareNativeStorage(
  workspacePath: string,
  sessionId: string,
): Promise<NativeStorage> {
  if (process.platform !== "linux" || process.getuid?.() !== 0)
    throw Error("Managed XFS profile requires the trusted Linux launcher");
  const profile = JSON.parse(process.env.HARBOR_XFS_PROFILE ?? "null");
  if (!profile?.roots) throw Error("Enforced XFS storage profile is required");
  const root = profile.roots.find((r: { path: string }) => {
    const sub = relative(r.path, workspacePath);
    return sub && !sub.startsWith("..") && !isAbsolute(sub);
  });
  if (!root) throw Error("Workspace lacks managed XFS storage");
  const relativePath = relative(root.path, workspacePath);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\/workspace$/.test(relativePath))
    throw Error("Managed workspace mapping invalid");
  return new Promise((resolve, reject) => {
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
    let diagnostic = "";
    child.stderr.on("data", (b) => {
      diagnostic = (diagnostic + b.toString()).slice(0, 200);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("Managed XFS admission unavailable"));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0)
          throw Error(
            /^Managed XFS storage unavailable: [a-zA-Z -]{1,80}\n$/.test(
              diagnostic,
            )
              ? diagnostic.trim()
              : "Enforced XFS quota or runner ownership unavailable",
          );
        resolve(JSON.parse(output));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(
      JSON.stringify({
        action: "native",
        rootId: root.id,
        relativePath,
        sessionId,
      }),
    );
  });
}
