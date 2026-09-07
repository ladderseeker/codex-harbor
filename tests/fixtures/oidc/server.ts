import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { readFileSync } from "node:fs";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { randomUUID, createHash } from "node:crypto";
const port = Number(process.env.OIDC_PORT),
  issuer = `${process.env.OIDC_TLS_CERT ? "https" : "http"}://127.0.0.1:${port}`,
  client = process.env.HARBOR_OIDC_CLIENT_ID!,
  callback = process.env.HARBOR_ORIGIN! + "/auth/callback";
if (
  process.env.NODE_ENV !== "test" ||
  process.env.HARBOR_FIXTURE_MODE !== "private-test"
)
  throw Error("Private test identity provider only");
const { publicKey, privateKey } = await generateKeyPair("RS256"),
  jwk = await exportJWK(publicKey);
jwk.kid = "test";
jwk.alg = "RS256";
const codes = new Map<
  string,
  { nonce: string; challenge: string; subject: string }
>();
const serverFactory = process.env.OIDC_TLS_CERT
  ? (handler: import("node:http").RequestListener) =>
      createTlsServer(
        {
          cert: readFileSync(process.env.OIDC_TLS_CERT!),
          key: readFileSync(process.env.OIDC_TLS_KEY!),
        },
        handler,
      )
  : createServer;
serverFactory(async (req, res) => {
  const url = new URL(req.url!, issuer);
  const send = (data: unknown, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === "/.well-known/openid-configuration")
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
  if (url.pathname === "/jwks") return send({ keys: [jwk] });
  if (url.pathname === "/authorize") {
    if (
      url.searchParams.get("redirect_uri") !== callback ||
      url.searchParams.get("client_id") !== client ||
      url.searchParams.get("code_challenge_method") !== "S256"
    )
      return send({ error: "invalid_request" }, 400);
    const q = url.searchParams.toString();
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(
      `<form action="/choose"><input type="hidden" name="query" value="${q.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"><button name="subject" value="owner">Sign in as owner</button><button name="subject" value="denied">Sign in as denied identity</button></form>`,
    );
  }
  if (url.pathname === "/choose") {
    const q = new URLSearchParams(url.searchParams.get("query")!),
      code = randomUUID();
    codes.set(code, {
      nonce: q.get("nonce")!,
      challenge: q.get("code_challenge")!,
      subject: url.searchParams.get("subject")!,
    });
    const target = new URL(callback);
    target.searchParams.set("code", code);
    target.searchParams.set("state", q.get("state")!);
    res.writeHead(302, { location: target.href });
    return res.end();
  }
  if (url.pathname === "/token") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) return send({ error: "too_large" }, 413);
    }
    const q = new URLSearchParams(body),
      value = codes.get(q.get("code")!);
    codes.delete(q.get("code")!);
    if (
      !value ||
      q.get("client_id") !== client ||
      q.get("redirect_uri") !== callback ||
      createHash("sha256")
        .update(q.get("code_verifier") ?? "")
        .digest("base64url") !== value.challenge
    )
      return send({ error: "invalid_grant" }, 400);
    const token = await new SignJWT({ nonce: value.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience(client)
      .setSubject(value.subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return send({
      access_token: randomUUID(),
      token_type: "Bearer",
      expires_in: 300,
      id_token: token,
    });
  }
  send({ error: "not_found" }, 404);
}).listen(port, "127.0.0.1");
