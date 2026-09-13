import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  developmentEnvironment,
  developmentWritableRoots,
  preparePersonalDevelopment,
} from "../../packages/codex-adapter/src/personal-development.js";

test("personal development grants only canonical ordinary Git metadata and private cache", async () => {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "harbor-dev-policy-")),
  );
  try {
    const home = join(base, "codex-home"),
      workspace = join(base, "project");
    await mkdir(home, { mode: 0o700 });
    await mkdir(workspace);
    const profile = await preparePersonalDevelopment(home, workspace);
    assert.deepEqual(await developmentWritableRoots(profile), [
      workspace,
      profile.cache,
    ]);
    assert.ok(!profile.cache.startsWith(home + "/"));
    assert.equal(developmentEnvironment(profile).GIT_CONFIG_VALUE_0, "");
    assert.equal(developmentEnvironment(profile).GIT_CONFIG_VALUE_1, workspace);
    await mkdir(join(workspace, ".git"));
    assert.deepEqual(await developmentWritableRoots(profile), [
      workspace,
      join(workspace, ".git"),
      profile.cache,
    ]);
    await writeFile(join(workspace, ".git", "commondir"), "../../outside\n");
    await assert.rejects(
      developmentWritableRoots(profile),
      /external Git metadata/,
    );
    await rm(join(workspace, ".git"), { recursive: true });
    await symlink(home, join(workspace, ".git"));
    await assert.rejects(
      developmentWritableRoots(profile),
      /external Git metadata/,
    );
    await rm(join(workspace, ".git"));
    await writeFile(join(workspace, ".git"), "gitdir: ../outside\n");
    await assert.rejects(
      developmentWritableRoots(profile),
      /external Git metadata/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
