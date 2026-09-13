import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { HarborError } from "../../policy/src/index.ts";
import type { ProjectRoot } from "./index.ts";

const execute = promisify(execFile);
let activeListings = 0;
export type DirectoryListing = {
  path: string;
  directories: { name: string; path: string }[];
  truncated: boolean;
};
export async function listProjectDirectories(
  roots: ProjectRoot[],
  rootId: string,
  relative: string,
): Promise<DirectoryListing> {
  const root = roots.find((r) => r.id === rootId);
  if (!root)
    throw new HarborError(403, "ROOT_DENIED", "Project root is not allowed");
  if (
    relative.length > 2048 ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    (relative !== "" &&
      relative.split("/").some((s) => !s || s === "." || s === ".."))
  )
    throw new HarborError(
      403,
      "PATH_DENIED",
      "Use a confined relative folder path",
    );
  if (activeListings >= 4)
    throw new HarborError(
      429,
      "DIRECTORY_BUSY",
      "Folder browsing is busy; try again",
      true,
    );
  activeListings++;
  try {
    const { stdout } = await execute(
      "python3",
      [
        fileURLToPath(new URL("./directories.py", import.meta.url)),
        root.path,
        relative,
      ],
      { timeout: 3000, maxBuffer: 262144, env: { PATH: process.env.PATH } },
    );
    return JSON.parse(stdout) as DirectoryListing;
  } catch {
    throw new HarborError(
      403,
      "PATH_DENIED",
      "Project folder is inaccessible or unsafe",
    );
  } finally {
    activeListings--;
  }
}
