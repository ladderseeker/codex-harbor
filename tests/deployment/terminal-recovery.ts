/** Actual installed PTY owner/crash setup and exact administrator recovery assertions. */
import { createPool } from "../../packages/storage/src/index.ts";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const db = createPool(process.env.DATABASE_URL!),
  record = process.env.HARBOR_RECOVERY_TEST_RECORD!;
try {
  if (process.argv[2] === "setup") {
    const w = (
      await db.query(
        "SELECT * FROM workspaces WHERE kind='local' ORDER BY created_at LIMIT 1",
      )
    ).rows[0];
    const id = randomUUID(),
      actor = (await db.query("SELECT hash FROM browser_sessions LIMIT 1"))
        .rows[0].hash;
    const generation = Number(
      (await db.query("SELECT nextval('runtime_generation_seq') AS n")).rows[0]
        .n,
    );
    await db.query(
      "INSERT INTO terminals(id,project_id,workspace_id,actor_hash,permission_profile,generation,state,controller_actor,controller_id,controller_until) VALUES($1,$2,$3,$4,'read-only',$5,'uncertain',$4,$6,clock_timestamp()+interval '1 hour')",
      [id, w.project_id, w.id, actor, generation, randomUUID()],
    );
    await db.query(
      "UPDATE workspaces SET writer_kind='terminal',writer_owner_id=$2,writer_generation=NULL WHERE id=$1",
      [w.id, id],
    );
    await db.query(
      "UPDATE terminals SET writer_epoch=(SELECT writer_epoch FROM workspaces WHERE id=$2) WHERE id=$1",
      [id, w.id],
    );
    await writeFile(
      record,
      JSON.stringify({
        instanceId: process.env.HARBOR_INSTANCE_ID,
        projectId: w.project_id,
        sessionId: "terminal-" + id,
        terminalId: id,
        workspaceId: w.id,
        workspacePath: w.canonical_path,
        workspaceDevice: w.device,
        workspaceInode: w.inode,
        generation,
        permissionProfile: "read-only",
        purpose: "terminal",
      }),
      { mode: 0o600 },
    );
  } else if (process.argv[2] === "check") {
    const c = JSON.parse(await readFile(record, "utf8"));
    const t = (
      await db.query("SELECT * FROM terminals WHERE id=$1", [c.terminalId])
    ).rows[0];
    assert.equal(t.retired, true);
    assert.equal(t.state, "interrupted");
    assert.equal(Number(t.generation), c.generation);
    assert.equal(t.controller_id, null);
    assert.equal(t.controller_until, null);
    assert.equal(
      (
        await db.query("SELECT writer_owner_id FROM workspaces WHERE id=$1", [
          c.workspaceId,
        ])
      ).rows[0].writer_owner_id,
      null,
    );
    assert.equal(
      (
        await db.query(
          "SELECT historical->>'state' AS state FROM deployment_restored_operations WHERE kind='terminal-recovery' AND id=$1",
          [c.terminalId],
        )
      ).rows[0].state,
      "uncertain",
    );
    console.log(
      "PASS original terminal uncertainty preserved historically and exact reservation/controller retired",
    );
  } else {
    const c = JSON.parse(await readFile(record, "utf8"));
    const { createRuntime } = await import(
      process.env.HARBOR_MANAGED_RELEASE +
        "/packages/codex-adapter/src/runtime.ts"
    );
    const runtime = await createRuntime({
      ...c,
      onEvent() {},
      onRequest() {},
      onDisconnect() {},
    });
    const shell = await runtime.startTerminal({
      processId: c.terminalId,
      permissionProfile: "read-only",
      cols: 80,
      rows: 24,
    });
    void shell.completion.catch(() => {});
    await runtime.writeTerminal(Buffer.from("sleep 300 &\n"));
    console.log("INITIALIZED");
    await new Promise<void>((r) => process.once("SIGTERM", r));
    await runtime.closeAndWait();
  }
} finally {
  await db.end();
}
