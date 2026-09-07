import { readFileSync, realpathSync, lstatSync } from "node:fs";
export function releaseImage(role, fallback) {
  const root = process.env.HARBOR_MANAGED_RELEASE;
  if (!root) return fallback;
  if (
    !/^\/opt\/codex-harbor\/releases\/[a-f0-9]{64}$/.test(root) ||
    realpathSync(root) !== root
  )
    throw Error("Immutable release image authority required");
  const info = lstatSync(root);
  if (info.uid !== 0 || (info.mode & 0o022) !== 0)
    throw Error("Unsafe release image authority");
  const image = JSON.parse(readFileSync(root + "/release.json", "utf8"))
    .images?.[role]?.id;
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw Error("Pinned release image unavailable");
  return image;
}
