import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
if (process.env.HARBOR_LOCAL_MODE !== "personal")
  throw Error("Local personal mode required");
const port = Number(process.env.OIDC_PORT);
const issuer = `http://127.0.0.1:${port}`;
const client = process.env.HARBOR_OIDC_CLIENT_ID!;
const callback = process.env.HARBOR_ORIGIN! + "/auth/callback";
const secret = readFileSync(
  process.env.HARBOR_LOCAL_OWNER_TOKEN_FILE!,
  "utf8",
).trim();
if (secret.length < 48 || new URL(callback).hostname !== "localhost")
  throw Error("Invalid local authentication configuration");
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "local", alg: "RS256" };
const codes = new Map<
  string,
  { nonce: string; challenge: string; expires: number }
>();
const requests = new Map<
  string,
  { nonce: string; challenge: string; state: string; expires: number }
>();
const hash = (s: string) => createHash("sha256").update(s).digest();
createServer(async (req, res) => {
  const send = (data: unknown, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  try {
    if (req.headers.host !== `127.0.0.1:${port}`)
      return send({ error: "invalid_host" }, 400);
    const url = new URL(req.url!, issuer);
    for (const map of [codes, requests])
      for (const [key, value] of map)
        if (value.expires < Date.now()) map.delete(key);
    if (
      req.method === "GET" &&
      url.pathname === "/.well-known/openid-configuration"
    )
      return send({
        issuer,
        authorization_endpoint: issuer + "/authorize",
        token_endpoint: issuer + "/token",
        jwks_uri: issuer + "/jwks",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      });
    if (req.method === "GET" && url.pathname === "/jwks")
      return send({ keys: [jwk] });
    if (req.method === "GET" && url.pathname === "/authorize") {
      const q = url.searchParams;
      if (
        q.get("redirect_uri") !== callback ||
        q.get("client_id") !== client ||
        q.get("response_type") !== "code" ||
        q.get("code_challenge_method") !== "S256" ||
        !/^[\w-]{43}$/.test(q.get("code_challenge") ?? "") ||
        !q.get("nonce") ||
        !q.get("state")
      )
        return send({ error: "invalid_request" }, 400);
      if (requests.size >= 100) return send({ error: "busy" }, 429);
      const id = randomUUID();
      requests.set(id, {
        nonce: q.get("nonce")!,
        challenge: q.get("code_challenge")!,
        state: q.get("state")!,
        expires: Date.now() + 300000,
      });
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "same-origin",
        "content-security-policy": `default-src 'none'; form-action 'self' ${new URL(callback).origin}; frame-ancestors 'none'`,
      });
      return res.end(
        `<!doctype html><title>Harbor local sign in</title><h1>Harbor local sign in</h1><p>Enter the owner token stored in .harbor-local/owner-token. This unlocks Harbor; Codex account login is separate.</p><form action="/choose" method="post"><input type="hidden" name="request" value="${id}"><label>Owner token <input name="token" type="password" autocomplete="current-password" required></label><button>Sign in</button></form>`,
      );
    }
    if (req.method !== "POST" || !["/choose", "/token"].includes(url.pathname))
      return send({ error: "not_found" }, 404);
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) return send({ error: "too_large" }, 413);
    }
    const q = new URLSearchParams(body);
    if (url.pathname === "/choose") {
      if (req.headers.origin !== issuer)
        return send({ error: "invalid_origin" }, 403);
      const value = requests.get(q.get("request") ?? "");
      requests.delete(q.get("request") ?? "");
      if (!value || !timingSafeEqual(hash(q.get("token") ?? ""), hash(secret)))
        return send({ error: "invalid_login" }, 403);
      const code = randomUUID();
      codes.set(code, {
        nonce: value.nonce,
        challenge: value.challenge,
        expires: Date.now() + 60000,
      });
      const target = new URL(callback);
      target.searchParams.set("code", code);
      target.searchParams.set("state", value.state);
      res.writeHead(302, {
        location: target.href,
        "cache-control": "no-store",
      });
      return res.end();
    }
    const value = codes.get(q.get("code") ?? "");
    codes.delete(q.get("code") ?? "");
    if (
      !value ||
      q.get("grant_type") !== "authorization_code" ||
      q.get("client_id") !== client ||
      q.get("redirect_uri") !== callback ||
      hash(q.get("code_verifier") ?? "").toString("base64url") !==
        value.challenge
    )
      return send({ error: "invalid_grant" }, 400);
    const token = await new SignJWT({ nonce: value.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "local" })
      .setIssuer(issuer)
      .setAudience(client)
      .setSubject("local-owner")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    send({
      access_token: randomUUID(),
      token_type: "Bearer",
      expires_in: 300,
      id_token: token,
    });
  } catch {
    if (!res.headersSent) send({ error: "invalid_request" }, 400);
    else res.end();
  }
}).listen(port, "127.0.0.1");
