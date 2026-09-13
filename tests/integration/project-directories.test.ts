import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjectDirectories } from "../../packages/workspaces/src/directories.ts";
import { projectBrowsingCapability } from "../../apps/api/src/project-directories.ts";
import { authorizeTokenRoute } from "../../apps/api/src/token-access.ts";

test("folder listings confine traversal, omit files and symlinks, and bound results", async () => {
  const base = await mkdtemp(join(tmpdir(), "harbor-directories-"));
  const root = join(base, "root"),
    outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  const roots = [{ id: "local", name: "Fixture", path: root }];
  try {
    await mkdir(join(root, "nested"));
    await mkdir(join(root, "nested", "empty"));
    await writeFile(join(root, "file"), "not a directory");
    await symlink(outside, join(root, "escape"));
    await symlink(join(root, "nested"), join(root, "alias"));
    assert.deepEqual(await listProjectDirectories(roots, "local", ""), {
      path: "",
      directories: [{ name: "nested", path: "nested" }],
      truncated: false,
    });
    assert.deepEqual(
      await listProjectDirectories(roots, "local", "nested/empty"),
      { path: "nested/empty", directories: [], truncated: false },
    );
    for (const path of [
      "/",
      "../outside",
      "nested/..",
      "nested/.",
      "nested//empty",
      "nested\\empty",
      "\0",
      "escape",
      "alias",
      "file",
      "missing",
    ])
      await assert.rejects(listProjectDirectories(roots, "local", path), {
        code: "PATH_DENIED",
      });
    await assert.rejects(listProjectDirectories(roots, "unknown", ""), {
      code: "ROOT_DENIED",
    });
    await mkdir(join(root, "private"));
    await chmod(join(root, "private"), 0);
    if (process.getuid?.() !== 0)
      await assert.rejects(listProjectDirectories(roots, "local", "private"), {
        code: "PATH_DENIED",
      });
    await chmod(join(root, "private"), 0o700);
    await Promise.all(
      Array.from({ length: 205 }, (_, i) => mkdir(join(root, `dir-${i}`))),
    );
    const bounded = await listProjectDirectories(roots, "local", "");
    assert.equal(bounded.truncated, true);
    assert.equal(bounded.directories.length, 200);
    assert.ok(
      bounded.directories.every((entry) => !entry.path.startsWith("/")),
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("folder browsing capabilities fail closed outside local/private profiles", () => {
  assert.equal(
    projectBrowsingCapability({
      HARBOR_LOCAL_MODE: undefined,
      HARBOR_FIXTURE_MODE: undefined,
    }).available,
    false,
  );
  if (!process.env.HARBOR_STORAGE_SOCKET && !process.env.HARBOR_MANAGED_RELEASE)
    assert.equal(
      projectBrowsingCapability({
        HARBOR_LOCAL_MODE: "personal",
        HARBOR_FIXTURE_MODE: undefined,
      }).available,
      true,
    );
});

test("folder listing is not in the bearer route allowlist", async () => {
  await assert.rejects(
    authorizeTokenRoute({} as never, {} as never, { kind: "token" } as never, {
      method: "GET",
      routeOptions: { url: "/api/v1/project-roots/:id/directories" },
    }),
    { code: "TOKEN_ROUTE_DENIED" },
  );
});

test("managed folder route refuses listing before filesystem access", async () => {
  const { default: Fastify } = await import("fastify");
  const { projectDirectoryRoutes } = await import(
    "../../apps/api/src/project-directories.ts"
  );
  const app = Fastify();
  projectDirectoryRoutes(app, {
    HARBOR_LOCAL_MODE: undefined,
    HARBOR_FIXTURE_MODE: undefined,
    roots: [],
  } as never);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/project-roots/unknown/directories",
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, "PROJECT_BROWSING_UNAVAILABLE");
  } finally {
    await app.close();
  }
});
