import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  stat,
  rename,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runnerArguments } from "../../infra/runner/launcher.js";
test("P001-07 mount identity rejects replacement and volumes survive generations", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "harbor-mount-")));
  const project = join(root, "project");
  const saved = process.env.HARBOR_PROJECT_ROOTS;
  try {
    await mkdir(project);
    const identity = await stat(project, { bigint: true });
    process.env.HARBOR_PROJECT_ROOTS = JSON.stringify([
      { id: "test", path: root },
    ]);
    const config = {
      sessionId: "session",
      projectId: "project",
      generation: 1,
      workspacePath: project,
      workspaceDevice: identity.dev.toString(),
      workspaceInode: identity.ino.toString(),
    };
    const first = await runnerArguments(config),
      second = await runnerArguments({ ...config, generation: 2 });
    assert.equal(
      first.find((a) => a.includes("target=/home/runner/.codex")),
      second.find((a) => a.includes("target=/home/runner/.codex")),
    );
    await rename(project, join(root, "previous"));
    await mkdir(project);
    await assert.rejects(runnerArguments(config), /identity/);
    await rm(project, { recursive: true });
    await symlink(join(root, "previous"), project);
    await assert.rejects(runnerArguments(config), /identity|Workspace/);
  } finally {
    if (saved === undefined) delete process.env.HARBOR_PROJECT_ROOTS;
    else process.env.HARBOR_PROJECT_ROOTS = saved;
    await rm(root, { recursive: true, force: true });
  }
});
test("P001 generation authority persists before launch and rejects stale generation", async () => {
  const { withRunnerAuthority } = await import(
    "../../infra/runner/authority.js"
  );
  const directory = await mkdtemp(join(tmpdir(), "harbor-authority-"));
  const original = process.env.HARBOR_LAUNCHER_STATE_DIR,
    roots = process.env.HARBOR_PROJECT_ROOTS;
  process.env.HARBOR_LAUNCHER_STATE_DIR = directory;
  process.env.HARBOR_PROJECT_ROOTS = "[]";
  const config = {
    sessionId: "session",
    projectId: "project",
    generation: 3,
    workspacePath: "/unopened",
  };
  try {
    await assert.rejects(
      withRunnerAuthority(config, async () => {
        throw Error("launch failed after fence");
      }),
      /launch failed/,
    );
    await assert.rejects(
      withRunnerAuthority(config, async () => 42),
      /Stale/,
    );
    await assert.rejects(
      withRunnerAuthority({ ...config, generation: 2 }, async () => 42),
      /Stale/,
    );
  } finally {
    if (original === undefined) delete process.env.HARBOR_LAUNCHER_STATE_DIR;
    else process.env.HARBOR_LAUNCHER_STATE_DIR = original;
    if (roots === undefined) delete process.env.HARBOR_PROJECT_ROOTS;
    else process.env.HARBOR_PROJECT_ROOTS = roots;
    await rm(directory, { recursive: true, force: true });
  }
});
