import { emergencyPauseSchedules } from "../../../packages/schedules/src/management.ts";
import { PgBoss } from "pg-boss";
import { scheduleRoutes } from "./schedules.ts";
import { initializeScheduleQueue } from "../../../packages/schedules/src/queue.ts";
import { requestTurnCancellation } from "../../../packages/storage/src/cancellation.ts";
import { attachmentRoutes } from "./attachments.ts";
import { acceptConversationTurn } from "../../../packages/storage/src/turns.ts";
import { effectiveSettings as requireEffectiveSettings } from "../../../packages/policy/src/models.ts";
import { terminalStreams } from "./terminal-stream.ts";
import { terminalRoutes } from "./terminals.ts";
import {
  deploymentAdmission,
  deploymentState,
  verifyInstalledSchema,
} from "../../../packages/storage/src/deployment.ts";
import type { FastifyRequest, FastifyReply } from "fastify";
import { fileRoutes } from "./files.ts";
import { registerWorkspaceRoutes } from "./workspace-routes.ts";
import {
  selectedWorkspace,
  sessionWorkspace,
  verifyWorkspace,
} from "../../../packages/workspaces/src/service.ts";
import {
  authenticateBearer,
  requireAuthority,
  authenticateBrowser,
  lockOwnerIdentity,
  type Authority,
} from "../../../packages/policy/src/authority.ts";
import { authorizeTokenRoute } from "./token-access.ts";
import { registerTokenRoutes } from "./tokens.ts";
import {
  admitOrdinaryIntent,
  lockIntentAdmission,
} from "../../../packages/storage/src/admission.ts";
import { recoveryRoutes } from "./recovery.ts";
import { historyRoutes } from "./history.ts";
import { pruneReplay } from "../../../packages/storage/src/replay.ts";
import { capacity } from "../../../packages/storage/src/capacity.ts";
import {
  createManagedProject,
  validateManagedProject,
  inspectManagedStorage,
} from "../../../infra/storage/client.ts";
import { credentialCommand } from "../../../packages/policy/src/control-client.ts";
import { openapi } from "../../../packages/contracts/src/openapi.ts";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import * as oidc from "openid-client";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import { stat, chmod, readFile } from "node:fs/promises";
import { z } from "zod";
import {
  createPool,
  migrate,
  bindIdentity,
  transaction,
  event,
  publicRow,
} from "../../../packages/storage/src/index.ts";
import {
  HarborError,
  digest,
  secret,
  equalSecret,
  checkKey,
  requireOrigin,
  authorizePermission,
} from "../../../packages/policy/src/index.ts";
import {
  projectSchema,
  sessionSchema,
  turnSchema,
} from "../../../packages/contracts/src/index.ts";
import { resolveProject } from "../../../packages/workspaces/src/index.ts";
import type { Config } from "./config.ts";
import type { PoolClient } from "pg";
export async function buildServer(c: Config) {
  const pool = createPool(c.DATABASE_URL);
  if (process.env.HARBOR_MANAGED_RELEASE) await verifyInstalledSchema(pool);
  else await migrate(pool);
  const ownerPin = digest(c.HARBOR_OIDC_ISSUER + "\0" + c.HARBOR_OWNER_SUBJECT);
  await bindIdentity(pool, ownerPin);
  const client = await oidc.discovery(
    new URL(c.HARBOR_OIDC_ISSUER),
    c.HARBOR_OIDC_CLIENT_ID,
    c.HARBOR_OIDC_CLIENT_SECRET,
    undefined,
    c.HARBOR_FIXTURE_MODE
      ? { execute: [oidc.allowInsecureRequests] }
      : undefined,
  );
  const app = Fastify({ logger: false, bodyLimit: 65536, trustProxy: false });
  await app.register(cookie);
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    path: "/",
    sameSite: "lax" as const,
  };
  const streams = new Map<string, number>();
  const openStreams = new Set<import("node:http").ServerResponse>();
  app.addHook("preClose", async () => {
    for (const stream of openStreams) stream.end();
  });
  const auth = new WeakMap<object, Authority>();
  const externalEffectsGranted = new WeakSet<object>();
  const selfRevocations = new WeakSet<object>();
  app.setErrorHandler((error, request, reply) => {
    const e =
      error instanceof HarborError
        ? error
        : error instanceof z.ZodError
          ? new HarborError(
              400,
              "INVALID_REQUEST",
              "Request does not match schema",
            )
          : (error as { statusCode?: number }).statusCode === 413
            ? new HarborError(
                413,
                "REQUEST_TOO_LARGE",
                "Request exceeds body limit",
              )
            : (error as { statusCode?: number }).statusCode === 400
              ? new HarborError(400, "INVALID_REQUEST", "Malformed request")
              : new HarborError(500, "INTERNAL_ERROR", "Request failed", true);
    reply.code(e.statusCode).send({
      error: {
        code: e.code,
        message: e.message,
        requestId: request.id,
        retryable: e.retryable,
      },
    });
  });
  const rateBuckets = new Map<string, { since: number; count: number }>();
  app.addHook("preValidation", async (req) => {
    const params = req.params as { id?: unknown } | undefined;
    if (params?.id !== undefined) z.uuid().parse(params.id);
  });
  app.addHook("onRequest", async (req, reply) => {
    const now = Date.now(),
      login = req.url.split("?")[0] === "/auth/login",
      window = login ? 60000 : 10000,
      limit = login ? 30 : 200;
    const reserved =
      req.url.includes("/security/") ||
      req.url.endsWith("/cancel") ||
      /^\/api\/v1\/schedules\/[a-f0-9-]{36}\/pause$/.test(
        req.url.split("?")[0],
      ) ||
      req.url.endsWith("/terminate");
    const bucketKey =
      req.ip + ":" + (login ? "login" : reserved ? "control" : "ordinary");
    const bucket = rateBuckets.get(bucketKey);
    if (bucket && now - bucket.since < window) {
      if (++bucket.count > limit)
        throw new HarborError(
          429,
          "RATE_LIMIT",
          "Request rate limit reached",
          true,
        );
    } else {
      if (!bucket && rateBuckets.size >= 1024)
        throw new HarborError(
          429,
          "RATE_LIMIT",
          "Request capacity reached",
          true,
        );
      rateBuckets.set(bucketKey, { since: now, count: 1 });
    }
    if (rateBuckets.size >= 1024)
      for (const [key, value] of rateBuckets) {
        if (now - value.since > 60000) rateBuckets.delete(key);
      }

    reply.headers({
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    });
    if (
      ["/auth/login", "/auth/callback", "/health"].includes(
        req.url.split("?")[0]!,
      )
    )
      return;
    if (req.headers.authorization !== undefined) {
      auth.set(
        req,
        await authenticateBearer(pool, c, req.headers.authorization),
      );
      return;
    }
    const token = req.cookies["__Host-harbor"];
    if (!token)
      throw new HarborError(401, "AUTH_REQUIRED", "Sign in to continue");
    const hash = digest(token);
    const authority = await authenticateBrowser(pool, c, hash);
    auth.set(req, authority);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      requireOrigin(req.headers.origin, c.HARBOR_ORIGIN);
      if (
        typeof req.headers["x-csrf-token"] !== "string" ||
        !equalSecret(req.headers["x-csrf-token"], authority.csrf)
      )
        throw new HarborError(403, "CSRF_DENIED", "CSRF token required");
    }
  });
  app.addHook("preHandler", async (req) => {
    if (auth.has(req)) await authorizeTokenRoute(pool, c, auth.get(req)!, req);
  });
  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ready" };
  });
  app.get("/auth/login", async (_req, reply) => {
    const state = oidc.randomState(),
      verifier = oidc.randomPKCECodeVerifier(),
      nonce = oidc.randomNonce();
    await pool.query("DELETE FROM login_states WHERE expires_at<now()");
    await pool.query(
      "INSERT INTO login_states(hash,verifier,nonce,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
      [digest(state), verifier, nonce],
    );
    reply.setCookie("__Host-harbor-login", state, {
      ...cookieOptions,
      maxAge: 600,
    });
    return reply.redirect(
      oidc.buildAuthorizationUrl(client, {
        redirect_uri: c.HARBOR_ORIGIN + "/auth/callback",
        scope: "openid",
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      }).href,
    );
  });
  app.get("/auth/callback", async (req, reply) => {
    const state = req.cookies["__Host-harbor-login"];
    if (!state)
      throw new HarborError(401, "LOGIN_STATE", "Login state missing");
    const result = await pool.query(
      "DELETE FROM login_states WHERE hash=$1 AND expires_at>now() RETURNING *",
      [digest(state)],
    );
    if (!result.rowCount)
      throw new HarborError(
        401,
        "LOGIN_STATE",
        "Login state expired or consumed",
      );
    const saved = result.rows[0];
    const tokens = await oidc.authorizationCodeGrant(
      client,
      new URL(req.url, c.HARBOR_ORIGIN),
      {
        pkceCodeVerifier: saved.verifier,
        expectedState: state,
        expectedNonce: saved.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (
      claims?.iss !== c.HARBOR_OIDC_ISSUER ||
      claims.sub !== c.HARBOR_OWNER_SUBJECT
    )
      throw new HarborError(
        403,
        "OWNER_DENIED",
        "This identity is not the owner",
      );
    const token = secret(),
      csrf = secret();
    await transaction(pool, async (db) => {
      if (req.cookies["__Host-harbor"])
        await db.query(
          "UPDATE browser_sessions SET revoked=true WHERE hash=$1",
          [digest(req.cookies["__Host-harbor"]!)],
        );
      await db.query(
        "INSERT INTO browser_sessions(hash,csrf,expires_at,identity_pin) VALUES($1,$2,now()+($3*interval '1 second'),$4)",
        [digest(token), csrf, c.HARBOR_ABSOLUTE_SECONDS, ownerPin],
      );
    });
    reply.clearCookie("__Host-harbor-login", cookieOptions);
    reply.setCookie("__Host-harbor", token, {
      ...cookieOptions,
      maxAge: c.HARBOR_ABSOLUTE_SECONDS,
    });
    return reply.redirect("/");
  });
  async function command(req: any, fn: (db: PoolClient) => Promise<unknown>) {
    const actor =
        auth.get(req)!.kind === "token"
          ? auth.get(req)!.hash
          : c.HARBOR_OWNER_SUBJECT,
      route = req.routeOptions.url as string,
      key = req.headers["idempotency-key"];
    if (typeof key !== "string")
      throw new HarborError(
        400,
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key required",
      );
    const hash = digest(
      JSON.stringify({ params: req.params, body: req.body ?? {} }),
    );
    return transaction(pool, async (db) => {
      if (route === "/api/v1/security/emergency-stop") {
        await lockOwnerIdentity(db);
        // Match schedule owner/meta -> actor -> schedule/resource ordering.
        await db.query("SELECT generation FROM harbor_meta FOR UPDATE");
      }
      if (route === "/api/v1/security/logout") {
        await lockOwnerIdentity(db);
        await db.query(
          "SELECT hash FROM browser_sessions WHERE hash=$1 FOR UPDATE",
          [auth.get(req)!.hash],
        );
      }
      await requireAuthority(db, auth.get(req)!.hash, c);
      if (auth.get(req)!.kind === "token")
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "token-intents:" + actor,
        ]);
      await authorizeTokenRoute(db, c, auth.get(req)!, req);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        actor + route + key,
      ]);
      const old = await db.query(
        "SELECT * FROM intents WHERE actor=$1 AND route=$2 AND key=$3",
        [actor, route, key],
      );
      if (old.rowCount) {
        if (old.rows[0].request_hash !== hash)
          throw new HarborError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Key already identifies different input",
          );
        await requireAuthority(db, auth.get(req)!.hash, c);
        return old.rows[0].result;
      }
      checkKey(key);
      await lockIntentAdmission(db, actor);
      if (
        route === "/api/v1/security/emergency-stop" &&
        (await db.query("SELECT emergency FROM harbor_meta FOR UPDATE")).rows[0]
          .emergency
      ) {
        await requireAuthority(db, auth.get(req)!.hash, c);
        return { stopped: true };
      }
      const reserved =
        route.endsWith("/cancel") ||
        route.endsWith("/terminate") ||
        route.endsWith("/answer") ||
        route.endsWith("/recovery") ||
        route.endsWith("/recovery/continue") ||
        route === "/api/v1/security/emergency-stop" ||
        route === "/api/v1/security/logout" ||
        (route.includes("/file-operations/") &&
          (route.endsWith("/inspect") || route.endsWith("/release")));
      if (!reserved) await admitOrdinaryIntent(db, actor);
      const reservedFileControl =
        route.includes("/file-operations/") &&
        (route.endsWith("/inspect") || route.endsWith("/release"));
      if (auth.get(req)!.kind === "token" && !reservedFileControl) {
        const reserve =
          route.endsWith("/cancel") ||
          route.endsWith("/answer") ||
          route.endsWith("/terminate");
        if (
          Number(
            (
              await db.query("SELECT count(*) FROM intents WHERE actor=$1", [
                actor,
              ])
            ).rows[0].count,
          ) >= (reserve ? 1100 : 1000)
        )
          throw new HarborError(
            429,
            "TOKEN_INTENT_QUOTA",
            "Token intent quota reached; existing intents remain retryable and owner browser controls remain available",
          );
      }
      await requireAuthority(db, auth.get(req)!.hash, c);
      await deploymentAdmission(
        db,
        route.endsWith("/cancel") ||
          route.endsWith("/answer") ||
          [
            "/api/v1/security/emergency-stop",
            "/api/v1/security/logout",
          ].includes(route),
      );
      const result = await fn(db);
      if (!externalEffectsGranted.has(req) && !selfRevocations.has(req))
        await requireAuthority(db, auth.get(req)!.hash, c);
      if (route === "/api/v1/security/emergency-stop") return result;
      const controlTarget =
        route.includes("/file-operations/") && route.endsWith("/inspect")
          ? "file-inspect:" + req.params.operationId
          : route.includes("/file-operations/") && route.endsWith("/release")
            ? "file-release:" + req.params.operationId
            : route === "/api/v1/security/logout"
              ? "logout:" + auth.get(req)!.hash
              : route.endsWith("/terminate")
                ? "terminal:" + req.params.id
                : route.endsWith("/cancel")
                  ? "cancel:" + req.params.id
                  : route.endsWith("/answer")
                    ? "approval:" + req.params.id
                    : route.endsWith("/recovery/continue")
                      ? "continue:" + req.body.recoveryId
                      : route.endsWith("/recovery")
                        ? "recovery:" + (result as any).recovery.id
                        : null;
      const limit = controlTarget
        ? controlTarget.startsWith("continue:") ||
          controlTarget.startsWith("logout:") ||
          controlTarget.startsWith("file-release:")
          ? 1
          : 3
        : 10000;
      const count = Number(
        (
          await db.query(
            "SELECT count(*) FROM intents WHERE actor=$1 AND control_target IS NOT DISTINCT FROM $2",
            [actor, controlTarget],
          )
        ).rows[0].count,
      );
      if (controlTarget && count >= limit)
        throw new HarborError(
          429,
          "INTENT_QUOTA",
          controlTarget
            ? "This target's control attempts are exhausted; emergency stop remains available"
            : "Ordinary request history capacity reached; reserved controls remain available",
        );
      if (controlTarget && Buffer.byteLength(JSON.stringify(result)) > 8192)
        throw new HarborError(
          500,
          "CONTROL_RESULT_LIMIT",
          "Control result exceeds its storage reservation",
        );
      await db.query(
        "INSERT INTO intents(actor,route,key,request_hash,result,control_target) VALUES($1,$2,$3,$4,$5,$6)",
        [actor, route, key, hash, JSON.stringify(result), controlTarget],
      );
      return result;
    });
  }
  const effectiveSettings = (db: PoolClient, model: string, effort: string) =>
    requireEffectiveSettings(db, model, effort, c.models);
  async function session(db: any, id: string) {
    const r = await db.query("SELECT * FROM sessions WHERE id=$1", [id]);
    if (!r.rowCount)
      throw new HarborError(404, "NOT_FOUND", "Conversation not found");
    return r.rows[0];
  }
  const lockWorkspace = async (db: PoolClient, id: string) => {
    await sessionWorkspace(db, id, true);
  };
  fileRoutes(app, { pool, c, command, actor: (req) => auth.get(req)!.hash });
  historyRoutes(app, { pool, command, lockWorkspace });
  recoveryRoutes(app, {
    pool,
    command,
    actor: (req) => auth.get(req)!.hash,
    acceptTurn,
    lockWorkspace,
  });
  registerWorkspaceRoutes(app, {
    pool,
    c,
    command,
    actor: (req) => auth.get(req)!.hash,
  });
  registerTokenRoutes(app, pool, c, command);
  const scheduleBoss = new PgBoss({
    connectionString: c.DATABASE_URL,
    supervise: false,
    schedule: false,
  });
  scheduleBoss.on("error", () => {});
  await scheduleBoss.start();
  await initializeScheduleQueue(scheduleBoss);
  scheduleRoutes(app, {
    pool,
    c,
    boss: scheduleBoss,
    authority: (req) => auth.get(req)!,
    command,
  });
  app.addHook("onClose", async () => scheduleBoss.stop());
  app.get("/api/v1/openapi.json", async () => openapi);
  app.get("/api/v1/security/runtime-credentials", async (req) =>
    credentialCommand(c.HARBOR_CONTROL_SOCKET, {
      action: "status",
      actor: auth.get(req)!.hash,
    }),
  );
  app.post("/api/v1/security/runtime-credentials", async (req) => {
    const body = z
      .object({ apiKey: z.string().min(16).max(4096) })
      .strict()
      .parse(req.body);
    return credentialCommand(c.HARBOR_CONTROL_SOCKET, {
      action: "set",
      actor: auth.get(req)!.hash,
      idempotencyKey: req.headers["idempotency-key"],
      apiKey: body.apiKey,
    });
  });
  app.post("/api/v1/security/runtime-credentials/remove", async (req) => {
    z.object({}).strict().parse(req.body);
    return credentialCommand(c.HARBOR_CONTROL_SOCKET, {
      action: "remove",
      actor: auth.get(req)!.hash,
      idempotencyKey: req.headers["idempotency-key"],
    });
  });
  app.get("/api/v1/me", async (req) => ({
    owner: { subject: c.HARBOR_OWNER_SUBJECT },
    csrfToken: auth.get(req)!.csrf,
  }));
  app.get("/api/v1/project-roots", async () => ({
    roots: c.roots.map(({ id, name }) => ({ id, name })),
  }));
  app.get("/api/v1/capabilities", async (req) => ({
    files: {
      read: !!(
        process.env.HARBOR_FILE_SOCKET ?? process.env.HARBOR_STORAGE_SOCKET
      ),
      write:
        process.platform === "linux" &&
        !!(
          process.env.HARBOR_FILE_SOCKET ?? process.env.HARBOR_STORAGE_SOCKET
        ) &&
        c.HARBOR_PERMISSION_CEILING === "workspace-write",
      reason:
        process.platform !== "linux"
          ? "Writes require the supported Linux filesystem boundary"
          : !(
                process.env.HARBOR_FILE_SOCKET ??
                process.env.HARBOR_STORAGE_SOCKET
              )
            ? "Configure the trusted file service"
            : null,
    },
    emergencyStopped: (await pool.query("SELECT emergency FROM harbor_meta"))
      .rows[0].emergency,
    models: (
      (
        await pool.query(
          "SELECT data FROM runtime_capabilities WHERE updated_at>now()-interval '1 hour'",
        )
      ).rows[0]?.data?.data ?? []
    )
      .filter((m: any) => c.models.includes(m.model ?? m.id))
      .map((m: any) => ({
        id: m.model ?? m.id,
        name: m.displayName ?? m.model ?? m.id,
        inputModalities: (m.inputModalities ?? []).filter((v: string) =>
          ["text", "image"].includes(v),
        ),
        efforts: (m.supportedReasoningEfforts ?? [])
          .map((e: any) => e.reasoningEffort)
          .filter((e: string) => ["low", "medium", "high"].includes(e)),
      })),
    permissionProfiles:
      c.HARBOR_PERMISSION_CEILING === "workspace-write" &&
      auth.get(req)!.permissionProfile !== "read-only"
        ? ["read-only", "workspace-write"]
        : ["read-only"],
    limits: {
      maxProjects: c.HARBOR_MAX_PROJECTS,
      maxSessions: c.HARBOR_MAX_SESSIONS,
      maxQueued: c.HARBOR_MAX_QUEUED,
      maxInputBytes: 32768,
      maxConversationBytes: 2097152,
      replayEventLimit: 2000,
      retryWindowHours: 24,
    },
    runtime: { version: "0.153.4", experimental: true },
    account: (await pool.query("SELECT data FROM runtime_capabilities")).rows[0]
      ?.data?.account ?? { authenticated: false, authMode: null },
  }));
  app.get("/api/v1/projects", async (req) => ({
    projects: (
      await pool.query(
        "SELECT * FROM projects WHERE ($1::uuid[] IS NULL OR id=ANY($1)) ORDER BY created_at",
        [auth.get(req)!.projectIds ?? null],
      )
    ).rows.map(publicRow),
  }));
  app.get<{ Params: { id: string } }>(
    "/api/v1/projects/:id/storage",
    async (req) => {
      const project = (
        await pool.query("SELECT * FROM projects WHERE id=$1", [req.params.id])
      ).rows[0];
      if (!project)
        throw new HarborError(404, "NOT_FOUND", "Project not found");
      try {
        return await inspectManagedStorage(
          project.root_id,
          project.relative_path,
        );
      } catch {
        return { status: "unavailable" };
      }
    },
  );
  app.post("/api/v1/projects", async (req) =>
    command(req, async (db) => {
      const b = projectSchema.parse(req.body);
      await db.query("SELECT pg_advisory_xact_lock(740012)");
      if (
        Number(
          (await db.query("SELECT count(*) FROM projects")).rows[0].count,
        ) >= c.HARBOR_MAX_PROJECTS
      )
        throw new HarborError(429, "PROJECT_QUOTA", "Project limit reached");
      const root = c.roots.find((root) => root.id === b.rootId);
      if (!root)
        throw new HarborError(
          403,
          "ROOT_DENIED",
          "Project root is not allowed",
        );
      // Existing browser-authorized storage work keeps its accepted grant.
      // Expiry after filesystem effects cannot undo them by rolling back SQL.
      await requireAuthority(db, auth.get(req)!.hash, c);
      externalEffectsGranted.add(req);
      const provisioned =
        c.HARBOR_FIXTURE_MODE && !process.env.HARBOR_STORAGE_SOCKET
          ? null
          : await (b.create
              ? createManagedProject(b.rootId, b.path)
              : validateManagedProject(b.rootId, b.path));
      const canonical =
        provisioned?.canonical ??
        (await resolveProject(c.roots, b.rootId, b.path, b.create));
      if (c.HARBOR_FIXTURE_MODE && !provisioned && b.create)
        await chmod(canonical, 0o755);
      const storedRelative = path.relative(root.path, canonical);
      const identity = provisioned
        ? { dev: provisioned.device, ino: provisioned.inode }
        : await stat(canonical, { bigint: true });
      const registered = await db.query("SELECT canonical_path FROM projects");
      if (
        registered.rows.some(
          (row) =>
            row.canonical_path === canonical ||
            row.canonical_path.startsWith(canonical + path.sep) ||
            canonical.startsWith(row.canonical_path + path.sep),
        )
      )
        throw new HarborError(
          409,
          "PROJECT_OVERLAP",
          "Project folders must be disjoint",
        );
      const id = randomUUID();
      const row = await db.query(
        "INSERT INTO projects(id,name,root_id,relative_path,device,inode,canonical_path) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          id,
          b.name,
          b.rootId,
          storedRelative,
          String(identity.dev),
          String(identity.ino),
          canonical,
        ],
      );
      await db.query(
        "INSERT INTO workspaces(id,project_id,relative_path,canonical_path,device,inode) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          id,
          storedRelative,
          canonical,
          String(identity.dev),
          String(identity.ino),
        ],
      );
      return { project: publicRow(row.rows[0]) };
    }),
  );
  app.get("/api/v1/sessions", async (req) => ({
    sessions: (
      await pool.query(
        "SELECT * FROM sessions WHERE NOT archived AND ($1::uuid[] IS NULL OR project_id=ANY($1)) ORDER BY updated_at DESC",
        [auth.get(req)!.projectIds ?? null],
      )
    ).rows.map(publicRow),
  }));
  app.post("/api/v1/sessions", async (req) =>
    command(req, async (db) => {
      const b = sessionSchema.parse(req.body);
      authorizePermission(b.permissionProfile, c.HARBOR_PERMISSION_CEILING);
      await effectiveSettings(db, b.model, b.effort);
      if (!c.models.includes(b.model))
        throw new HarborError(403, "MODEL_DENIED", "Model unavailable");
      await db.query("SELECT pg_advisory_xact_lock(740013)");
      if (
        Number(
          (await db.query("SELECT count(*) FROM sessions")).rows[0].count,
        ) >= c.HARBOR_MAX_SESSIONS
      )
        throw new HarborError(
          429,
          "SESSION_QUOTA",
          "Conversation limit reached",
        );
      const choice = await db.query(
        "SELECT id FROM workspaces WHERE project_id=$1 AND ($2::uuid IS NULL AND kind='local' OR id=$2)",
        [b.projectId, b.workspaceId ?? null],
      );
      if (!choice.rowCount)
        throw new HarborError(
          404,
          "NOT_FOUND",
          "Workspace not found in project",
        );
      const chosen = await selectedWorkspace(db, choice.rows[0].id, true);
      if (chosen.project_archived || chosen.state !== "ready")
        throw new HarborError(
          409,
          "WORKSPACE_UNAVAILABLE",
          "Select an available workspace",
        );
      await verifyWorkspace(chosen);
      const r = await db.query(
        "INSERT INTO sessions(id,project_id,workspace_id,title,model,effort,permission_profile) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          randomUUID(),
          b.projectId,
          chosen.id,
          b.title,
          b.model,
          b.effort,
          b.permissionProfile,
        ],
      );
      return { session: publicRow(r.rows[0]) };
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/snapshot",
    async (req) =>
      transaction(pool, async (db) => {
        await pruneReplay(db, req.params.id);
        const s = await session(db, req.params.id);
        return {
          session: publicRow(s),
          processes: s.process_inspection,
          storage: {
            conversationBytes: Number(
              (
                await db.query(
                  "SELECT coalesce(sum(octet_length(text)),0) AS bytes FROM messages WHERE session_id=$1",
                  [s.id],
                )
              ).rows[0].bytes,
            ),
            conversationLimitBytes: 2097152,
          },
          messages: (
            await db.query(
              "SELECT id,operation_id,role,text,status,created_at FROM messages WHERE session_id=$1 ORDER BY created_at,id",
              [s.id],
            )
          ).rows.map(publicRow),
          operations: (
            await db.query(
              "SELECT * FROM operations WHERE session_id=$1 ORDER BY created_at",
              [s.id],
            )
          ).rows.map(publicRow),
          approvals: (
            await db.query(
              "SELECT * FROM approvals WHERE session_id=$1 ORDER BY deadline",
              [s.id],
            )
          ).rows.map(publicRow),
          cursor: Number(s.sequence),
        };
      }),
  );
  async function acceptTurn(req: any, db: PoolClient, input: unknown) {
    return acceptConversationTurn(db, req.params.id, input, c, {
      actor: auth.get(req)!.hash,
      authorize: async (db) => {
        await requireAuthority(db, auth.get(req)!.hash, c);
        await authorizeTokenRoute(db, c, auth.get(req)!, req);
      },
    });
  }

  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/turns",
    async (req, reply) => {
      const result = await command(req, async (db) => {
        return acceptTurn(req, db, req.body);
      });
      return reply.code(202).send(result);
    },
  );
  attachmentRoutes(app, pool, command);
  terminalRoutes(app, {
    pool,
    c,
    command,
    actor: (req) => auth.get(req)!.hash,
  });
  terminalStreams(app, {
    pool,
    c,
    command,
    actor: (req) => auth.get(req)!.hash,
  });
  app.get<{ Params: { id: string } }>("/api/v1/operations/:id", async (req) => {
    const r = await pool.query("SELECT * FROM operations WHERE id=$1", [
      req.params.id,
    ]);
    if (!r.rowCount)
      throw new HarborError(404, "NOT_FOUND", "Operation not found");
    return { operation: publicRow(r.rows[0]) };
  });
  app.post<{ Params: { id: string } }>(
    "/api/v1/approvals/:id/answer",
    async (req, reply) =>
      reply.code(202).send(
        await command(req, async (db) => {
          const b = z
            .object({
              generation: z.number().int(),
              decision: z.enum(["accept", "decline"]),
              answers: z
                .record(
                  z.string(),
                  z.object({ answers: z.array(z.string().max(4096)).max(20) }),
                )
                .optional(),
            })
            .strict()
            .parse(req.body);
          await db.query(
            "SELECT s.id FROM sessions s JOIN approvals a ON a.session_id=s.id WHERE a.id=$1 FOR UPDATE OF s",
            [req.params.id],
          );
          const r = await db.query(
            "SELECT a.*,s.permission_profile,s.generation AS current_generation FROM approvals a JOIN sessions s ON s.id=a.session_id WHERE a.id=$1 FOR UPDATE OF a",
            [req.params.id],
          );
          const a = r.rows[0];
          if (!a) throw new HarborError(404, "NOT_FOUND", "Approval not found");
          authorizePermission(
            a.permission_profile,
            c.HARBOR_PERMISSION_CEILING,
          );
          if (
            a.state !== "pending" ||
            Number(a.generation) !== b.generation ||
            new Date(a.deadline).getTime() <= Date.now() ||
            Number(a.current_generation) !== b.generation
          )
            throw new HarborError(
              409,
              "STALE_APPROVAL",
              "Approval is stale or already answered",
            );
          const input = a.kind === "item/tool/requestUserInput";
          if (!input && b.answers !== undefined)
            throw new HarborError(
              400,
              "INVALID_ANSWER",
              "Command approval does not accept input answers",
            );
          if (b.decision === "decline" && b.answers !== undefined)
            throw new HarborError(
              400,
              "INVALID_ANSWER",
              "Decline cannot contain answers",
            );
          if (input && b.decision === "accept") {
            const ids = (a.scope.questions ?? []).map(
              (q: any) => q.id as string,
            );
            if (
              !b.answers ||
              Object.keys(b.answers).length !== ids.length ||
              ids.some((id: string) => !b.answers?.[id]?.answers.length) ||
              Object.keys(b.answers).some((id) => !ids.includes(id))
            )
              throw new HarborError(
                400,
                "INVALID_ANSWER",
                "Answer every requested question with its exact identifier",
              );
          }
          await db.query(
            "UPDATE approvals SET state='answering',answer=$2,answer_actor_hash=$3 WHERE id=$1",
            [a.id, JSON.stringify(b), auth.get(req)!.hash],
          );
          await event(db, a.session_id, "approval.answering", {
            approvalId: a.id,
          });
          return { approval: { id: a.id, state: "answering" } };
        }),
      ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/turns/:id/cancel",
    async (req, reply) =>
      reply.code(202).send(
        await command(req, async (db) => {
          return requestTurnCancellation(db, req.params.id, {
            actor: auth.get(req)!.hash,
            authorize: async (db) => {
              await requireAuthority(db, auth.get(req)!.hash, c);
              await authorizeTokenRoute(db, c, auth.get(req)!, req);
            },
          });
        }),
      ),
  );
  app.post("/api/v1/security/emergency-stop", async (req) =>
    command(req, async (db) => {
      await db.query("UPDATE harbor_meta SET emergency=true");
      await emergencyPauseSchedules(db);
      await db.query("INSERT INTO audits(kind) VALUES('emergency-stop')");
      return { stopped: true };
    }),
  );
  app.post("/api/v1/security/logout", async (req, reply) => {
    const result = await command(req, async (db) => {
      await requireAuthority(db, auth.get(req)!.hash, c);
      selfRevocations.add(req);
      await db.query("UPDATE browser_sessions SET revoked=true WHERE hash=$1", [
        auth.get(req)!.hash,
      ]);
      return { loggedOut: true };
    });
    reply.clearCookie("__Host-harbor", cookieOptions);
    return result;
  });
  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
    "/api/v1/sessions/:id/events",
    async (req, reply) => {
      await session(pool, req.params.id);
      requireOrigin(req.headers.origin ?? c.HARBOR_ORIGIN, c.HARBOR_ORIGIN);
      let cursor = Number(
        req.headers["last-event-id"] ?? req.query.cursor ?? 0,
      );
      if (!Number.isSafeInteger(cursor) || cursor < 0)
        throw new HarborError(400, "INVALID_CURSOR", "Invalid replay cursor");
      const streamOwner = auth.get(req)!.hash;
      if ((streams.get(streamOwner) ?? 0) >= 4)
        throw new HarborError(429, "STREAM_QUOTA", "Too many event streams");
      await pruneReplay(pool, req.params.id);
      const bounds = await pool.query(
        "SELECT s.sequence,(SELECT min(e.sequence) FROM events e WHERE e.session_id=s.id) AS oldest FROM sessions s WHERE s.id=$1",
        [req.params.id],
      );
      const needsSnapshot =
        cursor > Number(bounds.rows[0].sequence) ||
        (cursor < Number(bounds.rows[0].sequence) &&
          (bounds.rows[0].oldest === null ||
            cursor < Number(bounds.rows[0].oldest) - 1));
      streams.set(streamOwner, (streams.get(streamOwner) ?? 0) + 1);
      reply.hijack();
      openStreams.add(reply.raw);
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      if (needsSnapshot) {
        openStreams.delete(reply.raw);
        reply.raw.end(
          'event: resync\ndata: {"reason":"Replay retention gap; fetch snapshot"}\n\n',
        );
        streams.set(
          streamOwner,
          Math.max(0, (streams.get(streamOwner) ?? 1) - 1),
        );
        return;
      }
      let busy = false;
      const timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          await requireAuthority(pool, auth.get(req)!.hash, c, {
            scope: "read",
            projectId: (await session(pool as any, req.params.id)).project_id,
          });
          const current = await pruneReplay(pool, req.params.id);
          if (
            !current ||
            cursor < Number(current.replay_floor) ||
            cursor > Number(current.sequence)
          ) {
            reply.raw.end(
              'event: resync\ndata: {"reason":"Replay retention gap; fetch snapshot"}\n\n',
            );
            return;
          }
          const rows = await pool.query(
            "SELECT * FROM events WHERE session_id=$1 AND sequence>$2 AND created_at>=now()-interval '7 days' ORDER BY sequence LIMIT 100",
            [req.params.id, cursor],
          );
          for (const row of rows.rows) {
            if (Number(row.sequence) !== cursor + 1) {
              reply.raw.end(
                'event: resync\ndata: {"reason":"Replay retention gap; fetch snapshot"}\n\n',
              );
              return;
            }
            cursor = Number(row.sequence);
            if (
              !reply.raw.write(
                `id: ${cursor}\ndata: ${JSON.stringify({ schemaVersion: 1, conversationId: req.params.id, sequence: cursor, type: row.type, timestamp: row.created_at.toISOString(), data: row.data })}\n\n`,
              )
            ) {
              reply.raw.end();
              return;
            }
          }
          if (!rows.rowCount) reply.raw.write(": heartbeat\n\n");
        } catch {
          reply.raw.end();
        } finally {
          busy = false;
        }
      }, 250);
      reply.raw.on("close", () => {
        openStreams.delete(reply.raw);
        clearInterval(timer);
        streams.set(
          streamOwner,
          Math.max(0, (streams.get(streamOwner) ?? 1) - 1),
        );
      });
    },
  );
  async function applicationDocument(
    _req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const nonce = randomBytes(24).toString("base64"),
      html = await readFile(path.resolve("apps/web/dist/index.html"), "utf8");
    const policy = String(reply.getHeader("Content-Security-Policy"));
    reply.header(
      "Content-Security-Policy",
      policy.replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`),
    );
    return reply
      .type("text/html; charset=utf-8")
      .send(
        html.replace(
          "<head>",
          `<head><meta name="harbor-style-nonce" content="${nonce}">`,
        ),
      );
  }
  app.get("/", applicationDocument);
  app.get("/index.html", applicationDocument);
  await app.register(staticFiles, {
    root: path.resolve("apps/web/dist"),
    wildcard: false,
    index: false,
    globIgnore: ["index.html"],
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/"))
      throw new HarborError(404, "NOT_FOUND", "Route not found");
    return applicationDocument(req, reply);
  });
  app.addHook("onClose", async () => pool.end());
  return app;
}
