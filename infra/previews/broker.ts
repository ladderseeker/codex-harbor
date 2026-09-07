import { createServer, type Socket } from "node:net";
import { preparePreviewSocket } from "./socket.ts";
import type { Pool } from "pg";
import { transaction } from "../../packages/storage/src/index.ts";
import { viewerGrant } from "../../packages/previews/src/store.ts";
import type { Config } from "../../apps/api/src/config.ts";
import { FRAME_BYTES, type RelayInput, type RelayOutput } from "./protocol.ts";
import type { PreviewRelay } from "./launcher.ts";
export type ActiveRelay = { generation: number; relay: PreviewRelay };
export type BrokerOpening = {
  type: "open";
  hostname: string;
  grantHash: string;
  request: Extract<RelayInput, { type: "request" | "websocket" }>;
};
/** One logical browser stream per private socket; no client value becomes a host/port. */
export async function startPreviewBroker(
  pool: Pool,
  c: Config,
  lookup: (id: string) => ActiveRelay | undefined,
) {
  const path = c.HARBOR_PREVIEW_SOCKET;
  if (!path) throw Error("Private preview socket required");
  const publish = await preparePreviewSocket(c);
  let validating = 0;
  const sockets = new Set<Socket>(),
    counts = new Map<string, number>();
  const server = createServer((socket) => {
    if (sockets.size >= 32 || validating >= 32) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    let buffer = Buffer.alloc(0),
      busy = false,
      opened = false,
      closed = false,
      previewId: string | undefined,
      requestId: string | undefined,
      relay: PreviewRelay | undefined,
      hostname = "",
      hash = "",
      generation = 0,
      leaseMono = performance.now() + 5000;
    let refresh: NodeJS.Timeout | undefined;
    const deadline = setInterval(() => {
      if (performance.now() >= leaseMono) close();
    }, 50);
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(deadline);
      if (refresh) clearInterval(refresh);
      if (relay) {
        relay.off("frame", frame);
        relay.off("closed", close);
        if (requestId)
          try {
            relay.send({ type: "close", id: requestId });
          } catch {}
      }
      socket.destroy();
      sockets.delete(socket);
      if (previewId) {
        const count = (counts.get(previewId) ?? 1) - 1;
        if (count) counts.set(previewId, count);
        else counts.delete(previewId);
      }
    };
    const wire = (value: RelayInput) => {
      if (closed || performance.now() >= leaseMono || !relay)
        throw Error("Preview authority lease expired");
      const current = lookup(previewId!);
      if (
        !current ||
        current.generation !== generation ||
        current.relay !== relay
      )
        throw Error("Preview generation changed");
      relay.send(value);
    };
    const frame = (value: RelayOutput) => {
      if (value.type === "ready" || value.id !== requestId) return;
      if (closed || performance.now() >= leaseMono) {
        close();
        return;
      }
      const data = JSON.stringify(value) + "\n";
      if (
        Buffer.byteLength(data) > FRAME_BYTES ||
        socket.writableLength + Buffer.byteLength(data) > 256 * 1024
      ) {
        close();
        return;
      }
      socket.write(data);
      if (value.type === "end" || value.type === "error") socket.end();
    };
    const validate = async (initial?: BrokerOpening) => {
      if (busy) return;
      busy = true;
      validating++;
      try {
        await transaction(pool, async (db) => {
          await db.query("SET LOCAL statement_timeout='4s'");
          await db.query("SET LOCAL lock_timeout='4s'");
          const grant = await viewerGrant(db, c, hostname, hash);
          if (closed) throw Error("Preview connection closed");
          if (initial) {
            const current = lookup(grant.preview_id);
            if (
              !current ||
              current.generation !== grant.generation ||
              current.relay.runnerId !== grant.runner_id ||
              current.relay.relayId !== grant.relay_id
            )
              throw Error("Preview runtime unavailable");
            if ((counts.get(grant.preview_id) ?? 0) >= 8)
              throw Error("Preview connection capacity");
            previewId = grant.preview_id;
            generation = grant.generation;
            relay = current.relay;
            requestId = initial.request.id;
            counts.set(previewId!, (counts.get(previewId!) ?? 0) + 1);
            relay.on("frame", frame);
            relay.on("closed", close);
          } else if (
            grant.preview_id !== previewId ||
            grant.generation !== generation
          )
            throw Error("Preview grant changed");
          // A stalled query never renews the independent prior lease after its deadline.
          if (performance.now() >= leaseMono)
            throw Error("Preview lease elapsed");
          leaseMono =
            performance.now() +
            Math.max(0, Math.min(5000, grant.leaseUntil - Date.now()));
          if (initial) {
            wire(initial.request);
            opened = true;
          }
        });
      } catch {
        close();
      } finally {
        busy = false;
        validating--;
      }
      if (!closed && initial) {
        refresh = setInterval(() => void validate(), 1000);
        drain();
      }
    };
    const drain = () => {
      while (!closed) {
        if (busy && !opened) return;
        const at = buffer.indexOf(10);
        if (at < 0) {
          if (buffer.length > FRAME_BYTES) close();
          return;
        }
        if (at > FRAME_BYTES) {
          close();
          return;
        }
        const line = buffer.subarray(0, at);
        buffer = buffer.subarray(at + 1);
        try {
          const value = JSON.parse(line.toString("utf8"));
          if (!opened) {
            if (
              value.type !== "open" ||
              typeof value.hostname !== "string" ||
              value.hostname.length > 253 ||
              typeof value.grantHash !== "string" ||
              !/^[a-f0-9]{64}$/.test(value.grantHash) ||
              !["request", "websocket"].includes(value.request?.type) ||
              !/^[a-f0-9-]{36}$/.test(value.request?.id)
            )
              throw Error("Invalid preview opening");
            hostname = value.hostname;
            hash = value.grantHash;
            void validate(value);
            return;
          }
          if (
            value.id !== requestId ||
            !["body", "end", "message", "close"].includes(value.type)
          )
            throw Error("Invalid preview stream");
          wire(value);
        } catch {
          close();
          return;
        }
      }
    };
    socket.on("data", (chunk: Buffer) => {
      if (buffer.length + chunk.length > 256 * 1024) {
        close();
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      drain();
    });
    socket.on("end", close);
    socket.on("error", close);
    socket.on("close", close);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await publish();
  return async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
}
