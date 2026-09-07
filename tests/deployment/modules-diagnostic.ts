import { execFileSync } from "node:child_process";
import { createPool } from "../../packages/storage/src/index.ts";
import { selectedWorkspace } from "../../packages/workspaces/src/service.ts";
import { workspaceFileCommand } from "../../packages/files/src/workspace.ts";
const release = process.env.HARBOR_MANAGED_RELEASE!;
const { executeFile } = await import(release + "/infra/files/service.ts");
const { readWorkspaceFile } = await import(release + "/infra/files/client.ts");
const db = createPool(process.env.DATABASE_URL!);
try {
  const id = (
    await db.query("SELECT id FROM workspaces ORDER BY created_at LIMIT 1")
  ).rows[0].id;
  const w = await selectedWorkspace(db, id);
  console.log(
    JSON.stringify({
      workspace: w.id,
      relativePath: w.relative_path,
      canonical: w.canonical_path,
      rootId: w.root_id,
    }),
  );
  const command = workspaceFileCommand(w, "tree", {
    ref: id + ":",
    limit: 200,
  });
  try {
    console.log(
      execFileSync("python3", [release + "/infra/storage/workspace-paths.py"], {
        input: JSON.stringify({ ...command, action: "validate" }),
        env: process.env,
        encoding: "utf8",
      }),
    );
  } catch (e) {
    console.log("Fixed path validator rejected");
  }
  for (const [name, fn] of [
    ["direct", executeFile],
    ["socket", readWorkspaceFile],
  ] as const) {
    try {
      const result = await fn(command);
      console.log(
        JSON.stringify({ name, success: true, keys: Object.keys(result) }),
      );
    } catch (e) {
      console.log(
        JSON.stringify({
          name,
          success: false,
          error: (e as Error).message.slice(0, 1000),
        }),
      );
    }
  }
} finally {
  await db.end();
}
