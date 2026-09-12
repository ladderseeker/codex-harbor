import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import WebSocket from "ws";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { performance } from "node:perf_hooks";
import { expect } from "@playwright/test";
import type { Pool } from "pg";
import { digest } from "../../packages/policy/src/index.ts";
/** Fresh fixture TLS routes only; exact loopback lookup does not change host DNS/trust. */
export async function previewAccess(h: {
  db: Pool;
  url: string;
  cookie: string;
  ownerOrigin: string;
  ticketBody: string;
  artifacts: string;
}) {
  const target = new URL(h.url);
  let phase = "origin-policy";
  const options = {
    hostname: target.hostname,
    port: Number(target.port),
    servername: target.hostname,
    rejectUnauthorized: false,
    lookup: (_name: string, _options: unknown, done: any) =>
      done(null, [{ address: "127.0.0.1", family: 4 }]),
  };
  const request = (
    route: string,
    headers: Record<string, string>,
    body?: string,
  ) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const req = https.request(
          {
            ...options,
            path: route,
            method: body === undefined ? "GET" : "POST",
            headers,
          },
          (res) => {
            let text = "";
            res.on("data", (b) => {
              text += b;
              if (text.length > 65536) {
                req.destroy(Error("Fixture response bound"));
              }
            });
            res.on("end", () =>
              resolve({
                status: res.statusCode!,
                headers: res.headers,
                body: text,
              }),
            );
          },
        );
        req.on("error", reject);
        req.setTimeout(5000, () =>
          req.destroy(
            Error(
              "Fixture request deadline at " +
                phase +
                ": " +
                route +
                " declared bytes " +
                (headers["Content-Length"] ?? "0"),
            ),
          ),
        );
        req.end(body);
      },
    );
  const auth = {
    Cookie: "__Host-harbor-preview=" + h.cookie,
    Origin: target.origin,
  };
  expect((await request("/", {})).status).toBe(403);
  expect((await request("/", { Cookie: auth.Cookie })).status).toBe(403);
  expect((await request("/", { ...auth, Origin: "null" })).status).toBe(403);
  expect((await request("/", { ...auth, Origin: h.ownerOrigin })).status).toBe(
    403,
  );
  expect(
    (await request("/", { ...auth, Origin: "https://foreign.invalid" })).status,
  ).toBe(403);
  expect(
    (
      await request("/", {
        Cookie: auth.Cookie,
        "Sec-Fetch-Site": "same-origin",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request("/", {
        Cookie: auth.Cookie,
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-User": "?1",
      })
    ).status,
  ).toBe(200);
  for (const route of [
    "/__harbor/other",
    "/%5f%5fharbor/exchange",
    "/a/%2e%2e/__harbor/exchange",
  ])
    expect((await request(route, auth)).status).toBe(403);
  expect(
    (
      await request(
        "/__harbor/exchange",
        { Origin: "null", "Content-Type": "application/x-www-form-urlencoded" },
        h.ticketBody,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/__harbor/exchange",
        {
          Origin: h.ownerOrigin,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        h.ticketBody,
      )
    ).status,
  ).toBe(403);
  const reflected = await request("/headers", {
    ...auth,
    Authorization: "Bearer PUBLIC_HOSTILE_CANARY",
    "Proxy-Authorization": "Basic PUBLIC_CANARY",
    Forwarded: "for=PUBLIC_CANARY",
    Cookie: auth.Cookie + "; __Host-harbor=PUBLIC_CANARY; app=value",
  });
  expect(reflected.status).toBe(200);
  const observed = JSON.parse(reflected.body);
  expect(observed.cookie === "app=value").toBe(true);
  expect(observed.names).not.toContain("authorization");
  expect(observed.names).not.toContain("proxy-authorization");
  expect(observed.names).not.toContain("forwarded");
  const live = () =>
    new Promise<{ closed: Promise<void>; stop: () => void }>(
      (resolve, reject) => {
        const req = https.request(
          { ...options, path: "/events", headers: auth },
          (res) => {
            if (res.statusCode !== 200) {
              res.resume();
              reject(Error("Fixture stream denied"));
              return;
            }
            const closed = new Promise<void>((done) => {
              res.once("close", done);
              res.once("error", () => done());
            });
            res.once("data", () =>
              resolve({ closed, stop: () => req.destroy() }),
            );
            res.resume();
          },
        );
        req.on("error", reject);
        req.setTimeout(8000, () => req.destroy());
        req.end();
      },
    );
  const bounded = async (closed: Promise<void>, reason: string) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error(reason)), 5500);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  // The browser fixture was closed first, so these eight actual upstream
  // streams exclusively occupy the documented per-preview connection budget.
  phase = "connection-capacity";
  const saturated = [];
  try {
    for (let i = 0; i < 8; i++) saturated.push(await live());
    expect((await request("/", auth)).status).toBe(403);
  } finally {
    for (const stream of saturated) stream.stop();
    await Promise.all(saturated.map((stream) => stream.closed));
  }
  phase = "connection-release";
  await expect
    .poll(async () => (await request("/", auth)).status, { timeout: 3000 })
    .toBe(200);
  phase = "declared-body-limit";
  expect(
    (
      await request(
        "/",
        { ...auth, "Content-Length": "8388609" },
        "x".repeat(8388609),
      )
    ).status,
  ).toBe(403);
  phase = "websocket-size";
  const oversized = new WebSocket(
    target.origin.replace("https:", "wss:") + "/socket",
    { ...options, headers: auth, perMessageDeflate: false },
  );
  oversized.on("error", () => undefined);
  await new Promise<void>((resolve, reject) => {
    oversized.once("open", resolve);
    oversized.once("error", reject);
  });
  const oversizeClosed = new Promise<void>((resolve) =>
    oversized.once("close", () => resolve()),
  );
  oversized.send(Buffer.alloc(65537, 65));
  await bounded(oversizeClosed, "Oversized preview WebSocket did not close");
  expect((await request("/", auth)).status).toBe(200);
  // Real row wait stalls refresh; its independent nonrenewed lease closes idle SSE.
  phase = "authority-db-wait";
  const stalled = await live(),
    locker = await h.db.connect();
  try {
    await locker.query("BEGIN");
    await locker.query(
      "SELECT hash FROM browser_sessions WHERE hash=(SELECT actor_hash FROM preview_grants WHERE hash=$1) FOR UPDATE",
      [digest(h.cookie)],
    );
    const start = performance.now();
    await bounded(
      stalled.closed,
      "Preview lease did not expire during actual DB row wait",
    );
    expect(performance.now() - start).toBeLessThan(5500);
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
    stalled.stop();
  }
  const actor = (
    await h.db.query("SELECT actor_hash FROM preview_grants WHERE hash=$1", [
      digest(h.cookie),
    ])
  ).rows[0].actor_hash;
  const originalPin = (await h.db.query("SELECT identity_pin FROM harbor_meta"))
    .rows[0].identity_pin;
  for (const fence of [
    "source-browser-revocation",
    "owner-replacement",
  ] as const) {
    phase = fence;
    const idle = await live();
    const socket = new WebSocket(
      target.origin.replace("https:", "wss:") + "/socket",
      { ...options, headers: auth, perMessageDeflate: false },
    );
    socket.on("error", () => undefined);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    const replacement = "owned-preview-test-" + randomUUID();
    try {
      if (fence === "source-browser-revocation")
        await h.db.query(
          "UPDATE browser_sessions SET revoked=true WHERE hash=$1",
          [actor],
        );
      else
        await h.db.query("UPDATE harbor_meta SET identity_pin=$1", [
          replacement,
        ]);
      await bounded(idle.closed, fence + " left SSE open");
      await bounded(closed, fence + " left WebSocket open");
      expect((await request("/", auth)).status).toBe(403);
    } finally {
      // Restore only this disposable fixture's injected row change so later
      // independent cases can use its original owner. Closed transports stay closed.
      if (fence === "source-browser-revocation")
        await h.db.query(
          "UPDATE browser_sessions SET revoked=false WHERE hash=$1",
          [actor],
        );
      else
        await h.db.query(
          "UPDATE harbor_meta SET identity_pin=$1 WHERE identity_pin=$2",
          [originalPin, replacement],
        );
      idle.stop();
      socket.terminate();
    }
  }
  phase = "slow-reader";
  const slow = await new Promise<{
    resume: () => void;
    closed: Promise<void>;
    count: () => number;
  }>((resolve, reject) => {
    const req = https.get(
      { ...options, path: "/__fixture_stream_flood", headers: auth },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(Error("Slow-reader fixture denied"));
          return;
        }
        let count = 0;
        res.on("data", (chunk) => {
          count += chunk.length;
        });
        res.pause();
        const closed = new Promise<void>((done) => {
          res.once("close", done);
          res.once("error", () => done());
        });
        resolve({ resume: () => res.resume(), closed, count: () => count });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy());
  });
  expect((await request("/", auth)).status).toBe(200);
  await new Promise((r) => setTimeout(r, 300));
  slow.resume();
  await bounded(slow.closed, "Flooding slow-reader stream did not close");
  expect(slow.count()).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect((await request("/", auth)).status).toBe(200);
  phase = "viewer-revocation";
  const ws = new WebSocket(
    target.origin.replace("https:", "wss:") + "/socket",
    { ...options, headers: auth, perMessageDeflate: false },
  );
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  expect(ws.extensions).toBe("");
  const wsClosed = new Promise<void>((resolve) =>
    ws.once("close", () => resolve()),
  );
  ws.on("error", () => undefined);
  const revoked = await live();
  try {
    await h.db.query("UPDATE preview_grants SET revoked=true WHERE hash=$1", [
      digest(h.cookie),
    ]);
    await bounded(revoked.closed, "Revoked idle preview stream stayed open");
    await bounded(wsClosed, "Revoked idle preview WebSocket stayed open");
  } finally {
    revoked.stop();
    ws.terminate();
  }
  expect((await request("/", auth)).status).toBe(403);
  await writeFile(
    h.artifacts + "/access-cases.json",
    JSON.stringify(
      {
        status: "passed",
        eightConnectionsThenDenial: true,
        completeOversizedBodyDenied: true,
        oversizedWebSocketClosed: true,
        dbWaitIndependentLeaseClosed: true,
        sourceBrowserAndOwnerChangeClosedIdleSseAndWebSocket: true,
        pausedReaderOtherViewerHealthy: true,
        streamRateBoundBytes: slow.count(),
        fixtureAuthorityRestoredBetweenIndependentCases: true,
      },
      null,
      2,
    ),
  );
}
