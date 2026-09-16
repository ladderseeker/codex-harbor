import test from "node:test";
import assert from "node:assert/strict";
import {
  sessionSchema,
  turnSchema,
  reasoningEfforts,
} from "../../packages/contracts/src/index.js";
import { effectiveSettings } from "../../packages/policy/src/models.js";

test("P016 reasoning settings admit all five modes only when discovered for the chosen model", async () => {
  const db = {
    query: async () => ({
      rows: [
        {
          data: {
            data: [
              {
                model: "gpt-6-astra",
                supportedReasoningEfforts: reasoningEfforts.map(
                  (reasoningEffort) => ({ reasoningEffort }),
                ),
              },
              {
                model: "limited",
                supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
              },
            ],
          },
        },
      ],
    }),
  };
  for (const effort of reasoningEfforts) {
    sessionSchema.parse({
      projectId: "00000000-0000-4000-8000-000000000000",
      model: "gpt-6-astra",
      effort,
    });
    turnSchema.parse({
      text: "test",
      model: "gpt-6-astra",
      effort,
      permissionProfile: "read-only",
    });
    await effectiveSettings(db as any, "gpt-6-astra", effort, ["gpt-6-astra"]);
  }
  for (const effort of ["xhigh", "max", "light"]) {
    await assert.rejects(
      effectiveSettings(db as any, "limited", effort, ["limited"]),
      { code: "EFFORT_DENIED" },
    );
  }
  await assert.rejects(
    effectiveSettings(db as any, "gpt-6-astra", "max", ["limited"]),
    { code: "MODEL_DENIED" },
  );
  assert.equal(
    turnSchema.safeParse({
      text: "test",
      model: "gpt-6-astra",
      effort: "light",
      permissionProfile: "read-only",
    }).success,
    false,
  );
});
