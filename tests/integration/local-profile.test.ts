import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../apps/api/src/config.ts";
const local = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://localhost/isolated",
  HARBOR_ORIGIN: "https://localhost:3443",
  HARBOR_OIDC_ISSUER: "http://127.0.0.1:4000",
  HARBOR_OIDC_CLIENT_ID: "private-instance",
  HARBOR_OWNER_SUBJECT: "private-owner",
  HARBOR_PROJECT_ROOTS: JSON.stringify([
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Private projects",
      path: "/private/local-projects",
    },
  ]),
  HARBOR_LOCAL_MODE: "personal",
  HARBOR_LOCAL_CODEX_HOME: "/private/local-account",
  HARBOR_LOCAL_CODEX_BINARY: "/private/runtime/codex",
};
test("P013-01 personal local profile rejects public, fixture and installed deployment combinations", () => {
  assert.equal(config(local).HARBOR_LOCAL_MODE, "personal");
  for (const incompatible of [
    { HARBOR_ORIGIN: "https://harbor.example" },
    { HARBOR_HOST: "0.0.0.0" },
    { HARBOR_OIDC_ISSUER: "https://identity.example" },
    { HARBOR_FIXTURE_MODE: "private-test", NODE_ENV: "test" },
    { HARBOR_MANAGED_RELEASE: "installed" },
    { NODE_ENV: "production" },
    { HARBOR_LOCAL_CODEX_HOME: undefined },
    { HARBOR_LOCAL_CODEX_BINARY: undefined },
    { HARBOR_STORAGE_SOCKET: "/private/storage.sock" },
  ])
    assert.throws(() => config({ ...local, ...incompatible }));
});
