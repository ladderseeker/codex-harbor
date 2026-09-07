import type { FileCommand } from "./types.ts";
export function workspaceFileCommand(
  w: any,
  action: FileCommand["action"],
  payload: Record<string, unknown>,
): FileCommand {
  return {
    action,
    rootId: w.root_id,
    projectId: w.project_id,
    workspaceId: w.id,
    relativePath: w.relative_path,
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
    payload,
  };
}
