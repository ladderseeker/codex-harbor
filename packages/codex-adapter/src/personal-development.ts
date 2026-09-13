import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PersonalDevelopment = {
  workspace: string;
  cache: string;
  previewPort?: number;
};

/** Only the selected ordinary repository is trusted, never a wildcard or linked gitdir. */
export async function developmentWritableRoots(profile: PersonalDevelopment) {
  const git = join(profile.workspace, ".git");
  const info = await lstat(git).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (info && (!info.isDirectory() || (await realpath(git)) !== git))
    throw Error(
      "Personal development requires an ordinary .git directory inside the selected project; linked or external Git metadata is unsupported",
    );
  if (
    info &&
    (await lstat(join(git, "commondir")).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    ))
  )
    throw Error(
      "Personal development does not support external Git metadata through commondir",
    );
  return [profile.workspace, ...(info ? [git] : []), profile.cache];
}

export async function preparePersonalDevelopment(
  home: string,
  workspace: string,
) {
  const cache = join(
    dirname(home),
    "home",
    "development",
    createHash("sha256").update(workspace).digest("hex"),
  );
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const info = await lstat(cache);
  if (
    !info.isDirectory() ||
    (await realpath(cache)) !== cache ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  )
    throw Error(
      "Personal development cache must be a private canonical service-owned directory",
    );
  const profile: PersonalDevelopment = { workspace, cache };
  const previews = JSON.parse(
    process.env.HARBOR_PERSONAL_PREVIEWS ?? "[]",
  ) as Array<{ port: number }>;
  if (
    previews.length &&
    Number.isInteger(previews[0].port) &&
    previews[0].port >= 1024 &&
    previews[0].port <= 65535
  )
    profile.previewPort = previews[0].port;
  await developmentWritableRoots(profile);
  return profile;
}

export function developmentEnvironment(
  profile: PersonalDevelopment,
): NodeJS.ProcessEnv {
  return {
    XDG_CACHE_HOME: profile.cache,
    XDG_DATA_HOME: join(profile.cache, "data"),
    XDG_STATE_HOME: join(profile.cache, "state"),
    XDG_CONFIG_HOME: join(profile.cache, "config"),
    NPM_CONFIG_CACHE: join(profile.cache, "npm"),
    npm_config_store_dir: join(profile.cache, "pnpm-store"),
    // Protected command-scope Git configuration; project-local configuration cannot
    // establish safe.directory. Do not inherit root's Git/SSH configuration.
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "safe.directory",
    GIT_CONFIG_VALUE_1: profile.workspace,
    ...(profile.previewPort
      ? { PORT: String(profile.previewPort), HOST: "127.0.0.1" }
      : {}),
  };
}

export function developmentInstructions(profile: PersonalDevelopment) {
  return (
    "This is the owner's personal VPS development workspace. Workspace-write permits the selected project and its existing ordinary .git directory, private temporary files, the configured package cache, and network access. Initializing a new Git repository and linked/external Git metadata are unsupported; explain this limitation if relevant. The release, credentials, other projects, and host administration are outside the write grant; sandbox escalation is unavailable. Node and pinned pnpm are on PATH. Configure Git identity in the project if a commit needs it; do not invent the owner's identity. " +
    (profile.previewPort
      ? `For a browser preview, start the development server on 127.0.0.1:${profile.previewPort}; use the configured Harbor preview link. `
      : "") +
    "Keep development processes within this task's runtime; stopping or retiring it ends its child processes."
  );
}
