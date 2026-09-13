import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import * as oidc from "openid-client";
import {
  assertNewPrivateOutput,
  buildEnrollment,
  enrollmentSchema,
  type EnrollmentConfig,
} from "../../infra/personal-vps/enroll-owner.ts";

test("P015 enrollment locks production origin/issuer and lifetime", () => {
  const base = {
    origin: "https://harbor.example",
    issuer: "https://accounts.google.com",
    expectedEmail: "owner@example.com",
    clientFile: "/private/client.json",
    resultFile: "/private/result.json",
    startTokenFile: "/private/start-url",
    port: 3347,
  };
  assert.equal(enrollmentSchema.parse(base).ttlSeconds, 1800);
  for (const change of [
    { origin: "http://harbor.example" },
    { origin: "https://harbor.example/path" },
    { issuer: "http://127.0.0.1" },
    { issuer: "https://evil.example" },
    { ttlSeconds: 3601 },
    { port: 80 },
  ])
    assert.throws(() => enrollmentSchema.parse({ ...base, ...change }));
});

test("P015 enrollment code flow rejects CSRF/PKCE/nonce/unverified or other email and records one identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "harbor-enrollment-"));
  const { privateKey, publicKey } = await generateKeyPair("RS256"),
    jwk = await exportJWK(publicKey);
  jwk.kid = "fixture";
  jwk.alg = "RS256";
  const codes = new Map<
    string,
    { nonce: string; challenge: string; email: string; verified: boolean }
  >();
  let issuer = "",
    exchanges = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    const send = (v: unknown, status = 200) => {
      res.statusCode = status;
      res.end(JSON.stringify(v));
    };
    if (req.url === "/.well-known/openid-configuration")
      return send({
        issuer,
        authorization_endpoint: issuer + "/authorize",
        token_endpoint: issuer + "/token",
        jwks_uri: issuer + "/jwks",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    if (req.url === "/jwks") return send({ keys: [jwk] });
    if (req.url !== "/token") return send({ error: "not_found" }, 404);
    let body = "";
    for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body),
      entry = codes.get(params.get("code") ?? "");
    codes.delete(params.get("code") ?? "");
    exchanges++;
    if (
      !entry ||
      createHash("sha256")
        .update(params.get("code_verifier") ?? "")
        .digest("base64url") !== entry.challenge
    )
      return send({ error: "invalid_grant" }, 400);
    const token = await new SignJWT({
      nonce: entry.nonce,
      email: entry.email,
      email_verified: entry.verified,
    })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer(issuer)
      .setAudience("enrollment-test")
      .setSubject("verified-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return send({
      access_token: "discarded-fixture-token",
      token_type: "Bearer",
      id_token: token,
      expires_in: 300,
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = await oidc.discovery(
    new URL(issuer),
    "enrollment-test",
    undefined,
    undefined,
    { execute: [oidc.allowInsecureRequests] },
  );
  // Only the external boundary uses a private HTTP fixture. CLI schema above forbids this issuer.
  const config = {
    origin: "https://harbor.example",
    issuer,
    expectedEmail: "owner@example.com",
    clientFile: "/unused",
    resultFile: join(root, "result.json"),
    startTokenFile: join(root, "start-url"),
    port: 3347,
    ttlSeconds: 60,
  } as unknown as EnrollmentConfig;
  let completed = false;
  const app = await buildEnrollment(
    config,
    client,
    "private-start-token",
    () => {
      completed = true;
    },
  );
  try {
    assert.equal((await app.inject({ url: "/enroll/wrong" })).statusCode, 404);
    const start = async () => {
      const response = await app.inject({ url: "/enroll/private-start-token" });
      assert.equal(response.statusCode, 302);
      const url = new URL(response.headers.location!);
      assert.equal(url.searchParams.get("scope"), "openid email");
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      const setCookie = String(response.headers["set-cookie"]);
      assert.match(setCookie, /Secure/);
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Lax/);
      return { url, cookie: setCookie.split(";")[0]! };
    };
    const callback = async (
      flow: Awaited<ReturnType<typeof start>>,
      changes: Partial<{
        nonce: string;
        challenge: string;
        email: string;
        verified: boolean;
      }> = {},
      wrongState = false,
    ) => {
      const code = randomUUID();
      codes.set(code, {
        nonce: flow.url.searchParams.get("nonce")!,
        challenge: flow.url.searchParams.get("code_challenge")!,
        email: config.expectedEmail,
        verified: true,
        ...changes,
      });
      return app.inject({
        url: `/auth/callback?code=${code}&state=${wrongState ? "wrong" : flow.url.searchParams.get("state")}`,
        headers: { cookie: flow.cookie },
      });
    };
    assert.equal(
      (await app.inject({ url: "/auth/callback?code=unknown&state=unknown" }))
        .statusCode,
      403,
    );
    const csrf = await start();
    assert.equal((await callback(csrf, {}, true)).statusCode, 403);
    assert.equal(exchanges, 0);
    assert.equal((await callback(csrf)).statusCode, 403);
    for (const change of [
      { challenge: "wrong" },
      { nonce: "wrong" },
      { email: "other@example.com" },
      { verified: false },
    ]) {
      assert.equal((await callback(await start(), change)).statusCode, 403);
      await assert.rejects(readFile(config.resultFile));
    }
    await writeFile(config.resultFile, "preserve-existing", { mode: 0o600 });
    assert.equal((await callback(await start())).statusCode, 403);
    assert.equal(
      await readFile(config.resultFile, "utf8"),
      "preserve-existing",
    );
    await rm(config.resultFile);
    const success = await callback(await start());
    assert.equal(success.statusCode, 200);
    assert.equal(completed, true);
    assert.doesNotMatch(
      success.body,
      /verified-subject|discarded-fixture-token/,
    );
    assert.deepEqual(JSON.parse(await readFile(config.resultFile, "utf8")), {
      issuer,
      subject: "verified-subject",
      email: "owner@example.com",
    });
    assert.equal((await stat(config.resultFile)).mode & 0o777, 0o600);
    assert.equal(
      (await app.inject({ url: "/enroll/private-start-token" })).statusCode,
      410,
    );
    assert.equal((await app.inject({ url: "/auth/callback" })).statusCode, 410);
  } finally {
    await app.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});

test("P015 enrollment expires without accepting further starts or callbacks", async (t) => {
  const config = {
    origin: "https://harbor.example",
    issuer: "https://accounts.google.com",
    expectedEmail: "owner@example.com",
    clientFile: "/unused",
    resultFile: "/unused",
    startTokenFile: "/unused",
    port: 3347,
    ttlSeconds: 60,
  } as EnrollmentConfig;
  const app = await buildEnrollment(
    config,
    {} as oidc.Configuration,
    "private-start-token",
  );
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 61000);
  try {
    assert.equal(
      (await app.inject({ url: "/enroll/private-start-token" })).statusCode,
      410,
    );
    assert.equal((await app.inject({ url: "/auth/callback" })).statusCode, 410);
  } finally {
    await app.close();
  }
});

test("P015 startup refuses preexisting private enrollment output", async () => {
  const root = await mkdtemp(join(tmpdir(), "harbor-enrollment-output-")),
    output = join(root, "result.json");
  try {
    await assertNewPrivateOutput(output);
    await writeFile(output, "preserve", { mode: 0o600 });
    await assert.rejects(assertNewPrivateOutput(output), /already exists/);
    assert.equal(await readFile(output, "utf8"), "preserve");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
