/** Inspection mounts never change the session binding or authorize execution. */
export function inspectionMount(session: any) {
  if (session.workspace_state === "removed") {
    if (
      !session.local_workspace_id ||
      !session.local_path ||
      !session.local_device ||
      !session.local_inode ||
      session.local_state === "removed"
    )
      throw Error("Registered Local inspection mount unavailable");
    return {
      workspaceId: session.local_workspace_id,
      workspacePath: session.local_path,
      workspaceDevice: session.local_device,
      workspaceInode: session.local_inode,
    };
  }
  return {
    workspaceId: session.workspace_id,
    workspacePath: session.canonical_path,
    workspaceDevice: session.device,
    workspaceInode: session.inode,
    gitCommon: session.common_path
      ? {
          canonical: session.common_path,
          device: session.common_device,
          inode: session.common_inode,
        }
      : undefined,
  };
}
