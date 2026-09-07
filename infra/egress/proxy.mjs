import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { Transform } from "node:stream";
import { LIMITS, PROFILE, gatewayRequest, validateAnswers } from "./policy.mjs";

/** Trusted model gateway, never a generic forward proxy. Transport seams exist only for tests. */
export function createProxy({
  lookup = dns.lookup,
  request = https.request,
  limits = LIMITS,
} = {}) {
  const clients = new Set(),
    admitted = new WeakSet(),
    work = new Set();
  let windowStart = Date.now(),
    requests = 0,
    closing = false;
  const server = http.createServer(
    {
      maxHeaderSize: limits.preludeBytes,
      insecureHTTPParser: false,
      requireHostHeader: true,
    },
    async (req, res) => {
      if (closing || admitted.has(req.socket)) {
        req.socket.destroy();
        return;
      }
      admitted.add(req.socket);
      if (Date.now() - windowStart >= 60000) {
        windowStart = Date.now();
        requests = 0;
      }
      let upstream,
        upstreamResponse,
        body,
        output,
        done = false;
      let connectTimer;
      const lifetime = setTimeout(() => stop(), limits.totalMs);
      const cleanup = () => {
        clearTimeout(lifetime);
        clearTimeout(connectTimer);
        work.delete(stop);
        upstream?.destroy();
        upstreamResponse?.destroy();
        body?.destroy();
        output?.destroy();
      };
      function stop() {
        if (done) return;
        done = true;
        cleanup();
        req.destroy();
        res.destroy();
      }
      function deny(code = 403) {
        if (done) return;
        done = true;
        cleanup();
        if (res.headersSent) {
          req.destroy();
          res.destroy();
          return;
        }
        res.writeHead(code, {
          "content-type": "text/plain",
          "content-length": "0",
          connection: "close",
        });
        res.end();
        // A non-reading sender cannot retain an open rejected request.
        const timer = setTimeout(() => req.socket.destroy(), 100);
        timer.unref();
      }
      work.add(stop);
      req.on("error", stop);
      req.on("aborted", stop);
      res.on("error", stop);
      res.on("close", () => {
        if (!res.writableFinished) stop();
        else {
          done = true;
          cleanup();
        }
      });
      if (++requests > limits.requestsPerMinute) {
        deny(429);
        return;
      }
      let headers;
      try {
        headers = gatewayRequest(req);
      } catch {
        deny();
        return;
      }
      req.pause();
      connectTimer = setTimeout(() => deny(504), limits.connectMs);
      try {
        const pinned = validateAnswers(
          await lookup(PROFILE.host, { all: true, verbatim: true }),
        );
        if (done || req.destroyed || closing) return;
        upstream = request(
          {
            protocol: "https:",
            hostname: pinned.address,
            port: PROFILE.port,
            family: pinned.family,
            servername: PROFILE.host,
            rejectUnauthorized: true,
            method: req.method,
            path: req.url,
            headers,
            agent: false,
            maxHeaderSize: limits.preludeBytes,
          },
          (response) => {
            upstreamResponse = response;
            clearTimeout(connectTimer);
            // Redirects, protocol switching and malformed responses are never relayed/followed.
            if (
              !response.statusCode ||
              response.statusCode < 200 ||
              (response.statusCode >= 300 && response.statusCode < 400) ||
              (response.headers["content-encoding"] &&
                response.headers["content-encoding"] !== "identity")
            ) {
              deny(502);
              return;
            }
            const responseHeaders = { connection: "close" };
            for (const key of ["content-type", "x-request-id", "retry-after"])
              if (typeof response.headers[key] === "string")
                responseHeaders[key] = response.headers[key];
            res.writeHead(response.statusCode, responseHeaders);
            output = budget(limits.responseBytes, () => stop());
            output.on("error", stop);
            response.on("error", stop);
            response.on("aborted", stop);
            response.pipe(output).pipe(res);
          },
        );
        upstream.on("error", () => deny(502));
        upstream.on("upgrade", (_response, socket) => {
          socket.destroy();
          deny(502);
        });
        upstream.on("continue", () => deny(502));
        upstream.setTimeout(limits.idleMs, () => stop());
        body = budget(limits.requestBytes, () => deny(413));
        body.on("error", () => deny(413));
        req.pipe(body).pipe(upstream);
        req.resume();
      } catch {
        deny(502);
      }
    },
  );
  server.maxRequestsPerSocket = 1;
  server.requestTimeout = limits.totalMs;
  server.headersTimeout = limits.preludeMs;
  server.keepAliveTimeout = 1;
  server.on("connection", (socket) => {
    if (closing || clients.size >= limits.connections) {
      socket.destroy();
      return;
    }
    clients.add(socket);
    socket.on("error", () => socket.destroy());
    const preludeTimer = setTimeout(() => {
      if (!admitted.has(socket)) socket.destroy();
    }, limits.preludeMs);
    socket.setTimeout(limits.idleMs, () => socket.destroy());
    socket.on("close", () => {
      clearTimeout(preludeTimer);
      clients.delete(socket);
    });
  });
  const refuseTunnel = (_req, socket) =>
    socket.end(
      "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  server.on("connect", refuseTunnel);
  server.on("upgrade", refuseTunnel);
  server.on("checkContinue", (req, res) => {
    res.writeHead(403, { connection: "close" });
    res.end();
    req.resume();
  });
  server.on("checkExpectation", (req, res) => {
    res.writeHead(403, { connection: "close" });
    res.end();
    req.resume();
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  return {
    server,
    async close() {
      closing = true;
      for (const stop of work) stop();
      for (const socket of clients) socket.destroy();
      if (server.listening)
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    },
  };
}
function budget(maximum, overflow) {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximum) {
        overflow();
        callback(Error("Size limit"));
      } else callback(null, chunk);
    },
  });
}
