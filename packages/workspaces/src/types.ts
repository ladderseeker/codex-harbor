export type WorkspaceKind = "local" | "worktree" | "copy";
export interface WorkspaceIdentity {
  canonical: string;
  device: string;
  inode: string;
  common?: { canonical: string; device: string; inode: string };
}
export interface WorkspaceProvision extends WorkspaceIdentity {
  baseRevision: string | null;
  sourceDirty: boolean;
}
export interface WorkspaceCommand {
  action:
    | "workspaceCreate"
    | "workspaceInspect"
    | "workspaceValidate"
    | "workspaceRemove";
  operationId?: string;
  retryFailed?: boolean;
  sourceSnapshot?: string;
  rootId: string;
  relativePath: string;
  workspaceId: string;
  kind: WorkspaceKind;
  source?: { relativePath: string; device: string; inode: string };
  identity?: WorkspaceIdentity;
  revision?: string;
}
export interface WorkspaceView {
  id: string;
  projectId: string;
  name: string;
  kind: WorkspaceKind;
  state:
    | "creating"
    | "removing"
    | "ready"
    | "unavailable"
    | "failed"
    | "archived"
    | "removed";
  relativePath: string;
  baseRevision: string | null;
  sourceDirty: boolean;
  release?: { id: string; state: string; failureCode: string | null } | null;
  writerSessionId: string | null;
  writerKind?: "conversation" | "file" | "terminal" | null;
  writerOwnerId?: string | null;
  writerEpoch?: number;
  writerGeneration: number | null;
  failureCode: string | null;
}
