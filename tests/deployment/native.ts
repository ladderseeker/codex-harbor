/** Actual installed immutable adapter/runner smoke, with no account or model request. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { confinementProbe, gatewayProbe } from "../isolation/probes.ts";
import { createPool } from "../../packages/storage/src/index.ts";
const release = process.env.HARBOR_MANAGED_RELEASE!;
if (
  !/^\/opt\/codex-harbor\/releases\/[a-f0-9]{64}$/.test(release) ||
  process.getuid?.() !== 0
)
  throw Error("Owned installed Linux profile required");
const { createRuntime } = await import(
  release + "/packages/codex-adapter/src/runtime.ts"
);
const db = createPool(process.env.DATABASE_URL!);
let runtime: any;
try {
  const project = (
    await db.query(
      "SELECT p.*,w.id AS workspace_id FROM projects p JOIN workspaces w ON w.project_id=p.id AND w.kind='local' ORDER BY p.id LIMIT 1",
    )
  ).rows[0];
  assert.ok(project);
  const bootstrap = (await db.query("SELECT runtime_id FROM runtime_bootstrap"))
    .rows[0]?.runtime_id;
  assert.ok(bootstrap);
  const generation = Number(
    (await db.query("SELECT nextval('runtime_generation_seq') AS generation"))
      .rows[0].generation,
  );
  runtime = await createRuntime({
    instanceId: process.env.HARBOR_INSTANCE_ID!,
    projectId: project.id,
    sessionId: bootstrap,
    workspaceId: project.workspace_id,
    workspacePath: project.canonical_path,
    workspaceDevice: project.device,
    workspaceInode: project.inode,
    generation,
    permissionProfile: "read-only",
    onEvent() {},
    onRequest() {},
    onDisconnect() {},
  });
  console.log("PASS installed confined initialize");
  const account = await runtime.readAccount();
  assert.equal(
    account.account,
    null,
    "No dedicated model account is present in this test",
  );
  console.log("PASS no-account read");
  const started = await runtime.startThread({
    cwd: "/workspace",
    permissionProfile: "read-only",
  });
  console.log("PASS thread start metadata");
  // The pinned runtime does not materialize an empty thread for thread/read.
  // This is an observed metadata capability boundary, not persisted-history evidence.
  await assert.rejects(
    runtime.readThread(started.thread.id),
    /Codex request rejected/,
  );
  const container = `harbor-${process.env.HARBOR_INSTANCE_ID}-${bootstrap}-${generation}`;
  for (const probe of [
    confinementProbe,
    gatewayProbe,
    "require('assert').throws(()=>require('fs').writeFileSync('/workspace/denied','x'))",
  ]) {
    const result = await promisify(execFile)(
      "docker",
      ["exec", container, "node", "-e", probe],
      { timeout: 25000, maxBuffer: 8192 },
    );
    if (result.stdout.trim()) console.log(result.stdout.trim());
  }
  await runtime.closeAndWait();
  runtime = undefined;
  console.log(
    JSON.stringify({
      installedArtifact: release.split("/").at(-1),
      realPinnedRuntime: "0.153.4",
      initialized: true,
      threadStartMetadata: true,
      emptyThreadReadRejected: true,
      persistedHistoryGate: "unverified",
      linuxConfinementAndFixedGateway: true,
      confinedRetirement: true,
      modelRequests: 0,
      liveAccountGate: "unverified",
    }),
  );
} finally {
  if (runtime) await runtime.closeAndWait();
  await db.end();
}
