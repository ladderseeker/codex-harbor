import type { Pool, PoolClient } from "pg";
import { transaction } from "../../storage/src/index.ts";
import { acceptConversationTurn } from "../../storage/src/turns.ts";
import { createWorkspace } from "../../workspaces/src/create.ts";
import {
  selectedWorkspace,
  inspectWorkspace,
  requireWorkspaceIdle,
} from "../../workspaces/src/service.ts";
import { requireAuthority } from "../../policy/src/authority.ts";
import { effectiveSettings } from "../../policy/src/models.ts";
import { HarborError } from "../../policy/src/index.ts";
import { scheduleActor } from "./authority.ts";
import type { ScheduleAuthorityConfig } from "./admission.ts";
import type { ScheduleConfig } from "./schema.ts";
export interface ScheduleExecutionConfig extends ScheduleAuthorityConfig {
  HARBOR_FIXTURE_MODE?: string;
  HARBOR_MAX_QUEUED: number;
  HARBOR_MAX_SESSIONS: number;
  models: string[];
}
/** One bounded metadata phase. The pg-boss job is only a wakeup for this durable row. */
export async function advanceOccurrence(
  pool: Pool,
  c: ScheduleExecutionConfig,
  id: string,
  fence: (db: PoolClient) => Promise<void>,
) {
  await transaction(pool, async (db) => {
    const hint = (
      await db.query(
        `SELECT o.*,s.project_id,s.title,v.config FROM schedule_occurrences o
      JOIN schedules s ON s.id=o.schedule_id JOIN schedule_versions v ON v.schedule_id=o.schedule_id AND v.revision=o.config_revision WHERE o.id=$1`,
        [id],
      )
    ).rows[0];
    if (!hint || !["accepted", "preparing_workspace"].includes(hint.state))
      return;
    const config = hint.config as ScheduleConfig;
    const actor = scheduleActor(hint.grant_id, hint.id);
    const preparation =
      hint.state === "accepted" && config.workspaceMode === "standalone";
    const authorize = async (db: PoolClient) => {
      await requireAuthority(db, actor, c, {
        scope: "execute",
        projectId: hint.project_id,
        permissionProfile: preparation ? undefined : config.permissionProfile,
        internalOperation: {
          kind: preparation ? "workspace" : "turn",
          id: preparation ? hint.storage_operation_id : hint.turn_id,
        },
      });
    };
    await authorize(db);
    await fence(db);
    // Schedule lock is held by authority; serialize this occurrence before source locks.
    const current = (
      await db.query(
        "SELECT state FROM schedule_occurrences WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (current.state !== hint.state) return;
    await effectiveSettings(db, config.model, config.effort, c.models);
    if (preparation) {
      const source = await selectedWorkspace(
        db,
        config.sourceWorkspaceId!,
        true,
      );
      await authorize(db);
      await requireWorkspaceIdle(db, source, true);
      const inspection = await inspectWorkspace(
        db,
        source,
        !!c.HARBOR_FIXTURE_MODE,
      );
      if (!inspection.available)
        throw new HarborError(
          409,
          "WORKSPACE_UNAVAILABLE",
          "Source workspace unavailable",
        );
      if (inspection.git !== (config.sourcePolicy === "committed"))
        throw new HarborError(
          409,
          "SOURCE_POLICY",
          "Source Git/snapshot policy changed; review the schedule before activating",
        );
      await createWorkspace(
        db,
        hint.project_id,
        {
          name: `${hint.title.slice(0, 65)} · ${hint.local_minute ?? "manual"}`,
          sourceWorkspaceId: source.id,
          kind: inspection.git ? "worktree" : "copy",
          dirtyPolicy: inspection.git ? "exclude" : "snapshot",
          ...(config.baseRevision ? { revision: config.baseRevision } : {}),
        },
        c,
        {
          actor,
          workspaceId: hint.workspace_id,
          operationId: hint.storage_operation_id,
          authorize,
        },
      );
      await authorize(db);
      await fence(db);
      await db.query(
        "UPDATE schedule_occurrences SET state='preparing_workspace',updated_at=clock_timestamp() WHERE id=$1",
        [id],
      );
      return;
    }
    if (config.workspaceMode === "standalone") {
      const storage = (
        await db.query(
          "SELECT state FROM workspace_storage_operations WHERE id=$1",
          [hint.storage_operation_id],
        )
      ).rows[0];
      if (!storage || ["queued", "dispatching"].includes(storage.state)) return;
      if (storage.state !== "completed")
        throw new HarborError(
          409,
          "WORKSPACE_STORAGE_FAILED",
          "Workspace preparation failed",
        );
    }
    if (config.workspaceMode === "standalone")
      await db.query("SELECT pg_advisory_xact_lock(740013)");
    const workspace = await selectedWorkspace(db, hint.workspace_id, true);
    await authorize(db);
    await requireWorkspaceIdle(db, workspace);
    if (
      (
        await db.query(
          "SELECT 1 FROM operations WHERE session_id=$1 AND state IN ('queued','dispatching','running','waiting_approval','waiting_input') LIMIT 1",
          [hint.session_id],
        )
      ).rowCount
    )
      throw new HarborError(
        409,
        "SCHEDULE_OVERLAP",
        "Existing conversation is busy",
      );
    if (config.workspaceMode === "standalone") {
      if (
        Number(
          (await db.query("SELECT count(*) FROM sessions")).rows[0].count,
        ) >= c.HARBOR_MAX_SESSIONS
      )
        throw new HarborError(
          429,
          "SESSION_QUOTA",
          "Conversation limit reached",
        );
      await db.query(
        "INSERT INTO sessions(id,project_id,workspace_id,title,model,effort,permission_profile) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          hint.session_id,
          hint.project_id,
          hint.workspace_id,
          hint.title.slice(0, 100),
          config.model,
          config.effort,
          config.permissionProfile,
        ],
      );
    }
    await acceptConversationTurn(
      db,
      hint.session_id,
      {
        text: hint.prompt,
        model: config.model,
        effort: config.effort,
        permissionProfile: config.permissionProfile,
      },
      c,
      { actor, operationId: hint.turn_id, authorize },
    );
    await authorize(db);
    await fence(db);
    await db.query(
      "UPDATE schedule_occurrences SET state='queued_turn',updated_at=clock_timestamp() WHERE id=$1",
      [id],
    );
  });
}
