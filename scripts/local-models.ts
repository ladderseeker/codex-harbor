import { createRuntime } from "../packages/codex-adapter/src/runtime.ts";
import { randomUUID } from "node:crypto";
if (process.env.HARBOR_LOCAL_MODE !== "personal")
  throw Error("Local model discovery requires personal mode");
const roots = JSON.parse(process.env.HARBOR_PROJECT_ROOTS ?? "[]");
const adapter = await createRuntime({
  sessionId: randomUUID(),
  projectId: randomUUID(),
  workspacePath: roots[0].path,
  generation: 1,
  permissionProfile: "read-only",
});
try {
  const models = await adapter.listModels();
  console.log(
    JSON.stringify([
      ...new Set(models.data.map((entry: any) => entry.model ?? entry.id)),
    ]),
  );
} finally {
  await adapter.closeAndWait();
}
