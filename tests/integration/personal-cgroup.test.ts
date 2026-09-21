import test from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";
import {
  createPersonalCgroup,
  inspectRecoveredCgroup,
} from "../../packages/codex-adapter/src/personal-cgroup.ts";
import { inspectRecoveredLocalRuntime } from "../../packages/codex-adapter/src/local-runtime.ts";
test("P018 recovered cgroup identities fail closed without signaling or probing unrelated paths", async () => {
  for (const identity of [
    null,
    {},
    {
      path: "/etc",
      device: "1",
      inode: "1",
      bootId: "00000000-0000-4000-8000-000000000000",
      generation: 1,
    },
    {
      path: "/sys/fs/cgroup",
      device: "1",
      inode: "1",
      bootId: "00000000-0000-4000-8000-000000000000",
      generation: 1,
    },
  ])
    assert.equal(await inspectRecoveredCgroup(identity, hostname()), "unknown");
  assert.equal(
    await inspectRecoveredLocalRuntime(
      { host: hostname(), groupId: process.pid, cgroup: { generation: 7 } },
      8,
    ),
    "unknown",
  );
  assert.equal(
    await inspectRecoveredCgroup(
      {
        path: "/sys/fs/cgroup/private/conversation-session-1-00000000-0000-4000-8000-000000000000",
        device: "1",
        inode: "1",
        bootId: "00000000-0000-4000-8000-000000000000",
        generation: 1,
      },
      "different-host.invalid",
    ),
    "unknown",
  );
});
test("P018 cgroup launcher rejects unbounded and path-like conversation identities before admission", async () => {
  for (const [id, generation] of [
    ["../../other", 1],
    ["x".repeat(65), 1],
    ["session", 0],
    ["session", 1.5],
  ] as const)
    await assert.rejects(
      createPersonalCgroup(id, generation),
      /Invalid personal runtime identity/,
    );
});

test("P018 a disappearing parent cannot hide its surviving child from idle classification", async () => {
  const { stableCgroupCensus } = await import(
    "../../packages/codex-adapter/src/personal-cgroup.ts"
  );
  const { classifyIdle } = await import(
    "../../apps/supervisor/src/runtime-capacity.ts"
  );
  let first = true;
  const census = await stableCgroupCensus({
    populated: async () => true,
    members: async () => (first ? [10, 11, 20] : [10, 11, 21]),
    executable: async (pid) => {
      if (pid === 20) {
        first = false;
        throw Object.assign(Error("parent exited after forking"), {
          code: "ENOENT",
        });
      }
      return pid === 21 ? "preview-server" : "runtime";
    },
  });
  assert.equal(census.gone, false);
  assert.equal(
    classifyIdle(
      {
        status: "known",
        generation: 7,
        processes: census.processes.filter((p) => p.pid !== 10 && p.pid !== 11),
      },
      7,
    ),
    "protected",
  );
  assert.ok(census.processes.some((p) => p.pid === 21));
});
test("P018 empty or perpetually changing census stays unknown while kernel says populated", async () => {
  const { stableCgroupCensus } = await import(
    "../../packages/codex-adapter/src/personal-cgroup.ts"
  );
  await assert.rejects(
    stableCgroupCensus({
      populated: async () => true,
      members: async () => [],
      executable: async () => "",
    }),
    /ownership is unknown/,
  );
  let sample = 0;
  await assert.rejects(
    stableCgroupCensus({
      populated: async () => true,
      members: async () => [10, 11, ++sample + 20],
      executable: async () => "process",
    }),
    /ownership is unknown/,
  );
  assert.equal(sample, 6);
  assert.deepEqual(
    await stableCgroupCensus({
      populated: async () => false,
      members: async () => {
        throw Error("must not infer absence from a PID list");
      },
      executable: async () => "",
    }),
    { gone: true, processes: [] },
  );
});
test("P018 missing native binary is proven before guardian creation and identity persistence", async () => {
  const { launchLocalRuntime, PersonalRuntimeNotStartedError } = await import(
    "../../packages/codex-adapter/src/local-runtime.ts"
  );
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const original = { ...process.env };
  const root = await mkdtemp(join(tmpdir(), "p018-prelaunch-"));
  let identities = 0;
  await mkdir(join(root, "home"), { mode: 0o700 });
  await mkdir(join(root, "workspace"));
  process.env.HARBOR_LOCAL_MODE = "personal";
  delete process.env.HARBOR_PERSONAL_VPS_MODE;
  process.env.HARBOR_LOCAL_CODEX_HOME = join(root, "home");
  process.env.HARBOR_LOCAL_CODEX_BINARY = join(root, "missing-native-binary");
  try {
    await assert.rejects(
      launchLocalRuntime({
        sessionId: "p018-prelaunch",
        projectId: "p018-prelaunch",
        workspacePath: join(root, "workspace"),
        generation: 5,
        onOwnedIdentity: async () => {
          identities++;
        },
      }),
      (error) =>
        error instanceof PersonalRuntimeNotStartedError &&
        (error.cause as NodeJS.ErrnoException)?.code === "ENOENT",
    );
    assert.equal(identities, 0);
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    await rm(root, { recursive: true, force: true });
  }
});
