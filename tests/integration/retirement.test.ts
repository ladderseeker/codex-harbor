import test from "node:test";
import assert from "node:assert/strict";
import { RetirementRegistry } from "../../apps/supervisor/src/retirement.ts";
test("credential sweep waits for asynchronous retirement confirmation", async () => {
  let finish!: () => void,
    confirmed = false;
  const registry = new RetirementRegistry();
  const transport = {
    closeAndWait: () => new Promise<void>((r) => (finish = r)),
    inspectProcesses: async () => ({ status: "known" }),
  };
  registry.retire(transport);
  const check = registry.confirmed().then((result) => {
    confirmed = result;
  });
  await Promise.resolve();
  assert.equal(confirmed, false);
  finish();
  await check;
  assert.equal(confirmed, true);
});
test("failed retirement remains owned until trusted absence is established", async () => {
  let status = "unavailable";
  const registry = new RetirementRegistry();
  const transport = {
    closeAndWait: async () => {
      throw Error("daemon unavailable");
    },
    inspectProcesses: async () => ({ status }),
  };
  assert.equal(await registry.retire(transport), false);
  assert.equal(await registry.confirmed(), false);
  status = "known";
  assert.equal(await registry.confirmed(), false);
  status = "runtime_gone";
  assert.equal(await registry.confirmed(), true);
});
