import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { transaction } from "../../../packages/storage/src/index.ts";
import { requireAuthority } from "../../../packages/policy/src/authority.ts";
import { digest, HarborError } from "../../../packages/policy/src/index.ts";
import { selectedWorkspace } from "../../../packages/workspaces/src/service.ts";
import {
  rawPairs,
  requestPath,
  requestHeaders,
  responseHeaders,
  securityHeaders,
  methods,
  REQUEST_BYTES,
  RESPONSE_BYTES,
} from "../../../packages/previews/src/http-policy.ts";
import { previewRequestOrigin } from "./preview-gateway.ts";
import type { TerminalApi } from "./terminals.ts";

const cookieName = "__Host-harbor-personal-preview";
type Access = {
  actor: string;
  workspace: string;
  port: number;
  origin: string;
  expires: number;
};
type Opening = Access & { ticket: string };

/** Attached owner processes, deliberately separate from the managed preview launcher. */
export async function personalPreviewRoutes(
  app: FastifyInstance,
  h: TerminalApi,
) {
  const { c, pool } = h;
  const openings = new Map<string, Opening>();
  const grants = new Map<string, Access>();
  const prune = () => {
    for (const [key, value] of openings)
      if (value.expires <= Date.now()) openings.delete(key);
    for (const [key, value] of grants)
      if (value.expires <= Date.now()) grants.delete(key);
  };
  async function authorize(access: Access) {
    if (access.expires <= Date.now()) throw Error("Preview access expired");
    await transaction(pool, async (db) => {
      const owner = await requireAuthority(db, access.actor, c);
      if (owner.kind !== "browser") throw Error("Owner browser required");
      const workspace = await selectedWorkspace(db, access.workspace);
      if (
        workspace.state !== "ready" ||
        workspace.project_archived ||
        (await db.query("SELECT emergency FROM harbor_meta")).rows[0].emergency
      )
        throw Error("Preview workspace unavailable");
    });
  }
  app.post("/api/v1/personal-preview-openings", async (req) => {
    const body = z
      .object({ workspaceId: z.uuid(), port: z.number().int() })
      .strict()
      .parse(req.body);
    const entry = c.personalPreviews.find((entry) => entry.port === body.port);
    if (!entry)
      throw new HarborError(
        409,
        "PREVIEW_UNAVAILABLE",
        "This development port is not configured for private preview",
      );
    return h.command(req, async (db) => {
      const owner = await requireAuthority(db, h.actor(req), c);
      if (owner.kind !== "browser")
        throw new HarborError(
          403,
          "BROWSER_REQUIRED",
          "Owner browser required",
        );
      const w = await selectedWorkspace(db, body.workspaceId);
      if (
        w.state !== "ready" ||
        w.project_archived ||
        (await db.query("SELECT emergency FROM harbor_meta")).rows[0].emergency
      )
        throw new HarborError(
          409,
          "WORKSPACE_UNAVAILABLE",
          "Workspace unavailable",
        );
      prune();
      if (openings.size >= 32 || grants.size >= 32)
        throw new HarborError(
          429,
          "PREVIEW_CAPACITY",
          "Close expired preview access before opening more",
        );
      const id = randomUUID();
      openings.set(id, {
        actor: owner.hash,
        workspace: w.id,
        ...entry,
        ticket: randomBytes(32).toString("base64url"),
        expires: Date.now() + 30000,
      });
      return {
        bootstrapPath: "/api/v1/personal-preview-openings/" + id,
        expiresIn: 30,
      };
    });
  });
  app.get<{ Params: { id: string } }>(
    "/api/v1/personal-preview-openings/:id",
    async (req, reply) => {
      const opening = openings.get(req.params.id);
      if (!opening || opening.actor !== h.actor(req))
        throw new HarborError(
          410,
          "OPENING_EXPIRED",
          "Return to Harbor and open preview again",
        );
      await authorize(opening);
      const nonce = randomBytes(24).toString("base64");
      reply.header(
        "content-security-policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${opening.origin}; base-uri 'none'; frame-ancestors 'none'`,
      );
      reply.header("cross-origin-opener-policy", "same-origin");
      reply.header("referrer-policy", "origin");
      return reply
        .type("text/html")
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><title>Open private development preview</title></head><body><form method="post" action="${opening.origin}/__harbor/exchange"><input type="hidden" name="ticket" value="${opening.ticket}"><button>Open private preview</button></form><script nonce="${nonce}">document.forms[0].submit()</script></body></html>`,
        );
    },
  );
  if (!c.personalPreviews.length) return;
  const sockets = new Set<Socket>();
  const viewers = new Set<WebSocket>();
  const selectedProtocols = new WeakMap<http.IncomingMessage, string>();
  const wsServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 65536,
    handleProtocols: (_protocols, req) => selectedProtocols.get(req) || false,
  });
  function entryFor(req: http.IncomingMessage) {
    const entry = c.personalPreviews.find(
      (entry) => new URL(entry.origin).host === req.headers.host,
    );
    if (!entry) throw Error("Unknown preview host");
    return entry;
  }
  async function viewer(req: http.IncomingMessage) {
    const entry = entryFor(req);
    previewRequestOrigin(req, entry.origin);
    const cookies = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.startsWith(cookieName + "="));
    if (
      cookies.length !== 1 ||
      !new RegExp(`^${cookieName}=[A-Za-z0-9_-]{43}$`).test(cookies[0])
    )
      throw Error("Open preview from Harbor");
    const access = grants.get(digest(cookies[0].slice(cookieName.length + 1)));
    if (!access || access.origin !== entry.origin || access.port !== entry.port)
      throw Error("Preview grant unavailable");
    await authorize(access);
    return access;
  }
  const server = http.createServer(
    { maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 10000 },
    async (req, res) => {
      let upstream: http.ClientRequest | undefined;
      const fail = () => {
        upstream?.destroy();
        if (res.headersSent) res.destroy();
        else {
          res.writeHead(403, {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          });
          res.end(
            "Preview unavailable. Start the configured localhost development server, then open it again from Harbor.",
          );
        }
      };
      try {
        const entry = entryFor(req);
        if (req.url === "/__harbor/exchange") {
          if (
            req.method !== "POST" ||
            req.headers.origin !== c.HARBOR_ORIGIN ||
            !/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(
              req.headers["content-type"] ?? "",
            )
          )
            throw Error("Invalid exchange");
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 1024) throw Error("Exchange bound");
          }
          const form = new URLSearchParams(body);
          if ([...form.keys()].length !== 1) throw Error("Invalid exchange");
          const match = [...openings].find(
            ([, value]) =>
              value.ticket === form.get("ticket") &&
              value.origin === entry.origin,
          );
          if (!match) throw Error("Ticket unavailable");
          // Consume before awaiting authority, so concurrent exchanges cannot reuse it.
          openings.delete(match[0]);
          await authorize(match[1]);
          prune();
          if (grants.size >= 32) throw Error("Viewer capacity");
          const token = randomBytes(32).toString("base64url");
          grants.set(digest(token), {
            ...match[1],
            expires: Date.now() + 15 * 60000,
          });
          const nonce = randomBytes(24).toString("base64");
          res.writeHead(200, {
            ...securityHeaders(entry.origin),
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
            "set-cookie": `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=900`,
          });
          res.end(
            `<!doctype html><html><body><a href="/">Continue to preview</a><script nonce="${nonce}">location.replace('/')</script></body></html>`,
          );
          return;
        }
        const access = await viewer(req);
        if (!methods.has(req.method ?? "")) throw Error("Unsupported method");
        const headers = requestHeaders(rawPairs(req.rawHeaders), access.port);
        if (Number(req.headers["content-length"] ?? 0) > REQUEST_BYTES)
          throw Error("Request bound");
        upstream = http.request(
          {
            hostname: "127.0.0.1",
            port: access.port,
            path: requestPath(req.url ?? "/"),
            method: req.method,
            headers: headers.flat(),
            agent: false,
          },
          (response) => {
            try {
              const out: Record<string, string | string[]> = {
                ...securityHeaders(access.origin),
              };
              for (const [key, value] of responseHeaders(
                rawPairs(response.rawHeaders),
                access.origin,
              )) {
                const old = out[key];
                out[key] =
                  old === undefined
                    ? value
                    : Array.isArray(old)
                      ? [...old, value]
                      : [old, value];
              }
              res.writeHead(response.statusCode ?? 502, out);
              let bytes = 0;
              response.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > RESPONSE_BYTES) {
                  response.destroy();
                  fail();
                } else if (!res.write(chunk)) response.pause();
              });
              res.on("drain", () => response.resume());
              response.on("end", () => res.end());
              response.on("error", fail);
            } catch {
              response.destroy();
              fail();
            }
          },
        );
        const timer = setInterval(() => {
          void authorize(access).catch(fail);
        }, 5000);
        timer.unref();
        const deadline = setTimeout(
          fail,
          Math.min(15 * 60000, access.expires - Date.now()),
        );
        deadline.unref();
        res.once("close", () => {
          clearInterval(timer);
          clearTimeout(deadline);
          upstream?.destroy();
        });
        upstream.on("error", fail);
        upstream.setTimeout(30000, fail);
        let bytes = 0;
        req.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > REQUEST_BYTES) fail();
          else if (!upstream?.write(chunk)) req.pause();
        });
        upstream.on("drain", () => req.resume());
        req.on("end", () => upstream?.end());
        req.on("error", fail);
      } catch {
        fail();
      }
    },
  );
  server.maxHeadersCount = 100;
  server.on("connection", (socket) => {
    if (sockets.size >= 64) socket.destroy();
    else {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    }
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connect", (_req, socket) => socket.destroy());
  server.on("checkContinue", (_req, res) => {
    res.writeHead(417);
    res.end();
  });
  server.on("upgrade", async (req, socket, head) => {
    let upstream: WebSocket | undefined, client: WebSocket | undefined;
    let timer: NodeJS.Timeout | undefined;
    const close = () => {
      if (timer) clearInterval(timer);
      upstream?.terminate();
      client?.terminate();
      socket.destroy();
    };
    socket.on("error", close);
    socket.on("close", close);
    const openingDeadline = setTimeout(close, 5000);
    openingDeadline.unref();
    try {
      const access = await viewer(req);
      if (req.method !== "GET" || head.length > 65536)
        throw Error("Unsupported websocket");
      const offered = req.headers["sec-websocket-protocol"];
      const protocols = offered ? offered.split(",").map((p) => p.trim()) : [];
      if (
        protocols.length > 8 ||
        protocols.some((p) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(p)) ||
        new Set(protocols).size !== protocols.length
      )
        throw Error("Invalid websocket subprotocols");
      const headers = Object.fromEntries(
        requestHeaders(rawPairs(req.rawHeaders), access.port),
      );
      upstream = new WebSocket(
        `ws://127.0.0.1:${access.port}${requestPath(req.url ?? "/")}`,
        protocols,
        {
          headers,
          perMessageDeflate: false,
          maxPayload: 65536,
          followRedirects: false,
        },
      );
      upstream.on("error", close);
      upstream.on("close", close);
      upstream.on("open", () => {
        clearTimeout(openingDeadline);
        selectedProtocols.set(req, upstream!.protocol);
        wsServer.handleUpgrade(req, socket, head, (ws) => {
          client = ws;
          viewers.add(ws);
          ws.on("close", () => {
            viewers.delete(ws);
            close();
          });
          ws.on("error", close);
          ws.on("message", (data, binary) => {
            if (upstream!.bufferedAmount > 256 * 1024) close();
            else upstream!.send(data, { binary });
          });
          upstream!.on("message", (data, binary) => {
            if (ws.bufferedAmount > 256 * 1024) close();
            else ws.send(data, { binary });
          });
          timer = setInterval(() => {
            void authorize(access).catch(close);
          }, 5000);
          timer.unref();
        });
      });
    } catch {
      clearTimeout(openingDeadline);
      close();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(c.HARBOR_PERSONAL_PREVIEW_PORT, "127.0.0.1", resolve);
  });
  app.addHook("onClose", async () => {
    openings.clear();
    grants.clear();
    for (const ws of viewers) ws.terminate();
    for (const socket of sockets) socket.destroy();
    wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
}
