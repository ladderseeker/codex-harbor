/** Shared fixed protocol policy. No value from project traffic selects a destination. */
export const PREVIEW_RESERVED = "/__harbor/";
export const REQUEST_BYTES = 8 * 1024 * 1024;
export const RESPONSE_BYTES = 32 * 1024 * 1024;
export const STREAM_BYTES = 2 * 1024 * 1024;
export const methods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const hop = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
]);
const privateHeaders =
  /^(authorization|proxy-authorization|proxy-authenticate|forwarded|x-forwarded-.*|x-real-ip|sec-websocket-.*|host)$/;
const reservedCookie = (name: string) => /^__host-harbor(?:-|$)/i.test(name);
export function requestPath(value: string) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > 8192 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20\x7f#]/.test(value)
  )
    throw Error("Unsupported preview path");
  let path: string;
  try {
    path = decodeURIComponent(value.split("?")[0]);
  } catch {
    throw Error("Invalid preview path encoding");
  }
  if (
    /[\\\x00-\x20\x7f]/.test(path) ||
    path.startsWith("//") ||
    path.split("/").some((p) => p === "." || p === "..") ||
    path.toLowerCase().startsWith(PREVIEW_RESERVED)
  )
    throw Error("Reserved or ambiguous preview path");
  return value;
}
export type HeaderPairs = [string, string][];
export function validateHeaders(input: HeaderPairs) {
  if (!Array.isArray(input) || input.length > 100)
    throw Error("Preview header count limit");
  let bytes = 0;
  const out: HeaderPairs = [];
  for (const pair of input) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string"
    )
      throw Error("Invalid preview header");
    const [name, value] = pair;
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    if (
      !token.test(name) ||
      /[\x00-\x08\x0a-\x1f\x7f]/.test(value) ||
      bytes > 16384
    )
      throw Error("Preview header limit");
    out.push([name.toLowerCase(), value]);
  }
  for (const name of [
    "content-length",
    "transfer-encoding",
    "host",
    "origin",
  ]) {
    const values = out.filter(([key]) => key === name);
    if (values.length > 1) throw Error("Duplicate framing or authority header");
  }
  const length = out.find(([name]) => name === "content-length")?.[1];
  const transfer = out.find(([name]) => name === "transfer-encoding")?.[1];
  if (
    length !== undefined &&
    (!/^(0|[1-9][0-9]{0,10})$/.test(length) ||
      !Number.isSafeInteger(Number(length)))
  )
    throw Error("Invalid content length");
  if (
    transfer &&
    (length !== undefined || transfer.toLowerCase() !== "chunked")
  )
    throw Error("Ambiguous HTTP framing");
  return out;
}
export function requestHeaders(input: HeaderPairs, port: number) {
  const headers = validateHeaders(input);
  const connection = new Set(
    headers
      .filter(([key]) => key === "connection")
      .flatMap(([, v]) =>
        v
          .toLowerCase()
          .split(",")
          .map((s) => s.trim()),
      ),
  );
  const out: HeaderPairs = [];
  for (const [name, value] of headers) {
    if (hop.has(name) || connection.has(name) || privateHeaders.test(name))
      continue;
    if (name === "cookie") {
      if (Buffer.byteLength(value) > 4096)
        throw Error("Application cookie limit");
      const cookies = value
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      if (cookies.length > 16) throw Error("Application cookie count limit");
      const kept = cookies.filter(
        (cookie) => !reservedCookie(cookie.split("=", 1)[0]),
      );
      if (kept.length) out.push([name, kept.join("; ")]);
    } else out.push([name, value]);
  }
  out.push(["host", "127.0.0.1:" + port]);
  return out;
}
export function responseHeaders(input: HeaderPairs, origin: string) {
  const headers = validateHeaders(input);
  const connection = new Set(
    headers
      .filter(([key]) => key === "connection")
      .flatMap(([, v]) =>
        v
          .toLowerCase()
          .split(",")
          .map((s) => s.trim()),
      ),
  );
  const out: HeaderPairs = [];
  let cookies = 0;
  for (const [name, value] of headers) {
    if (
      hop.has(name) ||
      connection.has(name) ||
      privateHeaders.test(name) ||
      /^(content-security-policy(?:-report-only)?|access-control-.*|cross-origin-.*|permissions-policy|referrer-policy|cache-control|clear-site-data|reporting-endpoints|nel|report-to|x-frame-options|x-content-type-options|service-worker-allowed|alt-svc|refresh)$/i.test(
        name,
      )
    )
      continue;
    if (name === "location") {
      if (Buffer.byteLength(value) > 8192 || /[\\\x00-\x20\x7f]/.test(value))
        throw Error("Invalid application redirect");
      const url = new URL(value, origin);
      if (url.origin !== origin || url.username || url.password)
        throw Error("External application redirect denied");
      requestPath(url.pathname + url.search);
      out.push([name, url.pathname + url.search + url.hash]);
    } else if (name === "set-cookie") {
      if (++cookies > 8 || Buffer.byteLength(value) > 1024)
        throw Error("Application cookie limit");
      const parts = value.split(";").map((p) => p.trim());
      const equals = parts[0].indexOf("=");
      if (
        equals < 1 ||
        !token.test(parts[0].slice(0, equals)) ||
        reservedCookie(parts[0].slice(0, equals)) ||
        parts.slice(1).some((p) => /^domain(?:\s*=|$)/i.test(p))
      )
        throw Error("Reserved or cross-origin application cookie");
      out.push([
        name,
        parts.filter((p) => !/^secure$/i.test(p)).join("; ") + "; Secure",
      ]);
    } else out.push([name, value]);
  }
  return out;
}
export function securityHeaders(origin: string) {
  const ws = "wss:" + origin.slice(6);
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "x-frame-options": "DENY",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), clipboard-write=()",
    "content-security-policy": `default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ${ws}; form-action 'self'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'; sandbox allow-scripts allow-same-origin allow-forms`,
  };
}
export function rawPairs(raw: string[]): HeaderPairs {
  if (raw.length % 2) throw Error("Invalid header pairs");
  const pairs: HeaderPairs = [];
  for (let i = 0; i < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
  return pairs;
}
