import { previewCoexistLinux } from "./coexist-linux.ts";
import { expect, request, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { previewLinuxBoundary } from "./linux-boundary.ts";
const exec = promisify(execFile);
export async function previewDerivedLinux(h: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  csrf: string;
  workspace: any;
  port: number;
  artifacts: string;
}) {
  const local = (
    await h.db.query("SELECT * FROM workspaces WHERE id=$1", [h.workspace.id])
  ).rows[0];
  const command = async (route: string, body: unknown, status = 200) => {
    const res = await h.context.request.post(h.origin + "/api/v1" + route, {
      headers: {
        Origin: h.origin,
        "X-CSRF-Token": h.csrf,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data: body,
    });
    expect(res.status()).toBe(status);
    return res.json();
  };
  const readyWorkspace = async (w: any) => {
    await expect
      .poll(
        async () =>
          (await h.db.query("SELECT state FROM workspaces WHERE id=$1", [w.id]))
            .rows[0].state,
        { timeout: 30000 },
      )
      .toBe("ready");
    return w;
  };
  const copy = await readyWorkspace(
    (
      await command(`/projects/${local.project_id}/workspaces`, {
        name: "Preview copied checkout",
        kind: "copy",
        sourceWorkspaceId: local.id,
        dirtyPolicy: "snapshot",
      })
    ).workspace,
  );
  await previewCoexistLinux({ ...h, local, copy });
  const seed = [
    "run",
    "--rm",
    "--network=none",
    "--user=10001:10001",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--mount",
    `type=bind,source=${local.canonical_path},target=/source`,
    "--entrypoint",
    "git",
    "codex-harbor-git:2.39.5-p003",
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
      "user.email=fixture@localhost",
      "commit",
      "-m",
      "Preview fixture",
    ],
  ])
    await exec("docker", [...seed, ...args], {
      timeout: 20000,
      maxBuffer: 8192,
    });
  const worktree = await readyWorkspace(
    (
      await command(`/projects/${local.project_id}/workspaces`, {
        name: "Preview Git checkout",
        kind: "worktree",
        sourceWorkspaceId: local.id,
        dirtyPolicy: "exclude",
      })
    ).workspace,
  );
  const cases = [];
  for (const [workspace, permissionProfile] of [
    [copy, "read-only"],
    [worktree, "read-only"],
    [worktree, "workspace-write"],
  ] as const) {
    const p = (
      await command(
        "/previews",
        {
          workspaceId: workspace.id,
          name: "Derived " + permissionProfile,
          script: "dev",
          port: h.port,
          permissionProfile,
        },
        201,
      )
    ).preview;
    await command(
      `/previews/${p.id}/start`,
      { expectedRevision: p.revision },
      202,
    );
    await expect
      .poll(
        async () =>
          (await h.db.query("SELECT state FROM previews WHERE id=$1", [p.id]))
            .rows[0].state,
        { timeout: 30000 },
      )
      .toBe("ready");
    const row = (await h.db.query("SELECT * FROM previews WHERE id=$1", [p.id]))
      .rows[0];
    const proof = await previewLinuxBoundary(h.db, p.id, h.artifacts);
    cases.push(proof);
    const opening = await command(`/previews/${p.id}/open`, {
      expectedGeneration: Number(row.generation),
    });
    const page = await h.context.newPage();
    await page.goto(h.origin + opening.bootstrapPath);
    await expect(
      page.getByRole("heading", { name: "Private application" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#socket")).toHaveText("preview websocket");
    const source = (
      await h.db.query("SELECT * FROM workspaces WHERE id=$1", [workspace.id])
    ).rows[0];
    if (permissionProfile === "workspace-write") {
      const code = `const fs=require('fs'),assert=require('assert');assert.equal(fs.statSync('/workspace').ino,fs.statSync('/harbor/workspaces/${workspace.id}').ino);assert.ok(fs.existsSync('/git-common/HEAD'));fs.writeFileSync('/workspace/preview-owned-write','derived only');`;
      await exec("docker", ["exec", row.runner_id, "node", "-e", code], {
        timeout: 5000,
        maxBuffer: 4096,
      });
      expect(
        await readFile(
          path.join(source.canonical_path, "preview-owned-write"),
          "utf8",
        ),
      ).toBe("derived only");
      await exec(
        "cc",
        [
          "-O2",
          "tests/isolation/quota-probe.c",
          "-o",
          path.join(source.canonical_path, "quota-probe"),
        ],
        { timeout: 15000, maxBuffer: 4096 },
      );
      for (const action of ["inheritance", "bytes", "inodes"]) {
        const result = await exec(
          "docker",
          [
            "exec",
            row.runner_id,
            "/workspace/quota-probe",
            action,
            "/workspace",
          ],
          { timeout: 15000, maxBuffer: 8192 },
        );
        expect(result.stdout.startsWith("PASS")).toBe(true);
      }
      // Stop is available to a narrow read-only cancellation token even when
      // the target's physical mount is writable; tokens cannot mint viewers.
      const token = await command("/security/api-tokens", {
        name: "Preview cancellation only",
        scopes: ["previews:read", "previews:manage", "cancel"],
        projectIds: [local.project_id],
        permissionProfile: "read-only",
        expiresInDays: 1,
      });
      const machine = await request.newContext({
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { Authorization: "Bearer " + token.secret },
      });
      try {
        expect(
          (
            await machine.post(h.origin + `/api/v1/previews/${p.id}/open`, {
              data: { expectedGeneration: Number(row.generation) },
              headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
            })
          ).status(),
        ).toBe(403);
        expect(
          (
            await machine.post(h.origin + `/api/v1/previews/${p.id}/stop`, {
              data: { expectedGeneration: Number(row.generation) },
              headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
            })
          ).status(),
        ).toBe(202);
      } finally {
        await machine.dispose();
      }
    } else {
      // Reader ownership blocks incompatible source metadata snapshots.
      await command(
        `/projects/${local.project_id}/workspaces`,
        {
          name: "Must not snapshot an active reader",
          kind: "worktree",
          sourceWorkspaceId: local.id,
          dirtyPolicy: "exclude",
        },
        409,
      );
      await command(
        `/previews/${p.id}/stop`,
        { expectedGeneration: Number(row.generation) },
        202,
      );
    }
    await expect
      .poll(
        async () =>
          (await h.db.query("SELECT retired FROM previews WHERE id=$1", [p.id]))
            .rows[0].retired,
        { timeout: 15000 },
      )
      .toBe(true);
    await page.close();
  }
  await writeFile(
    path.join(h.artifacts, "derived-cases.json"),
    JSON.stringify(
      {
        status: "passed",
        cases,
        scope:
          "Actual managed copy and Git previews, both common-mount profiles, quota and exact stop; local fixtures only",
      },
      null,
      2,
    ),
  );
}
