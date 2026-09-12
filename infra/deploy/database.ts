import {
  installedModules,
  installedModuleStatus,
  restoreInstalledModules,
  pauseInstalledSchedules,
} from "../../packages/storage/src/deployment-modules.ts";
/** Fixed administrator database bridge. JSON stdin is never evaluated as SQL or code. */
import { readFile } from "node:fs/promises";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  createPool,
  migrate,
  bindIdentity,
  transaction,
} from "../../packages/storage/src/index.ts";
import { digest } from "../../packages/policy/src/index.ts";
const input = JSON.parse(
  await new Promise<string>((resolve, reject) => {
    let text = "";
    process.stdin.on("data", (b) => {
      text += b;
      if (Buffer.byteLength(text) > 8 * 1024 * 1024)
        reject(Error("Administrator input limit"));
    });
    process.stdin.on("end", () => resolve(text));
  }),
);
if (process.platform !== "linux" || process.getuid?.() !== 0)
  throw Error("Trusted Linux administrator required");
const pool = createPool(process.env.DATABASE_URL!);
const exists = async (name: string) =>
  !!(await pool.query("SELECT to_regclass($1) AS object", [name])).rows[0]
    .object;
const modules: Record<string, readonly string[]> = {
  ...installedModules,
  P001: [
    "harbor_meta",
    "browser_sessions",
    "login_states",
    "projects",
    "workspaces",
    "sessions",
    "operations",
    "intents",
    "messages",
    "events",
    "approvals",
    "audits",
    "runtime_credentials",
    "runtime_bootstrap",
    "runtime_capabilities",
  ],
  P002: ["api_tokens"],
  P003: ["workspace_storage_operations", "workspace_releases"],
  P007: ["session_recoveries", "recovery_audits"],
  P005: ["attachments", "conversation_drafts", "session_attachment_storage"],
  P009: ["deployment_state", "deployment_restored_operations"],
};
async function registry() {
  const present: Record<string, string[]> = {};
  for (const [module, tables] of Object.entries(modules)) {
    if (["P005", "P007"].includes(module) && !(await exists(tables[0]!)))
      continue;
    for (const table of tables)
      if (!(await exists(table)))
        throw Error("Required database module object missing");
    present[module] = [...tables];
  }
  const actual = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    )
  ).rows.map((r) => r.tablename);
  const known = new Set([
    "harbor_migrations",
    ...Object.values(present).flat(),
  ]);
  if (actual.some((t) => !known.has(t)))
    throw Error("Unregistered installed database module");
  const projects = (await pool.query("SELECT * FROM projects ORDER BY id"))
      .rows,
    workspaces = (await pool.query("SELECT * FROM workspaces ORDER BY id"))
      .rows,
    sessions = (
      await pool.query(
        "SELECT id,project_id,workspace_id,native_thread_id,generation,state FROM sessions ORDER BY id",
      )
    ).rows;
  if (projects.length > 20 || workspaces.length > 320 || sessions.length > 200)
    throw Error("Registry count limit");
  const terminalRows = (
    await pool.query(
      "SELECT id,project_id,workspace_id,generation,state,retired,restored_from FROM terminals ORDER BY id LIMIT 257",
    )
  ).rows;
  const previews = (
    await pool.query(
      "SELECT id,project_id,workspace_id,generation,port,state,retired,restored_from FROM previews ORDER BY id LIMIT 129",
    )
  ).rows;
  if (previews.length > 128) throw Error("Preview registry bound");
  const fileEffects = (
    await pool.query(
      "SELECT id,state,acknowledged_at FROM file_operations ORDER BY id LIMIT 4097",
    )
  ).rows;
  if (terminalRows.length > 256 || fileEffects.length > 4096)
    throw Error("Installed module registry bound");
  const scheduleRows = (
    await pool.query(
      "SELECT id,project_id,state,config_revision,grant_epoch FROM schedules ORDER BY id LIMIT 257",
    )
  ).rows;
  const scheduleEffects = (
    await pool.query(
      "SELECT id,schedule_id,workspace_id,session_id,turn_id,storage_operation_id,state FROM schedule_occurrences ORDER BY id LIMIT 8193",
    )
  ).rows;
  if (scheduleRows.length > 256 || scheduleEffects.length > 8192)
    throw Error("Schedule registry bound");
  return {
    format: 1,
    schedules: scheduleRows,
    scheduleEffects,
    fileEffects,
    modules: present,
    projects,
    workspaces,
    sessions,
    terminals: terminalRows,
    previews,
    bootstrap: (await pool.query("SELECT runtime_id FROM runtime_bootstrap"))
      .rows[0]?.runtime_id,
    attachments: (await exists("session_attachment_storage"))
      ? (
          await pool.query(
            "SELECT a.*,s.project_id FROM session_attachment_storage a JOIN sessions s ON s.id=a.session_id",
          )
        ).rows
      : [],
    attachmentFiles: (await exists("attachments"))
      ? (
          await pool.query(
            "SELECT id,session_id,project_id,device,inode,digest,size FROM attachments WHERE device IS NOT NULL",
          )
        ).rows
      : [],
    ownerPin: (await pool.query("SELECT identity_pin FROM harbor_meta")).rows[0]
      .identity_pin,
    migrations: (
      await pool.query(
        "SELECT version,digest FROM harbor_migrations ORDER BY version",
      )
    ).rows,
  };
}
try {
  let result: any;
  if (input.action === "migrate") {
    await migrate(pool);
    await bindIdentity(
      pool,
      digest(
        process.env.HARBOR_OIDC_ISSUER +
          "\0" +
          process.env.HARBOR_OWNER_SUBJECT,
      ),
    );
    result = { migrated: true };
  } else if (input.action === "prepare-restore") {
    const current = await registry();
    const tables = Object.values(current.modules).flat();
    await pool.query(
      "TRUNCATE " + tables.map((t) => '\"' + t + '\"').join(",") + " CASCADE",
    );
    result = { prepared: true };
  } else if (input.action === "status") {
    result = {
      deployment: (await pool.query("SELECT * FROM deployment_state")).rows[0],
      ...(await installedModuleStatus(pool)),
      active: Number(
        (
          await pool.query(
            "SELECT count(*) FROM operations WHERE state IN ('dispatching','running','waiting_input','waiting_approval')",
          )
        ).rows[0].count,
      ),
      pendingStorage: Number(
        (
          await pool.query(
            "SELECT count(*) FROM workspace_storage_operations WHERE state IN ('queued','dispatching')",
          )
        ).rows[0].count,
      ),
      pendingRecovery: (await exists("session_recoveries"))
        ? Number(
            (
              await pool.query(
                "SELECT count(*) FROM session_recoveries WHERE state IN ('queued','fencing')",
              )
            ).rows[0].count,
          )
        : 0,
      accountConfigured: !!(
        await pool.query("SELECT 1 FROM runtime_credentials")
      ).rowCount,
    };
  } else if (input.action === "maintenance") {
    await pool.query(
      "UPDATE deployment_state SET maintenance=$1,activation_required=activation_required OR $2,updated_at=clock_timestamp()",
      [!!input.enabled, !!input.activationRequired],
    );
    result = { maintenance: !!input.enabled };
  } else if (input.action === "activate") {
    await pool.query(
      "UPDATE deployment_state SET maintenance=false,activation_required=false,updated_at=clock_timestamp()",
    );
    result = { activated: true };
  } else if (input.action === "registry") result = await registry();
  else if (input.action === "interrupt") {
    await transaction(pool, async (db) => {
      await db.query("UPDATE harbor_meta SET emergency=true");
      await pauseInstalledSchedules(db, "ADMINISTRATOR_INTERRUPTED");
      await db.query(
        "INSERT INTO deployment_restored_operations(kind,id,source_instance,historical) SELECT 'preview-interruption',id,$1,to_jsonb(previews) FROM previews WHERE NOT retired ON CONFLICT DO NOTHING",
        [process.env.HARBOR_INSTANCE_ID],
      );
      await db.query("UPDATE preview_openings SET revoked=true");
      await db.query("UPDATE preview_grants SET revoked=true");
      await db.query(
        "UPDATE previews SET stop_attempts=stop_attempts+CASE WHEN state='uncertain' THEN 1 ELSE 0 END,state='stopping',failure_code='ADMINISTRATOR_INTERRUPTED' WHERE NOT retired AND (state<>'uncertain' OR stop_attempts<3)",
      );

      await db.query(
        "INSERT INTO deployment_restored_operations(kind,id,source_instance,historical) SELECT 'terminal-interruption',id,$1,to_jsonb(terminals) FROM terminals WHERE NOT retired AND state='uncertain' AND termination_attempts<3 ON CONFLICT DO NOTHING",
        [process.env.HARBOR_INSTANCE_ID],
      );
      await db.query(
        "UPDATE terminals SET termination_attempts=termination_attempts+CASE WHEN state='uncertain' THEN 1 ELSE 0 END,state='retiring',failure_code='ADMINISTRATOR_INTERRUPTED',controller_until=NULL WHERE NOT retired AND state<>'queued' AND (state<>'uncertain' OR termination_attempts<3)",
      );
      await db.query(
        "UPDATE operations SET state='uncertain',updated_at=now() WHERE kind='turn' AND state IN ('dispatching','running','waiting_input','waiting_approval')",
      );
      await db.query(
        "UPDATE sessions SET state='uncertain' WHERE id IN (SELECT session_id FROM operations WHERE state='uncertain')",
      );
      await db.query(
        "UPDATE approvals SET state='expired',answer=NULL WHERE state IN ('pending','answering')",
      );
    });
    result = { interruptionRecorded: true };
  } else if (input.action === "restore-rebind") {
    if (
      !input.sourceInstance ||
      input.sourceInstance === process.env.HARBOR_INSTANCE_ID ||
      !Array.isArray(input.projects) ||
      !Array.isArray(input.workspaces)
    )
      throw Error("Fresh restore namespace required");
    await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(740016)");
      if (!/^[a-f0-9-]{36}$/.test(input.restoreId))
        throw Error("Restore operation identity required");
      const bindingHash = digest(
        JSON.stringify({
          instance: process.env.HARBOR_INSTANCE_ID,
          source: input.sourceInstance,
          owner: process.env.HARBOR_OWNER_SUBJECT,
          projects: input.projects,
          workspaces: input.workspaces,
          attachments: input.attachments,
          attachmentFiles: input.attachmentFiles,
        }),
      );
      const prior = (
        await db.query(
          "SELECT historical FROM deployment_restored_operations WHERE kind='restore' AND id=$1",
          [input.restoreId],
        )
      ).rows[0];
      if (prior) {
        if (prior.historical.bindingHash !== bindingHash)
          throw Error("Restore binding changed");
        return;
      }
      const credential = (await db.query("SELECT * FROM runtime_credentials"))
        .rows[0];
      if (credential) {
        const oldKey = await readFile(input.oldKeyFile),
          newKey = await readFile(process.env.HARBOR_CREDENTIAL_KEY_FILE!);
        if (oldKey.length !== 32 || newKey.length !== 32)
          throw Error("Credential recovery key unavailable");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          oldKey,
          Buffer.from(credential.iv, "base64"),
        );
        decipher.setAAD(
          Buffer.from(input.sourceInstance + "\0" + input.sourceOwner),
        );
        decipher.setAuthTag(Buffer.from(credential.tag, "base64"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(credential.ciphertext, "base64")),
          decipher.final(),
        ]);
        try {
          const iv = randomBytes(12),
            cipher = createCipheriv("aes-256-gcm", newKey, iv);
          cipher.setAAD(
            Buffer.from(
              process.env.HARBOR_INSTANCE_ID +
                "\0" +
                process.env.HARBOR_OWNER_SUBJECT,
            ),
          );
          const ciphertext = Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
          ]);
          await db.query(
            "UPDATE runtime_credentials SET ciphertext=$1,iv=$2,tag=$3,updated_at=now()",
            [
              ciphertext.toString("base64"),
              iv.toString("base64"),
              cipher.getAuthTag().toString("base64"),
            ],
          );
        } finally {
          plaintext.fill(0);
          oldKey.fill(0);
          newKey.fill(0);
        }
      }
      const pin = digest(
        process.env.HARBOR_OIDC_ISSUER +
          "\0" +
          process.env.HARBOR_OWNER_SUBJECT,
      );
      await db.query(
        "UPDATE harbor_meta SET identity_pin=$1,generation=generation+1000000,emergency=false",
        [pin],
      );
      await db.query("UPDATE browser_sessions SET revoked=true");
      await db.query("UPDATE api_tokens SET revoked=true");
      await db.query("DELETE FROM login_states");
      await db.query("DELETE FROM runtime_capabilities");
      await db.query(
        "UPDATE approvals SET state='expired',answer=NULL WHERE state IN ('pending','answering')",
      );
      await db.query(
        "INSERT INTO deployment_restored_operations(kind,id,source_instance,historical) SELECT 'operation',id,$1,to_jsonb(operations) FROM operations WHERE state IN ('queued','dispatching','running','waiting_input','waiting_approval') ON CONFLICT DO NOTHING",
        [input.sourceInstance],
      );
      await db.query(
        "UPDATE operations SET state=CASE WHEN kind='turn' AND state<>'queued' THEN 'uncertain' ELSE 'interrupted' END,updated_at=now() WHERE state IN ('queued','dispatching','running','waiting_input','waiting_approval')",
      );
      await db.query(
        "INSERT INTO deployment_restored_operations(kind,id,source_instance,historical) SELECT 'storage',id,$1,to_jsonb(workspace_storage_operations) FROM workspace_storage_operations ON CONFLICT DO NOTHING",
        [input.sourceInstance],
      );
      await db.query(
        "UPDATE workspace_storage_operations SET state='failed',failure_code='RESTORED_AUTHORITY_REVOKED',retry_authority=false,command=jsonb_set(command,'{restoredAuthorityRevoked}','true')",
      );
      await db.query(
        "UPDATE workspace_releases SET state='failed',failure_code='RESTORED_AUTHORITY_REVOKED' WHERE state<>'completed'",
      );
      if (await exists("session_recoveries"))
        await db.query(
          "UPDATE session_recoveries SET state='failed',report='{\"status\":\"unavailable\",\"reason\":\"Restored host requires a fresh fence\"}',updated_at=now() WHERE state IN ('queued','fencing','ready')",
        );
      await restoreInstalledModules(db, input.sourceInstance);
      await db.query(
        "UPDATE intents SET actor='restored:' || $1 || ':' || actor",
        [input.sourceInstance],
      );
      for (const project of input.projects) {
        const updated = await db.query(
          "UPDATE projects SET root_id=$2,relative_path=$3,canonical_path=$4,device=$5,inode=$6 WHERE id=$1 RETURNING id",
          [
            project.id,
            project.rootId,
            project.relativePath,
            project.canonical,
            project.device,
            project.inode,
          ],
        );
        if (updated.rowCount !== 1)
          throw Error("Restored project identity missing");
      }
      for (const w of input.workspaces) {
        const updated = await db.query(
          "UPDATE workspaces SET relative_path=$2,canonical_path=$3,device=$4,inode=$5,common_path=$6,common_device=$7,common_inode=$8 WHERE id=$1 RETURNING id",
          [
            w.id,
            w.relativePath,
            w.canonical,
            w.device,
            w.inode,
            w.common?.canonical ?? null,
            w.common?.device ?? null,
            w.common?.inode ?? null,
          ],
        );
        if (updated.rowCount !== 1)
          throw Error("Restored workspace identity missing");
      }
      if (await exists("session_attachment_storage"))
        for (const a of input.attachments ?? [])
          await db.query(
            "UPDATE session_attachment_storage SET canonical=$2,device=$3,inode=$4 WHERE session_id=$1",
            [a.sessionId, a.canonical, a.device, a.inode],
          );
      if (await exists("attachments"))
        for (const a of input.attachmentFiles ?? [])
          await db.query(
            "UPDATE attachments SET device=$2,inode=$3 WHERE id=$1",
            [a.id, a.device, a.inode],
          );
      await db.query(
        "UPDATE sessions SET state='uncertain' WHERE id IN (SELECT session_id FROM operations WHERE state='uncertain')",
      );
      await db.query(
        "UPDATE deployment_state SET maintenance=true,activation_required=true,restored_from=$1,epoch=epoch+1000000,updated_at=now()",
        [input.sourceInstance],
      );
      await db.query(
        "SELECT setval('runtime_generation_seq',greatest((SELECT last_value FROM runtime_generation_seq),(SELECT coalesce(max(generation),0) FROM sessions))+1000000,true)",
      );
      await db.query(
        "INSERT INTO deployment_restored_operations(kind,id,source_instance,historical) VALUES('restore',$1,$2,$3)",
        [
          input.restoreId,
          input.sourceInstance,
          JSON.stringify({ bindingHash }),
        ],
      );
    });
    result = { rebound: true, disabled: true };
  } else throw Error("Unknown fixed administrator database action");
  process.stdout.write(JSON.stringify(result));
} finally {
  await pool.end();
}
