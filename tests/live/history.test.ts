/** Driver/prerequisite contracts only; these doubles make no native/model claim. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  exerciseHistory,
  historyPrerequisite,
  historyProgress,
} from "./history.ts";
import { CODEX_VERSION } from "../../packages/codex-adapter/src/index.ts";

function controlled(mode = "success", cancellation?: AbortController) {
  const turns: any[] = [],
    calls: string[] = [];
  let marker = "";
  const launch: Parameters<typeof exerciseHistory>[0] = async (
    generation,
    callbacks,
  ) => {
    calls.push("launch:" + generation);
    const runtime = {
      loginWithApiKey: async () => {
        authenticated = true;
      },
      readAccount: async () => ({
        account: authenticated ? { type: "apiKey" } : null,
      }),
      listModels: async () => ({
        data:
          mode === "unsupported"
            ? []
            : [
                {
                  model: "selected-model",
                  supportedReasoningEfforts: [{ reasoningEffort: "low" }],
                },
              ],
      }),
      startThread: async () => ({
        thread: { id: "thread-one", cliVersion: CODEX_VERSION },
      }),
      readThread: async () => ({
        thread: {
          id: "thread-one",
          cliVersion: CODEX_VERSION,
          turns: structuredClone(turns),
        },
      }),
      resumeThread: async (id: string) => {
        calls.push("resume:" + generation);
        if (mode === "duplicate") turns.push(structuredClone(turns[0]));
        return { thread: { id } };
      },
      startTurn: async (id: string, input: string) => {
        assert.equal(id, "thread-one");
        calls.push("turn:" + generation);
        if (mode === "interrupt") {
          cancellation!.abort();
          return { turn: { id: "turn-" + generation } };
        }
        if (mode === "lost") throw Error("controlled lost reply");
        const turn = {
          id: "turn-" + generation,
          status: "completed",
          items: [
            { type: "userMessage", content: [{ type: "text", text: input }] },
            {
              type: "agentMessage",
              text:
                generation === 1
                  ? (marker = /HARBOR_HISTORY_[a-f0-9]+/.exec(input)![0])
                  : marker + "_RESUMED",
            },
          ],
        };
        turns.push(turn);
        if (mode !== "timeout") callbacks.onEvent?.("turn/completed", { turn });
        return { turn };
      },
      close: () => {
        calls.push("abort:" + generation);
      },
      closeAndWait: async () => {
        calls.push("close:" + generation);
        if (mode === "retirement") throw Error("controlled retirement failure");
      },
      inspectProcesses: async () => ({
        status: "runtime_gone" as const,
        generation,
        processes: [],
      }),
    };
    let authenticated = false;
    callbacks.onTransport(runtime);
    return runtime;
  };
  return { launch, calls, turns };
}

test("P007 live driver retires generation one before resuming exactly one new input", async () => {
  const c = controlled(),
    progress = historyProgress();
  const result = await exerciseHistory(
    c.launch,
    "dedicated-test-key",
    "selected-model",
    progress,
  );
  assert.deepEqual(c.calls, [
    "launch:1",
    "turn:1",
    "close:1",
    "launch:2",
    "resume:2",
    "turn:2",
    "close:2",
  ]);
  assert.equal(progress.turnRequests, 2);
  assert.deepEqual(progress.retired, [1, 2]);
  assert.deepEqual(result.turns, ["turn-1", "turn-2"]);
  assert.notEqual(
    c.turns[0].items[0].content[0].text,
    c.turns[1].items[0].content[0].text,
  );
});

test("P007 live driver refuses missing model, lost reply, duplicate history, deadline and unconfirmed retirement without replay", async () => {
  for (const mode of [
    "unsupported",
    "lost",
    "duplicate",
    "timeout",
    "retirement",
  ]) {
    const c = controlled(mode),
      progress = historyProgress();
    await assert.rejects(
      exerciseHistory(
        c.launch,
        "dedicated-test-key",
        "selected-model",
        progress,
        10,
      ),
    );
    assert.ok(progress.turnRequests <= 1, mode);
    assert.ok(
      c.calls.filter((call) => call.startsWith("turn:")).length <= 1,
      mode,
    );
    if (mode !== "duplicate") assert.ok(!c.calls.includes("launch:2"), mode);
  }
});

test("P007 live prerequisites ignore personal credentials and require explicit supported native selection", () => {
  assert.equal(
    historyPrerequisite({ OPENAI_API_KEY: "personal-never-used" }, "linux", 0),
    "DEDICATED_KEY_REQUIRED",
  );
  const env = {
    HARBOR_TEST_OPENAI_API_KEY: "dedicated",
    HARBOR_TEST_CODEX_MODEL: "selected-model",
    HARBOR_TEST_XFS_MOUNT: "/owned-xfs",
  };
  assert.equal(
    historyPrerequisite({ ...env, HARBOR_TEST_CODEX_MODEL: "" }, "linux", 0),
    "EXPLICIT_MODEL_REQUIRED",
  );
  assert.equal(
    historyPrerequisite(
      { ...env, HARBOR_TEST_OPENAI_API_KEY: "secret\ninvalid" },
      "linux",
      0,
    ),
    "DEDICATED_KEY_INVALID",
  );
  assert.equal(
    historyPrerequisite(env, "darwin", 0),
    "SUPPORTED_LINUX_XFS_REQUIRED",
  );
  assert.equal(
    historyPrerequisite(env, "linux", 1000),
    "SUPPORTED_LINUX_XFS_REQUIRED",
  );
  assert.equal(
    historyPrerequisite(
      { ...env, HARBOR_FIXTURE_MODE: "private-test" },
      "linux",
      0,
    ),
    "NATIVE_RUNTIME_REQUIRED",
  );
  assert.equal(historyPrerequisite(env, "linux", 0), undefined);
});

test("P007 interruption before launch or during a turn prevents later dispatch and closes owned transport", async () => {
  for (const when of ["before-launch", "active-turn"]) {
    const cancellation = new AbortController(),
      c = controlled("interrupt", cancellation),
      progress = historyProgress();
    if (when === "before-launch") cancellation.abort();
    await assert.rejects(
      exerciseHistory(
        c.launch,
        "dedicated-test-key",
        "selected-model",
        progress,
        100,
        cancellation.signal,
      ),
    );
    if (when === "before-launch") {
      assert.deepEqual(c.calls, []);
      assert.equal(progress.turnRequests, 0);
    } else {
      assert.deepEqual(c.calls, ["launch:1", "turn:1", "abort:1", "close:1"]);
      assert.equal(progress.turnRequests, 1);
      assert.deepEqual(progress.retired, [1]);
    }
    assert.ok(!c.calls.includes("launch:2"));
  }
});

test("canonical --history routing fails before resources/model calls when its dedicated key is absent", () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENAI_API_KEY: "personal-never-used",
    HARBOR_TEST_XFS_MOUNT: "/not-an-owned-fixture",
  };
  delete env.HARBOR_TEST_OPENAI_API_KEY;
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "tests/live/run.ts", "--history"],
    { env, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.status, 2);
  assert.match(
    child.stderr,
    /UNVERIFIED P007-07: DEDICATED_KEY_REQUIRED; no model request or test resources created/,
  );
  assert.doesNotMatch(
    child.stdout + child.stderr,
    /personal-never-used|PASS|P001-08/,
  );
});
