import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import type { DB } from "../../storage/src/index.ts";
import { HarborError } from "../../policy/src/index.ts";
import { workspaceCommand } from "../../../infra/storage/workspace-client.ts";
import { executeWorkspace } from "../../../infra/storage/workspace-service.ts";
import type {
  WorkspaceCommand,
  WorkspaceIdentity,
  WorkspaceView,
} from "./types.ts";
export function workspaceView(w: any): WorkspaceView {
  return {
    id: w.id,
    projectId: w.project_id,
    name: w.name,
    kind: w.kind,
    state: w.state,
    relativePath: w.relative_path ?? "",
    baseRevision: w.base_revision,
    sourceDirty: w.source_dirty,
    writerSessionId: w.writer_session_id,
    writerKind: w.writer_kind,
    writerOwnerId: w.writer_owner_id,
    writerEpoch: Number(w.writer_epoch ?? 0),
    writerGeneration:
      w.writer_generation == null ? null : Number(w.writer_generation),
    failureCode: w.failure_code,
    release: w.latest_release ?? null,
  };
}
export function storedIdentity(w: any): WorkspaceIdentity {
  return {
    canonical: w.canonical_path,
    device: w.device,
    inode: w.inode,
    ...(w.common_path
      ? {
          common: {
            canonical: w.common_path,
            device: w.common_device,
            inode: w.common_inode,
          },
        }
      : {}),
  };
}
export async function selectedWorkspace(db: DB, id: string, lock = false) {
  const query =
    "SELECT w.*,(SELECT json_build_object('id',r.id,'state',r.state,'failureCode',r.failure_code) FROM workspace_releases r WHERE r.workspace_id=w.id ORDER BY created_at DESC LIMIT 1) AS latest_release,p.root_id,p.relative_path AS project_relative,p.archived_at AS project_archived FROM workspaces w JOIN projects p ON p.id=w.project_id WHERE w.id=$1";
  let r = await db.query(query, [id]);
  if (!r.rowCount)
    throw new HarborError(404, "NOT_FOUND", "Workspace not found");
  if (lock) {
    await db.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
      r.rows[0].project_id,
    ]);
    await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [id]);
    r = await db.query(query, [id]);
  }
  return r.rows[0];
}
export async function verifyWorkspace(w: any) {
  try {
    if (process.env.HARBOR_STORAGE_SOCKET) {
      const roots = JSON.parse(process.env.HARBOR_PROJECT_ROOTS ?? "[]");
      const root = roots.find(
        (r: any) =>
          w.canonical_path?.startsWith(r.path + "/") &&
          (!w.root_id || r.id === w.root_id),
      );
      if (!root) throw Error("Workspace authority unavailable");
      const relativePath = w.canonical_path.slice(root.path.length + 1);
      await workspaceCommand({
        action: "workspaceValidate",
        rootId: root.id,
        relativePath,
        workspaceId: w.workspace_id ?? w.id,
        kind: ["local", "copy", "worktree"].includes(w.kind)
          ? w.kind
          : w.common_path
            ? "worktree"
            : "local",
        source: { relativePath, device: w.device, inode: w.inode },
        identity: {
          canonical: w.canonical_path,
          device: w.device,
          inode: w.inode,
          ...(w.common_path
            ? {
                common: {
                  canonical: w.common_path,
                  device: w.common_device,
                  inode: w.common_inode,
                },
              }
            : {}),
        },
      });
      return w.canonical_path as string;
    }
    if (
      !w.canonical_path ||
      (await realpath(w.canonical_path)) !== w.canonical_path
    )
      throw Error();
    const s = await stat(w.canonical_path, { bigint: true });
    if (s.dev.toString() !== w.device || s.ino.toString() !== w.inode)
      throw Error();
    return w.canonical_path as string;
  } catch {
    throw new HarborError(
      409,
      "WORKSPACE_UNAVAILABLE",
      "Workspace folder is unavailable or its identity changed",
    );
  }
}
export const storageWorkspace = (
  command: WorkspaceCommand,
  fixture: boolean,
) =>
  fixture && !process.env.HARBOR_STORAGE_SOCKET
    ? executeWorkspace(command, true)
    : workspaceCommand(command);
export async function inspectWorkspace(db: DB, w: any, fixture: boolean) {
  if (w.state === "removed")
    return {
      available: false,
      git: false,
      dirty: false,
      reason: "Workspace removed",
    };
  try {
    await verifyWorkspace(w);
    const result = await storageWorkspace(
      {
        action: "workspaceInspect",
        rootId: w.root_id,
        relativePath: w.relative_path,
        workspaceId: w.id,
        kind: w.kind,
        identity: storedIdentity(w),
      },
      fixture,
    );
    if (w.state === "unavailable") {
      await db.query(
        "UPDATE workspaces SET state='ready',failure_code=NULL WHERE id=$1 AND state='unavailable'",
        [w.id],
      );
      w.state = "ready";
      w.failure_code = null;
    }
    return {
      available: true,
      ...result,
      dirty:
        w.kind === "copy"
          ? result.snapshotHash !== w.snapshot_hash
          : result.dirty,
    };
  } catch {
    if (["ready", "unavailable"].includes(w.state)) {
      await db.query(
        "UPDATE workspaces SET state='unavailable',failure_code='WORKSPACE_UNAVAILABLE' WHERE id=$1 AND state IN ('ready','unavailable')",
        [w.id],
      );
      w.state = "unavailable";
      w.failure_code = "WORKSPACE_UNAVAILABLE";
    }
    return {
      available: false,
      git: false,
      dirty: false,
      reason: "Workspace folder or managed Git profile is unavailable",
    };
  }
}
export async function requireWorkspaceIdle(
  db: DB,
  w: any,
  wholeProject = false,
) {
  const pending = await db.query(
    "SELECT 1 FROM workspace_storage_operations WHERE project_id=$1 AND state IN ('queued','dispatching')",
    [w.project_id],
  );
  if (pending.rowCount)
    throw new HarborError(
      409,
      "WORKSPACE_BUSY",
      "Project storage operation pending",
    );
  const busy = await db.query(
    `SELECT 1 FROM workspaces WHERE ${wholeProject ? "project_id" : "id"}=$1 AND writer_owner_id IS NOT NULL LIMIT 1`,
    [wholeProject ? w.project_id : w.id],
  );
  const queued = await db.query(
    `SELECT 1 FROM operations o JOIN sessions s ON s.id=o.session_id WHERE s.${wholeProject ? "project_id" : "workspace_id"}=$1 AND o.state IN ('queued','dispatching','running','waiting_approval','waiting_input') LIMIT 1`,
    [wholeProject ? w.project_id : w.id],
  );
  const filePending = await db.query(
    `SELECT 1 FROM file_operations WHERE ${wholeProject ? "project_id" : "workspace_id"}=$1 AND state IN ('queued','dispatching') LIMIT 1`,
    [wholeProject ? w.project_id : w.id],
  );
  const terminals = await db.query(
    `SELECT 1 FROM terminals WHERE ${wholeProject ? "project_id" : "workspace_id"}=$1 AND state='queued' LIMIT 1`,
    [wholeProject ? w.project_id : w.id],
  );
  if (
    busy.rowCount ||
    queued.rowCount ||
    filePending.rowCount ||
    terminals.rowCount
  )
    throw new HarborError(
      409,
      "WORKSPACE_BUSY",
      "Workspace is reserved by managed work or unconfirmed runtime retirement",
    );
}
export const workspaceRelative = (
  roots: { id: string; path: string }[],
  rootId: string,
  canonical: string,
) => path.relative(roots.find((r) => r.id === rootId)!.path, canonical);

/** Acquire project -> workspace before a caller locks the conversation. */
export async function sessionWorkspace(
  db: DB,
  sessionId: string,
  lock = false,
) {
  const row = (
    await db.query("SELECT workspace_id FROM sessions WHERE id=$1", [sessionId])
  ).rows[0];
  if (!row) throw new HarborError(404, "NOT_FOUND", "Conversation not found");
  return selectedWorkspace(db, row.workspace_id, lock);
}
