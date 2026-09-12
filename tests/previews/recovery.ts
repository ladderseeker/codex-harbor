/** Actual installed account-free preview owner/crash and administrator recovery. */
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
    const actor = (
      await db.query(
        "SELECT hash FROM browser_sessions WHERE NOT revoked ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0].hash;
    const id = randomUUID(),
      generation = Number(
        (await db.query("SELECT nextval('runtime_generation_seq') n")).rows[0]
          .n,
      ),
      epoch = Number(
        (await db.query("SELECT nextval('runtime_generation_seq') n")).rows[0]
          .n,
      );
    await db.query(
      "INSERT INTO previews(id,project_id,workspace_id,name,script,port,hostname,permission_profile,actor_hash,generation,lease_epoch,state,retired) VALUES($1,$2,$3,'Owned admin recovery','dev',33321,$4,'read-only',$5,$6,$7,'uncertain',false)",
      [
        id,
        w.project_id,
        w.id,
        randomUUID().replaceAll("-", "") + ".preview.localhost",
        actor,
        generation,
        epoch,
      ],
    );
    await db.query(
      "INSERT INTO preview_readers(owner_id,workspace_id,epoch,generation) VALUES($1,$2,$3,$4)",
      [id, w.id, epoch, generation],
    );
    const opening = randomUUID();
    await db.query(
      "INSERT INTO preview_openings(id,preview_id,generation,actor_hash,ticket_hash,grant_hash,expires_at,consumed_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '30 seconds',clock_timestamp())",
      [opening, id, generation, actor, randomUUID(), randomUUID()],
    );
    await db.query(
      "INSERT INTO preview_grants(id,preview_id,generation,actor_hash,hash,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes')",
      [opening, id, generation, actor, randomUUID()],
    );
    await writeFile(
      record,
      JSON.stringify({
        instanceId: process.env.HARBOR_INSTANCE_ID,
        projectId: w.project_id,
        sessionId: "preview-" + id,
        previewId: id,
        workspaceId: w.id,
        workspacePath: w.canonical_path,
        workspaceDevice: w.device,
        workspaceInode: w.inode,
        generation,
        permissionProfile: "read-only",
        purpose: "preview",
        port: 33321,
      }),
      { mode: 0o600 },
    );
  } else if (process.argv[2] === "check") {
    const c = JSON.parse(await readFile(record, "utf8")),
      p = (await db.query("SELECT * FROM previews WHERE id=$1", [c.previewId]))
        .rows[0];
    assert.equal(p.retired, true);
    assert.equal(p.state, "stopped");
    assert.equal(Number(p.generation), c.generation);
    assert.equal(p.output_lost, true);
    assert.equal(p.lease_epoch, null);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM preview_readers WHERE owner_id=$1",
          [p.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM preview_grants WHERE preview_id=$1 AND NOT revoked",
          [p.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM preview_openings WHERE preview_id=$1 AND NOT revoked",
          [p.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT historical->>'state' state FROM deployment_restored_operations WHERE kind='preview-recovery' AND id=$1",
          [p.id],
        )
      ).rows[0].state,
      "stopping",
    );
    assert.equal(
      (
        await db.query(
          "SELECT historical->>'state' state FROM deployment_restored_operations WHERE kind='preview-interruption' AND id=$1",
          [p.id],
        )
      ).rows[0].state,
      "uncertain",
    );
    console.log(
      "PASS exact reader/grants retired and original preview uncertainty preserved",
    );
  } else {
    const c = JSON.parse(await readFile(record, "utf8"));
    const { createRuntime } = await import(
      process.env.HARBOR_MANAGED_RELEASE +
        "/packages/codex-adapter/src/runtime.ts"
    );
    const { launchRelay } = await import(
      process.env.HARBOR_MANAGED_RELEASE + "/infra/previews/launcher.ts"
    );
    const runtime = await createRuntime({
      ...c,
      onEvent() {},
      onRequest() {},
      onDisconnect() {},
    });
    const started = await runtime.startPreview({
      processId: c.previewId,
      script: "dev",
      port: c.port,
      permissionProfile: "read-only",
    });
    void started.completion.catch(() => {});
    const relay = await launchRelay({
      id: c.previewId,
      generation: c.generation,
      instanceId: c.instanceId,
      port: c.port,
    });
    await runtime.probePreview();
    console.log("INITIALIZED");
    await new Promise<void>((resolve) => process.once("SIGTERM", resolve));
    await relay.close();
    await runtime.closeAndWait();
  }
} finally {
  await db.end();
}
