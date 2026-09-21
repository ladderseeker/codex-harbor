if (process.argv.includes("--previews")) {
  await import("../previews/e2e.ts");
  process.exit(process.exitCode ?? 0);
}
import { scheduleDstE2e } from "../schedules/dst-e2e.ts";
import { scheduleE2e } from "../schedules/e2e.ts";
if (process.argv.includes("--terminals")) {
  await import("../terminals/e2e.ts");
  process.exit(process.exitCode ?? 0);
}
import { p005 } from "./p005.ts";
import { acknowledgementContention } from "./acknowledgement.ts";
import { conversationLockOrder } from "./conversation-lock-order.ts";
import { p007 } from "./p007.ts";
import { p023 } from "./p023.ts";
import { p024 } from "./p024.ts";
import { p014 } from "./p014.ts";
import { createPool } from "../../packages/storage/src/index.ts";
import {
  claimWorkspace,
  workspaceAdmission,
  WorkspaceAdmissionChanged,
} from "../../apps/supervisor/src/workspace-admission.ts";
if (process.argv.includes("--files")) {
  await import("../files/e2e.ts");
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes("--workspaces")) {
  await import("../workspaces/e2e.ts");
  process.exit(process.exitCode ?? 0);
}
import { authorityExpiry } from "./authority-expiry.ts";
import { p002 } from "./p002.ts";
import { sourceDigest } from "../../scripts/source-digest.ts";
import { localComposeFiles } from "../../infra/compose.ts";
import { maintain } from "../../packages/storage/src/maintenance.ts";
import { checkKey } from "../../packages/policy/src/index.ts";
import { Ajv2020 } from "ajv/dist/2020.js";
import pg from "pg";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
import { chromium, expect, request as apiRequest } from "@playwright/test";
import ts from "typescript";
const sourceAtStart = sourceDigest();
const children: ChildProcess[] = [];
let diagnosticText = "";
let rotationBearer = "";
const commandResponses: {
  sequence: number;
  path: string;
  startedAt: number;
  elapsedMs: number;
  status: number;
  errorCode: string | null;
}[] = [];
let commandSequence = 0;
let runFailed = false;
function safeProcessDiagnostics() {
  const sqlStateMatches: Record<string, number> = {};
  for (const match of diagnosticText.matchAll(
    /(?:["']?code["']?|SQLSTATE)\s*[:=]\s*["']?(40001|40P01|23505|23503|23514|25P02|57014|57P01|08006|53300|P0001)\b/g,
  ))
    sqlStateMatches[match[1]] = (sqlStateMatches[match[1]] ?? 0) + 1;
  const categories = {
    retiredRuntimeCleanupPending:
      "Empty retired runtime ownership cleanup remains pending",
    scheduleReconciliationPending:
      "Schedule metadata reconciliation remains pending",
    fileSettlementPending: "File effect settlement remains pending",
    previewRetirementUnconfirmed: "preview-retirement-unconfirmed",
  };
  return {
    retainedCharacterLimit: 131072,
    sqlStateMatches,
    fixedCategoryMatches: Object.fromEntries(
      Object.entries(categories).map(([key, text]) => [
        key,
        diagnosticText.split(text).length - 1,
      ]),
    ),
    children: children.map((child, index) => ({
      index,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
    })),
    limits:
      "Only allowlisted matches in retained output; handled API errors may not be logged, and absence is not evidence of no internal error",
  };
}
const serve = process.argv.includes("--serve");
const designOnly = process.argv.includes("--design");
const p002Only = process.argv.includes("--p002-only");
const schedulesDstOnly = process.argv.includes("--schedules-dst");
const schedulesOnly = process.argv.includes("--schedules") || schedulesDstOnly;
if (
  p002Only &&
  (serve || designOnly || schedulesOnly || process.argv.includes("--critical"))
)
  throw Error("--p002-only requires its own isolated diagnostic run");
const dir = await mkdtemp(
    path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "harbor-e2e-",
    ),
  ),
  instance = "harbor-e2e-" + randomBytes(5).toString("hex");
async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
const [dbPort, apiPort, httpsPort, oidcPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
]);
const rootId = randomUUID(),
  origin = `https://localhost:${httpsPort}`,
  password = randomBytes(24).toString("hex");
const artifacts = path.resolve(".test-runs", instance);
const env = {
  ...process.env,
  NODE_ENV: "test",
  HARBOR_FIXTURE_MODE: "private-test",
  ...(schedulesOnly ? { HARBOR_SCHEDULE_TEST_CLOCK: "1" } : {}),
  HARBOR_INSTANCE_ID: instance,
  HARBOR_DATABASE_PASSWORD: password,
  HARBOR_DATABASE_PORT: String(dbPort),
  HARBOR_API_PORT: String(apiPort),
  HARBOR_HTTPS_PORT: String(httpsPort),
  HARBOR_PORT: String(apiPort),
  HARBOR_ORIGIN: origin,
  DATABASE_URL: `postgres://harbor:${password}@127.0.0.1:${dbPort}/harbor`,
  OIDC_PORT: String(oidcPort),
  HARBOR_OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
  HARBOR_OIDC_CLIENT_ID: instance,
  HARBOR_OWNER_SUBJECT: "owner",
  HARBOR_PROJECT_ROOTS: JSON.stringify([
    { id: rootId, name: "Test root", path: path.join(dir, "project-roots") },
  ]),
  HARBOR_MODELS: designOnly ? "fixture,gpt-6-astra" : "fixture",
  ...(designOnly ? { HARBOR_FIXTURE_EXTENDED_MODELS: "1" } : {}),
  HARBOR_CONTROL_SOCKET: path.join(dir, "control", "supervisor.sock"),
  HARBOR_CREDENTIAL_KEY_FILE: path.join(dir, "control", "key"),
  HARBOR_FIXTURE_INIT_DELAY_MS: "0",
  HARBOR_FIXTURE_STATE_DIR: path.join(dir, "fixture-state"),
  HARBOR_FIXTURE_TRACE_FILE: path.join(dir, "dispatch-trace.jsonl"),
  HARBOR_PERMISSION_CEILING: "workspace-write",
};
const compose = (args: string[]) =>
  execFileSync("docker", ["compose", ...localComposeFiles(), ...args], {
    env,
    stdio: "pipe",
    timeout: 120000,
  });
const normalizeDiagnosticSql = (sql: string) => sql.trim().replace(/\s+/g, " ");
async function staticSqlSources() {
  const statements = new Map<string, string[]>();
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const source = ts.createSourceFile(
          filename,
          await readFile(filename, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        const inspect = (node: ts.Node) => {
          if (
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node)
          ) {
            const sql = normalizeDiagnosticSql(node.text);
            if (
              /^(SELECT|UPDATE|INSERT|DELETE|WITH|BEGIN|COMMIT|ROLLBACK|SET|LOCK)\b/i.test(
                sql,
              )
            ) {
              const line =
                source.getLineAndCharacterOfPosition(node.getStart(source))
                  .line + 1;
              const anchors = statements.get(sql) ?? [];
              anchors.push(`${filename.split(path.sep).join("/")}:${line}`);
              statements.set(sql, anchors);
            }
          }
          ts.forEachChild(node, inspect);
        };
        inspect(source);
      }
    }
  }
  for (const directory of [
    "apps/api/src",
    "apps/supervisor/src",
    "packages/storage/src",
    "packages/workspaces/src",
  ])
    await visit(directory);
  return statements;
}
function deadlockStatementSources(
  logs: string,
  sources: Map<string, string[]>,
) {
  const statements: {
    deadlockIndex: number;
    processId: string;
    queryHash: string;
    classification: "static_sql_literal" | "unknown";
    sourceAnchors: string[];
    sourceAnchorCount: number;
  }[] = [];
  let deadlockIndex = 0;
  let inDeadlockDetail = false;
  let current: { processId: string; sql: string } | undefined;
  const finish = () => {
    if (!current) return;
    const normalized = normalizeDiagnosticSql(current.sql);
    const anchors = sources.get(normalized) ?? [];
    statements.push({
      deadlockIndex,
      processId: current.processId,
      queryHash: createHash("sha256").update(normalized).digest("hex"),
      classification: anchors.length ? "static_sql_literal" : "unknown",
      sourceAnchors: anchors.slice(0, 16),
      sourceAnchorCount: anchors.length,
    });
    if (statements.length > 80) statements.shift();
    current = undefined;
  };
  for (const line of logs.split("\n")) {
    const record = line.match(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC \[\d+\] ([A-Z]+):\s+(.*)$/,
    );
    if (record) {
      finish();
      if (record[1] === "ERROR" && record[2] === "deadlock detected") {
        deadlockIndex++;
        inDeadlockDetail = true;
      } else if (record[1] !== "DETAIL") inDeadlockDetail = false;
    }
    if (!inDeadlockDetail) continue;
    const statement = (record ? record[2] : line.trimStart()).match(
      /^Process (\d+): (.*)$/,
    );
    if (statement) {
      finish();
      current = { processId: statement[1], sql: statement[2] };
    } else if (current && !record) current.sql += "\n" + line;
  }
  finish();
  return statements;
}
async function capturePostgresDiagnostics() {
  const startedAt = Date.now();
  const byteLimit = 1024 * 1024;
  let logs = "";
  let captureStatus = "captured";
  try {
    // Raw output stays in bounded memory; never serialize command errors or SQL.
    logs = execFileSync(
      "docker",
      [
        "compose",
        ...localComposeFiles(),
        "logs",
        "--no-color",
        "--no-log-prefix",
        "--tail",
        "2000",
        "postgres",
      ],
      { env, stdio: "pipe", timeout: 15000, maxBuffer: byteLimit },
    ).toString();
  } catch {
    captureStatus = "unavailable_or_limit_exceeded";
  }
  const categories: Record<string, string> = {
    "deadlock detected": "deadlock_detected",
    "could not serialize access due to concurrent update":
      "serialization_concurrent_update",
    "could not serialize access due to concurrent delete":
      "serialization_concurrent_delete",
    "could not serialize access due to read/write dependencies among transactions":
      "serialization_dependencies",
    "canceling statement due to statement timeout": "statement_timeout",
    "canceling statement due to lock timeout": "lock_timeout",
    "current transaction is aborted, commands ignored until end of transaction block":
      "transaction_aborted",
  };
  const counts = Object.fromEntries(
    Object.values(categories).map((category) => [category, 0]),
  );
  const errors: { timestamp: string; processId: string; category: string }[] =
    [];
  for (const line of logs.split("\n")) {
    const match = line.match(
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC) \[(\d+)\] ERROR:\s+(.+)$/,
    );
    const category = match && categories[match[3]];
    if (!match || !category) continue;
    counts[category]++;
    errors.push({ timestamp: match[1], processId: match[2], category });
    if (errors.length > 80) errors.shift();
  }
  const deadlockWaits = [
    ...logs.matchAll(
      /(?:DETAIL:\s+|^\s*)Process (\d+) waits for (AccessShareLock|RowShareLock|RowExclusiveLock|ShareUpdateExclusiveLock|ShareLock|ShareRowExclusiveLock|ExclusiveLock|AccessExclusiveLock) on transaction (\d+); blocked by process (\d+)\.\s*$/gm,
    ),
  ]
    .slice(-120)
    .map((match) => ({
      processId: match[1],
      lockType: match[2],
      transactionId: match[3],
      blockedByProcessId: match[4],
    }));
  let sourceScanStatus = "captured";
  const sources = await staticSqlSources().catch(() => {
    sourceScanStatus = "unavailable";
    return new Map<string, string[]>();
  });
  const deadlockStatements = deadlockStatementSources(logs, sources);
  const diagnosticsDb = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  diagnosticsDb.on("error", () => {});
  let databaseDeadlocks: number | null = null;
  try {
    databaseDeadlocks = Number(
      (
        await diagnosticsDb.query(
          "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()",
        )
      ).rows[0].deadlocks,
    );
  } catch {
    // Retain an explicit unavailable counter without serializing driver errors.
  } finally {
    await diagnosticsDb.end();
  }
  await writeFile(
    path.join(artifacts, "postgres-diagnostics.json"),
    JSON.stringify(
      {
        instance,
        sourceAtStart,
        startedAt,
        elapsedMs: Date.now() - startedAt,
        captureStatus,
        tailLineLimit: 2000,
        byteLimit,
        counts,
        errors,
        deadlockWaits,
        sourceScanStatus,
        staticSqlCount: sources.size,
        deadlockStatements,
        databaseDeadlocks,
        limits:
          "Allowlisted metadata from this fixture's bounded PostgreSQL log tail only; no SQL or raw logs retained. Missing matches do not exclude errors, and timestamps alone do not attribute an error to an HTTP request.",
      },
      null,
      2,
    ),
  );
  return { databaseDeadlocks, loggedDeadlocks: counts.deadlock_detected };
}
const start = (file: string) => {
  const p = spawn(process.execPath, ["--import", "tsx", file], {
    env: {
      ...env,
      PGAPPNAME:
        file === "apps/supervisor/src/main.ts"
          ? "harbor-e2e-supervisor"
          : file === "apps/api/src/main.ts"
            ? "harbor-e2e-api"
            : "harbor-e2e-fixture",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (b: Buffer) => {
    diagnosticText = (diagnosticText + b.toString()).slice(-131072);
  };
  p.stdout?.on("data", capture);
  p.stderr?.on("data", capture);
  let diagnostics = "";
  p.stderr?.on("data", (b) => {
    diagnostics = (diagnostics + b.toString()).slice(-4000);
  });
  p.on("exit", (code) => {
    if (code)
      console.error(
        file + " failed: " + diagnostics.replaceAll(password, "[redacted]"),
      );
  });
  children.push(p);
  return p;
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const browserFailures: { kind: string; path?: string; status?: number }[] = [];
function observePage(page: import("@playwright/test").Page) {
  const record = (event: (typeof browserFailures)[number]) => {
    browserFailures.push(event);
    if (browserFailures.length > 40) browserFailures.shift();
  };
  page.on("pageerror", () => record({ kind: "pageerror" }));
  page.on("console", (message) => {
    if (message.type() === "error") record({ kind: "console-error" });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && response.status() >= 400)
      record({ kind: "http", path: url.pathname, status: response.status() });
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin)
      record({ kind: "requestfailed", path: url.pathname });
  });
}
async function captureFailure(name: string) {
  // Never serialize cookies, storage, form values, response bodies or console text.
  const pages = [];
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) {
      const pathname = (() => {
        try {
          return new URL(page.url()).pathname;
        } catch {
          return "unavailable";
        }
      })();
      const dom = await page
        .evaluate(() => ({
          title: document.title === "Harbor" ? "Harbor" : "other",
          bodyChildren: [...document.body.children]
            .map((e) => e.tagName)
            .slice(0, 30),
          headings: document.querySelectorAll("h1,h2,h3").length,
          dialogs: document.querySelectorAll('[role="dialog"],dialog').length,
          composer: !!document.querySelector("textarea#message"),
          controls: document.querySelectorAll("button,input,select,textarea")
            .length,
          errorCodes: [
            "UNAUTHENTICATED",
            "OWNER_DENIED",
            "RATE_LIMITED",
            "NOT_FOUND",
            "SESSION_EXPIRED",
            "INTERNAL_ERROR",
          ].filter((code) => document.body.innerText.includes(code)),
        }))
        .catch(() => ({ unavailable: true }));
      pages.push({ pathname, dom });
    }
  }
  await writeFile(
    path.join(artifacts, name + ".json"),
    JSON.stringify({ pages, browserFailures }, null, 2),
  );
}
async function captureP002State(db: pg.Pool, outcome: "passed" | "failed") {
  const sqlState = (error: unknown) => {
    const code = (error as { code?: unknown })?.code;
    return typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : null;
  };
  const queries = {
    operations:
      "SELECT id,session_id,kind,state,generation,queue_reason,created_at,updated_at FROM operations ORDER BY created_at DESC,id DESC LIMIT 80",
    unsettledOperations:
      "SELECT id,session_id,kind,state,generation,queue_reason,created_at,updated_at FROM operations WHERE state IN ('queued','dispatching','running','waiting_approval','waiting_input','uncertain') ORDER BY created_at DESC,id DESC LIMIT 80",
    sessions:
      "SELECT id,project_id,workspace_id,state,generation,background_stop_requested,background_until,updated_at FROM sessions ORDER BY updated_at DESC,id DESC LIMIT 80",
    workspaces:
      "SELECT id,project_id,kind,state,writer_session_id,writer_generation,writer_kind,writer_owner_id,writer_epoch FROM workspaces ORDER BY (writer_owner_id IS NOT NULL) DESC,created_at DESC,id DESC LIMIT 80",
    approvals:
      "SELECT id,session_id,operation_id,state,kind,generation,deadline FROM approvals ORDER BY deadline DESC,id DESC LIMIT 80",
    events:
      "SELECT session_id,sequence,type,created_at,CASE WHEN data->>'operationId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN data->>'operationId' END AS operation_id,CASE WHEN data->>'approvalId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN data->>'approvalId' END AS approval_id FROM events ORDER BY created_at DESC,session_id,sequence DESC LIMIT 120",
    waits:
      "SELECT state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() LIMIT 80",
  };
  const entries = Object.entries(queries);
  const results = await Promise.allSettled(
    entries.map(([, query]) => db.query(query)),
  );
  const metadata = Object.fromEntries(
    results.map((result, index) => [
      entries[index][0],
      result.status === "fulfilled"
        ? result.value.rows
        : { unavailable: true, sqlState: sqlState(result.reason) },
    ]),
  );
  let queueFailures: unknown;
  try {
    const required = [
      "id",
      "name",
      "state",
      "retry_count",
      "created_on",
      "started_on",
      "completed_on",
      "output",
    ];
    const observed = (
      await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='pgboss' AND table_name='job'",
      )
    ).rows.map((row) => row.column_name as string);
    queueFailures = required.every((column) => observed.includes(column))
      ? {
          observedColumns: required,
          jobs: (
            await db.query(
              "SELECT id,state,retry_count,created_on,started_on,completed_on,CASE WHEN coalesce(output->>'code',output#>>'{value,code}') ~ '^([A-Z0-9]{5}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EACCES|ENOENT)$' THEN coalesce(output->>'code',output#>>'{value,code}') END AS error_code FROM pgboss.job WHERE name='harbor-dispatch' AND state::text IN ('failed','retry') ORDER BY created_on DESC,id DESC LIMIT 40",
            )
          ).rows,
        }
      : { unavailable: true, reason: "Expected job schema not observed" };
  } catch (error) {
    queueFailures = { unavailable: true, sqlState: sqlState(error) };
  }
  await writeFile(
    path.join(artifacts, `p002-state-${outcome}.json`),
    JSON.stringify(
      {
        instance,
        outcome,
        capturedAt: new Date().toISOString(),
        consistency: "Bounded read-only samples; no transaction freeze",
        sourceAtStart,
        limits: {
          operations: 80,
          unsettledOperations: 80,
          sessions: 80,
          workspaces: 80,
          approvals: 80,
          events: 120,
          waits: 80,
          queueFailures: 40,
        },
        ...metadata,
        queueFailures,
      },
      null,
      2,
    ),
  );
}

try {
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  await mkdir(path.join(dir, "project-roots"), { mode: 0o700 });
  await mkdir(path.join(dir, "control"), { mode: 0o700 });
  await writeFile(env.HARBOR_CREDENTIAL_KEY_FILE, randomBytes(32), {
    mode: 0o600,
  });
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({ instance, dbPort, apiPort, httpsPort, oidcPort, rootId }),
  );
  compose(["up", "-d", "--wait"]);
  start("tests/fixtures/oidc/server.ts");
  await new Promise((r) => setTimeout(r, 300));
  let api = start("apps/api/src/main.ts");
  let supervisor = start("apps/supervisor/src/main.ts");
  if (serve) {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`http://127.0.0.1:${apiPort}/api/v1/me`))
              .status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(401);
    console.log(
      `Private development instance ready: ${origin}/auth/login\nSign in as owner with the isolated fixture identity provider. State is disposable and removed on shutdown.\nInstance: ${instance}`,
    );
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } else if (schedulesOnly) {
    browser = await chromium.launch({ headless: true });
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`http://127.0.0.1:${apiPort}/api/v1/me`))
              .status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(401);
    const db = new pg.Pool({ connectionString: env.DATABASE_URL });
    try {
      await (schedulesDstOnly ? scheduleDstE2e : scheduleE2e)({
        fixtureState: env.HARBOR_FIXTURE_STATE_DIR,
        browser,
        db,
        origin,
        artifacts,
        pauseSupervisor: () => {
          supervisor.kill("SIGSTOP");
        },
        resumeSupervisor: () => {
          supervisor.kill("SIGCONT");
        },
        restartSupervisor: async (whileStopped?: () => Promise<void>) => {
          supervisor.kill("SIGKILL");
          await new Promise((r) => supervisor.once("exit", r));
          try {
            await whileStopped?.();
          } finally {
            supervisor = start("apps/supervisor/src/main.ts");
          }
        },
      });
    } catch (error) {
      const failurePage = browser
        .contexts()
        .flatMap((c) => c.pages())
        .at(-1);
      if (
        failurePage &&
        (await failurePage.locator(".schedules-panel").count())
      )
        await failurePage
          .locator(".schedules-panel")
          .screenshot({ path: path.join(artifacts, "schedule-failure.png") })
          .catch(() => {});
      await writeFile(path.join(artifacts, "failure.log"), diagnosticText);
      throw error;
    } finally {
      await db.end();
    }
    await writeFile(
      path.join(artifacts, "result.json"),
      JSON.stringify(
        {
          instance,
          status: "passed",
          sourceAtStart,
          sourceAtEnd: sourceDigest(),
          node: process.version,
          scope: schedulesDstOnly
            ? "P008-02 real API/UI previews and persisted gap/fold/non-hour/skipped-day occurrences; external OIDC/Codex fixtures; no live or protected restore claim"
            : "P008 real UI/API/PG/pg-boss/supervisor offline scheduling, lifecycle, faults, authority, quotas and maintenance; external OIDC/Codex fixtures; DST-specific end-to-end, live-account and protected restore gates require separate evidence",
        },
        null,
        2,
      ),
    );
    console.log("P008 real-stack result: " + artifacts);
  } else {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    context.on("page", observePage);
    const page = await context.newPage();
    await expect
      .poll(
        async () => {
          try {
            return (await context.request.get(origin + "/api/v1/me")).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(401);
    for (const route of [
      "/",
      "/assets/absent.js",
      "/api/v1/projects",
      "/api/v1/sessions/" + randomUUID() + "/events",
    ])
      expect((await context.request.get(origin + route)).status()).toBe(401);
    await page.goto(origin + "/auth/login");
    await page
      .getByRole("button", { name: "Sign in as denied identity" })
      .click();
    await expect(page.locator("body")).toContainText("OWNER_DENIED");
    await page.goto(origin + "/auth/login");
    await page
      .getByRole("button", { name: "Sign in as owner", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add project", exact: true }).first(),
    ).toBeVisible();
    const me = await (await context.request.get(origin + "/api/v1/me")).json();
    const apiDocument = await (
      await context.request.get(origin + "/api/v1/openapi.json")
    ).json();
    const validator = new Ajv2020({ strict: false, validateFormats: false });
    const assertResponse = (
      route: string,
      method: string,
      status: number,
      data: unknown,
    ) => {
      const schema =
        apiDocument.paths[route][method].responses[String(status)].content[
          "application/json"
        ].schema;
      const validate = validator.compile({
        ...schema,
        components: apiDocument.components,
      });
      expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
    };
    assertResponse("/me", "get", 200, me);
    assertResponse(
      "/capabilities",
      "get",
      200,
      await (await context.request.get(origin + "/api/v1/capabilities")).json(),
    );
    const headers = { Origin: origin, "X-CSRF-Token": me.csrfToken };
    const command = async (
      route: string,
      body: unknown,
      key = `${Date.now()}:${randomUUID()}`,
    ) => {
      const sequence = ++commandSequence;
      const startedAt = Date.now();
      const record = (status: number, errorCode: string | null) => {
        commandResponses.push({
          sequence,
          path: /^\/[a-zA-Z0-9/_-]{1,160}$/.test(route)
            ? route
            : "UNCLASSIFIED_ROUTE",
          startedAt,
          elapsedMs: Date.now() - startedAt,
          status,
          errorCode,
        });
        if (commandResponses.length > 120) commandResponses.shift();
      };
      let response;
      try {
        response = await context.request.post(origin + "/api/v1" + route, {
          data: body,
          headers: { ...headers, "Idempotency-Key": key },
        });
      } catch (error) {
        record(0, "TRANSPORT_ERROR");
        throw error;
      }
      let errorCode: string | null = null;
      if (response.status() >= 400) {
        const result = await response.json().catch(() => undefined);
        errorCode =
          typeof result?.error?.code === "string" &&
          /^[A-Z][A-Z0-9_]{0,79}$/.test(result.error.code)
            ? result.error.code
            : "UNCLASSIFIED_RESPONSE";
      }
      record(response.status(), errorCode);
      return response;
    };
    for (const token of [undefined, "invalid"]) {
      const response = await context.request.post(
        origin + "/api/v1/security/emergency-stop",
        {
          data: {},
          headers: {
            Origin: origin,
            "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
            ...(token ? { "X-CSRF-Token": token } : {}),
          },
        },
      );
      expect(response.status()).toBe(403);
    }
    const syntheticKey = "test-only-key-" + randomBytes(20).toString("hex");
    const credentialIntent = `${Date.now()}:${randomUUID()}`;
    const credentialResult = await command(
      "/security/runtime-credentials",
      { apiKey: syntheticKey },
      credentialIntent,
    );
    expect(credentialResult.status()).toBe(200);
    expect(JSON.stringify(await credentialResult.json())).not.toContain(
      syntheticKey,
    );
    expect(
      (
        await command(
          "/security/runtime-credentials",
          { apiKey: syntheticKey },
          credentialIntent,
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await command(
          "/security/runtime-credentials",
          { apiKey: syntheticKey + "changed" },
          credentialIntent,
        )
      ).status(),
    ).toBe(409);
    expect(
      (
        await context.request.post(origin + "/api/v1/projects", {
          data: {},
          headers: {
            Origin: "https://evil.example",
            "X-CSRF-Token": me.csrfToken,
          },
        })
      ).status(),
    ).toBe(403);
    if (p002Only) {
      const focusedDb = new pg.Pool({ connectionString: env.DATABASE_URL });
      try {
        const created = await command("/projects", {
          name: "Acceptance project",
          rootId,
          path: "p002-project",
          create: true,
        });
        expect(created.status()).toBe(200);
        const projectId = (await created.json()).project.id as string;
        await page.reload();
        await expect(
          page
            .locator(".project-button")
            .filter({ hasText: "Acceptance project" }),
        ).toBeVisible();
        rotationBearer = await p002({
          page,
          context,
          origin,
          csrf: me.csrfToken,
          db: focusedDb,
          projectId,
          logs: () => diagnosticText,
          artifacts,
          pauseSupervisor: () => {
            supervisor.kill("SIGSTOP");
          },
          resumeSupervisor: () => {
            supervisor.kill("SIGCONT");
          },
        });
        await captureP002State(focusedDb, "passed");
        await writeFile(
          path.join(artifacts, "result.json"),
          JSON.stringify(
            {
              instance,
              status: "passed",
              sourceAtStart,
              sourceAtEnd: sourceDigest(),
              node: process.version,
              scope:
                "P002 isolated diagnostic: unchanged real browser/API/PostgreSQL/supervisor assertions; external OIDC/Codex fixtures only; full critical gate remains separate",
            },
            null,
            2,
          ),
        );
        console.log(
          "P002 isolated real-stack diagnostic passed. Artifacts: " + artifacts,
        );
      } catch (error) {
        await captureP002State(focusedDb, "failed").catch(() => undefined);
        throw error;
      } finally {
        await focusedDb.end();
      }
    } else if (designOnly) {
      await p014({
        page,
        context,
        origin,
        artifacts,
        rootId,
        rootPath: path.join(dir, "project-roots"),
      });
      const designDb = new pg.Pool({ connectionString: env.DATABASE_URL });
      try {
        await p023({ page, context, origin, artifacts, db: designDb });
        await p024({ page, context, origin, artifacts });
      } finally {
        await designDb.end();
      }
      await writeFile(
        path.join(artifacts, "result.json"),
        JSON.stringify(
          {
            instance,
            status: "passed",
            sourceAtStart,
            sourceAtEnd: sourceDigest(),
            node: process.version,
            scope:
              "P014/P023/P024 real browser/API/PostgreSQL/supervisor; external OIDC/Codex fixtures",
          },
          null,
          2,
        ),
      );
      console.log("P014/P023/P024 design E2E passed. Artifacts: " + artifacts);
    } else {
      await page
        .getByRole("button", { name: "Add project", exact: true })
        .first()
        .click();
      await page.getByLabel("Project name").fill("Acceptance project");
      await page.getByLabel("Folder path").fill("project");
      await page.getByLabel("Create a new folder").check();
      await page
        .getByRole("button", { name: "Add project", exact: true })
        .last()
        .click();
      await page
        .locator(".sidebar")
        .getByRole("button", { name: "New conversation", exact: true })
        .click();
      await page.getByLabel("Message Codex").fill("P001 initial text");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.locator("body")).toContainText("Fixture response", {
        timeout: 30000,
      });
      await page.screenshot({
        path: path.join(artifacts, "conversation-desktop.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByLabel("Message Codex")).toBeVisible();
      expect(
        await page.evaluate(() => document.body.scrollWidth <= innerWidth),
      ).toBe(true);

      await page.screenshot({
        path: path.join(artifacts, "conversation-mobile.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
      await page.locator(".rail-footer summary").click();
      await expect(
        page.getByRole("button", { name: "Sign out", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.body.scrollWidth <= innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: path.join(artifacts, "conversation-mobile-navigation.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Close navigation", exact: true })
        .last()
        .click();
      await expect(page.getByLabel("Message Codex")).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 900 });
      const sessions = await (
        await context.request.get(origin + "/api/v1/sessions")
      ).json();
      const id = sessions.sessions[0].id;
      const snapshot = async () =>
        (
          await context.request.get(origin + `/api/v1/sessions/${id}/snapshot`)
        ).json();
      const key = `${Date.now()}:${randomUUID()}`,
        payload = {
          text: "[delay] persisted work",
          model: "fixture",
          effort: "medium",
          permissionProfile: "read-only",
        };
      const first = await command(`/sessions/${id}/turns`, payload, key);
      const firstBody = await first.json();
      const firstErrorCode = firstBody?.error?.code;
      if (first.status() !== 202)
        console.error(
          "Second turn admission:",
          typeof firstErrorCode === "string" &&
            /^[A-Z_]{1,64}$/.test(firstErrorCode)
            ? firstErrorCode
            : "UNCLASSIFIED_RESPONSE",
        );
      expect(
        first.status(),
        typeof firstErrorCode === "string" &&
          /^[A-Z_]{1,64}$/.test(firstErrorCode)
          ? firstErrorCode
          : "Second turn admission",
      ).toBe(202);
      expect(
        await (await command(`/sessions/${id}/turns`, payload, key)).json(),
      ).toEqual(firstBody);
      expect(
        (
          await command(
            `/sessions/${id}/turns`,
            { ...payload, text: "different" },
            key,
          )
        ).status(),
      ).toBe(409);
      await page.close();
      api.kill("SIGTERM");
      await new Promise((r) => api.once("exit", r));
      api = start("apps/api/src/main.ts");
      await expect
        .poll(
          async () => {
            try {
              return (await snapshot()).operations.find(
                (o: any) => o.id === firstBody.operation.id,
              ).state;
            } catch {
              return "unavailable";
            }
          },
          { timeout: 30000 },
        )
        .toBe("succeeded");
      const reopened = await context.newPage();
      await reopened.goto(origin + "/?conversation=" + id);
      await expect(reopened.locator("body")).toContainText("persisted work");
      const approvalOp = await (
        await command(`/sessions/${id}/turns`, {
          ...payload,
          text: "[approval]",
        })
      ).json();
      await expect
        .poll(
          async () =>
            (await snapshot()).approvals.filter(
              (a: any) => a.operationId === approvalOp.operation.id,
            ).length,
          { timeout: 30000 },
        )
        .toBe(1);
      const approval = (await snapshot()).approvals.find(
        (a: any) => a.operationId === approvalOp.operation.id,
      );
      await reopened.screenshot({
        path: path.join(artifacts, "approval-desktop.png"),
        fullPage: true,
      });
      const answers = await Promise.all([
        command(`/approvals/${approval.id}/answer`, {
          generation: approval.generation,
          decision: "accept",
        }),
        command(`/approvals/${approval.id}/answer`, {
          generation: approval.generation,
          decision: "accept",
        }),
      ]);
      expect(answers.map((a) => a.status()).sort()).toEqual([202, 409]);
      expect(
        (
          await command("/projects", {
            name: "Escape",
            rootId,
            path: "../escape",
            create: true,
          })
        ).status(),
      ).toBe(403);
      await expect
        .poll(
          async () =>
            (await snapshot()).operations.find(
              (o: any) => o.id === approvalOp.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("succeeded");
      const delayedResponse = await command(`/sessions/${id}/turns`, {
        ...payload,
        text: "[delay] [background] cancel me",
      });
      expect(
        delayedResponse.status(),
        "Delayed turn admission must be accepted",
      ).toBe(202);
      const delayed = await delayedResponse.json();
      expect(
        delayed.operation?.id,
        "Accepted turn must identify its operation",
      ).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      );
      await expect
        .poll(
          async () =>
            (await snapshot()).operations.find(
              (o: any) => o.id === delayed.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("running");
      expect(
        (await command("/security/runtime-credentials/remove", {})).status(),
      ).toBe(409);
      expect(
        (await command(`/turns/${delayed.operation.id}/cancel`, {})).status(),
      ).toBe(202);
      await expect
        .poll(
          async () =>
            (await snapshot()).operations.find(
              (o: any) => o.id === delayed.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("interrupted");
      expect(
        (await command(`/turns/${delayed.operation.id}/cancel`, {})).status(),
      ).toBe(409);
      await expect
        .poll(async () => (await snapshot()).processes.status, {
          timeout: 30000,
        })
        .toBe("known");
      await expect(
        reopened.getByRole("list", {
          name: "Processes observed after interruption",
        }),
      ).toContainText("PID 42: sleep");
      const hostile = await (
        await command(`/sessions/${id}/turns`, {
          ...payload,
          text: "[hostile]",
        })
      ).json();
      await expect
        .poll(
          async () =>
            (await snapshot()).operations.find(
              (o: any) => o.id === hostile.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("succeeded");
      await expect(reopened.locator("body")).toContainText(
        "<script>window.compromised=true</script>",
      );
      expect(
        await reopened.evaluate(() => Reflect.get(window, "compromised")),
      ).toBeUndefined();
      const oversized = await command(`/sessions/${id}/turns`, {
        ...payload,
        text: "x".repeat(32769),
      });
      expect(oversized.status()).toBe(400);
      const stale = await command(`/approvals/${approval.id}/answer`, {
        generation: approval.generation - 1,
        decision: "accept",
      });
      expect(stale.status()).toBe(409);
      // Separate regression scenarios explicitly acknowledge prior unknown effects through
      // the owner recovery API; no database lease bypass is used.
      const releasePriorWorkspace = async () => {
        await expect
          .poll(
            async () => {
              const projectId = sessions.sessions[0].projectId;
              const workspaces = (
                await (
                  await context.request.get(
                    origin + `/api/v1/projects/${projectId}/workspaces`,
                  )
                ).json()
              ).workspaces;
              const held = workspaces.find(
                (w: any) => w.kind === "local" && w.writerSessionId,
              );
              if (!held) return true;
              const prior = await (
                await context.request.get(
                  origin + `/api/v1/sessions/${held.writerSessionId}/snapshot`,
                )
              ).json();
              if (
                prior.operations.some((o: any) =>
                  [
                    "dispatching",
                    "running",
                    "waiting_approval",
                    "waiting_input",
                  ].includes(o.state),
                )
              )
                return false;
              const release = await command(`/workspaces/${held.id}/release`, {
                acknowledgeUnknownEffects: true,
                expectedSessionId: held.writerSessionId,
                expectedGeneration: held.writerGeneration,
              });
              expect([200, 409]).toContain(release.status());
              return false;
            },
            { timeout: 30000 },
          )
          .toBe(true);
      };
      const newSession = async () => {
        await releasePriorWorkspace();
        await expect
          .poll(
            async () =>
              (
                await (
                  await context.request.get(origin + "/api/v1/capabilities")
                ).json()
              ).models.length,
            { timeout: 30000 },
          )
          .toBeGreaterThan(0);
        const response = await command("/sessions", {
          projectId: sessions.sessions[0].projectId,
          model: "fixture",
          effort: "medium",
          permissionProfile: "read-only",
        });
        expect(response.status()).toBe(200);
        return (await response.json()).session.id as string;
      };
      const getSnapshot = async (sessionId: string) => {
        const startedAt = Date.now();
        const response = await context.request.get(
          origin + `/api/v1/sessions/${sessionId}/snapshot`,
        );
        const body = await response.json().catch(() => undefined);
        const code = body?.error?.code;
        const errorCode =
          typeof code === "string" && /^[A-Z_]{1,64}$/.test(code)
            ? code
            : "UNCLASSIFIED_RESPONSE";
        if (response.status() !== 200 || body?.session?.id !== sessionId)
          await writeFile(
            path.join(artifacts, "snapshot-response-failure.json"),
            JSON.stringify(
              {
                path: `/api/v1/sessions/${sessionId}/snapshot`,
                startedAt,
                elapsedMs: Date.now() - startedAt,
                status: response.status(),
                errorCode,
                sessionPresent: Boolean(body?.session),
                api: { exitCode: api.exitCode, signalCode: api.signalCode },
                supervisor: {
                  exitCode: supervisor.exitCode,
                  signalCode: supervisor.signalCode,
                },
              },
              null,
              2,
            ),
          );
        expect(response.status(), `Snapshot response: ${errorCode}`).toBe(200);
        expect(body?.session?.id, "Snapshot must contain its session").toBe(
          sessionId,
        );
        return body;
      };
      const inputSession = await newSession();
      const input = await (
        await command(`/sessions/${inputSession}/turns`, {
          ...payload,
          text: "[input]",
        })
      ).json();
      await expect
        .poll(async () => (await getSnapshot(inputSession)).approvals.length, {
          timeout: 30000,
        })
        .toBe(1);
      const inputApproval = (await getSnapshot(inputSession)).approvals[0];
      expect(
        (
          await command(`/approvals/${inputApproval.id}/answer`, {
            generation: inputApproval.generation,
            decision: "accept",
          })
        ).status(),
      ).toBe(400);
      await reopened.goto(origin + "/?conversation=" + inputSession);
      await reopened
        .getByRole("button", { name: "Decline", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await getSnapshot(inputSession)).operations.find(
              (o: any) => o.id === input.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("interrupted");
      const beforeCredentialChange = (await snapshot()).operations[0];
      const replacementIntent = `${Date.now()}:${randomUUID()}`;
      await expect
        .poll(
          async () =>
            (
              await command(
                "/security/runtime-credentials",
                { apiKey: syntheticKey + "replacement" },
                replacementIntent,
              )
            ).status(),
          { timeout: 30000 },
        )
        .toBe(200);
      expect(
        (await snapshot()).operations.find(
          (o: any) => o.id === beforeCredentialChange.id,
        ).state,
      ).toBe(beforeCredentialChange.state);
      const testDb = new pg.Pool({ connectionString: env.DATABASE_URL });
      try {
        await conversationLockOrder({
          db: testDb,
          command,
          context,
          origin,
          artifacts,
          fixtureState: env.HARBOR_FIXTURE_STATE_DIR,
          newSession,
          pauseSupervisor: () => {
            supervisor.kill("SIGSTOP");
          },
          resumeSupervisor: () => {
            supervisor.kill("SIGCONT");
          },
        });
        // Lose captured-runtime eligibility after the real managed writer claim.
        // A retry must roll back that claim, so ordinary dispatch can still run.
        const rollbackSession = await newSession();
        const rollbackWorkspace = (
          await testDb.query("SELECT workspace_id FROM sessions WHERE id=$1", [
            rollbackSession,
          ])
        ).rows[0].workspace_id;
        await expect
          .poll(
            async () =>
              (
                await testDb.query(
                  "SELECT writer_session_id FROM workspaces WHERE id=$1",
                  [rollbackWorkspace],
                )
              ).rows[0].writer_session_id,
          )
          .toBe(null);
        const rollbackGeneration = Number(
          (
            await testDb.query(
              "SELECT nextval('runtime_generation_seq') AS generation",
            )
          ).rows[0].generation,
        );
        let claimed!: () => void, releaseClaim!: () => void;
        const claimReady = new Promise<void>((resolve) => {
          claimed = resolve;
        });
        const claimBarrier = new Promise<void>((resolve) => {
          releaseClaim = resolve;
        });
        const retry = workspaceAdmission(testDb, async (db) => {
          expect(
            await claimWorkspace(
              db,
              rollbackWorkspace,
              rollbackSession,
              rollbackGeneration,
            ),
          ).toBe(true);
          claimed();
          await claimBarrier;
          throw new WorkspaceAdmissionChanged();
        });
        try {
          await Promise.race([claimReady, retry]);
          expect(
            (
              await testDb.query(
                "SELECT writer_session_id FROM workspaces WHERE id=$1",
                [rollbackWorkspace],
              )
            ).rows[0].writer_session_id,
          ).toBe(null);
        } finally {
          releaseClaim();
        }
        expect(await retry).toBe(false);
        expect(
          (
            await testDb.query(
              "SELECT writer_session_id FROM workspaces WHERE id=$1",
              [rollbackWorkspace],
            )
          ).rows[0].writer_session_id,
        ).toBe(null);
        const rollbackTurn = await (
          await command(`/sessions/${rollbackSession}/turns`, payload)
        ).json();
        await expect
          .poll(
            async () =>
              (await getSnapshot(rollbackSession)).operations.find(
                (operation: any) => operation.id === rollbackTurn.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("succeeded");
        await acknowledgementContention({
          db: testDb,
          command,
          context,
          origin,
          sessionId: await newSession(),
          traceFile: env.HARBOR_FIXTURE_TRACE_FILE,
          artifacts,
        });
        await p005({
          apiPort,
          page: reopened,
          context,
          origin,
          csrf: me.csrfToken,
          db: testDb,
          projectId: sessions.sessions[0].projectId,
          traceFile: env.HARBOR_FIXTURE_TRACE_FILE,
          artifacts,
        });
        await authorityExpiry(
          testDb,
          {
            HARBOR_OIDC_ISSUER: env.HARBOR_OIDC_ISSUER,
            HARBOR_OWNER_SUBJECT: env.HARBOR_OWNER_SUBJECT,
            HARBOR_IDLE_SECONDS: 300,
          },
          sessions.sessions[0].projectId,
        );
        rotationBearer = await p002({
          page: reopened,
          context,
          origin,
          csrf: me.csrfToken,
          db: testDb,
          projectId: sessions.sessions[0].projectId,
          logs: () => diagnosticText,
          artifacts,
          pauseSupervisor: () => {
            supervisor.kill("SIGSTOP");
          },
          resumeSupervisor: () => {
            supervisor.kill("SIGCONT");
          },
        }).catch(async (error) => {
          await captureP002State(testDb, "failed").catch(() => undefined);
          await writeFile(
            path.join(artifacts, "p002-queue-failure.json"),
            JSON.stringify(
              {
                operations: (
                  await testDb.query(
                    "SELECT session_id,kind,state,generation,queue_reason FROM operations WHERE state IN ('queued','dispatching','running','waiting_approval','waiting_input','uncertain') ORDER BY created_at",
                  )
                ).rows,
                sessions: (
                  await testDb.query(
                    "SELECT id,state,generation FROM sessions WHERE state IN ('queued','running','waiting_approval','uncertain')",
                  )
                ).rows,
                workspaces: (
                  await testDb.query(
                    "SELECT id,writer_session_id,writer_generation,writer_kind FROM workspaces WHERE writer_owner_id IS NOT NULL",
                  )
                ).rows,
                waits: (
                  await testDb.query(
                    "SELECT state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()",
                  )
                ).rows,
              },
              null,
              2,
            ),
          );
          throw error;
        });
        await captureP002State(testDb, "passed");
        const interruptCrashSession = await newSession();
        const interruptCrash = await (
          await command(`/sessions/${interruptCrashSession}/turns`, {
            ...payload,
            text: "[interrupt-crash]",
          })
        ).json();
        await expect
          .poll(
            async () =>
              (await getSnapshot(interruptCrashSession)).operations.find(
                (o: any) => o.id === interruptCrash.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("running");
        const afterInterruptCrash = await (
          await command(`/sessions/${interruptCrashSession}/turns`, payload)
        ).json();
        await testDb.query("CREATE SEQUENCE test_terminal_fault");
        await testDb.query(
          "CREATE FUNCTION test_fail_terminal_once() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='turn' AND NEW.state='uncertain' AND nextval('test_terminal_fault')<=2 THEN RAISE EXCEPTION 'injected transient terminal settlement failure'; END IF; RETURN NEW; END $$",
        );
        await testDb.query(
          "CREATE TRIGGER test_fail_terminal_once BEFORE UPDATE ON operations FOR EACH ROW EXECUTE FUNCTION test_fail_terminal_once()",
        );
        await testDb.query(
          "CREATE FUNCTION test_fail_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='cancel' AND NEW.state='failed' THEN RAISE EXCEPTION 'injected cancel settlement commit failure'; END IF; RETURN NEW; END $$",
        );
        await testDb.query(
          "CREATE CONSTRAINT TRIGGER test_fail_cancel AFTER UPDATE ON operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_fail_cancel()",
        );
        const crashCancel = await (
          await command(`/turns/${interruptCrash.operation.id}/cancel`, {})
        ).json();
        await expect
          .poll(
            async () =>
              (await getSnapshot(interruptCrashSession)).operations.find(
                (o: any) => o.id === interruptCrash.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("uncertain")
          .catch(async (error) => {
            await writeFile(
              path.join(artifacts, "interrupt-crash-failure.json"),
              JSON.stringify(
                {
                  operations: (
                    await testDb.query(
                      "SELECT kind,state,generation FROM operations WHERE session_id=$1 ORDER BY created_at",
                      [interruptCrashSession],
                    )
                  ).rows,
                  session: (
                    await testDb.query(
                      "SELECT state,generation FROM sessions WHERE id=$1",
                      [interruptCrashSession],
                    )
                  ).rows,
                  events: (
                    await testDb.query(
                      "SELECT type FROM events WHERE session_id=$1 ORDER BY sequence DESC LIMIT 20",
                      [interruptCrashSession],
                    )
                  ).rows,
                  waits: (
                    await testDb.query(
                      "SELECT state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()",
                    )
                  ).rows,
                },
                null,
                2,
              ),
            );
            throw error;
          });
        expect(
          (await getSnapshot(interruptCrashSession)).operations.find(
            (o: any) => o.id === crashCancel.operation.id,
          ).state,
        ).toBe("dispatching");
        expect(
          Number(
            (await testDb.query("SELECT last_value FROM test_terminal_fault"))
              .rows[0].last_value,
          ),
        ).toBeGreaterThanOrEqual(3);
        await testDb.query("DROP TRIGGER test_fail_cancel ON operations");
        await testDb.query("DROP FUNCTION test_fail_cancel()");
        await testDb.query(
          "DROP TRIGGER test_fail_terminal_once ON operations",
        );
        await testDb.query("DROP FUNCTION test_fail_terminal_once()");
        await testDb.query("DROP SEQUENCE test_terminal_fault");
        await expect
          .poll(
            async () =>
              (await getSnapshot(interruptCrashSession)).operations.find(
                (o: any) => o.id === crashCancel.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("failed");
        const crashSnapshot = await getSnapshot(interruptCrashSession);
        expect(
          crashSnapshot.operations.find(
            (o: any) => o.id === interruptCrash.operation.id,
          ).state,
        ).toBe("uncertain");
        expect(
          crashSnapshot.operations.find(
            (o: any) => o.id === afterInterruptCrash.operation.id,
          ).state,
        ).toBe("queued");
        expect(
          crashSnapshot.operations.some(
            (o: any) => o.kind === "cancel" && o.state === "dispatching",
          ),
        ).toBe(false);

        const ownerContext = async () => {
          const isolated = await browser!.newContext({
            ignoreHTTPSErrors: true,
          });
          const viewer = await isolated.newPage();
          await viewer.goto(origin + "/auth/login");
          await viewer
            .getByRole("button", { name: "Sign in as owner", exact: true })
            .click();
          const identity = await (
            await isolated.request.get(origin + "/api/v1/me")
          ).json();
          return {
            isolated,
            viewer,
            post: (route: string, data: unknown) =>
              isolated.request.post(origin + "/api/v1" + route, {
                data,
                headers: {
                  Origin: origin,
                  "X-CSRF-Token": identity.csrfToken,
                  "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
                },
              }),
          };
        };
        const expiring = await ownerContext();
        const expiryCookie = (await expiring.isolated.cookies()).find(
          (cookie) => cookie.name === "__Host-harbor",
        )!;
        await testDb.query(
          "UPDATE browser_sessions SET expires_at=now()-interval '1 second' WHERE hash=$1",
          [createHash("sha256").update(expiryCookie.value).digest("hex")],
        );
        for (const route of ["/api/v1/me", `/api/v1/sessions/${id}/events`])
          expect(
            (await expiring.isolated.request.get(origin + route)).status(),
          ).toBe(401);
        await expiring.isolated.close();
        const logoutSession = await newSession(),
          runningOwner = await ownerContext();
        const continueTurn = await (
          await runningOwner.post(`/sessions/${logoutSession}/turns`, {
            ...payload,
            text: "[delay] survives logout",
          })
        ).json();
        await expect
          .poll(
            async () =>
              (await getSnapshot(logoutSession)).operations.find(
                (o: any) => o.id === continueTurn.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("running");
        expect((await runningOwner.post("/security/logout", {})).status()).toBe(
          200,
        );
        expect(
          (
            await runningOwner.isolated.request.get(origin + "/api/v1/me")
          ).status(),
        ).toBe(401);
        await expect
          .poll(
            async () =>
              (await getSnapshot(logoutSession)).operations.find(
                (o: any) => o.id === continueTurn.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("succeeded");
        await runningOwner.isolated.close();
        const queueExpirySession = await newSession(),
          queuedOwner = await ownerContext();
        const blocker = await (
          await command(`/sessions/${queueExpirySession}/turns`, {
            ...payload,
            text: "[delay]",
          })
        ).json();
        await expect
          .poll(
            async () =>
              (await getSnapshot(queueExpirySession)).operations.find(
                (o: any) => o.id === blocker.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("running");
        const expiryQueued = await (
          await queuedOwner.post(
            `/sessions/${queueExpirySession}/turns`,
            payload,
          )
        ).json();
        const queuedCookie = (await queuedOwner.isolated.cookies()).find(
          (cookie) => cookie.name === "__Host-harbor",
        )!;
        await testDb.query(
          "UPDATE browser_sessions SET expires_at=now()-interval '1 second' WHERE hash=$1",
          [createHash("sha256").update(queuedCookie.value).digest("hex")],
        );
        await expect
          .poll(
            async () =>
              (await getSnapshot(queueExpirySession)).operations.find(
                (o: any) => o.id === expiryQueued.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("failed");
        await queuedOwner.isolated.close();
        const offlineSession = await newSession();
        await command(`/sessions/${offlineSession}/turns`, {
          ...payload,
          text: "[approval]",
        });
        await expect
          .poll(
            async () => (await getSnapshot(offlineSession)).approvals.length,
            { timeout: 30000 },
          )
          .toBe(1);
        await testDb.query(
          "UPDATE approvals SET deadline=now()-interval '1 second' WHERE session_id=$1",
          [offlineSession],
        );
        await expect
          .poll(
            async () => (await getSnapshot(offlineSession)).approvals[0].state,
            { timeout: 30000 },
          )
          .toBe("expired");
        await expect
          .poll(
            async () =>
              (await getSnapshot(offlineSession)).messages.some((m: any) =>
                m.text.includes("Approval declined"),
              ),
            { timeout: 30000 },
          )
          .toBe(true);
        const retentionSession = await newSession();
        const retentionTime = Date.now(),
          futureKey = `${retentionTime + 240000}:${randomUUID()}`;
        const retained = await (
          await command(
            `/sessions/${retentionSession}/turns`,
            payload,
            futureKey,
          )
        ).json();
        await expect
          .poll(
            async () =>
              (await getSnapshot(retentionSession)).operations.find(
                (o: any) => o.id === retained.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("succeeded");
        await maintain(testDb, new Date(retentionTime + 86400000 + 60000));
        expect(
          await (
            await command(
              `/sessions/${retentionSession}/turns`,
              payload,
              futureKey,
            )
          ).json(),
        ).toEqual(retained);
        await maintain(testDb, new Date(retentionTime + 86400000 + 300001));
        expect(
          (
            await testDb.query("SELECT 1 FROM intents WHERE key=$1", [
              futureKey,
            ])
          ).rowCount,
        ).toBe(0);
        expect(() =>
          checkKey(futureKey, retentionTime + 86400000 + 300001),
        ).toThrow();
        await reopened.goto(origin + "/?conversation=" + retentionSession);
        try {
          await expect(reopened.getByLabel("Message Codex")).toBeVisible();
        } catch (error) {
          await captureFailure("retained-conversation-failure");
          const target = await reopened.request.get(
            origin + `/api/v1/sessions/${retentionSession}/snapshot`,
          );
          await writeFile(
            path.join(artifacts, "retained-snapshot-status.json"),
            JSON.stringify({ status: target.status() }),
          );
          throw error;
        }
        const duringGap = await (
          await command(`/sessions/${retentionSession}/turns`, {
            ...payload,
            text: "[delay] replay gap",
          })
        ).json();
        await expect
          .poll(
            async () =>
              (await getSnapshot(retentionSession)).operations.find(
                (o: any) => o.id === duringGap.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("running");
        api.kill("SIGTERM");
        await new Promise((r) => api.once("exit", r));
        await expect
          .poll(
            async () =>
              (
                await testDb.query("SELECT state FROM operations WHERE id=$1", [
                  duringGap.operation.id,
                ])
              ).rows[0].state,
            { timeout: 30000 },
          )
          .toBe("succeeded");
        await testDb.query(
          "UPDATE events SET created_at=now()-interval '8 days' WHERE session_id=$1",
          [retentionSession],
        );
        await maintain(testDb);
        api = start("apps/api/src/main.ts");
        await expect
          .poll(
            async () => {
              try {
                return (
                  await context.request.get(origin + "/api/v1/me")
                ).status();
              } catch {
                return 0;
              }
            },
            { timeout: 30000 },
          )
          .toBe(200);
        await expect(reopened.locator("body")).toContainText("replay gap", {
          timeout: 30000,
        });
        const afterGap = await (
          await command(`/sessions/${retentionSession}/turns`, {
            ...payload,
            text: "after retained replay gap",
          })
        ).json();
        await expect(reopened.locator("body")).toContainText(
          "Fixture response: after retained replay gap",
          { timeout: 30000 },
        );
        expect(
          (await getSnapshot(retentionSession)).operations.find(
            (o: any) => o.id === afterGap.operation.id,
          ).state,
        ).toBe("succeeded");
        const persisted = await testDb.query(
          "SELECT row_to_json(i)::text AS value FROM intents i UNION ALL SELECT row_to_json(e)::text FROM events e UNION ALL SELECT row_to_json(o)::text FROM operations o UNION ALL SELECT row_to_json(c)::text FROM runtime_credentials c",
        );
        expect(JSON.stringify(persisted.rows)).not.toContain(syntheticKey);
        assertResponse(
          "/sessions/{id}/snapshot",
          "get",
          200,
          await getSnapshot(retentionSession),
        );
        await testDb.query(
          "CREATE TABLE test_commit_faults(id uuid PRIMARY KEY)",
        );
        await testDb.query(
          "CREATE FUNCTION test_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='operation.succeeded' AND EXISTS(SELECT 1 FROM test_commit_faults WHERE id::text=NEW.data->>'operationId') THEN RAISE EXCEPTION 'injected deferred commit failure'; END IF; RETURN NEW; END $$",
        );
        await testDb.query(
          "CREATE CONSTRAINT TRIGGER test_fail_completion AFTER INSERT ON events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_fail_completion()",
        );
        const commitSession = await newSession();
        const prior = await (
          await command(`/sessions/${commitSession}/turns`, payload)
        ).json();
        await expect
          .poll(
            async () =>
              (await getSnapshot(commitSession)).operations.find(
                (o: any) => o.id === prior.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("succeeded");
        const failing = await (
          await command(`/sessions/${commitSession}/turns`, {
            ...payload,
            text: "[delay] commit fault",
          })
        ).json();
        await testDb.query("INSERT INTO test_commit_faults(id) VALUES($1)", [
          failing.operation.id,
        ]);
        await expect
          .poll(
            async () =>
              (await getSnapshot(commitSession)).operations.find(
                (o: any) => o.id === failing.operation.id,
              ).state,
            { timeout: 30000 },
          )
          .toBe("uncertain");
        expect(
          (await getSnapshot(commitSession)).operations.find(
            (o: any) => o.id === prior.operation.id,
          ).state,
        ).toBe("succeeded");
        await testDb.query("DROP TRIGGER test_fail_completion ON events");
        await testDb.query("DROP FUNCTION test_fail_completion()");
        await testDb.query("DROP TABLE test_commit_faults");
      } finally {
        await testDb.end();
      }
      const switching = await newSession();
      const beforeSwitch = await (
        await command(`/sessions/${switching}/turns`, payload)
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(switching)).operations.find(
              (o: any) => o.id === beforeSwitch.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("succeeded");
      const switched = await (
        await command(`/sessions/${switching}/turns`, {
          ...payload,
          permissionProfile: "workspace-write",
        })
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(switching)).operations.find(
              (o: any) => o.id === switched.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("succeeded");
      expect(
        (await getSnapshot(switching)).operations.find(
          (o: any) => o.id === beforeSwitch.operation.id,
        ).state,
      ).toBe("succeeded");
      const inputFlood = await newSession();
      await command(`/sessions/${inputFlood}/turns`, {
        ...payload,
        text: "[input-flood]",
      });
      await expect
        .poll(async () => (await getSnapshot(inputFlood)).session.state, {
          timeout: 30000,
        })
        .toBe("uncertain");
      expect(
        (await getSnapshot(inputFlood)).approvals.filter((a: any) =>
          ["pending", "answering"].includes(a.state),
        ),
      ).toHaveLength(0);
      const floodSession = await newSession();
      await command(`/sessions/${floodSession}/turns`, {
        ...payload,
        text: "[flood]",
      });
      await expect
        .poll(async () => (await getSnapshot(floodSession)).session.state, {
          timeout: 30000,
        })
        .toBe("uncertain");
      expect(
        (await command(`/sessions/${floodSession}/turns`, payload)).status(),
      ).toBe(409);
      const stuckSession = await newSession();
      const stuck = await (
        await command(`/sessions/${stuckSession}/turns`, {
          ...payload,
          text: "[timeout]",
        })
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(stuckSession)).operations.find(
              (o: any) => o.id === stuck.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("dispatching");
      const queuedB = await (
        await command(`/sessions/${stuckSession}/turns`, payload)
      ).json();
      const queuedC = await (
        await command(`/sessions/${stuckSession}/turns`, payload)
      ).json();
      supervisor.kill("SIGKILL");
      await new Promise((r) => supervisor.once("exit", r));
      supervisor = start("apps/supervisor/src/main.ts");
      await expect
        .poll(async () => (await getSnapshot(stuckSession)).session.state, {
          timeout: 30000,
        })
        .toBe("uncertain");
      await command(`/turns/${queuedB.operation.id}/cancel`, {});
      await expect
        .poll(
          async () =>
            (await getSnapshot(stuckSession)).operations.find(
              (o: any) => o.id === queuedB.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("interrupted");
      expect((await getSnapshot(stuckSession)).session.state).toBe("uncertain");
      expect(
        (await getSnapshot(stuckSession)).operations.find(
          (o: any) => o.id === queuedC.operation.id,
        ).state,
      ).toBe("queued");
      expect(
        (await command(`/sessions/${stuckSession}/turns`, payload)).status(),
      ).toBe(409);
      await releasePriorWorkspace();
      const crash = await (
        await command(`/sessions/${id}/turns`, {
          ...payload,
          text: "[crash-before-ack]",
        })
      ).json();
      await expect
        .poll(
          async () =>
            (await snapshot()).operations.find(
              (o: any) => o.id === crash.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("uncertain");
      expect((await command(`/sessions/${id}/turns`, payload)).status()).toBe(
        409,
      );
      const historyDb = createPool(env.DATABASE_URL);
      try {
        await p007({
          page: reopened,
          context,
          origin,
          db: historyDb,
          artifacts,
          fixtureState: env.HARBOR_FIXTURE_STATE_DIR,
          pauseSupervisor: () => {
            supervisor.kill("SIGSTOP");
          },
          resumeSupervisor: () => {
            supervisor.kill("SIGCONT");
          },
          trace: env.HARBOR_FIXTURE_TRACE_FILE,
          command,
          newSession,
          snapshot: getSnapshot,
          assertResponse,
          restartApi: async () => {
            api.kill("SIGTERM");
            await new Promise((r) => api.once("exit", r));
            api = start("apps/api/src/main.ts");
            await expect
              .poll(
                async () => {
                  try {
                    return (
                      await context.request.get(origin + "/api/v1/me")
                    ).status();
                  } catch {
                    return 0;
                  }
                },
                { timeout: 30000 },
              )
              .toBe(200);
          },
          restartSupervisor: async () => {
            supervisor.kill("SIGKILL");
            await new Promise((r) => supervisor.once("exit", r));
            supervisor = start("apps/supervisor/src/main.ts");
          },
          databaseOutage: async () => {
            compose(["stop", "postgres"]);
            await new Promise((r) => setTimeout(r, 2500));
            expect(
              (
                await command("/sessions", {
                  projectId: sessions.sessions[0].projectId,
                  model: "fixture",
                  effort: "medium",
                  permissionProfile: "read-only",
                })
              ).status(),
            ).toBe(500);
            compose(["start", "postgres"]);
            await expect
              .poll(
                async () => {
                  try {
                    return (await historyDb.query("SELECT 1 AS ok")).rows[0].ok;
                  } catch {
                    return 0;
                  }
                },
                { timeout: 30000 },
              )
              .toBe(1);
            if (supervisor.exitCode === null) {
              supervisor.kill("SIGTERM");
              await new Promise((r) => supervisor.once("exit", r));
            }
            supervisor = start("apps/supervisor/src/main.ts");
          },
        });
      } finally {
        await historyDb.end();
      }
      const initSession = await newSession();
      supervisor.kill("SIGTERM");
      await new Promise((r) => supervisor.once("exit", r));
      env.HARBOR_FIXTURE_INIT_DELAY_MS = "2000";
      await writeFile(env.HARBOR_FIXTURE_TRACE_FILE, "");
      supervisor = start("apps/supervisor/src/main.ts");
      const revokedContext = await browser.newContext({
        ignoreHTTPSErrors: true,
      });
      const revokedPage = await revokedContext.newPage();
      await revokedPage.goto(origin + "/auth/login");
      await revokedPage
        .getByRole("button", { name: "Sign in as owner", exact: true })
        .click();
      const revokedMe = await (
        await revokedContext.request.get(origin + "/api/v1/me")
      ).json();
      const revokedCommand = (route: string, data: unknown) =>
        revokedContext.request.post(origin + "/api/v1" + route, {
          data,
          headers: {
            Origin: origin,
            "X-CSRF-Token": revokedMe.csrfToken,
            "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
          },
        });
      const neverSent = await (
        await revokedCommand(`/sessions/${initSession}/turns`, payload)
      ).json();
      await expect
        .poll(
          async () =>
            (await getSnapshot(initSession)).operations.find(
              (o: any) => o.id === neverSent.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("dispatching");
      expect((await revokedCommand("/security/logout", {})).status()).toBe(200);
      await expect
        .poll(
          async () =>
            (await getSnapshot(initSession)).operations.find(
              (o: any) => o.id === neverSent.operation.id,
            ).state,
          { timeout: 30000 },
        )
        .toBe("uncertain");
      expect(
        (await readFile(env.HARBOR_FIXTURE_TRACE_FILE, "utf8")).trim(),
      ).toBe("");
      await revokedContext.close();
      const removalIntent = `${Date.now()}:${randomUUID()}`;
      await expect
        .poll(
          async () =>
            (
              await command(
                "/security/runtime-credentials/remove",
                {},
                removalIntent,
              )
            ).status(),
          { timeout: 30000 },
        )
        .toBe(200);
      expect(
        (
          await (
            await context.request.get(
              origin + "/api/v1/security/runtime-credentials",
            )
          ).json()
        ).configured,
      ).toBe(false);
      expect((await command("/security/emergency-stop", {})).status()).toBe(
        200,
      );
      expect((await command("/security/logout", {})).status()).toBe(200);
      expect((await context.request.get(origin + "/api/v1/me")).status()).toBe(
        401,
      );
      const oldOwner = await browser.newContext({ ignoreHTTPSErrors: true }),
        oldOwnerPage = await oldOwner.newPage();
      await oldOwnerPage.goto(origin + "/auth/login");
      await oldOwnerPage
        .getByRole("button", { name: "Sign in as owner", exact: true })
        .click();
      expect((await oldOwner.request.get(origin + "/api/v1/me")).status()).toBe(
        200,
      );
      env.HARBOR_OWNER_SUBJECT = "denied";
      api.kill("SIGTERM");
      await new Promise((r) => api.once("exit", r));
      api = start("apps/api/src/main.ts");
      await expect
        .poll(
          async () => {
            try {
              return (
                await oldOwner.request.get(origin + "/api/v1/me")
              ).status();
            } catch {
              return 0;
            }
          },
          { timeout: 30000 },
        )
        .toBe(401);
      expect(
        (
          await oldOwner.request.get(origin + `/api/v1/sessions/${id}/events`)
        ).status(),
      ).toBe(401);
      const machineAfterRotation = await apiRequest.newContext({
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { Authorization: "Bearer " + rotationBearer },
      });
      expect(
        (await machineAfterRotation.get(origin + "/api/v1/projects")).status(),
      ).toBe(401);
      await machineAfterRotation.dispose();
      const newOwner = await browser.newContext({ ignoreHTTPSErrors: true }),
        newOwnerPage = await newOwner.newPage();
      await newOwnerPage.goto(origin + "/auth/login");
      await newOwnerPage
        .getByRole("button", {
          name: "Sign in as denied identity",
          exact: true,
        })
        .click();
      expect(
        (await (await newOwner.request.get(origin + "/api/v1/me")).json()).owner
          .subject,
      ).toBe("denied");
      await oldOwner.close();
      await newOwner.close();
      await writeFile(
        path.join(artifacts, "result.json"),
        JSON.stringify(
          {
            instance,
            status: "passed",
            sourceAtStart,
            sourceAtEnd: sourceDigest(),
            runtime: "0.153.4",
            browser: "Chromium1194",
            node: process.version,
            scope:
              "P001/P002/P003/P005/P007 deterministic external-fixture acceptance; Linux/live separate",
          },
          null,
          2,
        ),
      );
      console.log("Secret-free screenshots and result: " + artifacts);
      console.log(
        "P001 deterministic E2E passed: real browser, Caddy, API, PostgreSQL, supervisor and external OIDC/Codex fixtures. Specialist/live gates separate.",
      );
    }
  }
} catch (error) {
  runFailed = true;
  await captureFailure("browser-failure").catch(() => undefined);
  throw error;
} finally {
  const postgresDiagnostics = await capturePostgresDiagnostics().catch(
    () => undefined,
  );
  await writeFile(
    path.join(artifacts, "command-responses.json"),
    JSON.stringify(
      {
        instance,
        sourceAtStart,
        totalCommands: commandSequence,
        retainedLimit: 120,
        responses: commandResponses,
        processDiagnostics: safeProcessDiagnostics(),
      },
      null,
      2,
    ),
  ).catch(() => undefined);
  await browser?.close();
  for (const p of children) p.kill("SIGTERM");
  await Promise.all(
    children.map((p) =>
      p.exitCode !== null || p.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            p.once("exit", r);
            setTimeout(() => {
              p.kill("SIGKILL");
              r(undefined);
            }, 5000);
          }),
    ),
  );
  try {
    compose(["down", "--volumes", "--remove-orphans"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  if (!runFailed) {
    expect(
      postgresDiagnostics?.databaseDeadlocks,
      "Fresh fixture database must contain no deadlocks",
    ).toBe(0);
    expect(
      postgresDiagnostics?.loggedDeadlocks,
      "Retained PostgreSQL log must contain no deadlocks",
    ).toBe(0);
  }
}
