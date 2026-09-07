import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { managedStorageCall } from "../../infra/storage/client.ts";
for (const mode of ["truncated", "drip"] as const)
  test(`managed project response ${mode} settles within its total bound`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "harbor-storage-response-"));
    const previous = process.env.HARBOR_STORAGE_SOCKET;
    process.env.HARBOR_STORAGE_SOCKET = join(dir, "socket");
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": "8192",
      });
      res.write("{");
      if (mode === "truncated") setTimeout(() => res.destroy(), 10);
      else {
        const timer = setInterval(() => res.write(" "), 10);
        res.on("close", () => clearInterval(timer));
      }
    });
    try {
      await new Promise<void>((resolve) =>
        server.listen(process.env.HARBOR_STORAGE_SOCKET!, resolve),
      );
      const started = Date.now();
      await assert.rejects(
        managedStorageCall("validate", "test-root", "test/workspace", 100),
        /aborted|incomplete|deadline/,
      );
      assert.ok(
        Date.now() - started < 1000,
        "IPC must settle after EOF or total deadline",
      );
    } finally {
      if (previous === undefined) delete process.env.HARBOR_STORAGE_SOCKET;
      else process.env.HARBOR_STORAGE_SOCKET = previous;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
