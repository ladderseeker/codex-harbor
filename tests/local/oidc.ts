import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { importJWK, jwtVerify } from "jose";
const dir = await mkdtemp(path.join(os.tmpdir(), "harbor-local-oidc-"));
const secret = randomBytes(32).toString("hex");
await writeFile(path.join(dir, "token"), secret, { mode: 0o600 });
const listener = createServer();
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const issuer = `http://127.0.0.1:${port}`;
const callback = "https://localhost:3443/auth/callback";
const child = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/local-oidc.ts"],
  {
    env: {
      ...process.env,
      HARBOR_LOCAL_MODE: "personal",
      OIDC_PORT: String(port),
      HARBOR_OIDC_CLIENT_ID: "local-test",
      HARBOR_ORIGIN: "https://localhost:3443",
      HARBOR_LOCAL_OWNER_TOKEN_FILE: path.join(dir, "token"),
    },
    stdio: "pipe",
  },
);
try {
  for (let i = 0; ; i++) {
    try {
      await fetch(issuer + "/jwks");
      break;
    } catch {
      if (i > 100) throw Error("OIDC did not start");
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    redirect_uri: callback,
    client_id: "local-test",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    nonce: "nonce",
    state: "state",
  });
  const begin = async () => {
    const response = await fetch(issuer + "/authorize?" + query);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(!html.includes(secret));
    return /name="request" value="([^"]+)"/.exec(html)![1];
  };
  const choose = (request: string, token: string, origin = issuer) =>
    fetch(issuer + "/choose", {
      method: "POST",
      redirect: "manual",
      headers: { origin },
      body: new URLSearchParams({ request, token }),
    });
  assert.equal((await choose(await begin(), "wrong")).status, 403);
  assert.equal(
    (await choose(await begin(), secret, "https://evil.example")).status,
    403,
  );
  const request = await begin();
  const login = await choose(request, secret);
  assert.equal(login.status, 302);
  assert.equal((await choose(request, secret)).status, 403);
  const destination = new URL(login.headers.get("location")!);
  assert.equal(destination.searchParams.get("state"), "state");
  const exchange = () =>
    fetch(issuer + "/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: destination.searchParams.get("code")!,
        code_verifier: verifier,
        client_id: "local-test",
        redirect_uri: callback,
      }),
    });
  const response = await exchange();
  assert.equal(response.status, 200);
  const token = await response.json();
  const { keys } = await (await fetch(issuer + "/jwks")).json();
  const verified = await jwtVerify(token.id_token, await importJWK(keys[0]), {
    issuer,
    audience: "local-test",
  });
  assert.equal(verified.payload.sub, "local-owner");
  assert.equal(verified.payload.nonce, "nonce");
  assert.equal((await exchange()).status, 400);
  query.set("redirect_uri", "https://evil.example");
  assert.equal((await fetch(issuer + "/authorize?" + query)).status, 400);
  console.log(
    "Local owner authentication: token, origin, redirect, PKCE, signed subject and single-use checks passed",
  );
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null && child.signalCode === null)
    await new Promise((resolve) => child.once("exit", resolve));
  await rm(dir, { recursive: true, force: true });
}
