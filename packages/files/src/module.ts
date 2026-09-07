/** Authoritative P009 inventory; registration must fail closed if omitted. */
export const fileModule = {
  id: "files",
  migration: "010_file_operations.sql",
  tables: [
    "file_operations",
    "file_inspections",
    "file_operation_audits",
    "file_events",
  ],
  controlPaths: ["file-receipts", "file-slots.json", "file-slots.lock"],
  projectPaths: ["complete-project-quota-unit"],
  unsettledSql:
    "SELECT 1 FROM file_operations WHERE state IN ('queued','dispatching') UNION ALL SELECT 1 FROM file_inspections WHERE state IN ('queued','inspecting') LIMIT 1",
  reservationSql: "SELECT 1 FROM workspaces WHERE writer_kind='file' LIMIT 1",
} as const;
