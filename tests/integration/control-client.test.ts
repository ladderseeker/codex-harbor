import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { credentialCommand } from "../../packages/policy/src/control-client.ts";
test("credential IPC rejects peer EOF promptly instead of leaving owner request pending", async () => {
  const directory = await mkdtemp(
    path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "harbor-ipc-",
    ),
  );
  const filename = path.join(directory, "control.sock");
  const server = createServer((socket) => {
    socket.resume();
    socket.end();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(filename, resolve);
    });
    await assert.rejects(
      Promise.race([
        credentialCommand(filename, { action: "status" }),
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("deadline exceeded")), 1000),
        ),
      ]),
      (error) =>
        error instanceof Error && error.message !== "deadline exceeded",
    );
  } finally {
    if (server.listening)
      await new Promise<void>((r) => server.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
});
