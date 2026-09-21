/** Fixed installed modules. No registry input supplies SQL or executable hooks. */
import type { DB } from "./index.ts";
export const installedModules = {
  P018: ["conversation_runtimes"],
  P004: [
    "file_operations",
    "file_inspections",
    "file_operation_audits",
    "file_events",
  ],
  P006: ["terminals", "terminal_input", "terminal_output"],
  P011: [
    "previews",
    "preview_readers",
    "preview_stops",
    "preview_openings",
    "preview_grants",
    "preview_logs",
  ],
  P008: [
    "schedules",
    "schedule_versions",
    "schedule_grants",
    "schedule_occurrences",
    "schedule_commands",
    "schedule_test_clock",
  ],
} as const;
export async function installedModuleStatus(db: DB) {
  const row = (
    await db.query(`SELECT
    (SELECT count(*) FROM conversation_runtimes) AS "activeConversationRuntimes",
    (SELECT count(*) FROM file_operations WHERE state='queued') AS "queuedFiles",
    (SELECT count(*) FROM file_operations WHERE state='dispatching') AS "activeFiles",
    (SELECT count(*) FROM file_operations WHERE state='uncertain' AND acknowledged_at IS NULL) AS "uncertainFiles",
    (SELECT count(*) FROM file_inspections WHERE state IN ('queued','inspecting')) AS "pendingFileInspections",
    (SELECT count(*) FROM terminals WHERE state='queued' AND NOT retired) AS "queuedTerminals",
    (SELECT count(*) FROM terminals WHERE state<>'queued' AND NOT retired) AS "activeTerminals",
    (SELECT count(*) FROM previews WHERE state='queued') AS "queuedPreviews",
    (SELECT count(*) FROM previews WHERE NOT retired) AS "activePreviews",
    (SELECT count(*) FROM schedules WHERE state='enabled') AS "enabledSchedules",
    (SELECT count(*) FROM schedule_occurrences WHERE state IN ('accepted','preparing_workspace','queued_turn')) AS "queuedScheduleOccurrences",
    (SELECT count(*) FROM schedule_occurrences o WHERE EXISTS(SELECT 1 FROM operations t WHERE t.id=o.turn_id AND t.state IN ('dispatching','running','waiting_approval','waiting_input')) OR EXISTS(SELECT 1 FROM workspace_storage_operations w WHERE w.id=o.storage_operation_id AND w.state IN ('queued','dispatching'))) AS "activeScheduleEffects"
  `)
  ).rows[0];
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  );
}
export async function restoreInstalledModules(db: DB, source: string) {
  // Restored process identities belong to the source host and are never inspected.
  await db.query(
    "UPDATE conversation_runtimes SET native_identity=NULL,state='unknown',idle_until=NULL",
  );
  // Historical rows retain original outcomes/content. Source dispatch and control
  // identities never become active authority in this destination.
  for (const [kind, table] of [
    ["file", "file_operations"],
    ["file-inspection", "file_inspections"],
    ["terminal", "terminals"],
    ["preview", "previews"],
  ] as const)
    await db.query(
      `INSERT INTO deployment_restored_operations(kind,id,source_instance,historical) SELECT $2,id,$1,to_jsonb(${table}) FROM ${table} ON CONFLICT DO NOTHING`,
      [source, kind],
    );
  for (const [kind, table] of [
    ["schedule", "schedules"],
    ["schedule-occurrence", "schedule_occurrences"],
  ] as const)
    await db.query(
      `INSERT INTO deployment_restored_operations(kind,id,source_instance,historical) SELECT $2,id,$1,to_jsonb(${table}) FROM ${table} ON CONFLICT DO NOTHING`,
      [source, kind],
    );
  await pauseInstalledSchedules(db, "RESTORED_AUTHORITY_REVOKED");
  await db.query(
    "UPDATE schedule_occurrences o SET state=CASE WHEN EXISTS(SELECT 1 FROM operations t WHERE t.id=o.turn_id AND t.state='uncertain') THEN 'uncertain' ELSE 'cancelled' END,reason='RESTORED_AUTHORITY_REVOKED',ended_at=COALESCE(ended_at,clock_timestamp()),updated_at=clock_timestamp() WHERE state IN ('accepted','preparing_workspace','queued_turn','running','attention')",
  );
  await db.query(
    "UPDATE schedule_commands SET actor_hash='restored:'||$1||':'||actor_hash",
    [source],
  );
  await db.query("DELETE FROM schedule_test_clock");
  // Source preview identities are history only. No source runner/relay is
  // contacted, and no restored viewing ticket or control can resume a process.
  await db.query("UPDATE preview_grants SET revoked=true");
  await db.query("UPDATE preview_openings SET revoked=true");
  await db.query(
    "UPDATE preview_stops SET state='failed',failure_code='RESTORED_AUTHORITY_REVOKED',actor_hash='restored:'||$1||':'||actor_hash WHERE state IN ('queued','retiring')",
    [source],
  );
  await db.query("DELETE FROM preview_readers");
  await db.query(
    "UPDATE workspaces SET writer_kind=NULL,writer_owner_id=NULL,writer_generation=NULL WHERE writer_kind='preview'",
  );
  await db.query(
    "UPDATE previews SET restored_from=$1,generation=nextval('runtime_generation_seq'),revision=revision+1,state='stopped',retired=true,lease_epoch=NULL,runner_id=NULL,relay_id=NULL,deadline=NULL,retirement_ack=NULL,stop_attempts=0,actor_hash='restored:'||$1||':'||actor_hash,output_lost=output_lost OR NOT retired,failure_code='RESTORED_AUTHORITY_REVOKED'",
    [source],
  );
  await db.query(
    "UPDATE file_operations SET restored_from=$1,state=CASE WHEN state='queued' THEN 'failed' WHEN state='dispatching' THEN 'uncertain' ELSE state END,failure_code=CASE WHEN state IN ('queued','dispatching','uncertain') THEN 'RESTORED_AUTHORITY_REVOKED' ELSE failure_code END,payload=CASE WHEN state='queued' THEN NULL ELSE payload END,payload_bytes=CASE WHEN state='queued' THEN 0 ELSE payload_bytes END",
    [source],
  );
  // Ready source inspections cannot release destination ownership. Their complete
  // records above remain historical; a fresh destination inspection gets a new ID.
  await db.query("DELETE FROM file_inspections");
  await db.query(
    "UPDATE workspaces SET writer_epoch=nextval('runtime_generation_seq') WHERE writer_kind IN ('file','terminal') AND writer_owner_id IS NOT NULL",
  );
  await db.query(
    "UPDATE file_operations o SET epoch=w.writer_epoch FROM workspaces w WHERE w.writer_kind='file' AND w.writer_owner_id=o.id",
  );
  await db.query(
    "UPDATE terminals SET restored_from=$1,generation=nextval('runtime_generation_seq'),state=CASE WHEN retired THEN state WHEN state='queued' THEN 'interrupted' ELSE 'uncertain' END,retired=retired OR state='queued',failure_code=CASE WHEN NOT retired THEN 'RESTORED_AUTHORITY_REVOKED' ELSE failure_code END,controller_actor=NULL,controller_id=NULL,controller_until=NULL,controller_epoch=controller_epoch+1,resize_pending=false,output_lost=output_lost OR NOT retired,input_uncertain=input_uncertain OR EXISTS(SELECT 1 FROM terminal_input i WHERE i.terminal_id=terminals.id AND i.state='dispatching')",
    [source],
  );
  await db.query(
    "UPDATE terminals t SET writer_epoch=w.writer_epoch FROM workspaces w WHERE w.writer_kind='terminal' AND w.writer_owner_id=t.id",
  );
  await db.query(
    "UPDATE terminal_input SET state=CASE WHEN state='dispatching' THEN 'uncertain' ELSE 'denied' END,bytes=NULL,settled_at=clock_timestamp(),failure_code='RESTORED_AUTHORITY_REVOKED' WHERE state IN ('accepted','dispatching')",
  );
}

/** Fixed administrator mutation: no queued source intent is reauthorized. */
export async function pauseInstalledSchedules(
  db: DB,
  reason: "RESTORED_AUTHORITY_REVOKED" | "ADMINISTRATOR_INTERRUPTED",
) {
  await db.query(
    "UPDATE schedules SET state='paused',reason=$1,catch_up=NULL,active_grant_id=NULL,updated_at=clock_timestamp()",
    [reason],
  );
  await db.query("UPDATE schedule_grants SET revoked=true WHERE NOT revoked");
}
