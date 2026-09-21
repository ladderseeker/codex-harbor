/** Bounded account/native boundary; actual Harbor admission is tested by --concurrency. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import {
  CODEX_VERSION,
  type CodexAdapter,
} from "../../packages/codex-adapter/src/index.ts";
import { createRuntime } from "../../packages/codex-adapter/src/runtime.ts";
import { inspectRecoveredLocalRuntime } from "../../packages/codex-adapter/src/local-runtime.ts";
import { sourceDigest } from "../../scripts/source-digest.ts";

type Config = { stateRoot: string; binary: string; model: string };
const owned: CodexAdapter[] = [];
const completed = new Map<string, { status: string; at: number }>();
let phase = "prerequisites",
  turnRequests = 0,
  root: string | undefined;
let unexpectedRequest = false,
  timedOut = false;
let timer: NodeJS.Timeout | undefined;
const original = { ...process.env };
const inside = (parent: string, child: string) => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};
async function privateDirectory(candidate: string) {
  assert.ok(isAbsolute(candidate) && candidate === (await realpath(candidate)));
  const info = await lstat(candidate);
  assert.ok(
    info.isDirectory() &&
      info.uid === process.getuid?.() &&
      (info.mode & 0o077) === 0,
  );
}
try {
  assert.ok(
    process.platform === "linux" && process.getuid?.() !== 0,
    "NONROOT_LINUX_REQUIRED",
  );
  assert.ok(
    !process.env.HARBOR_FIXTURE_MODE && !process.env.HARBOR_LOCAL_MODE,
    "NATIVE_VPS_REQUIRED",
  );
  const configPath = process.env.HARBOR_P018_LIVE_CONFIG;
  assert.ok(configPath && isAbsolute(configPath), "EXPLICIT_CONFIG_REQUIRED");
  assert.equal(
    await realpath(configPath),
    configPath,
    "CANONICAL_CONFIG_REQUIRED",
  );
  const configInfo = await lstat(configPath);
  assert.ok(
    configInfo.isFile() &&
      !configInfo.isSymbolicLink() &&
      configInfo.uid === process.getuid?.() &&
      (configInfo.mode & 0o077) === 0,
    "PRIVATE_CONFIG_REQUIRED",
  );
  const config: Config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(Object.keys(config).sort(), [
    "binary",
    "model",
    "stateRoot",
  ]);
  assert.match(config.model, /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
  await privateDirectory(config.stateRoot);
  assert.notEqual(config.stateRoot, await realpath(homedir()));
  assert.ok(
    !inside(join(await realpath(homedir()), ".codex"), config.stateRoot),
  );
  assert.deepEqual(
    (await readdir(config.stateRoot)).sort(),
    ["codex"],
    "FRESH_DEDICATED_STATE_REQUIRED",
  );
  const home = join(config.stateRoot, "codex");
  await privateDirectory(home);
  assert.deepEqual(
    await readdir(home),
    ["auth.json"],
    "CREDENTIAL_ONLY_DEDICATED_HOME_REQUIRED",
  );
  const auth = await lstat(join(home, "auth.json"));
  assert.ok(
    auth.isFile() &&
      !auth.isSymbolicLink() &&
      auth.uid === process.getuid?.() &&
      (auth.mode & 0o077) === 0 &&
      auth.size > 0,
  );
  // The worker never copies or reads account contents. Main provisions this one-time home.
  assert.ok(
    isAbsolute(config.binary) &&
      config.binary === (await realpath(config.binary)),
  );
  const binaryInfo = await stat(config.binary);
  assert.ok(binaryInfo.isFile() && (binaryInfo.mode & 0o022) === 0);
  assert.equal(
    (await readFile(config.binary)).subarray(0, 4).toString("hex"),
    "7f454c46",
    "DIRECT_NATIVE_BINARY_REQUIRED",
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(config.binary)) hash.update(chunk);
  const binarySha256 = hash.digest("hex");
  root = config.stateRoot;
  const workspace = join(root, "workspace");
  await mkdir(workspace, { mode: 0o700 });
  process.env.HARBOR_PERSONAL_VPS_MODE = "personal";
  process.env.HARBOR_PERSONAL_VPS_CODEX_HOME = home;
  process.env.HARBOR_PERSONAL_VPS_CODEX_BINARY = config.binary;
  delete process.env.HARBOR_PERSONAL_PREVIEWS;
  const identity = await stat(workspace, { bigint: true });
  timer = setTimeout(() => {
    timedOut = true;
    for (const adapter of owned) adapter.close();
  }, 240_000);
  const start = async (name: string, generation: number) => {
    const runtime = await createRuntime({
      sessionId: name,
      projectId: "p018-live",
      generation,
      workspacePath: workspace,
      workspaceDevice: String(identity.dev),
      workspaceInode: String(identity.ino),
      permissionProfile: "workspace-write",
      onTransport: (adapter) => {
        owned.push(adapter);
      },
      onEvent: (method, params) => {
        if (method === "turn/completed") {
          const turn = params.turn as { id: string; status: string };
          completed.set(turn.id, { status: turn.status, at: Date.now() });
        }
      },
      onRequest: () => {
        unexpectedRequest = true;
        for (const adapter of owned) adapter.close();
      },
    });
    assert.ok((await runtime.readAccount()).account, "DEDICATED_AUTH_REQUIRED");
    assert.ok(
      (await runtime.listModels()).data.some(
        (m: {
          model: string;
          hidden?: boolean;
          supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
        }) =>
          m.model === config.model &&
          !m.hidden &&
          m.supportedReasoningEfforts.some((e) => e.reasoningEffort === "low"),
      ),
      "EXPLICIT_MODEL_UNAVAILABLE",
    );
    return runtime;
  };
  const turn = async (
    adapter: CodexAdapter,
    thread: string,
    prompt: string,
  ) => {
    assert.ok(++turnRequests <= 4 && !timedOut && !unexpectedRequest);
    return (
      await adapter.startTurn(thread, prompt, {
        model: config.model,
        effort: "low",
        permissionProfile: "workspace-write",
      })
    ).turn.id as string;
  };
  const wait = async (id: string) => {
    const deadline = Date.now() + 60_000;
    while (
      !completed.has(id) &&
      Date.now() < deadline &&
      !unexpectedRequest &&
      !timedOut
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      completed.get(id)?.status,
      "completed",
      "BOUNDED_TURN_NOT_COMPLETED",
    );
  };
  phase = "parallel-native-turns";
  const a = await start("p018-live-a", 1),
    b = await start("p018-live-b", 1);
  const [ta, tb] = await Promise.all([
    a.startThread({
      cwd: workspace,
      model: config.model,
      permissionProfile: "workspace-write",
    }),
    b.startThread({
      cwd: workspace,
      model: config.model,
      permissionProfile: "workspace-write",
    }),
  ]);
  assert.notEqual(ta.thread.id, tb.thread.id);
  assert.notDeepEqual(a.ownedIdentity(), b.ownedIdentity());
  const marker = "P018_" + randomUUID().replaceAll("-", "");
  const prompt = (file: string) =>
    `Use exactly one shell command to sleep 3 seconds, then write the exact text ${marker} to ${file} in the current directory. Do not access any other file, use network, start background processes, or install anything. Reply exactly ${marker}. Remember this marker for a later turn.`;
  const [first, second] = await Promise.all([
    turn(a, ta.thread.id, prompt("a.txt")),
    turn(b, tb.thread.id, prompt("b.txt")),
  ]);
  const bothAccepted = Date.now();
  await Promise.all([wait(first), wait(second)]);
  assert.ok(
    completed.get(first)!.at >= bothAccepted &&
      completed.get(second)!.at >= bothAccepted,
    "PARALLEL_OVERLAP_NOT_OBSERVED",
  );
  for (const name of ["a.txt", "b.txt"]) {
    assert.equal(
      (await readFile(join(workspace, name), "utf8")).trim(),
      marker,
    );
    assert.equal((await stat(join(workspace, name))).uid, process.getuid?.());
  }
  phase = "reuse-and-retire";
  const before = a.ownedIdentity();
  await wait(
    await turn(
      a,
      ta.thread.id,
      "Reply with the exact remembered marker. Do not call tools.",
    ),
  );
  assert.deepEqual(a.ownedIdentity(), before);
  const threadBefore = await a.readThread(ta.thread.id);
  assert.ok(JSON.stringify(threadBefore).includes(marker));
  await a.closeAndWait();
  assert.equal(await inspectRecoveredLocalRuntime(before), "absent");
  assert.equal(
    await inspectRecoveredLocalRuntime(b.ownedIdentity()),
    "unknown",
  );
  assert.ok((await b.readThread(tb.thread.id)).thread.turns.length >= 1);
  phase = "resume-native-thread";
  const resumed = await start("p018-live-a", 2);
  assert.notDeepEqual(resumed.ownedIdentity(), before);
  assert.equal(
    (
      await resumed.resumeThread(ta.thread.id, {
        cwd: workspace,
        permissionProfile: "workspace-write",
      })
    ).thread.id,
    ta.thread.id,
  );
  await wait(
    await turn(
      resumed,
      ta.thread.id,
      "Reply with the exact remembered marker. Do not call tools.",
    ),
  );
  const history = (await resumed.readThread(ta.thread.id)).thread.turns;
  assert.equal(history.length, 3);
  for (const entry of history.slice(1))
    assert.ok(
      entry.items.some(
        (item: { type: string; text?: string }) =>
          item.type === "agentMessage" && item.text?.trim() === marker,
      ),
      "NATIVE_HISTORY_MARKER_NOT_RETAINED",
    );
  phase = "cleanup";
  for (const adapter of owned) {
    await adapter.closeAndWait();
    assert.equal(
      await inspectRecoveredLocalRuntime(adapter.ownedIdentity()),
      "absent",
    );
  }
  await rm(workspace, { recursive: true, force: true });
  await writeFile(
    join(root, "result.json"),
    JSON.stringify(
      {
        passed: true,
        sourceDigest: sourceDigest(),
        runtimeVersion: CODEX_VERSION,
        binarySha256,
        platform: process.platform,
        nonroot: true,
        turnRequests,
        parallelOverlap: true,
        nativeThreadReuseResume: true,
        siblingPreserved: true,
        confirmedRetirement: true,
        cleanup:
          "owned workspace removed; private one-time account home retained for main cleanup",
        limits: [
          "native/account boundary only; Harbor admission requires separate real-stack acceptance",
        ],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "PASS P018-09 bounded native/account concurrency; sanitized result.json retained in dedicated stateRoot",
  );
} catch {
  // Native errors may embed account/network information. Only our fixed phase is public.
  console.error(
    `${turnRequests ? "FAIL" : "UNVERIFIED"} P018-09 phase=${phase}; explicit HARBOR_P018_LIVE_CONFIG, credential-only private state, complete pinned native distribution, model and nonroot Linux required; no automatic retry`,
  );
  process.exitCode = turnRequests ? 1 : 2;
} finally {
  if (timer) clearTimeout(timer);
  const cleanup = await Promise.allSettled(
    owned.map((adapter) => adapter.closeAndWait()),
  );
  if (cleanup.some((result) => result.status === "rejected")) {
    console.error(
      "FAIL P018-09 owned retirement unconfirmed; dedicated resources retained for recovery",
    );
    process.exitCode = 1;
  }
  for (const key of Object.keys(process.env))
    if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
}
