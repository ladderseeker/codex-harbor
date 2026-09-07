/** Public test setup/actual installed runtime only; no account or model turn. */
import { createPool } from "../../packages/storage/src/index.ts";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const record = process.env.HARBOR_RECOVERY_TEST_RECORD!;
const release = process.env.HARBOR_MANAGED_RELEASE!;
const db = createPool(process.env.DATABASE_URL!);
if (process.argv[2] === "setup") {
  const p = (
    await db.query(
      "SELECT p.*,w.id AS workspace_id FROM projects p JOIN workspaces w ON w.project_id=p.id AND w.kind='local' ORDER BY p.id LIMIT 1",
    )
  ).rows[0];
  const sessionId = randomUUID(),
    operationId = randomUUID();
  const generation = Number(
    (await db.query("SELECT nextval('runtime_generation_seq') AS n")).rows[0].n,
  );
  await db.query(
    "INSERT INTO sessions(id,project_id,workspace_id,title,state,model,effort,permission_profile,generation) VALUES($1,$2,$3,'Public administrator recovery fixture','uncertain','gpt-5.4','medium','read-only',$4)",
    [sessionId, p.id, p.workspace_id, generation],
  );
  await db.query(
    "INSERT INTO operations(id,session_id,kind,state,payload,actor_hash,generation) VALUES($1,$2,'turn','uncertain','{\"text\":\"public unapplied recovery canary\"}','public-test-actor',$3)",
    [operationId, sessionId, generation],
  );
  await db.query(
    "UPDATE workspaces SET writer_session_id=$2,writer_generation=$3 WHERE id=$1",
    [p.workspace_id, sessionId, generation],
  );
  await writeFile(
    record,
    JSON.stringify({
      instanceId: process.env.HARBOR_INSTANCE_ID,
      projectId: p.id,
      sessionId,
      workspaceId: p.workspace_id,
      workspacePath: p.canonical_path,
      workspaceDevice: p.device,
      workspaceInode: p.inode,
      generation,
      permissionProfile: "read-only",
      operationId,
    }),
    { mode: 0o600 },
  );
} else if (process.argv[2] === "check") {
  const c = JSON.parse(await readFile(record, "utf8"));
  assert.equal(
    (
      await db.query("SELECT state FROM operations WHERE id=$1", [
        c.operationId,
      ])
    ).rows[0].state,
    "uncertain",
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM operations WHERE session_id=$1",
        [c.sessionId],
      )
    ).rows[0].n,
    "1",
  );
  assert.equal(
    (
      await db.query("SELECT writer_session_id FROM workspaces WHERE id=$1", [
        c.workspaceId,
      ])
    ).rows[0].writer_session_id,
    c.sessionId,
  );
  assert.equal(
    (await db.query("SELECT maintenance FROM deployment_state")).rows[0]
      .maintenance,
    true,
  );
  console.log(
    "PASS original uncertainty and writer ownership preserved; no replay",
  );
} else {
  const c = JSON.parse(await readFile(record, "utf8"));
  const { createRuntime } = await import(
    release + "/packages/codex-adapter/src/runtime.ts"
  );
  if (process.argv[2] === "new")
    c.generation = Number(
      (await db.query("SELECT nextval('runtime_generation_seq') AS n")).rows[0]
        .n,
    );
  const runtime = await createRuntime({
    ...c,
    onEvent() {},
    onRequest() {},
    onDisconnect() {},
  });
  assert.equal((await runtime.readAccount()).account, null);
  if (process.argv[2] === "new") {
    await runtime.closeAndWait();
    console.log("PASS new generation initialized and retired");
  } else {
    console.log("INITIALIZED");
    await new Promise<void>((r) => process.once("SIGTERM", r));
    await runtime.closeAndWait();
  }
}
await db.end();
