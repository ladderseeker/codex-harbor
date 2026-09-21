import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyIdle,
  capacityReason,
} from "../../apps/supervisor/src/runtime-capacity.ts";
import { inspectRecoveredLocalRuntime } from "../../packages/codex-adapter/src/local-runtime.ts";
test("P018-05 every extra owned child protects, including known startup executables", () => {
  assert.equal(
    classifyIdle({ status: "known", generation: 41, processes: [] }, 41),
    "idle",
  );
  for (const executable of [
    "git",
    "codex",
    "sleep",
    "node",
    "bwrap",
    "python3",
  ])
    assert.equal(
      classifyIdle(
        {
          status: "known",
          generation: 41,
          processes: [{ pid: 99, executable }],
        },
        41,
      ),
      "protected",
    );
  assert.equal(
    classifyIdle({ status: "unavailable", generation: 41, processes: [] }, 41),
    "unknown",
  );
  assert.equal(
    classifyIdle({ status: "runtime_gone", generation: 41, processes: [] }, 42),
    "unknown",
  );
  assert.equal(classifyIdle({ status: "known", processes: [] }, 41), "unknown");
  assert.equal(
    classifyIdle({ status: "runtime_gone", generation: 41, processes: [] }, 41),
    "gone",
  );
});
test("P018-04 queue capacity explains protected and unconfirmed members", () => {
  assert.equal(capacityReason(["active", "starting"]), "runtime_capacity");
  assert.equal(
    capacityReason(["waiting_input", "protected"]),
    "protected_capacity",
  );
  assert.equal(capacityReason(["protected", "retiring"]), "retirement_unknown");
  assert.equal(capacityReason(["unknown"]), "retirement_unknown");
});
test("P018-06 missing or restored identity never authorizes recovered PID contact", async () => {
  for (const identity of [
    null,
    {},
    { host: "not-this-host.invalid", groupId: process.pid },
    { host: "not-this-host.invalid", groupId: 1 },
  ])
    assert.equal(await inspectRecoveredLocalRuntime(identity), "unknown");
});
