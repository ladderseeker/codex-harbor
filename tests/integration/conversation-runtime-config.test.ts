import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../apps/api/src/config.ts";
const base = {
  DATABASE_URL: "postgres://localhost/p018-private",
  HARBOR_ORIGIN: "https://localhost:3443",
  HARBOR_OIDC_ISSUER: "http://127.0.0.1:4000",
  HARBOR_OIDC_CLIENT_ID: "p018",
  HARBOR_OWNER_SUBJECT: "p018",
  HARBOR_PROJECT_ROOTS: "[]",
};
test("P018-02 capacity defaults, distinct valid limits and strict ceilings", () => {
  assert.equal(config(base).HARBOR_MAX_ACTIVE_TURNS, 4);
  assert.equal(config(base).HARBOR_MAX_CONVERSATION_RUNTIMES, 4);
  const c = config({
    ...base,
    HARBOR_MAX_ACTIVE_TURNS: "3",
    HARBOR_MAX_CONVERSATION_RUNTIMES: "7",
  });
  assert.equal(c.HARBOR_MAX_ACTIVE_TURNS, 3);
  assert.equal(c.HARBOR_MAX_CONVERSATION_RUNTIMES, 7);
  for (const invalid of [
    "",
    "0",
    "-1",
    "1.5",
    " 4",
    "4 ",
    "04",
    "1e1",
    "NaN",
    "Infinity",
    "17",
  ])
    assert.throws(() => config({ ...base, HARBOR_MAX_ACTIVE_TURNS: invalid }));
  for (const invalid of ["0", "33", "4.5", "2"])
    assert.throws(() =>
      config({ ...base, HARBOR_MAX_CONVERSATION_RUNTIMES: invalid }),
    );
  assert.equal(
    config({
      ...base,
      HARBOR_MAX_ACTIVE_TURNS: "16",
      HARBOR_MAX_CONVERSATION_RUNTIMES: "32",
    }).HARBOR_MAX_CONVERSATION_RUNTIMES,
    32,
  );
});
