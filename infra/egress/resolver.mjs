import https from "node:https";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { PROFILE, validateAnswers } from "./policy.mjs";

export function resolverProfile(value = "system") {
  if (!["system", "cloudflare-doh"].includes(value))
    throw Error("Invalid trusted DNS profile");
  return value;
}
function dnsName(value) {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.?$/.test(
      value,
    )
  )
    throw Error("Invalid DNS response");
  return value.toLowerCase().replace(/\.$/, "");
}
export function parseDnsJson(body, host, type) {
  if (
    !body ||
    body.Status !== 0 ||
    body.TC !== false ||
    body.CD !== false ||
    !Array.isArray(body.Question) ||
    body.Question.length !== 1 ||
    dnsName(body.Question[0].name) !== host ||
    body.Question[0].type !== type
  )
    throw Error("Invalid DNS response");
  const records = body.Answer ?? [];
  if (!Array.isArray(records) || records.length > 32)
    throw Error("Invalid DNS response");
  const aliases = new Map();
  for (const record of records) {
    if (!record || ![5, type].includes(record.type))
      throw Error("Invalid DNS response");
    const name = dnsName(record.name);
    if (record.type === 5) {
      if (aliases.has(name)) throw Error("Invalid DNS response");
      aliases.set(name, dnsName(record.data));
    }
  }
  const chain = new Set([host]);
  let current = host;
  while (aliases.has(current)) {
    current = aliases.get(current);
    if (chain.has(current) || chain.size >= 8)
      throw Error("Invalid DNS response");
    chain.add(current);
  }
  const answers = [];
  for (const record of records) {
    const name = dnsName(record.name);
    if (!chain.has(name)) throw Error("Invalid DNS response");
    if (record.type !== 5) {
      if (name !== current || isIP(record.data) !== (type === 1 ? 4 : 6))
        throw Error("Invalid DNS response");
      answers.push({ address: record.data, family: type === 1 ? 4 : 6 });
    }
  }
  return answers;
}

export function queryDnsJson(host, type, request = https.request) {
  if (host !== PROFILE.host || ![1, 28].includes(type))
    throw Error("DNS query denied");
  return new Promise((resolve, reject) => {
    let settled = false,
      response;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response?.destroy();
      req.destroy();
      if (error) reject(Error("Trusted DNS unavailable"));
      else resolve(value);
    };
    // The IP is fixed, so even the resolver bootstrap cannot be redirected by system DNS.
    // TLS validates cloudflare-dns.com using Node's built-in roots; no custom CA or insecure option.
    const req = request(
      {
        protocol: "https:",
        host: "1.1.1.1",
        port: 443,
        servername: "cloudflare-dns.com",
        rejectUnauthorized: true,
        method: "GET",
        path: `/dns-query?name=${host}&type=${type}&cd=false`,
        headers: { Host: "cloudflare-dns.com", Accept: "application/dns-json" },
        agent: false,
        maxHeaderSize: 8192,
      },
      (res) => {
        response = res;
        if (
          res.statusCode !== 200 ||
          res.headers["content-type"]?.split(";")[0].trim() !==
            "application/dns-json"
        ) {
          finish(true);
          return;
        }
        let bytes = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 16384) finish(true);
          else chunks.push(chunk);
        });
        res.on("error", () => finish(true));
        res.on("aborted", () => finish(true));
        res.on("end", () => {
          try {
            finish(
              null,
              parseDnsJson(
                JSON.parse(Buffer.concat(chunks).toString("utf8")),
                host,
                type,
              ),
            );
          } catch {
            finish(true);
          }
        });
      },
    );
    const timer = setTimeout(() => finish(true), 4000);
    req.on("error", () => finish(true));
    req.end();
  });
}

export function createResolver(profile = "system") {
  resolverProfile(profile);
  if (profile === "system") return dns.lookup;
  return async (host) => {
    const groups = await Promise.all([
      queryDnsJson(host, 1),
      queryDnsJson(host, 28),
    ]);
    const answers = groups.flat();
    validateAnswers(answers); // Reject any private answer, including the unselected family.
    return answers;
  };
}
