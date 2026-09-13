/** P007-07 native/account boundary only. Harbor UI/API recovery has a separate E2E lane. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  CODEX_VERSION,
  type CodexAdapter,
  type RuntimeCallbacks,
} from "../../packages/codex-adapter/src/index.ts";
import { createRuntime } from "../../packages/codex-adapter/src/runtime.ts";
import { createManagedProject } from "../../infra/storage/client.ts";
import { retireRuntimeIdentity } from "../../infra/runner/authority.ts";
import { xfsFixture } from "../isolation/xfs-fixture.ts";
import { sourceDigest } from "../../scripts/source-digest.ts";

export function historyPrerequisite(
  env: NodeJS.ProcessEnv,
  platform = process.platform,
  uid = process.getuid?.(),
) {
  if (!env.HARBOR_TEST_OPENAI_API_KEY) return "DEDICATED_KEY_REQUIRED";
  if (
    env.HARBOR_TEST_OPENAI_API_KEY.length > 4096 ||
    /[\r\n]/.test(env.HARBOR_TEST_OPENAI_API_KEY)
  )
    return "DEDICATED_KEY_INVALID";
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(
      env.HARBOR_TEST_CODEX_MODEL ?? "",
    )
  )
    return "EXPLICIT_MODEL_REQUIRED";
  if (
    platform !== "linux" ||
    uid !== 0 ||
    !env.HARBOR_TEST_XFS_MOUNT?.startsWith("/")
  )
    return "SUPPORTED_LINUX_XFS_REQUIRED";
  if (env.HARBOR_FIXTURE_MODE) return "NATIVE_RUNTIME_REQUIRED";
  return undefined;
}
type HistoryRuntime = Pick<
  CodexAdapter,
  | "loginWithApiKey"
  | "readAccount"
  | "listModels"
  | "startThread"
  | "resumeThread"
  | "readThread"
  | "startTurn"
  | "close"
  | "closeAndWait"
  | "inspectProcesses"
>;
type Launch = (
  generation: number,
  callbacks: RuntimeCallbacks & {
    onTransport: (runtime: HistoryRuntime) => void;
  },
) => Promise<HistoryRuntime>;
export const historyProgress = () => ({
  phase: "prerequisites",
  turnRequests: 0,
  generations: [] as number[],
  retired: [] as number[],
});

/** Injectable native boundary permits no-model checks of driver ordering/failure;
 * such checks never count as a native or Harbor application acceptance result. */
export async function exerciseHistory(
  launch: Launch,
  key: string,
  model: string,
  progress: ReturnType<typeof historyProgress>,
  turnMs = 60000,
  signal?: AbortSignal,
) {
  assert.ok(Number.isSafeInteger(turnMs) && turnMs > 0 && turnMs <= 60000);
  const marker = "HARBOR_HISTORY_" + randomUUID().replaceAll("-", "");
  const firstInput = `Remember ${marker}. Reply exactly ${marker}. Do not call tools.`;
  const nextInput =
    "Reply with the marker from the earlier user message followed by _RESUMED. Do not call tools.";
  const owned: {
    runtime: HistoryRuntime;
    generation: number;
    retired: boolean;
  }[] = [];
  const completed = new Map<string, any>();
  let unexpected = false;
  const interrupted = () => owned.at(-1)?.runtime.close();
  signal?.addEventListener("abort", interrupted);
  const retire = async (entry: (typeof owned)[number]) => {
    await entry.runtime.closeAndWait();
    const inspection = await entry.runtime.inspectProcesses();
    assert.equal(
      inspection.status,
      "runtime_gone",
      "Exact runtime retirement unconfirmed",
    );
    assert.equal(
      inspection.generation,
      entry.generation,
      "Retirement generation changed",
    );
    entry.retired = true;
    progress.retired.push(entry.generation);
  };
  const start = async (generation: number) => {
    signal?.throwIfAborted();
    progress.phase = "runtime-" + generation;
    progress.generations.push(generation);
    const runtime = await launch(generation, {
      onTransport: (runtime) => {
        owned.push({ runtime, generation, retired: false });
        if (signal?.aborted) runtime.close();
      },
      onEvent: (method, params) => {
        if (method === "turn/completed") {
          if (completed.size >= 2) {
            unexpected = true;
            owned.at(-1)?.runtime.close();
          } else completed.set((params.turn as any).id, params.turn);
        }
        if (
          method === "item/started" &&
          !["userMessage", "agentMessage", "reasoning"].includes(
            (params.item as any)?.type,
          )
        ) {
          unexpected = true;
          owned.at(-1)?.runtime.close();
        }
      },
      onRequest: () => {
        unexpected = true;
        owned.at(-1)?.runtime.close();
      },
    });
    assert.equal(
      owned.at(-1)?.runtime,
      runtime,
      "Launch transport ownership missing",
    );
    signal?.throwIfAborted();
    if (generation === 1)
      assert.equal(
        (await runtime.readAccount()).account,
        null,
        "Fresh native home already authenticated",
      );
    signal?.throwIfAborted();
    await runtime.loginWithApiKey(key);
    signal?.throwIfAborted();
    assert.equal((await runtime.readAccount()).account?.type, "apiKey");
    const models = await runtime.listModels();
    assert.ok(
      models.data.some(
        (m: any) =>
          m.model === model &&
          !m.hidden &&
          m.supportedReasoningEfforts.some(
            (e: any) => e.reasoningEffort === "low",
          ),
      ),
      "Selected low-effort native model unavailable",
    );
    return runtime;
  };
  const turn = async (
    runtime: HistoryRuntime,
    threadId: string,
    input: string,
  ) => {
    signal?.throwIfAborted();
    assert.ok(
      progress.turnRequests < 2 && !unexpected,
      "Live turn budget exhausted",
    );
    progress.turnRequests++;
    const timeout = setTimeout(() => runtime.close(), turnMs);
    const deadline = performance.now() + turnMs;
    try {
      const result = await runtime.startTurn(threadId, input, {
        model,
        effort: "low",
        permissionProfile: "read-only",
      });
      while (
        !completed.has(result.turn.id) &&
        performance.now() < deadline &&
        !unexpected &&
        !signal?.aborted
      )
        await new Promise((r) => setTimeout(r, 25));
      signal?.throwIfAborted();
      assert.ok(!unexpected, "Unexpected native request or tool use");
      assert.equal(
        completed.get(result.turn.id)?.status,
        "completed",
        "Bounded live turn incomplete",
      );
      return result.turn.id as string;
    } finally {
      clearTimeout(timeout);
    }
  };
  const history = async (
    runtime: HistoryRuntime,
    threadId: string,
    expected: { id: string; input: string; reply: string }[],
  ) => {
    signal?.throwIfAborted();
    const { thread } = await runtime.readThread(threadId);
    signal?.throwIfAborted();
    assert.equal(thread.id, threadId);
    assert.equal(thread.cliVersion, CODEX_VERSION);
    assert.deepEqual(
      thread.turns.map((t: any) => t.id),
      expected.map((t) => t.id),
      "Native history added/lost/replayed a turn",
    );
    for (const [i, item] of expected.entries()) {
      const native = thread.turns[i];
      assert.equal(native.status, "completed");
      assert.deepEqual(
        native.items
          .filter((x: any) => x.type === "userMessage")
          .flatMap((x: any) =>
            x.content.map((c: any) => (c.type === "text" ? c.text : null)),
          ),
        [item.input],
      );
      assert.ok(
        native.items.some(
          (x: any) => x.type === "agentMessage" && x.text.trim() === item.reply,
        ),
        "Expected bounded native response missing",
      );
      assert.ok(
        native.items.every((x: any) =>
          ["userMessage", "agentMessage", "reasoning"].includes(x.type),
        ),
        "Unexpected native history item",
      );
    }
  };
  try {
    const first = await start(1);
    signal?.throwIfAborted();
    const { thread } = await first.startThread({
      cwd: "/workspace",
      model,
      permissionProfile: "read-only",
    });
    assert.equal(
      thread.cliVersion,
      CODEX_VERSION,
      "Pinned native runtime required before model use",
    );
    progress.phase = "first-turn";
    const firstId = await turn(first, thread.id, firstInput);
    const expected = [{ id: firstId, input: firstInput, reply: marker }];
    await history(first, thread.id, expected);
    progress.phase = "first-retirement";
    await retire(owned[0]!);
    const second = await start(2);
    progress.phase = "persisted-history";
    await history(second, thread.id, expected);
    const resumed = await second.resumeThread(thread.id, {
      cwd: "/workspace",
      permissionProfile: "read-only",
    });
    assert.equal(resumed.thread.id, thread.id);
    await history(second, thread.id, expected);
    progress.phase = "new-turn";
    const secondId = await turn(second, thread.id, nextInput);
    assert.notEqual(secondId, firstId);
    expected.push({
      id: secondId,
      input: nextInput,
      reply: marker + "_RESUMED",
    });
    await history(second, thread.id, expected);
    progress.phase = "second-retirement";
    await retire(owned[1]!);
    return {
      nativeThread: thread.id,
      turns: [firstId, secondId],
      runtimeVersion: CODEX_VERSION,
      originalInputResent: false,
    };
  } finally {
    try {
      for (const entry of owned.filter((entry) => !entry.retired))
        await retire(entry);
    } finally {
      signal?.removeEventListener("abort", interrupted);
    }
  }
}

export async function liveHistory() {
  const unavailable = process.argv.slice(2).some((arg) => arg !== "--history")
    ? "HISTORY_LANE_ARGUMENTS_INVALID"
    : historyPrerequisite(process.env);
  if (unavailable) {
    console.error(
      `UNVERIFIED P007-07: ${unavailable}; no model request or test resources created.`,
    );
    process.exitCode = 2;
    return;
  }
  const key = process.env.HARBOR_TEST_OPENAI_API_KEY!,
    model = process.env.HARBOR_TEST_CODEX_MODEL!;
  const progress = historyProgress(),
    id = randomUUID();
  const output = resolve(".test-runs", "live-history-" + id);
  const ownership: {
    projectId: string;
    sessionId: string;
    generations: number[];
    fixture?: {
      instanceId: string;
      rootId: string;
      base: string;
      control: string;
      mount: string;
      quotaIds: number[];
    };
    project?: { canonical: string; device: string; inode: string };
    storagePid?: number;
  } = { projectId: id, sessionId: id, generations: [] };
  const retainOwnership = () =>
    writeFile(
      join(output, "ownership.json"),
      JSON.stringify(ownership, null, 2) + "\n",
      { mode: 0o600 },
    );
  const cancellation = new AbortController();
  const onInterrupt = () => cancellation.abort();
  // Install before the first owned filesystem/process mutation. Repeated signals
  // keep cleanup in control instead of restoring Node's immediate-exit default.
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  let fixture: Awaited<ReturnType<typeof xfsFixture>> | undefined,
    storage: ChildProcess | undefined;
  let result: unknown,
    sourceAtStart: ReturnType<typeof sourceDigest> | undefined,
    sourceAtEnd: ReturnType<typeof sourceDigest> | undefined,
    failed = false,
    cleanup = false,
    fixtureAttempted = false;
  try {
    cancellation.signal.throwIfAborted();
    sourceAtStart = sourceDigest();
    await mkdir(output, { recursive: true, mode: 0o700 });
    await retainOwnership();
    cancellation.signal.throwIfAborted();
    progress.phase = "managed-fixture";
    fixtureAttempted = true;
    fixture = await xfsFixture();
    ownership.fixture = {
      instanceId: fixture.id,
      rootId: fixture.rootId,
      base: fixture.base,
      control: fixture.control,
      mount: fixture.mount,
      quotaIds: fixture.ids,
    };
    await retainOwnership();
    cancellation.signal.throwIfAborted();
    Object.assign(process.env, fixture.env);
    const childEnv: NodeJS.ProcessEnv = { ...fixture.env };
    delete childEnv.HARBOR_TEST_OPENAI_API_KEY;
    delete childEnv.OPENAI_API_KEY;
    storage = spawn(
      process.execPath,
      ["--import", "tsx", "infra/storage/server.ts"],
      { env: childEnv, stdio: "ignore" },
    );
    storage.on("error", () => {});
    ownership.storagePid = storage.pid;
    await retainOwnership();
    let ready = false;
    for (let n = 0; n < 100 && !ready; n++) {
      cancellation.signal.throwIfAborted();
      try {
        ready = (await stat(fixture.env.HARBOR_STORAGE_SOCKET)).isSocket();
      } catch {}
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "Owned storage IPC unavailable");
    cancellation.signal.throwIfAborted();
    const project = await createManagedProject(fixture.rootId, "live-history");
    ownership.project = {
      canonical: project.canonical,
      device: project.device,
      inode: project.inode,
    };
    await retainOwnership();
    cancellation.signal.throwIfAborted();
    result = await exerciseHistory(
      async (generation, callbacks) => {
        ownership.generations.push(generation);
        await retainOwnership();
        cancellation.signal.throwIfAborted();
        return createRuntime({
          ...callbacks,
          instanceId: fixture!.id,
          projectId: id,
          sessionId: id,
          generation,
          workspacePath: project.canonical,
          workspaceDevice: project.device,
          workspaceInode: project.inode,
          permissionProfile: "read-only",
        });
      },
      key,
      model,
      progress,
      60000,
      cancellation.signal,
    );
  } catch {
    failed = true;
  } finally {
    let runtimeRetired = false,
      storageStopped = false;
    try {
      if (fixture && progress.generations.length)
        await retireRuntimeIdentity({
          instanceId: fixture.id,
          projectId: id,
          sessionId: id,
        });
      runtimeRetired = true;
    } catch {
      failed = true;
    }
    // Stop our IPC process even if native retirement remains uncertain; retain
    // its fixture/data for recovery until both ownership checks have settled.
    try {
      if (storage && storage.exitCode === null && storage.signalCode === null) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            storage!.kill("SIGKILL");
            reject(Error("Owned storage shutdown unconfirmed"));
          }, 5000);
          storage!.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
          storage!.kill("SIGTERM");
        });
      }
      storageStopped = true;
    } catch {
      failed = true;
    }
    try {
      if (runtimeRetired && storageStopped) await fixture?.cleanup();
      // A shared fixture failure can occur after partial provisioning. Preserve
      // that uncertainty instead of claiming a missing return value is cleanup.
      cleanup =
        runtimeRetired && storageStopped && (!fixtureAttempted || !!fixture);
    } catch {
      failed = true;
    }
    failed ||= cancellation.signal.aborted;
    try {
      sourceAtEnd = sourceDigest();
      if (!sourceAtStart || sourceAtStart.digest !== sourceAtEnd.digest)
        failed = true;
    } catch {
      failed = true;
    }
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    const evidence = {
      acceptance: "P007-07",
      scope:
        "native account/history/restart/resume; Harbor UI/API E2E is separate",
      node: process.version,
      model,
      ...progress,
      interrupted: cancellation.signal.aborted,
      result,
      ownership,
      cleanup,
      passed: !failed,
      sourceAtStart,
      sourceAtEnd,
    };
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(
      join(output, "result.json"),
      JSON.stringify(evidence, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(
      `${failed ? (progress.turnRequests ? "FAIL" : "UNVERIFIED") : "PASS"} P007-07 native history lane; phase=${progress.phase}; turns=${progress.turnRequests}; cleanup=${cleanup}; evidence=${output}`,
    );
    process.exitCode = failed ? (progress.turnRequests ? 1 : 2) : 0;
  }
}
