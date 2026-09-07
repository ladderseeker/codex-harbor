import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { HarborError } from "../../policy/src/index.ts";
export interface ProjectRoot {
  id: string;
  name: string;
  path: string;
}
const execute = promisify(execFile);
export async function resolveProject(
  roots: ProjectRoot[],
  rootId: string,
  relative: string,
  create = false,
) {
  const root = roots.find((r) => r.id === rootId);
  if (!root)
    throw new HarborError(403, "ROOT_DENIED", "Project root is not allowed");
  if (
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((s) => s === ".." || s === "." || !s) ||
    relative.includes("\0")
  )
    throw new HarborError(
      403,
      "PATH_DENIED",
      "Use a confined relative folder path",
    );
  try {
    const { stdout } = await execute(
      "python3",
      [
        fileURLToPath(new URL("./confine.py", import.meta.url)),
        root.path,
        relative,
        String(create),
      ],
      { timeout: 5000, maxBuffer: 8192, env: { PATH: process.env.PATH } },
    );
    return JSON.parse(stdout).path as string;
  } catch {
    throw new HarborError(
      403,
      "PATH_DENIED",
      "Project folder is inaccessible or unsafe",
    );
  }
}
