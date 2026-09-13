/** Trusted one-time owner enrollment. This never creates a Harbor session. */
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import * as oidc from "openid-client";
import { z } from "zod";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, lstat, realpath, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const enrollmentSchema = z
  .object({
    origin: z
      .url()
      .refine(
        (v) => new URL(v).protocol === "https:" && new URL(v).origin === v,
      ),
    issuer: z.literal("https://accounts.google.com"),
    expectedEmail: z.email(),
    clientFile: z.string().startsWith("/"),
    resultFile: z.string().startsWith("/"),
    startTokenFile: z.string().startsWith("/"),
    port: z.number().int().min(1024).max(65535),
    ttlSeconds: z.number().int().min(60).max(3600).default(1800),
  })
  .strict();
export type EnrollmentConfig = z.infer<typeof enrollmentSchema>;
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function buildEnrollment(
  c: EnrollmentConfig,
  client: oidc.Configuration,
  startToken: string,
  onSuccess: () => void = () => {},
) {
  const app = Fastify({ logger: false, bodyLimit: 4096 });
  await app.register(cookie);
  const deadline = Date.now() + c.ttlSeconds * 1000;
  const pending = new Map<
    string,
    { verifier: string; nonce: string; expires: number }
  >();
  let complete = false,
    saving = false;
  app.addHook("onRequest", async (_req, reply) => {
    reply.headers({
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    });
    if (Date.now() >= deadline || complete)
      return reply.code(410).send("Owner enrollment has ended.");
  });
  app.setErrorHandler((_error, _req, reply) =>
    reply
      .code(403)
      .send(
        "Owner enrollment could not verify this sign-in. Reopen the private enrollment link to try again.",
      ),
  );
  app.get("/enroll/:token", async (req, reply) => {
    if (!same((req.params as { token: string }).token, startToken))
      return reply.code(404).send("Not found");
    for (const [state, value] of pending)
      if (value.expires < Date.now()) pending.delete(state);
    if (pending.size >= 8)
      return reply.code(429).send("Enrollment is busy. Try again shortly.");
    const state = oidc.randomState(),
      verifier = oidc.randomPKCECodeVerifier(),
      nonce = oidc.randomNonce();
    pending.set(state, {
      verifier,
      nonce,
      expires: Math.min(deadline, Date.now() + 600000),
    });
    reply.setCookie("__Host-harbor-enroll", state, {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return reply.redirect(
      oidc.buildAuthorizationUrl(client, {
        redirect_uri: c.origin + "/auth/callback",
        scope: "openid email",
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        prompt: "select_account",
      }).href,
    );
  });
  app.get("/auth/callback", async (req, reply) => {
    const state = req.cookies["__Host-harbor-enroll"],
      saved = state ? pending.get(state) : undefined;
    if (state) pending.delete(state);
    reply.clearCookie("__Host-harbor-enroll", {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    if (!state || !saved || saved.expires < Date.now() || saving)
      throw Error("Invalid enrollment state");
    const tokens = await oidc.authorizationCodeGrant(
      client,
      new URL(req.url, c.origin),
      {
        pkceCodeVerifier: saved.verifier,
        expectedState: state,
        expectedNonce: saved.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (
      !claims ||
      claims.iss !== c.issuer ||
      claims.email !== c.expectedEmail ||
      claims.email_verified !== true ||
      typeof claims.sub !== "string" ||
      !claims.sub ||
      claims.sub.length > 255 ||
      Date.now() >= deadline ||
      complete ||
      saving
    )
      throw Error("Identity denied");
    saving = true;
    try {
      await writeFile(
        c.resultFile,
        JSON.stringify({
          issuer: claims.iss,
          subject: claims.sub,
          email: claims.email,
        }) + "\n",
        { mode: 0o600, flag: "wx" },
      );
      complete = true;
      pending.clear();
      reply.raw.once("finish", onSuccess);
    } finally {
      saving = false;
    }
    return reply
      .type("text/plain")
      .send(
        "Your account is verified. You can close this page; Harbor setup will continue.",
      );
  });
  return app;
}
async function privateFile(filename: string) {
  const s = await lstat(filename);
  if (
    !s.isFile() ||
    ![0, process.getuid?.()].includes(s.uid) ||
    (s.mode & 0o007) !== 0 ||
    (s.mode & 0o020) !== 0 ||
    (await realpath(filename)) !== resolve(filename)
  )
    throw Error("Enrollment input must be a protected regular file");
  return readFile(filename, "utf8");
}
export async function assertNewPrivateOutput(output: string) {
  if (resolve(output) !== output)
    throw Error("Enrollment output must be canonical");
  try {
    await lstat(output);
    throw Error("Enrollment output already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const directory = await lstat(dirname(output));
  if (
    !directory.isDirectory() ||
    directory.uid !== process.getuid?.() ||
    (directory.mode & 0o077) !== 0 ||
    (await realpath(dirname(output))) !== dirname(output)
  )
    throw Error(
      "Enrollment output directory must be private and service-owned",
    );
}
export async function runEnrollment(filename: string) {
  if (process.platform !== "linux" || process.getuid?.() === 0)
    throw Error("Enrollment requires a nonroot Linux service");
  const c = enrollmentSchema.parse(JSON.parse(await privateFile(filename)));
  if (c.resultFile === c.startTokenFile)
    throw Error("Enrollment output paths must differ");
  for (const output of [c.resultFile, c.startTokenFile])
    await assertNewPrivateOutput(output);
  const credentials = z
    .object({
      web: z.object({
        client_id: z.string().min(1),
        client_secret: z.string().min(1),
      }),
    })
    .parse(JSON.parse(await privateFile(c.clientFile))).web;
  const client = await oidc.discovery(
    new URL(c.issuer),
    credentials.client_id,
    credentials.client_secret,
  );
  const startToken = randomBytes(32).toString("base64url");
  const app = await buildEnrollment(c, client, startToken, () => {
    void stop();
  });
  await app.listen({ host: "127.0.0.1", port: c.port });
  try {
    await writeFile(
      c.startTokenFile,
      c.origin + "/enroll/" + startToken + "\n",
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    await app.close();
    throw error;
  }
  const stop = async () => {
    clearTimeout(timer);
    await app.close();
    await unlink(c.startTokenFile).catch(() => {});
  };
  const timer = setTimeout(() => void stop(), c.ttlSeconds * 1000);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => void stop());
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runEnrollment(process.argv[2] ?? "").catch(() => {
    console.error(
      "Owner enrollment could not start. Check the private configuration and service permissions.",
    );
    process.exitCode = 1;
  });
