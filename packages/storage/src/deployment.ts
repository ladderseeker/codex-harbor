import type { DB } from "./index.ts";
import { HarborError } from "../../policy/src/index.ts";
export async function deploymentState(db: DB) {
  return (
    await db.query(
      "SELECT maintenance,activation_required,epoch FROM deployment_state WHERE id=true",
    )
  ).rows[0] as {
    maintenance: boolean;
    activation_required: boolean;
    epoch: string;
  };
}
export async function deploymentAdmission(db: DB, control = false) {
  const state = (
    await db.query(
      "SELECT maintenance,activation_required,epoch FROM deployment_state WHERE id=true FOR SHARE",
    )
  ).rows[0];
  if (state.activation_required || (state.maintenance && !control))
    throw new HarborError(
      503,
      "MAINTENANCE",
      "Administrator maintenance is active; no new work is admitted",
    );
  return state;
}

export async function verifyInstalledSchema(db: DB) {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(
    await readFile(new URL("../../../release.json", import.meta.url), "utf8"),
  );
  const rows = (
    await db.query(
      "SELECT version,digest FROM harbor_migrations ORDER BY version",
    )
  ).rows;
  const expected = Object.entries(manifest.migrations).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (
    JSON.stringify(rows.map((r: any) => [r.version, r.digest])) !==
    JSON.stringify(expected)
  )
    throw Error(
      "Installed schema differs from selected release; administrator migration required",
    );
}
