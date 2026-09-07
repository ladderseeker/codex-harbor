import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HarborError, authorizePermission } from "../../policy/src/index.ts";
import {
  selectedWorkspace,
  inspectWorkspace,
  requireWorkspaceIdle,
  workspaceView,
} from "./service.ts";
export const createWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["worktree", "copy"]),
    sourceWorkspaceId: z.uuid(),
    revision: z
      .string()
      .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
      .optional(),
    dirtyPolicy: z.enum(["exclude", "snapshot"]),
  })
  .strict();
export async function createWorkspace(
  db: PoolClient,
  projectId: string,
  input: unknown,
  c: {
    HARBOR_PERMISSION_CEILING: "read-only" | "workspace-write";
    HARBOR_FIXTURE_MODE?: string;
  },
  options: {
    actor: string;
    workspaceId?: string;
    operationId?: string;
    authorize: (
      db: PoolClient,
      source: Awaited<ReturnType<typeof selectedWorkspace>>,
    ) => Promise<void>;
  },
) {
  const b = createWorkspaceSchema.parse(input);
  authorizePermission("workspace-write", c.HARBOR_PERMISSION_CEILING);
  const source = await selectedWorkspace(db, b.sourceWorkspaceId, true);
  await options.authorize(db, source);
  if (source.project_id !== projectId)
    throw new HarborError(
      403,
      "PROJECT_DENIED",
      "Source belongs to another project",
    );
  if (source.project_archived || source.state !== "ready")
    throw new HarborError(
      409,
      "WORKSPACE_UNAVAILABLE",
      "Select an available source workspace",
    );
  await requireWorkspaceIdle(db, source, true);
  if (
    Number(
      (
        await db.query(
          "SELECT count(*) FROM workspaces WHERE project_id=$1 AND state<>'removed' AND (canonical_path IS NOT NULL OR state='creating')",
          [source.project_id],
        )
      ).rows[0].count,
    ) >= 16
  )
    throw new HarborError(
      429,
      "WORKSPACE_QUOTA",
      "Project workspace limit reached",
    );
  const inspection = await inspectWorkspace(
    db,
    source,
    !!c.HARBOR_FIXTURE_MODE,
  );
  if (!inspection.available)
    throw new HarborError(409, "WORKSPACE_UNAVAILABLE", inspection.reason!);
  if (
    (b.kind === "worktree" &&
      (!inspection.git || b.dirtyPolicy !== "exclude")) ||
    (b.kind === "copy" && (inspection.git || b.dirtyPolicy !== "snapshot"))
  )
    throw new HarborError(
      400,
      "SOURCE_POLICY",
      "Choose committed Git files or an explicit non-Git snapshot",
    );
  await options.authorize(db, source);
  const id = options.workspaceId ?? randomUUID();
  await db.query(
    "INSERT INTO workspaces(id,project_id,name,kind,state,source_workspace_id) VALUES($1,$2,$3,$4,'creating',$5)",
    [id, source.project_id, b.name, b.kind, source.id],
  );
  if (
    Number(
      (
        await db.query(
          "SELECT count(*) FROM workspace_storage_operations WHERE project_id=$1",
          [source.project_id],
        )
      ).rows[0].count,
    ) >= 112
  )
    throw new HarborError(
      429,
      "WORKSPACE_HISTORY_QUOTA",
      "Project workspace operation limit reached",
    );
  const operationId = options.operationId ?? randomUUID();
  await db.query(
    "INSERT INTO workspace_storage_operations(id,workspace_id,project_id,action,command,actor_hash) VALUES($1,$2,$3,'create',$4,$5)",
    [
      operationId,
      id,
      source.project_id,
      JSON.stringify({
        action: "workspaceCreate",
        operationId,
        rootId: source.root_id,
        relativePath: source.project_relative,
        workspaceId: id,
        kind: b.kind,
        source: {
          relativePath: source.relative_path,
          device: source.device,
          inode: source.inode,
        },
        revision: b.revision ?? inspection.head,
        sourceSnapshot: inspection.snapshotHash,
      }),
      options.actor,
    ],
  );
  return { workspace: workspaceView(await selectedWorkspace(db, id)) };
}
