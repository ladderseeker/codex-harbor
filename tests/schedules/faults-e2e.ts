import { expect, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export async function scheduleFaultsE2e(o: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  projectId: string;
  sessionId: string;
  csrf: string;
  fixtureState: string;
  post: (route: string, data: unknown, key?: string) => Promise<any>;
  pauseSupervisor: () => void;
  resumeSupervisor: () => void;
  restartSupervisor: () => Promise<void>;
}) {
  const { db, post } = o;
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const config = {
    rule: { kind: "cron", expression: "0 0 * * *", timezone: "UTC" },
    workspaceMode: "existing",
    sessionId: o.sessionId,
    ...settings,
  };
  const schedule = await post("/schedules", {
    title: "Atomic occurrence API intent",
    projectId: o.projectId,
    prompt: "P008 occurrence commit fault",
    config,
    grantDays: 1,
  });
  await db.query(
    `CREATE FUNCTION p008_occurrence_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.schedule_id='${schedule.id}'::uuid THEN RAISE EXCEPTION 'owned occurrence COMMIT rejection'; END IF; RETURN NEW; END $$`,
  );
  await db.query(
    "CREATE CONSTRAINT TRIGGER p008_occurrence_commit_fault AFTER INSERT ON schedule_occurrences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p008_occurrence_commit_fault()",
  );
  const key = `${Date.now()}:${randomUUID()}`;
  try {
    const result = await o.context.request.post(
      o.origin + `/api/v1/schedules/${schedule.id}/runs`,
      {
        headers: {
          Origin: o.origin,
          "X-CSRF-Token": o.csrf,
          "Idempotency-Key": key,
        },
        data: { expectedRevision: 1 },
      },
    );
    expect(result.status(), await result.text()).toBe(500);
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM schedule_occurrences WHERE schedule_id=$1",
            [schedule.id],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM schedule_commands WHERE schedule_id=$1",
            [schedule.id],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
  } finally {
    await db.query(
      "DROP TRIGGER p008_occurrence_commit_fault ON schedule_occurrences",
    );
    await db.query("DROP FUNCTION p008_occurrence_commit_fault()");
  }
  const run = (
    await post(`/schedules/${schedule.id}/runs`, { expectedRevision: 1 }, key)
  ).occurrence;
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM schedule_occurrences WHERE id=$1", [
            run.id,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("succeeded");
  expect(
    Number(
      (await db.query("SELECT count(*) FROM pgboss.job WHERE id=$1", [run.id]))
        .rows[0].count,
    ),
  ).toBe(1);
  await post(`/schedules/${schedule.id}/pause`, { expectedRevision: 1 });
  // A trusted workspace receipt survives a failed result COMMIT and supervisor restart.
  const workspace = (
    await db.query(
      "SELECT w.*,p.canonical_path AS project_path FROM workspaces w JOIN projects p ON p.id=w.project_id WHERE w.project_id=$1 AND w.kind='local'",
      [o.projectId],
    )
  ).rows[0];
  const marker = "P008 source snapshot retained across result COMMIT failure\n";
  await writeFile(
    path.join(workspace.project_path, "scheduled-source.txt"),
    marker,
  );
  const standalone = await post("/schedules", {
    title: "Workspace receipt result loss",
    projectId: o.projectId,
    prompt: "P008 reconciled source preparation",
    config: {
      rule: config.rule,
      workspaceMode: "standalone",
      sourceWorkspaceId: workspace.id,
      sourcePolicy: "snapshot",
      ...settings,
    },
    grantDays: 1,
  });
  o.pauseSupervisor();
  let occurrence: any;
  try {
    const accepted = await post(`/schedules/${standalone.id}/runs`, {
      expectedRevision: 1,
    });
    occurrence = (
      await db.query("SELECT * FROM schedule_occurrences WHERE id=$1", [
        accepted.occurrence.id,
      ])
    ).rows[0];
    await db.query(
      `CREATE FUNCTION p008_storage_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${occurrence.storage_operation_id}'::uuid AND NEW.state='completed' THEN RAISE EXCEPTION 'owned storage result COMMIT rejection'; END IF; RETURN NEW; END $$`,
    );
    await db.query(
      "CREATE CONSTRAINT TRIGGER p008_storage_commit_fault AFTER UPDATE ON workspace_storage_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p008_storage_commit_fault()",
    );
  } finally {
    o.resumeSupervisor();
  }
  try {
    const receiptPath = path.join(
      o.fixtureState,
      "workspace-receipts",
      occurrence.storage_operation_id + ".json",
    );
    await expect
      .poll(
        async () => {
          try {
            return JSON.parse(await readFile(receiptPath, "utf8")).state;
          } catch {
            return "missing";
          }
        },
        { timeout: 45000 },
      )
      .toBe("completed");
    expect(
      (
        await db.query(
          "SELECT state FROM workspace_storage_operations WHERE id=$1",
          [occurrence.storage_operation_id],
        )
      ).rows[0].state,
    ).toBe("dispatching");
    await o.restartSupervisor();
  } finally {
    await db.query(
      "DROP TRIGGER p008_storage_commit_fault ON workspace_storage_operations",
    );
    await db.query("DROP FUNCTION p008_storage_commit_fault()");
  }
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM schedule_occurrences WHERE id=$1", [
            occurrence.id,
          ])
        ).rows[0].state,
      { timeout: 45000 },
    )
    .toBe("succeeded");
  const result = (
    await db.query("SELECT canonical_path FROM workspaces WHERE id=$1", [
      occurrence.workspace_id,
    ])
  ).rows[0];
  expect(
    await readFile(
      path.join(result.canonical_path, "scheduled-source.txt"),
      "utf8",
    ),
  ).toBe(marker);
  expect(
    Number(
      (
        await db.query("SELECT count(*) FROM workspaces WHERE id=$1", [
          occurrence.workspace_id,
        ])
      ).rows[0].count,
    ),
  ).toBe(1);
  expect(
    Number(
      (
        await db.query("SELECT count(*) FROM operations WHERE id=$1", [
          occurrence.turn_id,
        ])
      ).rows[0].count,
    ),
  ).toBe(1);
  await post(`/schedules/${standalone.id}/pause`, { expectedRevision: 1 });
}
