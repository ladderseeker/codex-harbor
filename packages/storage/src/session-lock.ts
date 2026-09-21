import type { PoolClient } from "pg";
import { HarborError } from "../../policy/src/index.ts";

type Binding = { id: string; project_id: string; workspace_id: string };

/** Acquire after authority gates, before any conversation child mutation.
 * Repeated session updates can recheck unchanged foreign-key parents. */
export async function lockSessionResources(
  db: PoolClient,
  ids: readonly string[],
) {
  const selected = [...new Set(ids)].sort();
  if (!selected.length) return;
  const before = (
    await db.query<Binding>(
      "SELECT id,project_id,workspace_id FROM sessions WHERE id=ANY($1::uuid[]) ORDER BY id",
      [selected],
    )
  ).rows;
  if (before.length !== selected.length)
    throw new HarborError(404, "NOT_FOUND", "Conversation not found");
  await db.query(
    "SELECT id FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [[...new Set(before.map((row) => row.project_id))].sort()],
  );
  const workspaces = (
    await db.query<{ id: string; project_id: string }>(
      "SELECT id,project_id FROM workspaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[...new Set(before.map((row) => row.workspace_id))].sort()],
    )
  ).rows;
  const parents = new Map(workspaces.map((row) => [row.id, row.project_id]));
  if (before.some((row) => parents.get(row.workspace_id) !== row.project_id))
    throw Error("Conversation resource binding changed");
  const after = (
    await db.query<Binding>(
      "SELECT id,project_id,workspace_id FROM sessions WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [selected],
    )
  ).rows;
  if (
    after.length !== before.length ||
    after.some(
      (row, i) =>
        row.id !== before[i].id ||
        row.project_id !== before[i].project_id ||
        row.workspace_id !== before[i].workspace_id,
    )
  )
    throw Error("Conversation resource binding changed");
}

export async function lockSessionResource(db: PoolClient, id: string) {
  await lockSessionResources(db, [id]);
}
