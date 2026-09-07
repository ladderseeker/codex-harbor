import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { workspaceCommand } from "../../infra/storage/workspace-client.ts";
async function fixture(
  handler: (res: ServerResponse) => void,
  run: () => Promise<void>,
) {
  const folder = await mkdtemp(join(tmpdir(), "harbor-workspace-ipc-")),
    socket = join(folder, "storage.sock"),
    previous = process.env.HARBOR_STORAGE_SOCKET;
  const server = createServer((req, res) => {
    req.resume();
    handler(res);
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  process.env.HARBOR_STORAGE_SOCKET = socket;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.HARBOR_STORAGE_SOCKET;
    else process.env.HARBOR_STORAGE_SOCKET = previous;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  }
}
const command = {
  action: "workspaceInspect" as const,
  rootId: "root",
  relativePath: "project/workspace",
  workspaceId: randomUUID(),
  kind: "local" as const,
};
test("P003 storage IPC rejects peer EOF after partial response headers", async () =>
  fixture(
    (res) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": "100",
      });
      res.write("{");
      setTimeout(() => res.destroy(), 10);
    },
    async () => {
      const started = Date.now();
      await assert.rejects(
        workspaceCommand(command, 1000),
        /aborted|incomplete|failed|unavailable/,
      );
      assert.ok(Date.now() - started < 500);
    },
  ));
test("P003 storage IPC total deadline bounds a continuously active slow response", async () =>
  fixture(
    (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write(" ");
      const timer = setInterval(() => res.write(" "), 10);
      res.once("close", () => clearInterval(timer));
    },
    async () => {
      const started = Date.now();
      await assert.rejects(workspaceCommand(command, 100), /deadline/);
      assert.ok(Date.now() - started < 500);
    },
  ));
