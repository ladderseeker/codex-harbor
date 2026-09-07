import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { CodexAdapter } from "../../packages/codex-adapter/src/index.js";
const require = createRequire(import.meta.url);
const digest = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
test("P001 pinned generated schema remains exact", async () => {
  const home = await mkdtemp(join(tmpdir(), "harbor-schema-test-"));
  try {
    execFileSync(
      "codex",
      ["app-server", "generate-json-schema", "--out", join(home, "schemas")],
      { env: { PATH: process.env.PATH, CODEX_HOME: home, HOME: home } },
    );
    execFileSync(
      "codex",
      ["app-server", "generate-ts", "--out", join(home, "types")],
      { env: { PATH: process.env.PATH, CODEX_HOME: home, HOME: home } },
    );
    for (const name of await readdir("packages/codex-adapter/generated", {
      recursive: true,
    })) {
      if (name.endsWith(".ts"))
        assert.equal(
          digest(await readFile(join(home, "types", name))),
          digest(
            await readFile(join("packages/codex-adapter/generated", name)),
          ),
          name,
        );
    }
    for (const name of await readdir("packages/codex-adapter/schema")) {
      const upstream = join(
        home,
        "schemas",
        name.endsWith("Response.json") ? "v2" : "",
        name,
      );
      assert.equal(
        digest(await readFile(upstream)),
        digest(await readFile(join("packages/codex-adapter/schema", name))),
        name,
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("P001 fixture conversation and notifications match generated protocol schemas", async () => {
  const Ajv = require("ajv");
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const validate = async (name: string) =>
    ajv.compile(
      JSON.parse(
        await readFile(`packages/codex-adapter/schema/${name}.json`, "utf8"),
      ),
    );
  const notification = await validate("ServerNotification"),
    request = await validate("ServerRequest"),
    threadResponse = await validate("ThreadStartResponse"),
    turnResponse = await validate("TurnStartResponse"),
    modelResponse = await validate("ModelListResponse");
  const errors: unknown[] = [];
  const adapter = new CodexAdapter(
    spawn(process.execPath, ["tests/fixtures/codex/server.mjs"], {
      stdio: "pipe",
    }),
    {
      onEvent: (method, params) => {
        if (!notification({ method, params }))
          errors.push({
            method,
            errors: notification.errors?.filter(
              (e: any) => e.instancePath !== "/method" && e.keyword !== "oneOf",
            ),
          });
      },
      onRequest: (r) => {
        if (!request(r))
          errors.push({
            method: r.method,
            errors: request.errors?.filter(
              (e: any) => e.instancePath !== "/method" && e.keyword !== "oneOf",
            ),
          });
        adapter.respond(
          r.id,
          r.method === "item/tool/requestUserInput"
            ? { answers: { choice: { answers: ["Yes"] } } }
            : { decision: "decline" },
        );
      },
    },
  );
  try {
    await adapter.initialize();
    assert.ok(
      modelResponse(await adapter.listModels()),
      JSON.stringify(modelResponse.errors),
    );
    const start = await adapter.startThread({ cwd: "/workspace" });
    assert.ok(threadResponse(start), JSON.stringify(threadResponse.errors));
    const turn = await adapter.startTurn(start.thread.id, "[approval]");
    assert.ok(turnResponse(turn), JSON.stringify(turnResponse.errors));
    await new Promise((r) => setTimeout(r, 120));
    await adapter.startTurn(start.thread.id, "[input]");
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(errors, []);
  } finally {
    adapter.close();
  }
});
