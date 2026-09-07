import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  mkdir,
  chmod,
  stat,
  writeFile,
  readFile,
  rm,
  access,
  symlink,
  readdir,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fixedGitHelper, GIT_IMAGE } from "../../infra/git/launcher.ts";
const exec = promisify(execFile);
async function identity(canonical: string) {
  const s = await stat(canonical, { bigint: true });
  return { canonical, device: s.dev.toString(), inode: s.ino.toString() };
}
async function directory(root: string, name: string) {
  const p = join(root, name);
  await mkdir(p, { mode: 0o777 });
  await chmod(p, 0o777);
  return identity(p);
}
async function seed(source: string) {
  const base = [
    "run",
    "--rm",
    "--label",
    "org.codex-harbor.owner=p003-test-seed",
    "--network=none",
    "--user=10001:10001",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--mount",
    `type=bind,source=${source},target=/source`,
    "--entrypoint",
    "git",
    GIT_IMAGE,
  ];
  for (const args of [
    ["init", "/source"],
    ["-C", "/source", "add", "."],
    [
      "-C",
      "/source",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "Fixture",
    ],
  ])
    await exec("docker", [...base, ...args], { timeout: 20000 });
}
test("P003 fixed helper imports independent committed objects and neutralizes source hooks/config", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "harbor-p003-helper-")),
  );
  try {
    const source = await directory(root, "source"),
      common = await directory(root, "common"),
      first = await directory(root, "first"),
      second = await directory(root, "second");
    await writeFile(join(source.canonical, "tracked.txt"), "committed\n");
    await writeFile(
      join(source.canonical, ".gitattributes"),
      "tracked.txt filter=evil\n",
    );
    await seed(source.canonical);
    await writeFile(join(source.canonical, "tracked.txt"), "dirty local\n");
    await writeFile(
      join(source.canonical, ".git", "config"),
      '[core]\nrepositoryformatversion=0\nbare=false\nfsmonitor=sh -c "touch /git-common/hostile-marker"\nhooksPath=/source/hooks\n[filter "evil"]\nsmudge=sh -c "touch /git-common/hostile-marker"\n',
    );
    const firstId = randomUUID(),
      secondId = randomUUID();
    const info = await fixedGitHelper({
      action: "inspect",
      workspaceId: firstId,
      source,
    });
    assert.equal(info.git, true);
    assert.equal(info.dirty, true);
    const result = await fixedGitHelper({
      action: "worktree",
      workspaceId: firstId,
      source,
      target: first,
      common,
    });
    assert.equal(result.sourceDirty, true);
    assert.match(result.baseRevision, /^[a-f0-9]{40}$/);
    await fixedGitHelper({
      action: "worktree",
      workspaceId: secondId,
      source,
      target: second,
      common,
    });
    assert.equal(
      await readFile(join(first.canonical, "tracked.txt"), "utf8"),
      "committed\n",
    );
    assert.equal(
      await readFile(join(second.canonical, "tracked.txt"), "utf8"),
      "committed\n",
    );
    assert.equal(
      await readFile(join(source.canonical, "tracked.txt"), "utf8"),
      "dirty local\n",
    );
    await assert.rejects(access(join(common.canonical, "hostile-marker")));
    const sourceObjects = await readdir(
      join(source.canonical, ".git", "objects"),
      { recursive: true },
    );
    const commonObjects = await readdir(join(common.canonical, "objects"), {
      recursive: true,
    });
    const sourceInodes = new Set(
      await Promise.all(
        sourceObjects.map(
          async (name) =>
            (await stat(join(source.canonical, ".git", "objects", name))).ino,
        ),
      ),
    );
    for (const name of commonObjects)
      assert.equal(
        sourceInodes.has(
          (await stat(join(common.canonical, "objects", name))).ino,
        ),
        false,
        "Object import must not hardlink Local",
      );
    assert.match(
      await readFile(join(first.canonical, ".git"), "utf8"),
      new RegExp("/git-common/worktrees/" + firstId),
    );
    assert.equal(
      await readFile(
        join(common.canonical, "worktrees", firstId, "gitdir"),
        "utf8",
      ),
      `/harbor/workspaces/${firstId}/.git\n`,
    );
    assert.equal(
      (
        await fixedGitHelper({
          action: "inspect",
          workspaceId: firstId,
          source: first,
          common,
        })
      ).dirty,
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("P003 nonGit copy is explicit, bounded and has independent contents", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "harbor-p003-copy-")),
  );
  try {
    const source = await directory(root, "source"),
      target = await directory(root, "target");
    await writeFile(join(source.canonical, "file.txt"), "original");
    const value = await fixedGitHelper({
      action: "copy",
      workspaceId: randomUUID(),
      source,
      target,
    });
    assert.ok(value.snapshotHash);
    assert.equal(
      (
        await fixedGitHelper({
          action: "inspect",
          workspaceId: randomUUID(),
          source: target,
        })
      ).snapshotHash,
      value.snapshotHash,
    );
    await writeFile(join(target.canonical, "file.txt"), "copy");
    assert.equal(
      await readFile(join(source.canonical, "file.txt"), "utf8"),
      "original",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("P003 helper rejects symlink snapshot and external Git metadata", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "harbor-p003-negative-")),
  );
  try {
    const source = await directory(root, "source"),
      target = await directory(root, "target");
    await symlink("/etc/passwd", join(source.canonical, "escape"));
    await assert.rejects(
      fixedGitHelper({
        action: "copy",
        workspaceId: randomUUID(),
        source,
        target,
      }),
    );
    await rm(join(source.canonical, "escape"));
    await writeFile(join(source.canonical, ".git"), "gitdir: /etc");
    await assert.rejects(
      fixedGitHelper({ action: "inspect", workspaceId: randomUUID(), source }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("P003 snapshot identity distinguishes nested and sibling file trees", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "harbor-p003-tree-")),
  );
  try {
    const source = await directory(root, "source");
    await mkdir(join(source.canonical, "a"));
    await writeFile(join(source.canonical, "a", "b"), "content");
    const nested = await fixedGitHelper({
      action: "inspect",
      workspaceId: randomUUID(),
      source,
    });
    await rename(join(source.canonical, "a", "b"), join(source.canonical, "b"));
    const sibling = await fixedGitHelper({
      action: "inspect",
      workspaceId: randomUUID(),
      source,
    });
    assert.notEqual(nested.snapshotHash, sibling.snapshotHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
