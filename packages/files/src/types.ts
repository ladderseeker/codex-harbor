import type { WorkspaceIdentity } from "../../workspaces/src/types.ts";
export const FILE_LIMITS = {
  textBytes: 1048576,
  downloadBytes: 16777216,
  entries: 200,
  searchEntries: 10000,
  searchBytes: 33554432,
  searchMs: 2000,
  operationsPerWorkspace: 128,
  operationsPerInstance: 4096,
  pendingBytesPerWorkspace: 16777216,
  pendingBytesPerInstance: 67108864,
} as const;
export type FileAction =
  | "tree"
  | "search"
  | "content"
  | "download"
  | "status"
  | "diff"
  | "save"
  | "stage"
  | "unstage"
  | "commit"
  | "inspect"
  | "verify";
export interface FileCommand {
  action: FileAction;
  rootId: string;
  workspaceId: string;
  projectId: string;
  relativePath: string;
  identity: WorkspaceIdentity;
  operationId?: string;
  epoch?: number;
  payload: Record<string, unknown>;
}
export interface FileEntry {
  ref: string;
  name: string;
  kind: "file" | "directory" | "symlink" | "unavailable";
  size: number;
}
export interface FileOperation {
  id: string;
  workspaceId: string;
  kind: "save" | "stage" | "unstage" | "commit";
  state: "queued" | "dispatching" | "succeeded" | "failed" | "uncertain";
  epoch: number | null;
  result: Record<string, unknown> | null;
  failureCode: string | null;
  acknowledgedAt: string | null;
}
