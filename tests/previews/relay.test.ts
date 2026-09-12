import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { launchRelay } from "../../infra/previews/launcher.ts";
import type { RelayOutput } from "../../infra/previews/protocol.ts";
import {
  requestPath,
  responseHeaders,
} from "../../packages/previews/src/http-policy.ts";
import { previewRequestOrigin } from "../../apps/api/src/preview-gateway.ts";

test("real private relay streams HTTP/SSE/WebSocket and strips authority without destination input", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      const t = setTimeout(() => res.end("data: last\n\n"), 50);
      res.on("close", () => clearTimeout(t));
    } else {
      let n = 0;
      req.on("data", (c) => (n += c.length));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ headers: req.headers, bytes: n }));
      });
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const ws = new WebSocketServer({ server, perMessageDeflate: false });
  ws.on("connection", (client) =>
    client.on("message", (data, binary) => client.send(data, { binary })),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const old = {
    node: process.env.NODE_ENV,
    fixture: process.env.HARBOR_FIXTURE_MODE,
  };
  process.env.NODE_ENV = "test";
  process.env.HARBOR_FIXTURE_MODE = "private-test";
  const relay = await launchRelay(
    { id: randomUUID(), generation: 1, instanceId: "relay-test", port },
    true,
  );
  try {
    const request = async (path: string, headers: [string, string][] = []) => {
      const id = randomUUID(),
        frames: RelayOutput[] = [];
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error("Relay response timed out")),
          3000,
        );
        const receive = (f: RelayOutput) => {
          if (f.type === "ready" || f.id !== id) return;
          frames.push(f);
          if (f.type === "error") {
            clearTimeout(timeout);
            relay.off("frame", receive);
            reject(Error(f.code));
          }
          if (f.type === "end") {
            clearTimeout(timeout);
            relay.off("frame", receive);
            resolve();
          }
        };
        relay.on("frame", receive);
        relay.send({ type: "request", id, method: "GET", path, headers });
        relay.send({ type: "end", id });
      });
      return frames;
    };
    const frames = await request("/", [
      ["authorization", "Bearer must-not-leave"],
      ["cookie", "__Host-harbor=owner; __Host-harbor-preview=grant; app=ok"],
      ["x-forwarded-host", "control.internal"],
    ]);
    const body = JSON.parse(
      frames
        .filter((f) => f.type === "data")
        .map((f) => Buffer.from(f.data, "base64").toString())
        .join(""),
    );
    assert.equal(body.headers.authorization, undefined);
    assert.equal(body.headers["x-forwarded-host"], undefined);
    assert.equal(body.headers.cookie, "app=ok");
    assert.equal(body.headers.host, "127.0.0.1:" + port);
    const events = await request("/events");
    assert.equal(
      (events.find((f) => f.type === "head") as any).streaming,
      true,
    );
    assert.equal(
      events
        .filter((f) => f.type === "data")
        .map((f) => Buffer.from(f.data, "base64").toString())
        .join(""),
      "data: first\n\ndata: last\n\n",
    );
    const id = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("WebSocket echo timeout")),
        3000,
      );
      const receive = (f: RelayOutput) => {
        if (f.type === "ready" || f.id !== id) return;
        if (f.type === "websocket")
          relay.send({
            type: "message",
            id,
            data: Buffer.from("hello").toString("base64"),
            binary: false,
          });
        if (f.type === "message") {
          assert.equal(Buffer.from(f.data, "base64").toString(), "hello");
          assert.equal(f.binary, false);
          clearTimeout(timeout);
          relay.off("frame", receive);
          relay.send({ type: "close", id });
          resolve();
        }
        if (f.type === "error") {
          clearTimeout(timeout);
          reject(Error(f.code));
        }
      };
      relay.on("frame", receive);
      relay.send({
        type: "websocket",
        id,
        path: "/ws",
        headers: [
          [
            "sec-websocket-extensions",
            "permessage-deflate; client_max_window_bits",
          ],
        ],
      });
    });
  } finally {
    await relay.close();
    for (const s of sockets) s.destroy();
    ws.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (old.node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old.node;
    if (old.fixture === undefined) delete process.env.HARBOR_FIXTURE_MODE;
    else process.env.HARBOR_FIXTURE_MODE = old.fixture;
  }
});
test("preview framing/origin policy denies credential or reserved-path escalation", () => {
  for (const value of [
    "http://127.0.0.1/",
    "//control/",
    "/%2e%2e/__harbor/exchange",
    "/%5f%5fharbor/exchange",
    "/ok\\bad",
  ])
    assert.throws(() => requestPath(value));
  assert.throws(() =>
    responseHeaders(
      [["set-cookie", "__Host-harbor-preview=stolen; Path=/"]],
      "https://preview.test",
    ),
  );
  assert.throws(() =>
    responseHeaders(
      [["set-cookie", "app=1; Domain=preview.test"]],
      "https://preview.test",
    ),
  );
  assert.throws(() =>
    responseHeaders(
      [["location", "https://control.test/"]],
      "https://preview.test",
    ),
  );
  assert.throws(() =>
    responseHeaders(
      [["location", "/__harbor/exchange"]],
      "https://preview.test",
    ),
  );
  assert.throws(() =>
    responseHeaders(
      [
        ["content-length", "1"],
        ["transfer-encoding", "chunked"],
      ],
      "https://preview.test",
    ),
  );
  assert.throws(() =>
    previewRequestOrigin({ headers: {} }, "https://preview.test"),
  );
  assert.throws(() =>
    previewRequestOrigin(
      {
        headers: {
          origin: "https://control.test",
          "sec-fetch-site": "same-origin",
        },
      },
      "https://preview.test",
    ),
  );
  previewRequestOrigin(
    { headers: { "sec-fetch-site": "same-origin" } },
    "https://preview.test",
  );
  previewRequestOrigin(
    {
      headers: {
        "sec-fetch-site": "none",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "sec-fetch-user": "?1",
      },
    },
    "https://preview.test",
  );
});
