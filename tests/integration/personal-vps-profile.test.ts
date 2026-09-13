import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { config } from "../../apps/api/src/config.ts";

const base = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://localhost/isolated",
  HARBOR_ORIGIN: "https://harbor.example",
  HARBOR_OIDC_ISSUER: "https://identity.example",
  HARBOR_OIDC_CLIENT_ID: "private-instance",
  HARBOR_OWNER_SUBJECT: "private-owner",
  HARBOR_PROJECT_ROOTS: JSON.stringify([
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Approved",
      path: "/srv/projects",
    },
  ]),
  HARBOR_PERSONAL_VPS_MODE: "personal",
  HARBOR_PERSONAL_VPS_CODEX_HOME: "/var/lib/harbor-personal/codex",
  HARBOR_PERSONAL_VPS_CODEX_BINARY: "/opt/harbor-personal/codex",
};
test("P015 profile preserves public authentication and rejects mixed or privileged deployment", (t) => {
  const run = mkdtempSync(join(tmpdir(), "harbor-vps-config-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const project = join(run, "projects"),
    home = join(run, "state", "codex");
  mkdirSync(project);
  mkdirSync(home, { recursive: true });
  const roots = (path: string) =>
    JSON.stringify([
      { id: "11111111-1111-4111-8111-111111111111", name: "Approved", path },
    ]);
  const personal = {
    ...base,
    HARBOR_PROJECT_ROOTS: roots(project),
    HARBOR_PERSONAL_VPS_CODEX_HOME: home,
    HARBOR_PERSONAL_VPS_STATE_DIR: join(run, "state"),
  };
  symlinkSync(project, join(run, "alias"));
  t.mock.method(
    process as NodeJS.Process & { getuid: () => number },
    "getuid",
    () => 1001,
  );
  if (process.platform !== "linux") {
    assert.throws(() => config(personal));
    return;
  }
  assert.equal(config(personal).HARBOR_PERSONAL_VPS_MODE, "personal");
  for (const incompatible of [
    { HARBOR_ORIGIN: "http://harbor.example" },
    { HARBOR_OIDC_ISSUER: "http://127.0.0.1:4000" },
    { HARBOR_HOST: "0.0.0.0" },
    { HARBOR_LOCAL_MODE: "personal" },
    { HARBOR_FIXTURE_MODE: "private-test", NODE_ENV: "test" },
    { HARBOR_MANAGED_RELEASE: "installed" },
    { HARBOR_STORAGE_SOCKET: "/run/storage.sock" },
    { HARBOR_CONTROL_SOCKET: "/run/control.sock" },
    { HARBOR_PERSONAL_VPS_CODEX_HOME: undefined },
    { HARBOR_PERSONAL_VPS_STATE_DIR: undefined },
    { HARBOR_PERSONAL_VPS_STATE_DIR: project },
    { HARBOR_PERSONAL_VPS_CODEX_BINARY: undefined },
    { HARBOR_PROJECT_ROOTS: "[]" },
    { HARBOR_PROJECT_ROOTS: roots(join(run, "alias")) },
    { HARBOR_PROJECT_ROOTS: roots(join(run, "missing")) },
    { HARBOR_PROJECT_ROOTS: roots(join(run, "state")) },
    { HARBOR_PROJECT_ROOTS: roots(home) },
    { HARBOR_PROJECT_ROOTS: roots("/") },
  ])
    assert.throws(() => config({ ...personal, ...incompatible }));
  t.mock.method(
    process as NodeJS.Process & { getuid: () => number },
    "getuid",
    () => 0,
  );
  assert.throws(() => config(personal), /nonroot/);
});

test("P015 exact approved root admission is explicit and never creates or escapes it", async (t) => {
  const { resolveProject } = await import(
    "../../packages/workspaces/src/index.ts"
  );
  const run = mkdtempSync(join(tmpdir(), "harbor-vps-root-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const root = join(run, "project");
  mkdirSync(root);
  const roots = [{ id: "approved", name: "Approved", path: root }];
  for (const value of [".", ""]) {
    await assert.rejects(resolveProject(roots, "approved", value), {
      code: "PATH_DENIED",
    });
    assert.equal(
      await resolveProject(roots, "approved", value, false, true),
      root,
    );
    await assert.rejects(resolveProject(roots, "approved", value, true, true), {
      code: "PATH_DENIED",
    });
  }
  symlinkSync(root, join(run, "alias"));
  await assert.rejects(
    resolveProject(
      [{ ...roots[0]!, path: join(run, "alias") }],
      "approved",
      ".",
      false,
      true,
    ),
    { code: "PATH_DENIED" },
  );
  for (const value of ["..", "../project", "/", "child/..", "./child"]) {
    await assert.rejects(
      resolveProject(roots, "approved", value, false, true),
      { code: "PATH_DENIED" },
    );
  }
});
