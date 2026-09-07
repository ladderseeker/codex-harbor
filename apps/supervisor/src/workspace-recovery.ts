import {
  requireAuthority,
  type AuthorityConfig,
} from "../../../packages/policy/src/authority.ts";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../../../packages/storage/src/index.ts";
import { selectedWorkspace } from "../../../packages/workspaces/src/service.ts";
/** Call only after confirmed retirement of this exact session's owned runtime. */
export async function releaseRecoveredWorkspace(
  db: PoolClient,
  expected: {
    workspaceId: string;
    sessionId: string;
    generation: number;
    recoveryId: string;
  },
) {
  const w = await selectedWorkspace(db, expected.workspaceId, true);
  if (
    w.writer_kind !== "conversation" ||
    w.writer_session_id !== expected.sessionId ||
    Number(w.writer_generation) !== expected.generation
  )
    throw Error("RESERVATION_CHANGED");
  const active = await db.query(
    "SELECT 1 FROM operations WHERE session_id=$1 AND kind='turn' AND state IN ('dispatching','running','waiting_approval','waiting_input') LIMIT 1",
    [expected.sessionId],
  );
  if (active.rowCount) throw Error("WORKSPACE_ACTIVE");
  // New input requires a different conversation; original uncertain effects remain authoritative.
  await db.query(
    "UPDATE operations SET state='failed',updated_at=now() WHERE session_id=$1 AND state='queued'",
    [expected.sessionId],
  );
  await db.query(
    "UPDATE workspaces SET writer_session_id=NULL,writer_generation=NULL WHERE id=$1",
    [w.id],
  );
}
export async function processWorkspaceReleases(
  pool: Pool,
  options: {
    config: AuthorityConfig;
    current: () => boolean;
    retire: (sessionId: string, projectId: string) => Promise<void>;
  },
) {
  const rows = (
    await pool.query(
      "SELECT * FROM workspace_releases WHERE state IN ('queued','dispatching') ORDER BY created_at LIMIT 4",
    )
  ).rows;
  for (const row of rows) {
    try {
      await transaction(pool, async (db) => {
        const authority = async () => {
          if (!options.current()) throw Error("AUTHORITY_REVOKED");
          const grant = await requireAuthority(
            db,
            row.actor_hash,
            options.config,
          );
          if (grant.kind !== "browser") throw Error("AUTHORITY_REVOKED");
        };
        await authority();
        const w = await selectedWorkspace(db, row.workspace_id, true);
        if (
          w.writer_kind !== "conversation" ||
          w.writer_session_id !== row.session_id ||
          Number(w.writer_generation) !== Number(row.expected_generation)
        )
          throw Error("RESERVATION_CHANGED");

        const active = await db.query(
          "SELECT 1 FROM operations WHERE session_id=$1 AND kind='turn' AND state IN ('dispatching','running','waiting_approval','waiting_input') LIMIT 1",
          [row.session_id],
        );
        if (active.rowCount) throw Error("WORKSPACE_ACTIVE");
        await db.query(
          "UPDATE workspace_releases SET state='dispatching',updated_at=now() WHERE id=$1",
          [row.id],
        );
        // Hold workspace ownership through exact retirement and CAS: a concurrent
        // recovery cannot admit a successor between inspection and removal.
        await authority();
        await options.retire(row.session_id, w.project_id);
        await authority();

        await releaseRecoveredWorkspace(db, {
          workspaceId: row.workspace_id,
          sessionId: row.session_id,
          generation: Number(row.expected_generation),
          recoveryId: row.id,
        });
        await db.query(
          "UPDATE workspace_releases SET state='completed',updated_at=now() WHERE id=$1",
          [row.id],
        );
        await authority();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const code = [
        "RESERVATION_CHANGED",
        "AUTHORITY_REVOKED",
        "WORKSPACE_ACTIVE",
      ].includes(message)
        ? message
        : "RETIREMENT_UNCONFIRMED";
      await pool.query(
        "UPDATE workspace_releases SET state='failed',failure_code=$2,updated_at=now() WHERE id=$1 AND state<>'completed'",
        [row.id, code],
      );
    }
  }
}
