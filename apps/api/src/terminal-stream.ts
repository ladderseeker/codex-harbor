import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  authenticateBearer,
  authenticateBrowser,
  requireAuthority,
} from "../../../packages/policy/src/authority.ts";
import {
  digest,
  equalSecret,
  HarborError,
  requireOrigin,
} from "../../../packages/policy/src/index.ts";
import { transaction } from "../../../packages/storage/src/index.ts";
import {
  terminalInput,
  terminalResize,
  terminalHeartbeat,
  terminalView,
} from "../../../packages/terminals/src/contracts.ts";
import {
  lockedTerminal,
  terminalRow,
  terminalGrant,
  outputSnapshot,
  acceptInput,
  resize,
  heartbeat,
} from "../../../packages/terminals/src/store.ts";
import type { TerminalApi } from "./terminals.ts";
type Viewer = {
  socket: WebSocket;
  actor: string;
  kind: "browser" | "token";
  id: string;
  generation: number;
  cursor: number;
  hello: boolean;
  polling: boolean;
  lastMessage: number;
  controllerId?: string;
  lastState: string;
  queue: Buffer[];
  queuedBytes: number;
  processing: boolean;
  closed: boolean;
  lastWatch: number;
};
export function terminalStreams(app: FastifyInstance, h: TerminalApi) {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 8192,
    clientTracking: false,
    allowSynchronousEvents: false,
  });
  const viewers = new Set<Viewer>();
  let pending = 0;
  const send = (v: Viewer, p: any) => {
    if (v.closed) return;
    if (v.socket.bufferedAmount > 262144) {
      v.socket.terminate();
      return;
    }
    v.socket.send(JSON.stringify(p));
  };
  const poll = async (v: Viewer) => {
    if (v.closed || !v.hello || v.polling) return;
    v.polling = true;
    try {
      const result = await transaction(h.pool, async (db) => {
        const t = await lockedTerminal(db, v.id, v.actor, h.c, "terminal:read");
        if (Number(t.generation) !== v.generation)
          throw Error("Terminal generation changed");
        return {
          terminal: terminalView(t),
          output: await outputSnapshot(db, t, v.cursor),
        };
      });
      const state = JSON.stringify(result.terminal);
      if (state !== v.lastState) {
        send(v, { version: 1, type: "state", terminal: result.terminal });
        v.lastState = state;
      }
      if (result.output.chunks.length || result.output.gap) {
        send(v, { version: 1, type: "output", ...result.output });
        v.cursor = result.output.cursor;
      }
    } catch (error) {
      const code =
        error instanceof HarborError
          ? error.code
          : typeof (error as any)?.code === "string" &&
              /^[A-Z0-9]{5}$/.test((error as any).code)
            ? (error as any).code
            : "STREAM_FAILURE";
      // Only a bounded fixed error code; never terminal bytes, SQL or credentials.
      console.error("Terminal stream unavailable (" + code + ")");
      v.socket.close(1008, "Terminal access unavailable");
    } finally {
      v.polling = false;
    }
  };
  const processFrame = async (v: Viewer, raw: Buffer) => {
    let b: any;
    try {
      b = JSON.parse(raw.toString("utf8"));
    } catch {
      throw Error("Invalid terminal message");
    }
    if (!v.hello) {
      const hello = z
        .object({
          version: z.literal(1),
          type: z.literal("hello"),
          generation: z.number().int().positive(),
          cursor: z.number().int().nonnegative(),
          csrf: z.string().max(256).optional(),
        })
        .strict()
        .parse(b);
      const authority = await requireAuthority(h.pool, v.actor, h.c);
      if (
        v.kind === "browser" &&
        (!hello.csrf || !equalSecret(hello.csrf, authority.csrf))
      )
        throw Error("CSRF required");
      if (hello.generation !== v.generation)
        throw Error("Terminal generation changed");
      v.cursor = hello.cursor;
      v.hello = true;
      v.lastMessage = Date.now();
      await poll(v);
      return;
    }
    if (b.type === "watch") {
      z.object({
        version: z.literal(1),
        type: z.literal("watch"),
        generation: z.literal(v.generation),
      })
        .strict()
        .parse(b);
      if (Date.now() - v.lastWatch < 5000)
        throw new HarborError(
          429,
          "WATCH_RATE_LIMIT",
          "Viewer heartbeat too frequent",
        );
      v.lastWatch = Date.now();
      v.lastMessage = Date.now();
      return;
    }
    if (v.kind === "browser") await authenticateBrowser(h.pool, h.c, v.actor);
    const type = b.type;
    delete b.type;
    const payload =
      type === "input"
        ? terminalInput.parse(b)
        : type === "resize"
          ? terminalResize.parse(b)
          : type === "heartbeat"
            ? terminalHeartbeat.parse(b)
            : null;
    if (!payload) throw Error("Unsupported terminal message");
    const response = await transaction(h.pool, async (db) => {
      const t = await lockedTerminal(
        db,
        v.id,
        v.actor,
        h.c,
        "terminal:control",
      );
      if (type === "input")
        return { input: await acceptInput(db, t, v.actor, payload) };
      if (type === "resize") return resize(db, t, v.actor, payload);
      return heartbeat(db, t, v.actor, payload);
    });
    v.controllerId = payload.controllerId;
    v.lastMessage = Date.now();
    send(v, {
      version: 1,
      type: "ack",
      action: type,
      generation: v.generation,
      epoch: payload.epoch,
      ...("sequence" in payload ? { sequence: payload.sequence } : {}),
      ...response,
    });
  };
  const pump = async (v: Viewer) => {
    if (v.processing) return;
    v.processing = true;
    try {
      while (v.queue.length && !v.closed) {
        const frame = v.queue.shift()!;
        v.queuedBytes -= frame.length;
        try {
          await processFrame(v, frame);
        } catch (error) {
          if (error instanceof HarborError && v.hello) {
            send(v, {
              version: 1,
              type: "error",
              code: error.code,
              message: error.message,
            });
            if (error.statusCode === 401 || error.statusCode === 403)
              v.socket.close(1008, "Terminal access revoked");
          } else {
            v.socket.close(1008, "Invalid terminal control");
            break;
          }
        }
      }
    } finally {
      v.processing = false;
    }
  };
  app.server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => {});
    const match = /^\/api\/v1\/terminals\/([a-f0-9-]{36})\/stream$/.exec(
      request.url ?? "",
    );
    if (!match || pending + viewers.size >= 16 || head.length > 8192) {
      socket.destroy();
      return;
    }
    pending++;
    const deadline = setTimeout(() => socket.destroy(), 10000);
    void (async () => {
      try {
        if (request.headers["sec-websocket-protocol"])
          throw Error("Subprotocol credentials are not accepted");
        let authority;
        if (request.headers.authorization) {
          if (request.headers.cookie)
            throw Error("Bearer terminal streams must be cookie-free");
          if (request.headers.origin !== undefined)
            requireOrigin(request.headers.origin, h.c.HARBOR_ORIGIN);
          authority = await authenticateBearer(
            h.pool,
            h.c,
            request.headers.authorization,
          );
        } else {
          requireOrigin(request.headers.origin, h.c.HARBOR_ORIGIN);
          const cookie = app.parseCookie(request.headers.cookie ?? "")[
            "__Host-harbor"
          ];
          if (!cookie) throw Error("Authentication required");
          authority = await authenticateBrowser(h.pool, h.c, digest(cookie));
        }
        const t = await transaction(h.pool, async (db) => {
          const t = await terminalRow(db, match[1]!);
          await terminalGrant(db, t, authority.hash, h.c, "terminal:read");
          return t;
        });
        if (
          [...viewers].filter((v) => v.actor === authority.hash).length >= 8 ||
          [...viewers].filter((v) => v.id === t.id).length >= 4 ||
          viewers.size >= 16 ||
          socket.destroyed
        )
          throw Error("Terminal viewer limit reached");
        clearTimeout(deadline);
        wss.handleUpgrade(request, socket, head, (ws) => {
          const v: Viewer = {
            socket: ws,
            actor: authority.hash,
            kind: authority.kind,
            id: t.id,
            generation: Number(t.generation),
            cursor: 0,
            hello: false,
            polling: false,
            lastMessage: Date.now(),
            lastState: "",
            queue: [],
            queuedBytes: 0,
            processing: false,
            closed: false,
            lastWatch: 0,
          };
          viewers.add(v);
          ws.on("error", () => {});
          ws.on("message", (data, binary) => {
            if (binary) {
              ws.close(1008, "JSON frames required");
              return;
            }
            const bytes = Buffer.isBuffer(data)
              ? data
              : Buffer.from(data as ArrayBuffer);
            if (v.queue.length >= 8 || v.queuedBytes + bytes.length > 32768) {
              ws.close(1008, "Terminal frame backlog exceeded");
              return;
            }
            v.queue.push(bytes);
            v.queuedBytes += bytes.length;
            void pump(v);
          });
          ws.on("close", () => {
            v.closed = true;
            viewers.delete(v);
            v.queue.length = 0;
            if (v.controllerId)
              void h.pool
                .query(
                  "UPDATE terminals SET controller_until=NULL WHERE id=$1 AND controller_actor=$2 AND controller_id=$3",
                  [v.id, v.actor, v.controllerId],
                )
                .catch(() => {});
          });
        });
      } catch {
        if (!socket.destroyed) {
          socket.write(
            "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
          );
          socket.destroy();
        }
      } finally {
        clearTimeout(deadline);
        pending--;
      }
    })();
  });
  const timer = setInterval(() => {
    for (const v of viewers) {
      if (
        (!v.hello && Date.now() - v.lastMessage > 5000) ||
        Date.now() - v.lastMessage > 60000
      ) {
        v.socket.close(1008, "Terminal viewer idle");
        continue;
      }
      void poll(v);
    }
  }, 250);
  app.addHook("onResponse", async (req) => {
    if (req.method !== "GET" && req.url.includes("/security/"))
      for (const v of viewers) void poll(v);
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    for (const v of viewers) v.socket.terminate();
    wss.close();
  });
}
