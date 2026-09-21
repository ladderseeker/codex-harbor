import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { turnSchema } from "../../packages/contracts/src/index.ts";
import { ATTACHMENT_LIMITS } from "../../packages/contracts/src/attachments.ts";
test("file-only turns are valid and empty messages remain invalid", () => {
  const base = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "workspace-write",
    text: "",
  };
  assert.throws(() => turnSchema.parse(base));
  assert.throws(() => turnSchema.parse({ ...base, text: "   " }));
  assert.equal(
    turnSchema.parse({ ...base, attachmentIds: [randomUUID()] }).text,
    "",
  );
  assert.throws(() =>
    turnSchema.parse({
      ...base,
      attachmentIds: Array.from({ length: 5 }, randomUUID),
    }),
  );
  assert.equal(ATTACHMENT_LIMITS.fileBytes, 10 * 1024 * 1024);
});

test(
  "P024 actual Linux native reads immutable attachments and denies write/unlink",
  { timeout: 60000 },
  async () => {
    assert.ok(
      process.platform === "linux" &&
        process.getuid?.() !== 0 &&
        process.env.HARBOR_LOCAL_CONTRACT_BINARY,
      "UNVERIFIED P024-03: nonroot Linux and explicit complete pinned HARBOR_LOCAL_CONTRACT_BINARY required",
    );
    const { mkdir, mkdtemp, realpath, rm, readFile } = await import(
      "node:fs/promises"
    );
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { publishPersonalAttachments } = await import(
      "../../packages/attachments/src/personal.ts"
    );
    const { hashBytes } = await import(
      "../../packages/attachments/src/media.ts"
    );
    const { createRuntime } = await import(
      "../../packages/codex-adapter/src/runtime.ts"
    );
    const { png } = await import("../fixtures/png.ts");
    const parent = fileURLToPath(
      new URL("../../.test-runs/p024/backend/native/", import.meta.url),
    );
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const root = await realpath(await mkdtemp(join(parent, "run-"))),
      home = join(root, "codex"),
      workspace = join(root, "project");
    await mkdir(home, { mode: 0o700 });
    await mkdir(workspace, { mode: 0o700 });
    const original = { ...process.env };
    process.env.HARBOR_LOCAL_MODE = "personal";
    process.env.HARBOR_LOCAL_CODEX_HOME = home;
    process.env.HARBOR_LOCAL_CODEX_BINARY =
      process.env.HARBOR_LOCAL_CONTRACT_BINARY;
    delete process.env.HARBOR_PERSONAL_VPS_MODE;
    delete process.env.HARBOR_FIXTURE_MODE;
    let adapter:
      | import("../../packages/codex-adapter/src/index.ts").CodexAdapter
      | undefined;
    try {
      const session = randomUUID(),
        files = [
          { id: randomUUID(), content: png() },
          { id: randomUUID(), content: Buffer.from([0, 255, 65, 66]) },
        ].map((f) => ({ ...f, digest: hashBytes(f.content) }));
      const published = await publishPersonalAttachments(
        session,
        workspace,
        undefined,
        files,
      );
      adapter = await createRuntime({
        sessionId: session,
        projectId: randomUUID(),
        workspacePath: workspace,
        generation: 1,
        attachmentDirectory: published.directory,
      });
      const started = await adapter.startThread({
        cwd: workspace,
        model: "gpt-5.4",
        permissionProfile: "workspace-write",
      });
      assert.equal(
        (started.sandbox as { type: string }).type,
        "workspaceWrite",
      );
      const request = adapter as unknown as {
        request(
          method: string,
          p: object,
        ): Promise<{ exitCode: number; stdout: string }>;
      };
      const command = (args: string[]) =>
        request.request("command/exec", {
          command: args,
          cwd: workspace,
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: [workspace],
            networkAccess: false,
            excludeTmpdirEnvVar: true,
            excludeSlashTmp: true,
          },
          timeoutMs: 5000,
        });
      for (const file of files) {
        const path = join(published.directory.canonical, file.id);
        const read = await command(["/usr/bin/sha256sum", path]);
        assert.equal(read.exitCode, 0);
        assert.ok(read.stdout.startsWith(file.digest));
        assert.notEqual(
          (
            await command([
              "/bin/sh",
              "-c",
              'printf changed > "$1"',
              "sh",
              path,
            ])
          ).exitCode,
          0,
        );
        assert.notEqual((await command(["/bin/rm", path])).exitCode, 0);
        assert.deepEqual(await readFile(path), file.content);
      }
      assert.notEqual(
        (
          await command([
            "/usr/bin/touch",
            join(published.directory.canonical, "injected"),
          ])
        ).exitCode,
        0,
      );
      await assert.rejects(
        adapter.startTurn(started.thread.id, "invalid", {
          attachments: [
            {
              id: files[0].id,
              kind: "image",
              path: join(workspace, files[0].id),
            },
          ],
        }),
        /Invalid attachment reference/,
      );
    } finally {
      if (adapter) await adapter.closeAndWait();
      for (const k of Object.keys(process.env))
        if (!(k in original)) delete process.env[k];
      Object.assign(process.env, original);
      await rm(root, { recursive: true, force: true });
    }
  },
);
