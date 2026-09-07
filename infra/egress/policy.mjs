import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

// Administrator-owned immutable profile. No environment, project or API overrides.
export const PROFILE = Object.freeze({ host: "api.openai.com", port: 443 });
export const LIMITS = Object.freeze({
  connections: 32,
  requestsPerMinute: 120,
  preludeBytes: 8192,
  preludeMs: 5000,
  connectMs: 10000,
  idleMs: 120000,
  totalMs: 3600000,
  requestBytes: 4 * 1024 * 1024,
  responseBytes: 64 * 1024 * 1024,
});

export function publicAddress(address) {
  if (typeof address !== "string" || !isIP(address) || address.includes("%"))
    return false;
  const parsed = ipaddr.parse(address);
  // Reject all transition/mapped/translation mechanisms, even public mapped IPv4.
  if (parsed.range() !== "unicast") return false;
  if (parsed.kind() === "ipv6") {
    // Only current global unicast allocation; exclude all protocol-assignment space,
    // documentation and 6to4 (the latter also classified by ipaddr).
    return (
      parsed.match(ipaddr.parseCIDR("2000::/3")) &&
      !parsed.match(ipaddr.parseCIDR("2001::/23")) &&
      !parsed.match(ipaddr.parseCIDR("2001:db8::/32")) &&
      !parsed.match(ipaddr.parseCIDR("3fff::/20"))
    );
  }
  return true;
}

export function validateAnswers(answers) {
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 32)
    throw Error("Destination unavailable");
  if (
    answers.some(
      (a) => !a || !publicAddress(a.address) || isIP(a.address) !== a.family,
    )
  )
    throw Error("Destination denied");
  // Prefer IPv4 on deployments without IPv6. Every answer is validated first.
  return [...answers].sort((a, b) => a.family - b.family)[0];
}

export const ROUTES = Object.freeze(["POST /v1/responses"]);
export function gatewayRequest(req) {
  if (!ROUTES.includes(`${req.method} ${req.url}`)) throw Error("Route denied");
  const seen = new Set();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const key = req.rawHeaders[i].toLowerCase();
    if (seen.has(key)) throw Error("Duplicate header");
    seen.add(key);
  }
  const expectedHost = `${req.socket.localAddress}:${req.socket.localPort}`;
  if (
    req.headers.host !== expectedHost ||
    req.headers.upgrade ||
    req.headers.expect ||
    req.headers["proxy-authorization"] ||
    req.headers["proxy-connection"]
  )
    throw Error("Invalid gateway authority");
  if (
    req.headers.connection &&
    !/^(close|keep-alive)$/i.test(req.headers.connection)
  )
    throw Error("Invalid connection header");
  if (
    req.headers["transfer-encoding"] &&
    req.headers["transfer-encoding"] !== "chunked"
  )
    throw Error("Invalid framing");
  if (req.headers["content-type"] !== "application/json")
    throw Error("Invalid content type");
  const length = req.headers["content-length"];
  if (
    length !== undefined &&
    (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > LIMITS.requestBytes)
  )
    throw Error("Request too large");
  const headers = {
    host: PROFILE.host,
    "content-type": "application/json",
    "accept-encoding": "identity",
  };
  // Explicit end-to-end header subset. Never forward routing, proxy or hop-by-hop headers.
  for (const key of [
    "authorization",
    "accept",
    "openai-organization",
    "openai-project",
    "openai-beta",
    "x-client-request-id",
  ]) {
    if (typeof req.headers[key] === "string") headers[key] = req.headers[key];
  }
  return headers;
}
