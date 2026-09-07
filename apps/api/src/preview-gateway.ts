import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { WebSocketServer, WebSocket } from "ws";
import { transaction } from "../../../packages/storage/src/index.ts";
import {
  requireAuthority,
  lockOwnerIdentity,
} from "../../../packages/policy/src/authority.ts";
import { digest, HarborError } from "../../../packages/policy/src/index.ts";
import {
  configured,
  openingSecrets,
  previewOrigin,
  previewRow,
  viewerGrant,
} from "../../../packages/previews/src/store.ts";
import {
  requestPath,
  methods,
  rawPairs,
  validateHeaders,
  responseHeaders,
  securityHeaders,
  REQUEST_BYTES,
} from "../../../packages/previews/src/http-policy.ts";
import {
  FRAME_BYTES,
  DATA_BYTES,
  bytes,
  type RelayInput,
  type RelayOutput,
} from "../../../infra/previews/protocol.ts";
import type { Config } from "./config.ts";
const cookieName = "__Host-harbor-preview";
function authority(req: IncomingMessage, c: Config) {
  validateHeaders(rawPairs(req.rawHeaders));
  const host = req.headers.host;
  if (typeof host !== "string") throw Error("Preview hostname required");
  const expectedPort =
    c.HARBOR_PREVIEW_HTTPS_PORT === 443
      ? ""
      : ":" + c.HARBOR_PREVIEW_HTTPS_PORT;
  const suffix = "." + c.HARBOR_PREVIEW_DOMAIN + expectedPort;
  if (
    !host.endsWith(suffix) ||
    !/^[a-f0-9]{32}$/.test(host.slice(0, -suffix.length))
  )
    throw Error("Unknown preview hostname");
  const hostname = host.slice(
    0,
    host.length - expectedPort.length || undefined,
  );
  const origin = previewOrigin({ hostname }, c);
  return { hostname, origin };
}
export function previewRequestOrigin(
  req: { headers: IncomingMessage["headers"] },
  origin: string,
) {
  if (req.headers.origin !== undefined) {
    if (req.headers.origin !== origin) throw Error("Preview Origin denied");
    return;
  }
  if (req.headers["sec-fetch-site"] === "same-origin") return;
  if (
    req.headers["sec-fetch-site"] === "none" &&
    req.headers["sec-fetch-mode"] === "navigate" &&
    req.headers["sec-fetch-dest"] === "document" &&
    req.headers["sec-fetch-user"] === "?1"
  )
    return;
  throw Error(
    "Open this preview from Harbor using a browser with Fetch Metadata support",
  );
}
function grantHash(req: IncomingMessage) {
  const raw = req.headers.cookie ?? "";
  if (Buffer.byteLength(raw) > 8192) throw Error("Preview cookie limit");
  const values = raw
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.startsWith(cookieName + "="));
  if (
    values.length !== 1 ||
    !/^__Host-harbor-preview=[A-Za-z0-9_-]{43}$/.test(values[0])
  )
    throw Error("Open this private preview from Harbor");
  return digest(values[0].slice(cookieName.length + 1));
}
async function exchange(
  pool: Pool,
  c: Config,
  req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  origin: string,
) {
  if (
    req.method !== "POST" ||
    req.headers.origin !== c.HARBOR_ORIGIN ||
    !/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(
      req.headers["content-type"] ?? "",
    )
  )
    throw Error("Invalid preview bootstrap");
  let body = Buffer.alloc(0);
  for await (const chunk of req) {
    if (body.length + chunk.length > 1024)
      throw Error("Preview bootstrap size");
    body = Buffer.concat([body, chunk]);
  }
  const form = new URLSearchParams(body.toString("utf8"));
  if (
    [...form.keys()].length !== 1 ||
    !/^[A-Za-z0-9_-]{43}$/.test(form.get("ticket") ?? "")
  )
    throw Error("Invalid preview ticket");
  const result = await transaction(pool, async (db) => {
    await lockOwnerIdentity(db);
    await db.query("SELECT emergency FROM harbor_meta FOR SHARE");
    const initial = (
      await db.query("SELECT * FROM preview_openings WHERE ticket_hash=$1", [
        digest(form.get("ticket")!),
      ])
    ).rows[0];
    if (!initial) throw Error("Preview ticket expired");
    const owner = await requireAuthority(db, initial.actor_hash, c);
    if (owner.kind !== "browser") throw Error("Owner browser required");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('preview-openings',0))",
    );
    await db.query("SELECT id FROM previews WHERE id=$1 FOR SHARE", [
      initial.preview_id,
    ]);
    await db.query("SELECT id FROM preview_openings WHERE id=$1 FOR UPDATE", [
      initial.id,
    ]);
    await requireAuthority(db, initial.actor_hash, c);
    const opening = (
      await db.query(
        "SELECT o.* FROM preview_openings o JOIN previews p ON p.id=o.preview_id WHERE o.id=$1 AND NOT o.revoked AND o.consumed_at IS NULL AND o.expires_at>clock_timestamp() AND o.generation=p.generation AND p.hostname=$2 AND p.state='ready' AND NOT p.retired AND NOT (SELECT emergency FROM harbor_meta)",
        [initial.id, hostname],
      )
    ).rows[0];
    if (!opening) throw Error("Preview ticket consumed or expired");
    const n = (
      await db.query(
        "SELECT count(*) FILTER(WHERE preview_id=$1) AS preview,count(*) FILTER(WHERE actor_hash=$2) AS actor FROM preview_grants WHERE NOT revoked AND expires_at>clock_timestamp()",
        [opening.preview_id, owner.hash],
      )
    ).rows[0];
    if (Number(n.preview) >= 4 || Number(n.actor) >= 8)
      throw new HarborError(
        429,
        "PREVIEW_GRANT_LIMIT",
        "Preview browser access capacity reached; wait for current grants to expire",
      );
    const secrets = openingSecrets(
      owner.csrf,
      opening.id,
      opening.preview_id,
      Number(opening.generation),
    );
    if (
      secrets.ticketHash !== opening.ticket_hash ||
      secrets.grantHash !== opening.grant_hash
    )
      throw Error("Preview ticket identity mismatch");
    await db.query(
      "UPDATE preview_openings SET consumed_at=clock_timestamp() WHERE id=$1",
      [opening.id],
    );
    const row = (
      await db.query(
        "INSERT INTO preview_grants(id,preview_id,generation,actor_hash,hash,expires_at) SELECT $1,$2,$3,$4,$5,LEAST(clock_timestamp()+interval '15 minutes',expires_at,last_seen+($6*interval '1 second')) FROM browser_sessions WHERE hash=$4 RETURNING expires_at",
        [
          opening.id,
          opening.preview_id,
          opening.generation,
          owner.hash,
          secrets.grantHash,
          c.HARBOR_IDLE_SECONDS,
        ],
      )
    ).rows[0];
    return { grant: secrets.grant, expires: new Date(row.expires_at) };
  });
  if (res.destroyed) return;
  const nonce = randomBytes(24).toString("base64");
  res.writeHead(200, {
    ...securityHeaders(origin),
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    "set-cookie": `${cookieName}=${result.grant}; Path=/; Secure; HttpOnly; SameSite=Strict; Expires=${result.expires.toUTCString()}`,
  });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Private preview</title></head><body><a href="/" rel="noreferrer">Continue to preview</a><script nonce="${nonce}">location.replace('/')</script></body></html>`,
  );
}
class BrokerConnection {
  readonly socket: Socket;
  private buffer = Buffer.alloc(0);
  constructor(
    c: Config,
    hostname: string,
    hash: string,
    initial: RelayInput,
    frame: (f: RelayOutput) => void,
    closed: () => void,
  ) {
    this.socket = connect(c.HARBOR_PREVIEW_SOCKET!);
    this.socket.once("connect", () =>
      this.write({ type: "open", hostname, grantHash: hash, request: initial }),
    );
    this.socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const at = this.buffer.indexOf(10);
        if (at < 0) {
          if (this.buffer.length > FRAME_BYTES) this.socket.destroy();
          return;
        }
        if (at > FRAME_BYTES) {
          this.socket.destroy();
          return;
        }
        try {
          const f = JSON.parse(this.buffer.subarray(0, at).toString("utf8"));
          this.buffer = this.buffer.subarray(at + 1);
          frame(f);
        } catch {
          this.socket.destroy();
          return;
        }
      }
    });
    this.socket.on("error", closed);
    this.socket.on("close", closed);
  }
  write(value: unknown) {
    const data = JSON.stringify(value) + "\n";
    if (
      this.socket.destroyed ||
      Buffer.byteLength(data) > FRAME_BYTES ||
      this.socket.writableLength + Buffer.byteLength(data) > 256 * 1024
    )
      throw Error("Private preview backlog");
    this.socket.write(data);
  }
  close() {
    this.socket.destroy();
  }
}
export async function startPreviewGateway(pool: Pool, c: Config) {
  configured(c);
  const clients = new Set<Socket>(),
    streams = new Set<BrokerConnection>();
  let activeRequests = 0;
  const wsServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 65536,
    handleProtocols: () => false,
  });
  const server = http.createServer(
    {
      maxHeaderSize: 16384,
      requestTimeout: 30000,
      headersTimeout: 10000,
      keepAliveTimeout: 5000,
    },
    async (req, res) => {
      if (activeRequests >= 32) {
        res.writeHead(503, {
          connection: "close",
          "cache-control": "no-store",
        });
        res.end("Preview connection capacity reached");
        return;
      }
      activeRequests++;
      res.once("close", () => activeRequests--);
      let broker: BrokerConnection | undefined,
        done = false;
      const fail = () => {
        if (done) return;
        done = true;
        broker?.close();
        if (!res.headersSent) {
          res.writeHead(403, {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          });
          res.end("Preview unavailable. Return to Harbor and open it again.");
        } else res.destroy();
      };
      try {
        const { hostname, origin } = authority(req, c);
        if (req.url === "/__harbor/exchange") {
          await exchange(pool, c, req, res, hostname, origin);
          return;
        }
        if (!methods.has(req.method ?? ""))
          throw Error("Unsupported preview method");
        previewRequestOrigin(req, origin);
        const hash = grantHash(req),
          path = requestPath(req.url ?? "/");
        const length = req.headers["content-length"];
        if (length !== undefined && Number(length) > REQUEST_BYTES)
          throw Error("Request body limit");
        const id = randomUUID();
        let count = 0,
          headed = false;
        const timer = setTimeout(fail, 30000);
        broker = new BrokerConnection(
          c,
          hostname,
          hash,
          {
            type: "request",
            id,
            method: req.method!,
            path,
            headers: rawPairs(req.rawHeaders),
          },
          (frame) => {
            if (done || frame.type === "ready" || frame.id !== id) return;
            if (frame.type === "head") {
              if (headed || frame.status < 200 || frame.status > 599)
                throw Error("Invalid response head");
              headed = true;
              const headers = responseHeaders(frame.headers, origin),
                out: Record<string, string | string[]> = {
                  ...securityHeaders(origin),
                };
              for (const [key, value] of headers) {
                const old = out[key];
                out[key] =
                  old === undefined
                    ? value
                    : Array.isArray(old)
                      ? [...old, value]
                      : [old, value];
              }
              if (frame.streaming) {
                clearTimeout(timer);
                setTimeout(fail, 15 * 60000).unref();
              }
              res.writeHead(frame.status, out);
            } else if (frame.type === "data") {
              if (!headed) throw Error("Response head missing");
              const data = bytes(frame.data);
              if (res.writableLength + data.length > 256 * 1024)
                throw Error("Slow preview viewer");
              res.write(data);
            } else if (frame.type === "end") {
              done = true;
              clearTimeout(timer);
              res.end();
              broker?.close();
            } else if (frame.type === "error") fail();
          },
          fail,
        );
        streams.add(broker);
        res.once("close", () => {
          done = true;
          clearTimeout(timer);
          broker?.close();
          if (broker) streams.delete(broker);
        });
        // Do not queue the body before the broker's opening frame is written.
        req.pause();
        broker.socket.once("connect", () => req.resume());
        req.on("data", (chunk: Buffer) => {
          try {
            count += chunk.length;
            if (count > REQUEST_BYTES) throw Error("Request body limit");
            for (let at = 0; at < chunk.length; at += DATA_BYTES)
              broker!.write({
                type: "body",
                id,
                data: chunk.subarray(at, at + DATA_BYTES).toString("base64"),
              });
          } catch {
            fail();
          }
        });
        req.on("end", () => {
          try {
            broker!.write({ type: "end", id });
          } catch {
            fail();
          }
        });
        req.on("error", fail);
      } catch {
        fail();
      }
    },
  );
  server.maxHeadersCount = 100;
  server.on("connection", (socket) => {
    if (clients.size >= 64) {
      socket.destroy();
      return;
    }
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("checkContinue", (_req, res) => {
    res.writeHead(417);
    res.end();
  });
  server.on("connect", (_req, socket) => socket.destroy());
  server.on("upgrade", (req, socket, head) => {
    let broker: BrokerConnection | undefined,
      ws: WebSocket | undefined,
      ended = false;
    const close = () => {
      if (ended) return;
      ended = true;
      broker?.close();
      if (broker) streams.delete(broker);
      ws?.terminate();
      socket.destroy();
    };
    const timer = setTimeout(close, 5000);
    socket.on("close", () => {
      clearTimeout(timer);
      close();
    });
    socket.on("error", close);
    try {
      const { hostname, origin } = authority(req, c);
      previewRequestOrigin(req, origin);
      if (
        req.method !== "GET" ||
        req.headers["sec-websocket-protocol"] ||
        head.length > 65536
      )
        throw Error("Unsupported WebSocket");
      const hash = grantHash(req),
        id = randomUUID(),
        path = requestPath(req.url ?? "/");
      broker = new BrokerConnection(
        c,
        hostname,
        hash,
        { type: "websocket", id, path, headers: rawPairs(req.rawHeaders) },
        (frame) => {
          if (ended || frame.type === "ready" || frame.id !== id) return;
          if (frame.type === "websocket") {
            if (ws) throw Error("Duplicate upgrade");
            clearTimeout(timer);
            wsServer.handleUpgrade(req, socket, head, (client) => {
              ws = client;
              client.on("message", (data, binary) => {
                try {
                  const b = Buffer.isBuffer(data)
                    ? data
                    : Buffer.concat(
                        Array.isArray(data) ? data : [Buffer.from(data)],
                      );
                  if (b.length > 65536) throw Error();
                  broker!.write({
                    type: "message",
                    id,
                    data: b.toString("base64"),
                    binary,
                  });
                } catch {
                  close();
                }
              });
              client.on("error", close);
              client.on("close", close);
            });
          } else if (frame.type === "message") {
            if (!ws || ws.readyState !== WebSocket.OPEN)
              throw Error("WebSocket not ready");
            const data = bytes(frame.data, 65536);
            if (ws.bufferedAmount + data.length > 256 * 1024)
              throw Error("Slow preview viewer");
            ws.send(data, { binary: frame.binary, compress: false });
          } else if (frame.type === "end" || frame.type === "error") close();
        },
        close,
      );
      streams.add(broker);
    } catch {
      close();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(c.HARBOR_PREVIEW_PORT, c.HARBOR_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return async () => {
    for (const stream of streams) stream.close();
    for (const socket of clients) socket.destroy();
    wsServer.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
}
