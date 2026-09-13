/** Controlled transport faults only; canonical E2E uses actual PostgreSQL. */
import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import {
  acknowledgementPool,
  releaseAcknowledgementGate,
} from "./acknowledgement-db.ts";

async function faultServer(connected: boolean) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    if (connected)
      socket.once("data", () => {
        // Minimal PostgreSQL authentication/ready handshake; subsequent ROLLBACK
        // is intentionally never answered. No real database or secret is used.
        socket.write(
          Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0, 90, 0, 0, 0, 5, 73]),
        );
      });
    else socket.resume(); // Consume startup bytes so the peer's close is observed.
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return {
    sockets,
    url: `postgres://owned:synthetic@127.0.0.1:${port}/owned`,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
test(
  "stalled connection acquisition closes the owned socket without a late checkout",
  { timeout: 5000 },
  async () => {
    const server = await faultServer(false),
      pool = acknowledgementPool(server.url, 200);
    try {
      const start = Date.now();
      await assert.rejects(pool.connect(), /timeout/);
      assert.ok(Date.now() - start < 2000);
      await pool.end();
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(server.sockets.size, 0);
      assert.equal(pool.totalCount, 0);
    } finally {
      await pool.end().catch(() => {});
      await server.close();
    }
  },
);
test(
  "lost ROLLBACK reply is bounded and destroys the advisory-gate connection",
  { timeout: 5000 },
  async () => {
    const server = await faultServer(true),
      pool = acknowledgementPool(server.url, 200);
    try {
      const gate = await pool.connect(),
        errors: string[] = [];
      const start = Date.now();
      await releaseAcknowledgementGate(gate, false, errors);
      assert.deepEqual(errors, ["GATE_RELEASE_FAILED"]);
      assert.ok(Date.now() - start < 2000);
      await pool.end();
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(server.sockets.size, 0);
      assert.equal(pool.totalCount, 0);
    } finally {
      await pool.end().catch(() => {});
      await server.close();
    }
  },
);
