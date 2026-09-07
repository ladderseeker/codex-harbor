import { retireRuntimeIdentity } from "../runner/authority.ts";
let body = "";
for await (const chunk of process.stdin) {
  body += chunk;
  if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw Error("Registry limit");
}
if (process.platform !== "linux" || process.getuid?.() !== 0)
  throw Error("Trusted administrator required");
const registry = JSON.parse(body),
  instanceId = process.env.HARBOR_INSTANCE_ID!;
if (
  !Array.isArray(registry.sessions) ||
  registry.sessions.length > 200 ||
  !Array.isArray(registry.projects) ||
  registry.projects.length > 20
)
  throw Error("Retirement registry limit");
for (const session of registry.sessions)
  await retireRuntimeIdentity({
    instanceId,
    projectId: session.project_id,
    sessionId: session.id,
  });
if (registry.bootstrap)
  for (const project of registry.projects)
    await retireRuntimeIdentity({
      instanceId,
      projectId: project.id,
      sessionId: registry.bootstrap,
    });
process.stdout.write(JSON.stringify({ retired: true }));
