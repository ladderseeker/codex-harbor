import type { PoolClient } from "pg";
import {
  selectedWorkspace,
  sessionWorkspace,
  inspectWorkspace,
} from "../../workspaces/src/service.ts";
import { HarborError } from "../../policy/src/index.ts";
import type { ScheduleConfig } from "./schema.ts";
export async function scheduleTarget(
  db: PoolClient,
  projectId: string,
  config: ScheduleConfig,
  fixture: boolean,
) {
  const workspace =
    config.workspaceMode === "standalone"
      ? await selectedWorkspace(db, config.sourceWorkspaceId!, true)
      : await sessionWorkspace(db, config.sessionId!, true);
  if (
    workspace.project_id !== projectId ||
    workspace.project_archived ||
    workspace.state !== "ready"
  )
    throw new HarborError(
      409,
      "WORKSPACE_UNAVAILABLE",
      "Select an available workspace in this project",
    );
  if (config.workspaceMode === "standalone") {
    const inspection = await inspectWorkspace(db, workspace, fixture);
    if (!inspection.available)
      throw new HarborError(
        409,
        "WORKSPACE_UNAVAILABLE",
        "Source inspection unavailable",
      );
    if (inspection.git !== (config.sourcePolicy === "committed"))
      throw new HarborError(
        409,
        "SOURCE_POLICY",
        "Choose committed Git content or explicitly authorize a non-Git snapshot",
      );
  }
  return workspace;
}
