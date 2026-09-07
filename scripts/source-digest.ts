import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
/** SHA256 over sorted repo-relative path, NUL, file SHA256, newline records. */
export function sourceDigest() {
  const roots = ["apps/", "packages/", "infra/", "tests/", "scripts/"];
  const configs = new Set([
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    ".gitignore",
    ".prettierignore",
  ]);
  const files = [
    ...new Set(
      execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
        encoding: "utf8",
      })
        .split("\0")
        .filter(Boolean),
    ),
  ]
    .filter(
      (file) =>
        (roots.some((root) => file.startsWith(root)) || configs.has(file)) &&
        !file.endsWith(".md") &&
        !file
          .split("/")
          .some((part) =>
            ["node_modules", "dist", "__pycache__"].includes(part),
          ),
    )
    .sort();
  const hash = createHash("sha256");
  for (const file of files)
    hash.update(
      file +
        "\0" +
        createHash("sha256").update(readFileSync(file)).digest("hex") +
        "\n",
    );
  return {
    algorithm: "sha256-path-and-content-v1",
    files: files.length,
    digest: hash.digest("hex"),
  };
}
