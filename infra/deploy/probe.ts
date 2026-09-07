/** Read-only, non-model validation of restored native histories; never resume a turn. */
import { inspectionMount } from "./probe-mount.ts";
import { createPool } from "../../packages/storage/src/index.ts";
import { createRuntime } from "../../packages/codex-adapter/src/runtime.ts";
import { retireRuntimeIdentity } from "../runner/authority.ts";
if (process.platform !== "linux" || process.getuid?.() !== 0)
  throw Error("Trusted Linux administrator required");
const db = createPool(process.env.DATABASE_URL!);
let checked = 0;
try {
  const status = (await db.query("SELECT * FROM deployment_state")).rows[0];
  if (!status?.activation_required || !status.maintenance)
    throw Error("Disabled restore required");
  const sessions = (
    await db.query(`SELECT s.id,s.project_id,s.native_thread_id,
    w.id AS workspace_id,w.canonical_path,w.device,w.inode,w.state AS workspace_state,
    w.common_path,w.common_device,w.common_inode,
    local.id AS local_workspace_id,local.canonical_path AS local_path,
    local.device AS local_device,local.inode AS local_inode,local.state AS local_state
    FROM sessions s JOIN workspaces w ON w.id=s.workspace_id
    LEFT JOIN workspaces local ON local.project_id=s.project_id AND local.kind='local'
    WHERE s.native_thread_id IS NOT NULL ORDER BY s.id`)
  ).rows;
  if (sessions.length > 200) throw Error("Native inspection count bound");
  const deadline = Date.now() + 900_000;
  for (const session of sessions) {
    if (Date.now() > deadline)
      throw Error("Native inspection deadline exceeded");
    const mount = inspectionMount(session);
    const generation = Number(
      (await db.query("SELECT nextval('runtime_generation_seq') AS generation"))
        .rows[0].generation,
    );
    const identity = {
      instanceId: process.env.HARBOR_INSTANCE_ID!,
      projectId: session.project_id,
      sessionId: session.id,
    };
    let runtime;
    try {
      runtime = await createRuntime({
        ...identity,
        generation,
        permissionProfile: "read-only",
        ...mount,
        onEvent() {},
        onRequest() {},
        onDisconnect() {},
      });
      const result = await runtime.readThread(session.native_thread_id);
      if (result.thread.id !== session.native_thread_id)
        throw Error("Native thread identity mismatch");
      checked++;
    } finally {
      if (runtime) await runtime.closeAndWait();
      await retireRuntimeIdentity(identity);
    }
  }
  process.stdout.write(
    JSON.stringify({
      nativeHistories: checked,
      validated: true,
      modelRequests: 0,
    }),
  );
} finally {
  await db.end();
}
