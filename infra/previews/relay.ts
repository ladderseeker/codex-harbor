/** Fixed non-root relay entry point. Only its trusted launcher supplies PORT. */
import http from "node:http";
import { WebSocket } from "ws";
import {
  methods,
  requestPath,
  requestHeaders,
  rawPairs,
  validateHeaders,
  REQUEST_BYTES,
  RESPONSE_BYTES,
} from "../../packages/previews/src/http-policy.ts";
import {
  bytes,
  FRAME_BYTES,
  DATA_BYTES,
  StreamBudget,
  type RelayInput,
  type RelayOutput,
} from "./protocol.ts";
const port = Number(process.env.HARBOR_RELAY_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Fixed relay port required");
type Connection = {
  req?: http.ClientRequest;
  response?: http.IncomingMessage;
  ws?: WebSocket;
  received: number;
  sent: number;
  streaming: boolean;
  ended: boolean;
  timer: NodeJS.Timeout;
  budget: StreamBudget;
};
const connections = new Map<string, Connection>();
let closed = false,
  buffer = Buffer.alloc(0);
function output(frame: RelayOutput) {
  if (closed) return;
  const data = JSON.stringify(frame) + "\n";
  if (
    Buffer.byteLength(data) > FRAME_BYTES ||
    process.stdout.writableLength + Buffer.byteLength(data) > 256 * 1024
  ) {
    shutdown();
    return;
  }
  process.stdout.write(data);
}
function remove(id: string, code?: string) {
  const c = connections.get(id);
  if (!c) return;
  connections.delete(id);
  clearTimeout(c.timer);
  c.req?.destroy();
  c.response?.destroy();
  c.ws?.terminate();
  output(code ? { type: "error", id, code } : { type: "end", id });
}
function shutdown() {
  if (closed) return;
  closed = true;
  for (const id of connections.keys()) remove(id);
  process.stdin.destroy();
  process.stdout.end();
  setTimeout(() => process.exit(1), 100).unref();
}
function open(id: string) {
  if (connections.has(id) || connections.size >= 8)
    throw Error("Relay connection capacity");
  const c: Connection = {
    received: 0,
    sent: 0,
    streaming: false,
    ended: false,
    timer: setTimeout(() => remove(id, "TIME_LIMIT"), 30000),
    budget: new StreamBudget(),
  };
  connections.set(id, c);
  return c;
}
function stream(id: string, c: Connection) {
  c.streaming = true;
  clearTimeout(c.timer);
  c.timer = setTimeout(() => remove(id, "TIME_LIMIT"), 15 * 60000);
}
function dispatch(f: RelayInput) {
  if (
    !f ||
    typeof f !== "object" ||
    typeof f.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(f.id)
  )
    throw Error("Invalid relay identity");
  if (f.type === "close") {
    remove(f.id);
    return;
  }
  if (f.type === "request") {
    if (!methods.has(f.method)) throw Error("Unsupported method");
    const path = requestPath(f.path),
      pairs = requestHeaders(f.headers, port);
    const length = pairs.find(([k]) => k === "content-length")?.[1];
    if (length !== undefined && Number(length) > REQUEST_BYTES)
      throw Error("Request length limit");
    const c = open(f.id),
      request = http.request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: f.method,
          headers: pairs.flat(),
          agent: false,
          maxHeaderSize: 16384,
        },
        (res) => {
          if (!connections.has(f.id)) {
            res.destroy();
            return;
          }
          c.response = res;
          try {
            const headers = validateHeaders(rawPairs(res.rawHeaders));
            const type = headers.find(([k]) => k === "content-type")?.[1] ?? "";
            if (/^text\/event-stream(?:;|$)/i.test(type)) stream(f.id, c);
            const declared = headers.find(([k]) => k === "content-length")?.[1];
            if (declared !== undefined && Number(declared) > RESPONSE_BYTES)
              throw Error("Response length limit");
            output({
              type: "head",
              id: f.id,
              status: res.statusCode ?? 502,
              headers,
              streaming: c.streaming,
            });
          } catch {
            remove(f.id, "UPSTREAM_HEADERS");
            return;
          }
          res.on("data", (chunk: Buffer) => {
            if (!connections.has(f.id)) return;
            try {
              if (c.streaming) c.budget.take(chunk.length);
              else if ((c.sent += chunk.length) > RESPONSE_BYTES)
                throw Error("Response limit");
              for (let offset = 0; offset < chunk.length; offset += DATA_BYTES)
                output({
                  type: "data",
                  id: f.id,
                  data: chunk
                    .subarray(offset, offset + DATA_BYTES)
                    .toString("base64"),
                });
            } catch {
              remove(f.id, "RESPONSE_LIMIT");
            }
          });
          res.on("end", () => remove(f.id));
          res.on("error", () => remove(f.id, "UPSTREAM_CLOSED"));
        },
      );
    c.req = request;
    request.on("error", () => remove(f.id, "UPSTREAM_UNAVAILABLE"));
    request.on("upgrade", (_res, socket) => {
      socket.destroy();
      remove(f.id, "UNSUPPORTED_UPGRADE");
    });
    request.on("information", (info) => {
      if (info.statusCode !== 100) remove(f.id, "UNSUPPORTED_INFORMATION");
    });
    return;
  }
  if (f.type === "websocket") {
    const path = requestPath(f.path),
      headers = requestHeaders(f.headers, port);
    if (f.headers.some(([k]) => /^sec-websocket-protocol$/i.test(k)))
      throw Error("Unsupported WebSocket extension");
    const c = open(f.id);
    stream(f.id, c);
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
      headers: Object.fromEntries(headers),
      perMessageDeflate: false,
      maxPayload: 65536,
      handshakeTimeout: 5000,
      followRedirects: false,
    });
    c.ws = ws;
    ws.on("open", () => output({ type: "websocket", id: f.id }));
    ws.on("message", (data, binary) => {
      try {
        const b = Buffer.isBuffer(data)
          ? data
          : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]);
        c.budget.take(b.length);
        if (b.length > 65536) throw Error();
        output({
          type: "message",
          id: f.id,
          data: b.toString("base64"),
          binary,
        });
      } catch {
        remove(f.id, "WEBSOCKET_LIMIT");
      }
    });
    ws.on("error", () => remove(f.id, "UPSTREAM_UNAVAILABLE"));
    ws.on("close", () => remove(f.id));
    return;
  }
  const c = connections.get(f.id);
  if (!c) throw Error("Unknown relay connection");
  if (f.type === "body") {
    if (!c.req || c.ended) throw Error("Unexpected request body");
    const data = bytes(f.data);
    c.received += data.length;
    if (
      c.received > REQUEST_BYTES ||
      c.req.writableLength + data.length > 256 * 1024
    )
      throw Error("Request buffer limit");
    c.req.write(data);
    return;
  }
  if (f.type === "end") {
    if (!c.req || c.ended) throw Error("Unexpected request completion");
    const declared = c.req.getHeader("content-length");
    if (declared !== undefined && Number(declared) !== c.received)
      throw Error("Request length mismatch");
    c.ended = true;
    c.req.end();
    return;
  }
  if (f.type === "message") {
    if (
      !c.ws ||
      c.ws.readyState !== WebSocket.OPEN ||
      typeof f.binary !== "boolean"
    )
      throw Error("WebSocket is not ready");
    const data = bytes(f.data, 65536);
    c.budget.take(data.length);
    if (c.ws.bufferedAmount + data.length > 256 * 1024)
      throw Error("WebSocket backlog");
    c.ws.send(data, { binary: f.binary, compress: false });
    return;
  }
  throw Error("Unknown relay command");
}
process.stdin.on("data", (chunk: Buffer) => {
  if (closed) return;
  buffer = Buffer.concat([buffer, chunk]);
  while (!closed) {
    const at = buffer.indexOf(10);
    if (at < 0) {
      if (buffer.length > FRAME_BYTES) shutdown();
      break;
    }
    if (at > FRAME_BYTES) {
      shutdown();
      break;
    }
    const line = buffer.subarray(0, at);
    buffer = buffer.subarray(at + 1);
    let frame: RelayInput | undefined;
    try {
      frame = JSON.parse(line.toString("utf8"));
      dispatch(frame!);
    } catch {
      if (frame && connections.has(frame.id))
        remove(frame.id, "PROTOCOL_DENIED");
      else shutdown();
    }
  }
});
process.stdin.on("end", shutdown);
process.stdin.on("error", shutdown);
process.stdout.on("error", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
output({ type: "ready" });
