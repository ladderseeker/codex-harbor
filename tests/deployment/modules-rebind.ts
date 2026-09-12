/** Fresh local synthetic DB clone only; no backup, filesystem restore or source contact. */
import { createPool } from "../../packages/storage/src/index.ts";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const sourceUrl = new URL(process.env.DATABASE_URL!);
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const name = "module_rebind_" + randomUUID().replaceAll("-", "");
const cloneUrl = new URL(sourceUrl);
cloneUrl.pathname = "/" + name;
const admin = createPool(adminUrl.toString());
const release = process.env.HARBOR_MANAGED_RELEASE!;
let clone: ReturnType<typeof createPool> | undefined;
try {
  await admin.query(`CREATE DATABASE ${name} TEMPLATE harbor`);
  clone = createPool(cloneUrl.toString());
  const w = (
    await clone.query("SELECT * FROM workspaces ORDER BY created_at LIMIT 1")
  ).rows[0];
  const actor = (await clone.query("SELECT hash FROM browser_sessions LIMIT 1"))
    .rows[0].hash;
  const file = randomUUID(),
    inspection = randomUUID(),
    terminal = randomUUID(),
    controller = randomUUID();
  await clone.query(
    "INSERT INTO file_operations(id,project_id,workspace_id,actor_hash,kind,state,request_hash,payload,result) VALUES($1,$2,$3,$4,'save','dispatching','public-rebind','{\"text\":\"original public text\"}','{\"receipt\":\"original public receipt\"}')",
    [file, w.project_id, w.id, actor],
  );
  await clone.query(
    "UPDATE workspaces SET writer_kind='file',writer_owner_id=$2,writer_generation=NULL WHERE id=$1",
    [w.id, file],
  );
  const epoch = (
    await clone.query("SELECT writer_epoch FROM workspaces WHERE id=$1", [w.id])
  ).rows[0].writer_epoch;
  await clone.query("UPDATE file_operations SET epoch=$2 WHERE id=$1", [
    file,
    epoch,
  ]);
  await clone.query(
    "INSERT INTO file_inspections(id,operation_id,actor_hash,expected_epoch,fence,state,report) VALUES($1,$2,$3,$4,$4,'ready','{\"sourceAuthority\":true}')",
    [inspection, file, actor, epoch],
  );
  await clone.query(
    "INSERT INTO terminals(id,project_id,workspace_id,actor_hash,permission_profile,state,controller_actor,controller_id,controller_until,generation) VALUES($1,$2,$3,$4,'read-only','running',$4,$5,clock_timestamp()+interval '1 hour',nextval('runtime_generation_seq'))",
    [terminal, w.project_id, w.id, actor, controller],
  );
  await clone.query(
    "INSERT INTO terminal_input(terminal_id,epoch,sequence,actor_hash,controller_id,hash,bytes,state) VALUES($1,0,1,$2,$3,'public-hash',$4,'dispatching')",
    [terminal, actor, controller, Buffer.from("PUBLIC_INPUT_NEVER_REPLAY")],
  );
  const old = (
    await clone.query("SELECT generation FROM terminals WHERE id=$1", [
      terminal,
    ])
  ).rows[0];
  const preview = randomUUID(),
    opening = randomUUID();
  await clone.query(
    "INSERT INTO previews(id,project_id,workspace_id,name,script,port,hostname,permission_profile,actor_hash,generation,lease_epoch,state,retired,runner_id,relay_id) VALUES($1,$2,$3,'Restored preview','dev',3000,$4,'read-only',$5,nextval('runtime_generation_seq'),nextval('runtime_generation_seq'),'ready',false,'original-source-runtime','original-source-relay')",
    [
      preview,
      w.project_id,
      w.id,
      randomUUID().replaceAll("-", "") + ".preview.localhost",
      actor,
    ],
  );
  const originalPreview = (
    await clone.query("SELECT * FROM previews WHERE id=$1", [preview])
  ).rows[0];
  await clone.query(
    "INSERT INTO preview_readers(owner_id,workspace_id,epoch,generation) VALUES($1,$2,$3,$4)",
    [preview, w.id, originalPreview.lease_epoch, originalPreview.generation],
  );
  await clone.query(
    "INSERT INTO preview_openings(id,preview_id,generation,actor_hash,ticket_hash,grant_hash,expires_at,consumed_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '30 seconds',clock_timestamp())",
    [
      opening,
      preview,
      originalPreview.generation,
      actor,
      randomUUID(),
      randomUUID(),
    ],
  );
  await clone.query(
    "INSERT INTO preview_grants(id,preview_id,generation,actor_hash,hash,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes')",
    [opening, preview, originalPreview.generation, actor, randomUUID()],
  );
  await clone.query(
    "INSERT INTO preview_logs(preview_id,sequence,generation,bytes) VALUES($1,1,$2,$3)",
    [
      preview,
      originalPreview.generation,
      Buffer.from("PUBLIC_PREVIEW_HISTORY"),
    ],
  );
  const input = {
    action: "restore-rebind",
    restoreId: randomUUID(),
    sourceInstance: process.env.HARBOR_INSTANCE_ID,
    sourceOwner: process.env.HARBOR_OWNER_SUBJECT,
    projects: [],
    workspaces: [],
    attachments: [],
    attachmentFiles: [],
  };
  const env = {
    ...process.env,
    DATABASE_URL: cloneUrl.toString(),
    HARBOR_INSTANCE_ID: "restore-" + randomUUID(),
  };
  const invoke = () =>
    JSON.parse(
      execFileSync(
        release + "/bin/node",
        [
          "--import",
          release + "/node_modules/tsx/dist/loader.mjs",
          release + "/infra/deploy/database.ts",
        ],
        { input: JSON.stringify(input), env, encoding: "utf8", timeout: 60000 },
      ),
    );
  assert.equal(invoke().disabled, true);
  const restoredPreview = (
    await clone.query("SELECT * FROM previews WHERE id=$1", [preview])
  ).rows[0];
  assert.equal(restoredPreview.state, "stopped");
  assert.equal(restoredPreview.retired, true);
  assert.notEqual(restoredPreview.generation, originalPreview.generation);
  assert.equal(restoredPreview.runner_id, null);
  assert.equal(restoredPreview.relay_id, null);
  assert.equal(restoredPreview.lease_epoch, null);
  assert.equal(restoredPreview.output_lost, true);
  assert.equal(
    (
      await clone.query(
        "SELECT count(*)::int n FROM preview_readers WHERE owner_id=$1",
        [preview],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await clone.query(
        "SELECT count(*)::int n FROM preview_grants WHERE preview_id=$1 AND NOT revoked",
        [preview],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await clone.query(
        "SELECT count(*)::int n FROM preview_openings WHERE preview_id=$1 AND NOT revoked",
        [preview],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await clone.query("SELECT bytes FROM preview_logs WHERE preview_id=$1", [
        preview,
      ])
    ).rows[0].bytes.toString(),
    "PUBLIC_PREVIEW_HISTORY",
  );
  assert.equal(
    (
      await clone.query(
        "SELECT historical->>'runner_id' id FROM deployment_restored_operations WHERE kind='preview' AND id=$1",
        [preview],
      )
    ).rows[0].id,
    "original-source-runtime",
  );
  const f = (
    await clone.query("SELECT * FROM file_operations WHERE id=$1", [file])
  ).rows[0];
  assert.equal(f.state, "uncertain");
  assert.notEqual(f.epoch, epoch);
  assert.deepEqual(f.result, { receipt: "original public receipt" });
  assert.equal(
    (
      await clone.query("SELECT count(*) FROM file_inspections WHERE id=$1", [
        inspection,
      ])
    ).rows[0].count,
    "0",
  );
  assert.equal(
    (
      await clone.query(
        "SELECT historical->>'state' AS state FROM deployment_restored_operations WHERE kind='file-inspection' AND id=$1",
        [inspection],
      )
    ).rows[0].state,
    "ready",
  );
  const t = (
    await clone.query("SELECT * FROM terminals WHERE id=$1", [terminal])
  ).rows[0];
  assert.equal(t.state, "uncertain");
  assert.equal(t.controller_id, null);
  assert.equal(t.controller_actor, null);
  assert.equal(t.controller_until, null);
  assert.notEqual(t.generation, old.generation);
  assert.deepEqual(
    (
      await clone.query(
        "SELECT state,bytes FROM terminal_input WHERE terminal_id=$1",
        [terminal],
      )
    ).rows[0],
    { state: "uncertain", bytes: null },
  );
  assert.equal(
    (
      await clone.query(
        "SELECT count(*) FROM browser_sessions WHERE NOT revoked",
      )
    ).rows[0].count,
    "0",
  );
  assert.equal(
    (await clone.query("SELECT count(*) FROM api_tokens WHERE NOT revoked"))
      .rows[0].count,
    "0",
  );
  assert.equal(
    (
      await clone.query(
        "SELECT activation_required AND maintenance AS disabled FROM deployment_state",
      )
    ).rows[0].disabled,
    true,
  );
  invoke();
  assert.equal(
    (
      await clone.query("SELECT generation FROM previews WHERE id=$1", [
        preview,
      ])
    ).rows[0].generation,
    restoredPreview.generation,
  );
  assert.equal(
    (
      await clone.query("SELECT generation FROM terminals WHERE id=$1", [
        terminal,
      ])
    ).rows[0].generation,
    t.generation,
  );
  const interrupt = () =>
    JSON.parse(
      execFileSync(
        release + "/bin/node",
        [
          "--import",
          release + "/node_modules/tsx/dist/loader.mjs",
          release + "/infra/deploy/database.ts",
        ],
        {
          input: JSON.stringify({ action: "interrupt" }),
          env,
          encoding: "utf8",
          timeout: 60000,
        },
      ),
    );
  interrupt();
  assert.equal(
    (await clone.query("SELECT state FROM terminals WHERE id=$1", [terminal]))
      .rows[0].state,
    "retiring",
  );
  assert.equal(
    (
      await clone.query(
        "SELECT historical->>'state' AS state FROM deployment_restored_operations WHERE kind='terminal-interruption' AND id=$1",
        [terminal],
      )
    ).rows[0].state,
    "uncertain",
  );
  await clone.query(
    "UPDATE terminals SET state='uncertain',termination_attempts=3 WHERE id=$1",
    [terminal],
  );
  interrupt();
  assert.equal(
    (await clone.query("SELECT state FROM terminals WHERE id=$1", [terminal]))
      .rows[0].state,
    "uncertain",
  );
  await writeFile(
    process.env.HARBOR_MODULE_REBIND_RESULT!,
    JSON.stringify(
      {
        status: "passed",
        node: process.version,
        freshLocalDatabaseClone: true,
        previewStoppedNewGenerationWithoutReplay: true,
        previewViewerAuthorityRevoked: true,
        previewLogsAndNativeReferencesHistoricallyPreserved: true,
        actualInstalledDatabaseBridge: release,
        originalFileOutcomePreserved: true,
        oldInspectionNonAuthorizing: true,
        controllerAndInputRevoked: true,
        sameRestoreRetryStable: true,
        explicitUncertainInterruptionBounded: true,
        sourceContact: false,
        protectedTransfer: false,
        filesystemRestore: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("PASS fresh local metadata rebind, no source contact or replay");
} finally {
  await clone?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
}
