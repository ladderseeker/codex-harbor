import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  readFile,
  lstat,
  rename,
  chmod,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  publishPersonalAttachments,
  validatePersonalAttachmentDirectory,
} from "../../packages/attachments/src/personal.ts";
import { hashBytes } from "../../packages/attachments/src/media.ts";
test("personal publication verifies exact immutable bytes, identity, retry and no-follow paths", async () => {
  const original = { ...process.env };
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "harbor-attachments-")),
  );
  const home = join(root, "codex"),
    workspace = join(root, "project");
  await mkdir(home, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  process.env.HARBOR_LOCAL_CODEX_HOME = home;
  delete process.env.HARBOR_PERSONAL_VPS_MODE;
  const session = randomUUID(),
    id = randomUUID(),
    content = Buffer.from([0, 255, 65]);
  const files = [{ id, content, digest: hashBytes(content) }];
  try {
    const first = await publishPersonalAttachments(
      session,
      workspace,
      undefined,
      files,
    );
    const path = join(first.directory.canonical, id);
    assert.deepEqual(await readFile(path), content);
    assert.equal((await lstat(path)).mode & 0o777, 0o444);
    assert.equal(
      await validatePersonalAttachmentDirectory(
        first.directory,
        session,
        workspace,
      ),
      first.directory.canonical,
    );
    const retry = await publishPersonalAttachments(
      session,
      workspace,
      first.directory,
      [{ ...files[0], ...first.files[0] }],
    );
    assert.deepEqual(retry, first);
    await assert.rejects(
      publishPersonalAttachments(session, workspace, first.directory, [
        { ...files[0], id: "../escape" },
      ]),
    );
    await chmod(path, 0o644);
    await writeFile(path, Buffer.from([0, 255, 66]));
    await chmod(path, 0o444);
    await assert.rejects(
      publishPersonalAttachments(session, workspace, first.directory, [
        { ...files[0], ...first.files[0] },
      ]),
    );
    await rename(
      first.directory.canonical,
      first.directory.canonical + "-saved",
    );
    await assert.rejects(
      publishPersonalAttachments(session, workspace, first.directory, files),
    );
    await symlink(
      first.directory.canonical + "-saved",
      first.directory.canonical,
    );
    await assert.rejects(
      publishPersonalAttachments(session, workspace, first.directory, files),
    );
    await assert.rejects(
      validatePersonalAttachmentDirectory(first.directory, session, workspace),
    );

    const maximum = Buffer.alloc(10485760, 7);
    const bounded = [0, 1].map(() => ({
      id: randomUUID(),
      content: maximum,
      digest: hashBytes(maximum),
    }));
    const maximumResult = await publishPersonalAttachments(
      randomUUID(),
      workspace,
      undefined,
      bounded,
    );
    assert.equal(maximumResult.files.length, 2);
    await assert.rejects(
      publishPersonalAttachments(randomUUID(), workspace, undefined, [
        ...bounded,
        {
          id: randomUUID(),
          content: Buffer.from([1]),
          digest: hashBytes(Buffer.from([1])),
        },
      ]),
    );
    const tooLarge = Buffer.alloc(10485761, 7);
    await assert.rejects(
      publishPersonalAttachments(randomUUID(), workspace, undefined, [
        { id: randomUUID(), content: tooLarge, digest: hashBytes(tooLarge) },
      ]),
    );
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in original)) delete process.env[k];
    Object.assign(process.env, original);
    await rm(root, { recursive: true, force: true });
  }
});
