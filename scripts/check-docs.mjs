import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = process.cwd(),
  ignored = new Set([
    "node_modules",
    ".git",
    ".test-runs",
    ".harbor-local",
    "dist",
    "generated",
  ]);
async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(filename)));
    else if (entry.name.endsWith(".md")) found.push(filename);
  }
  return found;
}
let errors = 0;
const files = await walk(root);
for (const filename of files) {
  const text = await readFile(filename, "utf8");
  if (/[\t ]+$/m.test(text) || !text.endsWith("\n")) {
    console.error(
      path.relative(root, filename) + ": whitespace/newline violation",
    );
    errors++;
  }
  const body = text.replace(/```[\s\S]*?```/g, "");
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split(/\s+"/)[0];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [part, fragment] = target.split("#");
    const resolved = part
      ? path.resolve(path.dirname(filename), decodeURIComponent(part))
      : filename;
    try {
      const metadata = await stat(resolved);
      if (fragment && metadata.isFile() && resolved.endsWith(".md")) {
        const source = await readFile(resolved, "utf8");
        const slugs = new Set(),
          counts = new Map();
        for (const heading of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
          const slug = heading[1]
            .toLowerCase()
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/[^\p{L}\p{N}\s_-]/gu, "")
            .replace(/\s/g, "-");
          const count = counts.get(slug) ?? 0;
          slugs.add(slug + (count ? "-" + count : ""));
          counts.set(slug, count + 1);
        }
        if (!slugs.has(decodeURIComponent(fragment)))
          throw Error("missing anchor");
      }
    } catch {
      console.error(
        path.relative(root, filename) + ": unresolved local link " + target,
      );
      errors++;
    }
  }
}
if (errors) process.exitCode = 1;
else
  console.log(
    `Documentation links and whitespace passed (${files.length} files).`,
  );
