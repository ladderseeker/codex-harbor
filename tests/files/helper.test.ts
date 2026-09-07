import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  stat,
  rm,
  chmod,
  readFile,
  realpath,
  symlink,
  link,
  rename,
  open,
  readdir,
  readlink,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fixedFileHelper, FILE_IMAGE } from "../../infra/files/launcher.ts";
import { executeFile } from "../../infra/files/service.ts";
import type { FileCommand } from "../../packages/files/src/types.ts";
test("P004 fixed helper reads, fences stale saves, stages exact files and commits once", async (t) => {
  assert.equal(
    process.platform,
    "linux",
    "The strict file revision lane requires native Linux; macOS is render-only",
  );
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "harbor-p004-helper-")),
  );
  const state = await realpath(
    await mkdtemp(join(tmpdir(), "harbor-p004-slots-")),
  );
  const previous = {
    state: process.env.HARBOR_FIXTURE_STATE_DIR,
    roots: process.env.HARBOR_PROJECT_ROOTS,
    node: process.env.NODE_ENV,
    mode: process.env.HARBOR_FIXTURE_MODE,
  };
  const previousState = previous.state;
  process.env.HARBOR_FIXTURE_STATE_DIR = state;
  const workspaceId = randomUUID(),
    operationId = randomUUID();
  try {
    // Fresh disposable fixture seed; production ownership is tested on XFS/Linux.
    await chmod(root, 0o777);
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network=none",
        "--user=10001:10001",
        "--mount",
        `type=bind,source=${root},target=/seed`,
        "--entrypoint=git",
        FILE_IMAGE,
        "-C",
        "/seed",
        "init",
      ],
      { stdio: "pipe" },
    );
    await writeFile(join(root, "note.txt"), "one\ntwo\n");
    await chmod(join(root, "note.txt"), 0o666);
    const info = await stat(root, { bigint: true });
    const base = {
      rootId: randomUUID(),
      workspaceId,
      projectId: randomUUID(),
      relativePath: "fixture",
      identity: {
        canonical: root,
        device: info.dev.toString(),
        inode: info.ino.toString(),
      },
      payload: {},
    };
    process.env.NODE_ENV = "test";
    process.env.HARBOR_FIXTURE_MODE = "private-test";
    process.env.HARBOR_PROJECT_ROOTS = JSON.stringify([
      { id: base.rootId, path: root.substring(0, root.lastIndexOf("/")) },
    ]);
    base.relativePath = root.substring(root.lastIndexOf("/") + 1);
    const call = (
      action: FileCommand["action"],
      payload: Record<string, unknown>,
      write = false,
    ) =>
      (write ? (c: FileCommand) => executeFile(c, true) : fixedFileHelper)({
        ...base,
        action,
        payload,
        ...(write ? { operationId: randomUUID(), epoch: 1 } : {}),
      });
    const probeId = randomUUID();
    await writeFile(
      join(state, "control-canary"),
      "owned control-plane fixture",
    );
    const isolated = await fixedFileHelper(
      { ...base, action: "tree", operationId: probeId },
      async (send) => {
        let inspection: any;
        for (let attempt = 0; attempt < 50; attempt++) {
          inspection = JSON.parse(
            execFileSync("docker", ["inspect", "harbor-file-" + probeId], {
              encoding: "utf8",
              timeout: 5000,
            }),
          )[0];
          if (inspection.State.Running) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(inspection.State.Running, true);
        assert.equal(inspection.Config.User, "10001:10001");
        assert.equal(inspection.HostConfig.NetworkMode, "none");
        assert.equal(inspection.HostConfig.Privileged, false);
        assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
        assert.deepEqual(inspection.HostConfig.CapDrop, ["ALL"]);
        assert.equal(
          inspection.Mounts.filter((m: any) => m.Type === "bind").length,
          1,
        );
        assert.equal(
          inspection.Mounts.find((m: any) => m.Destination === "/workspace").RW,
          false,
        );
        const probe = `const fs=require('fs'),net=require('net'),assert=require('assert');assert.equal(process.getuid(),10001);assert.equal(fs.existsSync(${JSON.stringify(join(state, "control-canary"))}),false);assert.equal(fs.existsSync('/var/run/docker.sock'),false);assert.throws(()=>fs.writeFileSync('/workspace/read-only-denial','x'));assert.throws(()=>fs.writeFileSync('/root-write-denial','x'));Promise.all(['169.254.169.254','1.1.1.1','2606:4700:4700::1111'].map(host=>new Promise((resolve,reject)=>{const s=net.connect({host,port:443});s.setTimeout(700);s.on('connect',()=>{s.destroy();reject(Error('Network escaped'))});s.on('error',()=>resolve());s.on('timeout',()=>{s.destroy();resolve()})}))).then(()=>console.log('owned isolation passed')).catch(e=>{console.error(e.message);process.exitCode=1});`;
        assert.match(
          execFileSync(
            "docker",
            [
              "exec",
              "--user=10001:10001",
              "harbor-file-" + probeId,
              "node",
              "-e",
              probe,
            ],
            { encoding: "utf8", timeout: 5000 },
          ),
          /owned isolation passed/,
        );
        send();
      },
    );
    assert.equal(isolated.entries.length, 1);
    const tree = await call("tree", {});
    assert.equal(tree.entries.length, 1);
    const ref = tree.entries[0].ref;
    const content = await call("content", { ref });
    assert.equal(content.text, "one\ntwo\n");
    // Inject a failure in the actual directory fsync, before the first receipt.
    // The production service is unchanged and no helper effect may be published.
    const handle = await open(state, "r");
    const prototype = Object.getPrototypeOf(handle),
      originalSync = prototype.sync;
    await handle.close();
    let parentSyncs = 0;
    const fsyncFault = t.mock.method(
      prototype,
      "sync",
      async function (this: any) {
        if ((await readlink(`/proc/self/fd/${this.fd}`)) === state) {
          parentSyncs++;
          throw Error("OWNED_PARENT_FSYNC_FAILURE");
        }
        return originalSync.call(this);
      },
    );
    try {
      await assert.rejects(
        call(
          "save",
          {
            ref,
            expectedRevision: content.revision,
            text: "MUST NOT BE PUBLISHED",
          },
          true,
        ),
        /OWNED_PARENT_FSYNC_FAILURE/,
      );
      assert.equal(parentSyncs, 1);
      assert.deepEqual(await readdir(join(state, "file-receipts")), []);
      assert.equal(
        await readFile(join(root, "note.txt"), "utf8"),
        "one\ntwo\n",
      );
    } finally {
      fsyncFault.mock.restore();
    }
    const saved = await call(
      "save",
      { ref, expectedRevision: content.revision, text: "ONE\ntwo\n" },
      true,
    );
    assert.notEqual(saved.revision, content.revision);
    assert.equal((await stat(join(root, "note.txt"))).mode & 0o777, 0o666);
    assert.equal(await readFile(join(root, "note.txt"), "utf8"), "ONE\ntwo\n");
    await assert.rejects(
      call(
        "save",
        { ref, expectedRevision: content.revision, text: "obsolete" },
        true,
      ),
    );
    const status = await call("status", {});
    assert.equal(status.head.oid, null);
    await call(
      "stage",
      {
        expectedRevision: status.revision,
        selections: [{ ref, wholeFile: true }],
      },
      true,
    );
    const staged = await call("status", {});
    const committed = await call(
      "commit",
      {
        expectedRevision: staged.revision,
        selectedRefs: [ref],
        message: "Reviewed initial text",
        author: { name: "Harbor Test", email: "test@example.test" },
        timestamp: 1700000000,
      },
      true,
    );
    assert.match(committed.commitOid, /^[a-f0-9]{40}$/);
    assert.equal((await call("status", {})).head.oid, committed.commitOid);
    const lines = Array.from({ length: 24 }, (_, i) => `line ${i + 1}`);
    const unicodeName = "空 白.txt",
      unicodeRef =
        workspaceId + ":" + Buffer.from(unicodeName).toString("base64url");
    await writeFile(join(root, unicodeName), lines.join("\n"));
    const initial = await call("status", {});
    await call(
      "stage",
      {
        expectedRevision: initial.revision,
        selections: [{ ref: unicodeRef, wholeFile: true }],
      },
      true,
    );
    const initialStaged = await call("status", {});
    await call(
      "commit",
      {
        expectedRevision: initialStaged.revision,
        selectedRefs: [unicodeRef],
        message: "Baseline for exact hunks",
        author: { name: "Harbor Test", email: "test@example.test" },
        timestamp: 1700000001,
      },
      true,
    );
    lines[1] = "first selected change";
    lines[21] = "second unstaged change";
    await writeFile(join(root, unicodeName), lines.join("\n"));
    const reviewed = await call("diff", { ref: unicodeRef, side: "unstaged" });
    assert.equal(reviewed.hunks.length, 2);
    assert.equal(reviewed.oldMode, "100644");
    await call(
      "stage",
      {
        expectedRevision: reviewed.revision,
        selections: [{ ref: unicodeRef, hunkIds: [reviewed.hunks[0].id] }],
      },
      true,
    );
    const selected = await call("diff", { ref: unicodeRef, side: "staged" });
    assert.match(selected.newText, /first selected change/);
    assert.doesNotMatch(selected.newText, /second unstaged change/);
    assert.match(
      (await call("diff", { ref: unicodeRef, side: "unstaged" })).newText,
      /second unstaged change/,
    );
    await call(
      "unstage",
      {
        expectedRevision: selected.revision,
        selections: [{ ref: unicodeRef, hunkIds: [selected.hunks[0].id] }],
      },
      true,
    );
    assert.equal(
      (await call("status", {})).entries.find((e: any) => e.ref === unicodeRef)
        .index,
      " ",
    );
    assert.equal(
      await readFile(join(root, unicodeName), "utf8"),
      lines.join("\n"),
      "unstaging never overwrites worktree edits or missing final newline",
    );
    await chmod(join(root, unicodeName), 0o755);
    const mode = await call("diff", { ref: unicodeRef, side: "unstaged" });
    assert.equal(mode.wholeFileOnly, true);
    await assert.rejects(
      call(
        "stage",
        {
          expectedRevision: mode.revision,
          selections: [{ ref: unicodeRef, hunkIds: [mode.hunks[0].id] }],
        },
        true,
      ),
    );
    await chmod(join(root, unicodeName), 0o644);
    const beforePrepared = await call("status", {});
    await assert.rejects(
      fixedFileHelper(
        {
          ...base,
          operationId: randomUUID(),
          epoch: 2,
          action: "stage",
          payload: {
            expectedRevision: beforePrepared.revision,
            selections: [{ ref: unicodeRef, wholeFile: true }],
          },
        },
        undefined,
        async () => {
          throw Error("Owned injected prepared receipt failure");
        },
      ),
    );
    assert.equal(
      (await call("status", {})).indexRevision,
      beforePrepared.indexRevision,
      "failed durable preparation publishes no index",
    );
    const renamedName = "renamed 空.txt",
      renamedRef =
        workspaceId + ":" + Buffer.from(renamedName).toString("base64url");
    await rename(join(root, unicodeName), join(root, renamedName));
    let renameStatus = await call("status", {});
    await call(
      "stage",
      {
        expectedRevision: renameStatus.revision,
        selections: [
          { ref: unicodeRef, wholeFile: true },
          { ref: renamedRef, wholeFile: true },
        ],
      },
      true,
    );
    renameStatus = await call("status", {});
    const renamedEntry = renameStatus.entries.find(
      (e: any) => e.ref === renamedRef,
    );
    assert.equal(renamedEntry.index, "R");
    assert.equal(renamedEntry.renameFrom, unicodeRef);
    const renamedDiff = await call("diff", { ref: renamedRef, side: "staged" });
    assert.equal(renamedDiff.wholeFileOnly, true);
    await call(
      "unstage",
      {
        expectedRevision: renameStatus.revision,
        selections: [{ ref: renamedRef, wholeFile: true }],
      },
      true,
    );
    await assert.rejects(readFile(join(root, unicodeName)));
    assert.equal(
      await readFile(join(root, renamedName), "utf8"),
      lines.join("\n"),
    );
    const deletion = await call("status", {});
    await call(
      "stage",
      {
        expectedRevision: deletion.revision,
        selections: [{ ref: unicodeRef, wholeFile: true }],
      },
      true,
    );
    const deletedDiff = await call("diff", { ref: unicodeRef, side: "staged" });
    assert.equal(deletedDiff.newText, "");
    assert.equal(deletedDiff.newMode, null);
    await call(
      "unstage",
      {
        expectedRevision: deletedDiff.revision,
        selections: [{ ref: unicodeRef, wholeFile: true }],
      },
      true,
    );
    await assert.rejects(
      readFile(join(root, unicodeName)),
      "unstaging deletion must not recreate a worktree file",
    );
    await symlink("/control-plane-canary", join(root, "outside-link"));
    await assert.rejects(
      call("content", {
        ref:
          workspaceId + ":" + Buffer.from("outside-link").toString("base64url"),
      }),
    );
    await link(join(root, "note.txt"), join(root, "hard-link"));
    assert.equal((await call("content", { ref })).reason, "FILE_HARDLINK");
    await rm(join(root, "hard-link"));
    await writeFile(join(root, "binary"), Buffer.from([0, 255, 0]));
    assert.equal(
      (
        await call("content", {
          ref: workspaceId + ":" + Buffer.from("binary").toString("base64url"),
        })
      ).status,
      "binary",
    );

    const final = await call("content", { ref });
    assert.equal(
      Buffer.from(
        (await call("download", { ref, revision: final.revision })).data,
        "base64",
      ).toString(),
      "ONE\ntwo\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
    if (previousState === undefined)
      delete process.env.HARBOR_FIXTURE_STATE_DIR;
    else process.env.HARBOR_FIXTURE_STATE_DIR = previousState;
    for (const [key, value] of Object.entries({
      HARBOR_PROJECT_ROOTS: previous.roots,
      NODE_ENV: previous.node,
      HARBOR_FIXTURE_MODE: previous.mode,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
