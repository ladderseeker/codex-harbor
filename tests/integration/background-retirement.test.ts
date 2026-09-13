import { test } from "node:test";
import assert from "node:assert/strict";
import { settleBackgroundRetirement } from "../../apps/supervisor/src/background-retirement.ts";
import { RetirementRegistry } from "../../apps/supervisor/src/retirement.ts";

test("retained runtime with unconfirmed retirement becomes uncertain without releasing its writer", async () => {
  const registry = new RetirementRegistry();
  let live = true;
  let available = true;
  let writerHeld = true;
  let uncertain = false;
  const runtime = {
    async closeAndWait() {
      live = false; // Models adapter close removing the live runtime map entry.
      throw Error("process inspection failed after close");
    },
    async inspectProcesses() {
      return { status: "unavailable" };
    },
  };
  const result = await settleBackgroundRetirement({
    retire: () => registry.retire(runtime),
    uncertain: async () => {
      uncertain = true;
      available = false;
    },
    release: async () => {
      writerHeld = false;
    },
  });
  assert.equal(result, false);
  assert.equal(live, false);
  assert.equal(available, false);
  assert.equal(uncertain, true);
  assert.equal(writerHeld, true);
  assert.equal(await registry.confirmed(), false);
});

test("confirmed retirement releases only after transport confirmation", async () => {
  const sequence: string[] = [];
  assert.equal(
    await settleBackgroundRetirement({
      retire: async () => {
        sequence.push("retired");
        return true;
      },
      uncertain: async () => {
        sequence.push("uncertain");
      },
      release: async () => {
        sequence.push("released");
      },
    }),
    true,
  );
  assert.deepEqual(sequence, ["retired", "released"]);
});
