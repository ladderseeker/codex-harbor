import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, symlink, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  checkKey,
  authorizePermission,
  requireOrigin,
} from "../../packages/policy/src/index.ts";
import { resolveProject } from "../../packages/workspaces/src/index.ts";
test("P001-05 old intent is rejected after retained lookup is exhausted", () => {
  checkKey(`${Date.now()}:${randomUUID()}`);
  assert.throws(() => checkKey(`${Date.now() - 86400001}:${randomUUID()}`));
  assert.throws(() => checkKey(`${Date.now() + 300001}:${randomUUID()}`));
});
test("P001-07 ceiling and exact Origin deny escalation", () => {
  assert.throws(() => authorizePermission("workspace-write", "read-only"));
  assert.throws(() =>
    requireOrigin("https://harbor.example.evil", "https://harbor.example"),
  );
  assert.throws(() => requireOrigin(undefined, "https://harbor.example"));
});
test("P001-07 directory-relative confinement denies traversal and symlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harbor-path-"));
  try {
    const id = randomUUID(),
      roots = [{ id, name: "test", path: root }];
    await mkdir(path.join(root, "allowed"));
    await symlink(os.tmpdir(), path.join(root, "escape"));
    assert.equal(
      await resolveProject(roots, id, "allowed/nested", true),
      await realpath(path.join(root, "allowed/nested")),
    );
    await assert.rejects(resolveProject(roots, id, "../escape"));
    await assert.rejects(resolveProject(roots, id, "escape/new", true));
    await assert.rejects(resolveProject(roots, randomUUID(), "allowed"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
