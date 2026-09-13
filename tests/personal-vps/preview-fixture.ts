import http from "node:http";
import https from "node:https";
import net from "node:net";
import { WebSocketServer } from "ws";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { openProjectTools } from "../e2e/navigation.ts";
export async function personalPreviewFixture(h: {
  appPort: number;
  gatewayPort: number;
  tlsPort: number;
  cert: Buffer;
  key: Buffer;
}) {
  const proxy = https.createServer({ cert: h.cert, key: h.key }, (req, res) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: h.gatewayPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  const sockets = new Set<import("node:stream").Duplex>();
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  proxy.on("upgrade", (req, socket, head) => {
    const upstream = net.connect(h.gatewayPort, "127.0.0.1", () => {
      upstream.write(
        `${req.method} ${req.url} HTTP/1.1\r\n` +
          req.rawHeaders.reduce(
            (out, value, i) => out + value + (i % 2 === 0 ? ": " : "\r\n"),
            "",
          ) +
          "\r\n",
      );
      upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
  });
  await new Promise<void>((r) => proxy.listen(h.tlsPort, "127.0.0.1", r));
  return {
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await Promise.all([new Promise<void>((r) => proxy.close(() => r()))]);
    },
  };
}
export async function checkPersonalPreview(
  page: Page,
  context: BrowserContext,
  previewOrigin: string,
  port: number,
) {
  expect((await context.request.get(previewOrigin)).status()).toBe(403);
  await openProjectTools(page);
  await page
    .getByRole("button", { name: "Project previews", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `Development app · 127.0.0.1:${port}`,
      exact: true,
    })
    .click();
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Open private preview ↗" }).click();
  const preview = await popup;
  await expect(
    preview.getByRole("heading", { name: "Private development application" }),
  ).toBeVisible();
  await expect(preview.locator("#ws")).toHaveText(
    "HMR connected: preview-check",
  );
  expect(await preview.evaluate(() => (window as any).largeLoaded)).toBe(true);
  const headers = await preview.evaluate(async () =>
    (await fetch("/headers")).json(),
  );
  expect(headers.cookie ?? "").not.toContain("harbor");
  expect(headers.authorization).toBeUndefined();
  expect(
    (
      await context.request.get(previewOrigin, {
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  const cookies = await context.cookies(previewOrigin);
  expect(
    cookies.some(
      (cookie) =>
        cookie.name === "__Host-harbor-personal-preview" &&
        cookie.httpOnly &&
        cookie.secure,
    ),
  ).toBe(true);
  expect(cookies.some((cookie) => cookie.name === "__Host-harbor")).toBe(false);
  await preview.close();
  await page.keyboard.press("Escape");
}
