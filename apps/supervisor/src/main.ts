import { prepareAttachments } from "../../../packages/attachments/src/materialize.ts";
import { maintainAttachments } from "../../../packages/attachments/src/store.ts";
import { processRecovery } from "./recovery.ts";
import { processWorkspaceStorage } from "./workspace-storage.ts";
import {
  processWorkspaceReleases,
  releaseRecoveredWorkspace,
} from "./workspace-recovery.ts";
import { claimWorkspace, releaseWorkspace } from "./workspace-admission.ts";
import {
  selectedWorkspace,
  sessionWorkspace,
  verifyWorkspace,
} from "../../../packages/workspaces/src/service.ts";
import {
  requireAuthority,
  lockOwnerIdentity,
  type Scope,
} from "../../../packages/policy/src/authority.ts";
import { RetirementRegistry } from "./retirement.ts";
import { retireRuntimeIdentity } from "../../../infra/runner/authority.ts";
import { clearManagedCredentials } from "../../../infra/storage/client.ts";
import { CredentialStore, serveCredentials } from "./credentials.ts";
import { maintain } from "../../../packages/storage/src/maintenance.ts";
import { RuntimeMailbox } from "./runtime-mailbox.ts";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { config } from "../../api/src/config.ts";
import {
  createPool,
  migrate,
  bindIdentity,
  transaction,
  event,
  deriveSessionState,
} from "../../../packages/storage/src/index.ts";
import {
  authorizePermission,
  HarborError,
  digest,
} from "../../../packages/policy/src/index.ts";
import { resolveProject } from "../../../packages/workspaces/src/index.ts";
import { createRuntime } from "../../../packages/codex-adapter/src/runtime.ts";
import type {
  CodexAdapter,
  RuntimeRequest,
  TurnOptions,
} from "../../../packages/codex-adapter/src/index.ts";
const c = config(),
  pool = createPool(c.DATABASE_URL);
await migrate(pool);
const ownerPin = digest(c.HARBOR_OIDC_ISSUER + "\0" + c.HARBOR_OWNER_SUBJECT);
await bindIdentity(pool, ownerPin);
let discovering = false;
let discoveryTransport: CodexAdapter | undefined;
const credentials = new CredentialStore(pool, c, clearNativeCredentials);
const fence = await pool.connect();
if (
  !(await fence.query("SELECT pg_try_advisory_lock(740014) AS held")).rows[0]
    .held
)
  throw Error("Another supervisor owns this instance");
let alive = true;
type RuntimeState = {
  adapter: CodexAdapter;
  generation: number;
  permissionProfile: string;
  authorityActor: string | null;
  authorityScope: Scope;
  credentialVersion: string;
  operation: string;
  thread: string;
  turn: string;
  mailbox: RuntimeMailbox;
};
const runtimes = new Map<string, RuntimeState>();
const terminalRepairs = new Map<string, string>();
const cancellationRepairs = new Map<string, "failed" | "succeeded">();
const retirement = new RetirementRegistry<CodexAdapter>();
const retire = (adapter: CodexAdapter) => retirement.retire(adapter);
fence.on("error", () => {
  alive = false;
  const owned = [...runtimes.values()].map((runtime) => runtime.adapter);
  if (discoveryTransport) owned.push(discoveryTransport);
  for (const adapter of owned) adapter.close();
  const deadline = setTimeout(() => process.exit(1), 25000);
  void Promise.allSettled(
    owned.map((adapter) => adapter.closeAndWait()),
  ).finally(() => {
    clearTimeout(deadline);
    process.exit(1);
  });
});
const generation = await transaction(pool, async (db) => {
  const g = Number(
    (
      await db.query(
        "UPDATE harbor_meta SET generation=generation+1 RETURNING generation",
      )
    ).rows[0].generation,
  );
  await db.query(
    "UPDATE operations SET state='failed',updated_at=now() WHERE kind<>'turn' AND state IN ('dispatching','running','waiting_approval','waiting_input','uncertain')",
  );
  const rows = await db.query(
    "UPDATE operations SET state='uncertain',updated_at=now() WHERE kind='turn' AND state IN ('dispatching','running','waiting_approval','waiting_input') RETURNING session_id",
  );
  await db.query(
    'UPDATE session_recoveries SET state=\'failed\',report=\'{"status":"unavailable","reason":"Supervisor restarted during fencing; retry explicitly"}\'::jsonb,updated_at=now() WHERE state=\'fencing\'',
  );
  await db.query(
    "UPDATE approvals SET state='expired' WHERE state IN ('pending','answering')",
  );
  for (const row of rows.rows) {
    await db.query(
      "UPDATE sessions SET state='uncertain',generation=$2 WHERE id=$1",
      [row.session_id, g],
    );
    await event(db, row.session_id, "runtime.uncertain", {
      reason: "Supervisor restarted; dispatched effects are not replayed",
    });
  }
  return g;
});
if (c.HARBOR_FIXTURE_MODE) {
  const probe = await createRuntime({
    sessionId: randomUUID(),
    projectId: randomUUID(),
    workspacePath: c.roots[0]!.path,
    generation,
    fixture: true,
  });
  try {
    const key = await credentials.read();
    if (key) await probe.loginWithApiKey(key);
    const account = await probe.readAccount();
    const models = await probe.listModels();
    await pool.query(
      "INSERT INTO runtime_capabilities(id,data) VALUES(true,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()",
      [
        JSON.stringify({
          ...models,
          account: {
            authenticated: !!account.account,
            authMode: account.account?.type ?? null,
          },
        }),
      ],
    );
  } finally {
    if (!(await retire(probe)))
      throw Error("Discovery runtime termination unconfirmed");
  }
}
async function clearNativeCredentials() {
  const deadline = Date.now() + 30000;
  const withinDeadline = () => {
    if (Date.now() > deadline)
      throw new HarborError(
        503,
        "CREDENTIAL_CLEANUP_TIMEOUT",
        "Credential cleanup timed out; retry the same intent",
      );
  };
  if (discovering || [...runtimes.values()].some((r) => r.operation))
    throw new HarborError(
      409,
      "CREDENTIAL_IN_USE",
      "Finish or stop active work before changing credentials",
    );
  for (const [id, r] of runtimes) {
    withinDeadline();
    await r.adapter.logoutAccount();
    runtimes.delete(id);
    if (!(await retire(r.adapter)))
      throw new HarborError(
        503,
        "RUNTIME_TERMINATION_UNCONFIRMED",
        "Credential cleanup requires confirmed runtime termination",
      );
  }
  if (!c.HARBOR_FIXTURE_MODE) {
    const identities = (
      await pool.query(
        "SELECT id,project_id FROM sessions UNION ALL SELECT b.runtime_id,p.id FROM runtime_bootstrap b CROSS JOIN LATERAL (SELECT id FROM projects ORDER BY created_at LIMIT 1) p",
      )
    ).rows;
    for (const row of identities) {
      withinDeadline();
      await retireRuntimeIdentity({
        instanceId: process.env.HARBOR_INSTANCE_ID ?? "harbor",
        projectId: row.project_id,
        sessionId: row.id,
      });
    }
  }
  if (!(await retirement.confirmed()))
    throw new HarborError(
      503,
      "RUNTIME_TERMINATION_UNCONFIRMED",
      "Credential cleanup requires confirmed runtime termination",
    );
  const projects = (await pool.query("SELECT * FROM projects")).rows;
  if (!c.HARBOR_FIXTURE_MODE || process.env.HARBOR_STORAGE_SOCKET) {
    for (const project of projects) {
      withinDeadline();
      await clearManagedCredentials(project.root_id, project.relative_path);
    }
  }
}
const closeCredentials = await serveCredentials(credentials, c);
let lastDiscovery = 0;
async function discover() {
  if (discovering || credentials.mutating) return;
  discovering = true;
  try {
    if (
      Date.now() - lastDiscovery < 60000 &&
      (await pool.query("SELECT 1 FROM runtime_capabilities")).rowCount
    )
      return;
    lastDiscovery = Date.now();
    const project = (
      await pool.query("SELECT * FROM projects ORDER BY created_at LIMIT 1")
    ).rows[0];
    if (!project) return;
    await pool.query(
      "INSERT INTO runtime_bootstrap(id,runtime_id) VALUES(true,$1) ON CONFLICT DO NOTHING",
      [randomUUID()],
    );
    const id = (await pool.query("SELECT runtime_id FROM runtime_bootstrap"))
      .rows[0].runtime_id;
    const epoch = Number(
      (
        await pool.query(
          "SELECT nextval('runtime_generation_seq') AS generation",
        )
      ).rows[0].generation,
    );
    const workspacePath = await resolveProject(
      c.roots,
      project.root_id,
      project.relative_path,
    );
    const probe = await createRuntime({
      onTransport: (adapter) => {
        discoveryTransport = adapter;
        if (!alive) adapter.close();
      },
      sessionId: id,
      projectId: project.id,
      workspacePath,
      workspaceDevice: project.device,
      workspaceInode: project.inode,
      generation: epoch,
      instanceId: process.env.HARBOR_INSTANCE_ID ?? "harbor",
      fixture: !!c.HARBOR_FIXTURE_MODE,
      permissionProfile: "read-only",
    });
    try {
      const key = await credentials.read();
      if (key) await probe.loginWithApiKey(key);
      const models = await probe.listModels(),
        account = await probe.readAccount();
      await pool.query(
        "INSERT INTO runtime_capabilities(id,data) VALUES(true,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()",
        [
          JSON.stringify({
            ...models,
            account: {
              authenticated: !!account.account,
              authMode: account.account?.type ?? null,
            },
          }),
        ],
      );
    } finally {
      if (!(await retire(probe)))
        throw Error("Discovery runtime termination unconfirmed");
    }
  } finally {
    // Initialization can fail before createRuntime returns its adapter. Keep the
    // onTransport capture owned through confirmed retirement in that case too.
    const transport = discoveryTransport;
    if (transport) await retire(transport);
    discovering = false;
    discoveryTransport = undefined;
  }
}
const boss = new PgBoss({ connectionString: c.DATABASE_URL });
boss.on("error", () => {
  /* durable SQL intent polling recovers missed wakeups */
});
await boss.start();
await boss.createQueue("harbor-dispatch");
async function update(id: string, state: string, data: unknown = {}) {
  await transaction(pool, async (db) => {
    const found = await db.query(
      "SELECT session_id FROM operations WHERE id=$1",
      [id],
    );
    if (!found.rowCount) return;
    const sessionId = found.rows[0].session_id;
    await db.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
      sessionId,
    ]);
    await db.query(
      "UPDATE operations SET state=$2,updated_at=now() WHERE id=$1 AND (state<>'uncertain' OR $2='uncertain') AND ($2<>'uncertain' OR state IN ('queued','dispatching','running','waiting_approval','waiting_input','uncertain'))",
      [id, state],
    );
    await deriveSessionState(db, sessionId);
    if (state === "uncertain")
      await db.query(
        "UPDATE approvals SET state='expired' WHERE operation_id=$1 AND state IN ('pending','answering')",
        [id],
      );
    await event(db, sessionId, "operation." + state, {
      operationId: id,
      ...(data as object),
    });
  });
}
async function onEvent(
  sessionId: string,
  operationId: string,
  method: string,
  p: any,
  captured: RuntimeState,
) {
  if (
    !alive ||
    captured.mailbox.poisoned ||
    runtimes.get(sessionId) !== captured
  )
    return;
  let completed = false;
  await transaction(pool, async (db) => {
    await db.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
      sessionId,
    ]);
    const valid = await db.query(
      "SELECT 1 FROM operations WHERE id=$1 AND generation=$2 AND state IN ('dispatching','running','waiting_approval','waiting_input')",
      [operationId, captured.generation],
    );
    if (!valid.rowCount || captured.mailbox.poisoned) return;
    if (method === "item/agentMessage/delta") {
      const total = await db.query(
        "SELECT coalesce(sum(octet_length(text)),0) AS bytes,count(*) AS count FROM messages WHERE session_id=$1",
        [sessionId],
      );
      if (
        Number(total.rows[0].bytes) + Buffer.byteLength(String(p.delta)) >
          2097152 ||
        Number(total.rows[0].count) >= 2000
      )
        throw Error("Conversation output quota");
      const existing = await db.query(
        "SELECT text FROM messages WHERE session_id=$1 AND native_item_id=$2 FOR UPDATE",
        [sessionId, p.itemId],
      );
      if (
        (existing.rows[0]?.text.length ?? 0) + String(p.delta).length >
        262144
      )
        throw Error("Output quota");
      await db.query(
        "INSERT INTO messages(id,session_id,operation_id,native_item_id,role,text,status) VALUES($1,$2,$3,$4,'assistant',$5,'streaming') ON CONFLICT(session_id,native_item_id) DO UPDATE SET text=messages.text||EXCLUDED.text",
        [randomUUID(), sessionId, operationId, p.itemId, p.delta],
      );
      await event(db, sessionId, "message.delta", {
        itemId: p.itemId,
        delta: p.delta,
      });
    } else if (method === "turn/completed") {
      const state =
        p.turn.status === "completed"
          ? "succeeded"
          : p.turn.status === "interrupted"
            ? "interrupted"
            : "failed";
      await db.query(
        "UPDATE operations SET state=$2,updated_at=now() WHERE id=$1",
        [operationId, state],
      );
      await deriveSessionState(db, sessionId);
      await db.query(
        "UPDATE messages SET status='complete' WHERE operation_id=$1",
        [operationId],
      );
      await db.query(
        "UPDATE approvals SET state='expired' WHERE operation_id=$1 AND state IN ('pending','answering')",
        [operationId],
      );
      await event(db, sessionId, "operation." + state, { operationId });
      completed = true;
    }
  });
  if (
    completed &&
    !captured.mailbox.poisoned &&
    runtimes.get(sessionId) === captured &&
    captured.operation === operationId
  )
    captured.operation = "";
  if (
    completed &&
    method === "turn/completed" &&
    p.turn.status === "interrupted" &&
    !captured.mailbox.poisoned &&
    runtimes.get(sessionId) === captured
  ) {
    const inspection = await captured.adapter.inspectProcesses().catch(() => ({
      status: "unavailable" as const,
      generation: captured.generation,
      processes: [],
    }));
    await transaction(pool, async (db) => {
      const current = await db.query(
        "UPDATE sessions SET process_inspection=$2 WHERE id=$1 AND generation=$3 RETURNING id",
        [
          sessionId,
          JSON.stringify({ ...inspection, generation: captured.generation }),
          captured.generation,
        ],
      );
      if (current.rowCount)
        await event(db, sessionId, "processes.inspected", inspection);
    });
  }
  if (
    completed &&
    !captured.mailbox.poisoned &&
    runtimes.get(sessionId) === captured
  ) {
    runtimes.delete(sessionId);
    if (await retire(captured.adapter))
      await releaseWorkspace(pool, sessionId, captured.generation);
  }
}
// Memory follows committed state only; failed COMMIT poisons the captured runtime.
async function onRequest(
  sessionId: string,
  operationId: string,
  r: RuntimeRequest,
  captured: RuntimeState,
) {
  if (
    !alive ||
    captured.mailbox.poisoned ||
    runtimes.get(sessionId) !== captured
  )
    return;
  await transaction(pool, async (db) => {
    await db.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
      sessionId,
    ]);
    const valid = await db.query(
      "SELECT 1 FROM operations WHERE id=$1 AND generation=$2 AND state IN ('dispatching','running','waiting_approval','waiting_input')",
      [operationId, captured.generation],
    );
    if (
      !valid.rowCount ||
      captured.mailbox.poisoned ||
      runtimes.get(sessionId) !== captured
    )
      return;
    if (
      Buffer.byteLength(JSON.stringify(r.params)) > 32768 ||
      Number(
        (
          await db.query("SELECT count(*) FROM approvals WHERE session_id=$1", [
            sessionId,
          ])
        ).rows[0].count,
      ) >= 100
    )
      throw Error("Approval quota");
    const state =
      r.method === "item/tool/requestUserInput"
        ? "waiting_input"
        : "waiting_approval";
    await db.query(
      "INSERT INTO approvals(id,session_id,operation_id,generation,request_id,kind,scope,deadline) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes')",
      [
        randomUUID(),
        sessionId,
        operationId,
        Number(
          (
            await db.query("SELECT generation FROM sessions WHERE id=$1", [
              sessionId,
            ])
          ).rows[0].generation,
        ),
        JSON.stringify(r.id),
        r.method,
        JSON.stringify(r.params),
      ],
    );
    await db.query("UPDATE operations SET state=$2 WHERE id=$1", [
      operationId,
      state,
    ]);
    await db.query("UPDATE sessions SET state=$2 WHERE id=$1", [
      sessionId,
      state,
    ]);
    await event(db, sessionId, "approval.pending", { operationId });
  });
}
let lastMaintenance = 0;
async function tick() {
  if (!alive) return;
  await fence.query("SELECT 1");
  for (const [operation, state] of cancellationRepairs) {
    await pool.query(
      "UPDATE operations SET state=$2,updated_at=now() WHERE id=$1 AND kind='cancel'",
      [operation, state],
    );
    cancellationRepairs.delete(operation);
  }
  for (const [operation, reason] of terminalRepairs) {
    await update(operation, "uncertain", { reason });
    terminalRepairs.delete(operation);
  }
  if (Date.now() - lastMaintenance > 60000) {
    await maintain(pool);
    await maintainAttachments(pool);
    lastMaintenance = Date.now();
  }
  if (credentials.mutating) return;
  await processWorkspaceStorage(pool, !!c.HARBOR_FIXTURE_MODE, c.roots);
  await processWorkspaceReleases(pool, {
    config: c,
    current: () => alive && !credentials.mutating,
    retire: async (sessionId, projectId) => {
      const runtime = runtimes.get(sessionId);
      if (runtime) {
        runtimes.delete(sessionId);
        if (!(await retire(runtime.adapter)))
          throw Error("Runtime retirement unconfirmed");
      }
      if (!c.HARBOR_FIXTURE_MODE)
        await retireRuntimeIdentity({
          instanceId: process.env.HARBOR_INSTANCE_ID ?? "harbor",
          projectId,
          sessionId,
        });
      if (!(await retirement.confirmed()))
        throw Error("Runtime retirement unconfirmed");
    },
  });

  await discover().catch(() => {});
  discovering = true;
  try {
    await processRecovery({
      pool,
      authority: async (db, actor) => {
        const meta = (
          await db.query("SELECT generation,identity_pin FROM harbor_meta")
        ).rows[0];
        if (
          !alive ||
          Number(meta.generation) !== generation ||
          meta.identity_pin !== ownerPin ||
          credentials.mutating
        )
          throw Error("Recovery authority lost");
        const authority = await requireAuthority(db, actor, c);
        if (authority.kind !== "browser")
          throw Error("Browser authority required");
      },
      lockWorkspace: async (db, id) => {
        const w = await sessionWorkspace(db, id, true);
        if (
          w.state !== "ready" ||
          (w.writer_session_id && w.writer_session_id !== id)
        )
          throw Error("Workspace owned by another operation or unavailable");
        if (
          (
            await db.query(
              "SELECT 1 FROM workspace_storage_operations WHERE project_id=$1 AND state IN ('queued','dispatching')",
              [w.project_id],
            )
          ).rowCount
        )
          throw Error("Workspace storage operation pending");
      },
      releaseWorkspace: async (db, input) => {
        const w = await selectedWorkspace(db, input.workspaceId, true);
        if (input.generation === null) {
          if (w.writer_session_id !== null) throw Error("Reservation changed");
          return;
        }
        await releaseRecoveredWorkspace(db, {
          ...input,
          generation: input.generation,
        });
      },
      retireSession: async (session) => {
        const current = runtimes.get(session.id);
        if (current) {
          runtimes.delete(session.id);
          if (!(await retire(current.adapter)))
            throw Error("Runtime retirement unconfirmed");
        }
        if (discoveryTransport) {
          if (!(await retire(discoveryTransport)))
            throw Error("Probe retirement unconfirmed");
          discoveryTransport = undefined;
        }
        if (!c.HARBOR_FIXTURE_MODE)
          await retireRuntimeIdentity({
            instanceId: process.env.HARBOR_INSTANCE_ID ?? "harbor",
            projectId: session.project_id,
            sessionId: session.id,
          });
        if (!(await retirement.confirmed()))
          throw Error("Owned transport retirement unconfirmed");
      },
      probe: async (session, epoch) =>
        createRuntime({
          onTransport: (adapter) => {
            discoveryTransport = adapter;
            if (!alive) adapter.close();
          },
          sessionId: session.id,
          projectId: session.project_id,
          workspacePath: await verifyWorkspace(session),
          workspaceId: session.workspace_id,
          gitCommon: session.common_path
            ? {
                canonical: session.common_path,
                device: session.common_device,
                inode: session.common_inode,
              }
            : undefined,
          workspaceDevice: session.device,
          workspaceInode: session.inode,
          generation: epoch,
          instanceId: process.env.HARBOR_INSTANCE_ID ?? "harbor",
          fixture: !!c.HARBOR_FIXTURE_MODE,
          permissionProfile: "read-only",
        }),
      retireProbe: retire,
    });
  } finally {
    discovering = false;
  }
  const emergency = (await pool.query("SELECT emergency FROM harbor_meta"))
    .rows[0].emergency;
  if (emergency) {
    for (const [id, r] of runtimes) {
      r.adapter.close();
      if (r.operation)
        await update(r.operation, "interrupted", { reason: "Emergency stop" });
      runtimes.delete(id);
    }
    await pool.query(
      "UPDATE operations SET state='interrupted' WHERE state='queued'",
    );
    return;
  }
  const approvals = await pool.query(
    "SELECT * FROM approvals WHERE state='answering' OR (state='pending' AND deadline<now())",
  );
  for (const a of approvals.rows) {
    const runtime = runtimes.get(a.session_id);
    if (!runtime || Number(a.generation) !== runtime.generation) {
      await pool.query("UPDATE approvals SET state='expired' WHERE id=$1", [
        a.id,
      ]);
      continue;
    }
    try {
      const expired = a.state === "pending";
      runtime.authorityActor = expired ? null : a.answer_actor_hash;
      runtime.authorityScope = "approve";
      if (
        (expired || a.answer?.decision === "decline") &&
        a.kind === "item/tool/requestUserInput"
      ) {
        await runtime.adapter.interruptTurn(runtime.thread, runtime.turn);
      } else
        await runtime.adapter.respond(
          JSON.parse(a.request_id),
          expired ? { decision: "decline" } : a.answer,
        );
      await transaction(pool, async (db) => {
        await db.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
          a.session_id,
        ]);
        await db.query("UPDATE approvals SET state=$2 WHERE id=$1", [
          a.id,
          expired ? "expired" : "resolved",
        ]);
        await event(
          db,
          a.session_id,
          "approval." + (expired ? "expired" : "resolved"),
          { approvalId: a.id },
        );
      });
    } catch (error) {
      if (
        error instanceof HarborError &&
        [401, 403].includes(error.statusCode)
      ) {
        await transaction(pool, async (db) => {
          await db.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
            a.session_id,
          ]);
          await db.query(
            "UPDATE approvals SET state='pending',answer=NULL,answer_actor_hash=NULL WHERE id=$1 AND state='answering'",
            [a.id],
          );
          await event(db, a.session_id, "approval.rejected", {
            approvalId: a.id,
            reason: "Answer authorization expired or revoked before send",
          });
        });
      } else {
        await update(a.operation_id, "uncertain");
        runtime.adapter.close();
      }
    }
  }
  const cancels = await pool.query(
    "SELECT * FROM operations WHERE kind='cancel' AND state='queued'",
  );
  for (const cancel of cancels.rows) {
    const target = await pool.query("SELECT * FROM operations WHERE id=$1", [
      cancel.payload.operationId,
    ]);
    const t = target.rows[0],
      r = runtimes.get(cancel.session_id);
    const projectId = (
      await pool.query("SELECT project_id FROM sessions WHERE id=$1", [
        cancel.session_id,
      ])
    ).rows[0].project_id;
    try {
      await requireAuthority(pool, cancel.actor_hash, c, {
        scope: "cancel",
        projectId,
      });
    } catch {
      await pool.query("UPDATE operations SET state='failed' WHERE id=$1", [
        cancel.id,
      ]);
      continue;
    }
    if (r) {
      r.authorityActor = cancel.actor_hash;
      r.authorityScope = "cancel";
    }
    if (t.state === "queued") {
      try {
        await transaction(pool, async (db) => {
          await requireAuthority(db, cancel.actor_hash, c, {
            scope: "cancel",
            projectId,
          });
          await db.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
            cancel.session_id,
          ]);
          await requireAuthority(db, cancel.actor_hash, c, {
            scope: "cancel",
            projectId,
          });
          await db.query(
            "UPDATE operations SET state='interrupted',updated_at=now() WHERE id=$1 AND state='queued'",
            [t.id],
          );
          await db.query(
            "UPDATE operations SET state='succeeded' WHERE id=$1",
            [cancel.id],
          );
          await deriveSessionState(db, cancel.session_id);
          await event(db, cancel.session_id, "operation.interrupted", {
            operationId: t.id,
          });
        });
      } catch (error) {
        if (
          error instanceof HarborError &&
          [401, 403].includes(error.statusCode)
        )
          await pool.query("UPDATE operations SET state='failed' WHERE id=$1", [
            cancel.id,
          ]);
        else throw error;
      }
    } else if (r && r.operation === t.id && r.turn) {
      try {
        await pool.query(
          "UPDATE operations SET state='dispatching' WHERE id=$1",
          [cancel.id],
        );
        await r.adapter.interruptTurn(r.thread, r.turn);
        await pool.query(
          "UPDATE operations SET state='succeeded' WHERE id=$1",
          [cancel.id],
        );
      } catch (error) {
        const completed =
          (error as { code?: string }).code === "TURN_ALREADY_COMPLETED";
        const denied =
          error instanceof HarborError && [401, 403].includes(error.statusCode);
        cancellationRepairs.set(cancel.id, completed ? "succeeded" : "failed");
        if (!completed && !denied)
          r.mailbox.poison("Turn interruption could not be confirmed");
        const uncertain = await transaction(pool, async (db) => {
          await db.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
            cancel.session_id,
          ]);
          const target = (
            await db.query(
              "SELECT state FROM operations WHERE id=$1 FOR UPDATE",
              [t.id],
            )
          ).rows[0];
          const active =
            target &&
            [
              "dispatching",
              "running",
              "waiting_approval",
              "waiting_input",
            ].includes(target.state);
          if (!completed && !denied && active) {
            await db.query(
              "UPDATE operations SET state='uncertain',updated_at=now() WHERE id=$1",
              [t.id],
            );
            await db.query(
              "UPDATE approvals SET state='expired' WHERE operation_id=$1 AND state IN ('pending','answering')",
              [t.id],
            );
            await event(db, cancel.session_id, "operation.uncertain", {
              operationId: t.id,
              reason: "Turn interruption could not be confirmed",
            });
          }
          await db.query(
            "UPDATE operations SET state=$2,updated_at=now() WHERE id=$1",
            [cancel.id, completed ? "succeeded" : "failed"],
          );
          await deriveSessionState(db, cancel.session_id);
          await event(
            db,
            cancel.session_id,
            completed ? "cancel.noop" : "cancel.failed",
            { operationId: t.id, cancelId: cancel.id },
          );
          return !completed && !denied && active;
        });
        cancellationRepairs.delete(cancel.id);
        if (uncertain)
          r.mailbox.poison("Turn interruption could not be confirmed");
      }
    } else
      await pool.query("UPDATE operations SET state='failed' WHERE id=$1", [
        cancel.id,
      ]);
  }
  const candidates = await pool.query(
    "SELECT o.*,s.native_thread_id,s.project_id,s.workspace_id,p.root_id,w.relative_path,w.device,w.inode,w.canonical_path,w.common_path,w.common_device,w.common_inode FROM operations o JOIN sessions s ON s.id=o.session_id JOIN projects p ON p.id=s.project_id JOIN workspaces w ON w.id=s.workspace_id WHERE w.state='ready' AND p.archived_at IS NULL AND w.writer_session_id IS NULL AND o.kind='turn' AND o.state='queued' AND s.state<>'uncertain' AND NOT EXISTS(SELECT 1 FROM operations active WHERE active.session_id=o.session_id AND active.kind='turn' AND (active.state IN ('dispatching','running','waiting_approval','waiting_input') OR (active.state='uncertain' AND active.uncertainty_acknowledged_at IS NULL))) ORDER BY o.created_at LIMIT 4",
  );
  for (const o of candidates.rows) {
    if ([...runtimes.values()].filter((r) => r.operation).length >= 4) break;
    if (runtimes.get(o.session_id)?.operation) continue;
    try {
      await requireAuthority(pool, o.actor_hash, c, {
        scope: "execute",
        projectId: o.project_id,
        permissionProfile: o.payload.permissionProfile,
      });
    } catch {
      await update(o.id, "failed", {
        reason: "Queued execution grant revoked or restricted",
      });
      continue;
    }
    try {
      authorizePermission(
        o.payload.permissionProfile,
        c.HARBOR_PERMISSION_CEILING,
      );
      const workspacePath = await verifyWorkspace(o);
      const admitted = await transaction(pool, async (db) => {
        await requireAuthority(db, o.actor_hash, c, {
          scope: "execute",
          projectId: o.project_id,
          permissionProfile: o.payload.permissionProfile,
        });
        if (
          !(await claimWorkspace(db, o.workspace_id, o.session_id, generation))
        )
          return false;
        await requireAuthority(db, o.actor_hash, c, {
          scope: "execute",
          projectId: o.project_id,
          permissionProfile: o.payload.permissionProfile,
        });
        await db.query(
          "UPDATE operations SET state='dispatching',generation=$2 WHERE id=$1",
          [o.id, generation],
        );
        await db.query(
          "UPDATE sessions SET permission_profile=$3,model=$4,effort=$5 WHERE id=$1 AND $2::bigint>0",
          [
            o.session_id,
            generation,
            o.payload.permissionProfile,
            o.payload.model,
            o.payload.effort,
          ],
        );
        await event(db, o.session_id, "operation.dispatching", {
          operationId: o.id,
        });
        return true;
      });
      if (!admitted) continue;
      const attachments = await prepareAttachments(
        pool,
        o.session_id,
        o.id,
        workspacePath,
        !!c.HARBOR_FIXTURE_MODE,
      );
      const credentialVersion = await credentials.version();
      let r = runtimes.get(o.session_id);
      if (
        r &&
        (r.permissionProfile !== o.payload.permissionProfile ||
          r.credentialVersion !== credentialVersion)
      ) {
        runtimes.delete(o.session_id);
        if (!(await retire(r.adapter)))
          throw Error("Previous runtime termination unconfirmed");
        r = undefined;
      }
      if (!r) {
        const runtimeGeneration = Number(
          (
            await pool.query(
              "SELECT nextval('runtime_generation_seq') AS generation",
            )
          ).rows[0].generation,
        );
        await pool.query("UPDATE sessions SET generation=$2 WHERE id=$1", [
          o.session_id,
          runtimeGeneration,
        ]);

        await pool.query(
          "UPDATE workspaces SET writer_generation=$2 WHERE id=$1 AND writer_session_id=$3",
          [o.workspace_id, runtimeGeneration, o.session_id],
        );
        let captured: RuntimeState;
        const mailbox = new RuntimeMailbox((reason) => {
          const current = captured && runtimes.get(o.session_id) === captured;
          const operation = current ? captured.operation : undefined;
          if (current) runtimes.delete(o.session_id);
          if (captured) void retire(captured.adapter);
          // Terminal persistence is independent of normal notification processing.
          if (operation)
            void update(operation, "uncertain", { reason }).catch(() => {
              terminalRepairs.set(operation, reason);
            });
        });
        const adapter = await createRuntime({
          sessionId: o.session_id,
          projectId: o.project_id,
          workspacePath,
          attachmentDirectory: attachments.directory,
          attachmentProject: attachments.project,
          workspaceId: o.workspace_id,
          gitCommon: o.common_path
            ? {
                canonical: o.common_path,
                device: o.common_device,
                inode: o.common_inode,
              }
            : undefined,
          workspaceDevice: o.device,
          workspaceInode: o.inode,
          generation: runtimeGeneration,
          instanceId: process.env.HARBOR_INSTANCE_ID ?? "harbor",
          permissionProfile: o.payload.permissionProfile,
          fixture: !!c.HARBOR_FIXTURE_MODE,
          onTransport: (adapter) => {
            captured = {
              adapter,
              generation: runtimeGeneration,
              permissionProfile: o.payload.permissionProfile,
              authorityActor: o.actor_hash,
              authorityScope: "execute",
              credentialVersion,
              operation: o.id,
              thread: "",
              turn: "",
              mailbox,
            };
            runtimes.set(o.session_id, captured);
            if (!alive || mailbox.poisoned) {
              mailbox.poison("Supervisor authority lost during initialization");
              adapter.close();
            }
          },
          withDispatch: async (send) => {
            if (
              credentials.mutating ||
              !alive ||
              mailbox.poisoned ||
              runtimes.get(o.session_id) !== captured
            )
              throw Error("Runtime authority lost");
            await fence.query("BEGIN");
            try {
              await lockOwnerIdentity(fence);
              const meta = await fence.query(
                "SELECT generation,emergency,identity_pin FROM harbor_meta FOR UPDATE",
              );
              if (
                Number(meta.rows[0].generation) !== generation ||
                meta.rows[0].identity_pin !== ownerPin ||
                meta.rows[0].emergency
              )
                throw Error("Dispatch fenced or stopped");
              if (captured.authorityActor) {
                await requireAuthority(fence, captured.authorityActor, c, {
                  scope: captured.authorityScope,
                  projectId: o.project_id,
                  permissionProfile:
                    captured.authorityScope === "cancel"
                      ? undefined
                      : captured.permissionProfile,
                });
              }
              const session = await fence.query(
                "SELECT generation FROM sessions WHERE id=$1 FOR UPDATE",
                [o.session_id],
              );
              const uncertain = await fence.query(
                "SELECT 1 FROM operations WHERE session_id=$1 AND state='uncertain' AND uncertainty_acknowledged_at IS NULL LIMIT 1",
                [o.session_id],
              );
              if (
                Number(session.rows[0].generation) !== runtimeGeneration ||
                uncertain.rowCount ||
                !alive ||
                mailbox.poisoned ||
                runtimes.get(o.session_id) !== captured
              )
                throw Error("Runtime generation invalid");
              // Session/generation locks can themselves wait past expiration.
              // Re-evaluate authority after every lock, immediately before wire send.
              if (captured.authorityActor)
                await requireAuthority(fence, captured.authorityActor, c, {
                  projectId: o.project_id,
                  scope: captured.authorityScope,
                  permissionProfile:
                    captured.authorityScope === "cancel"
                      ? undefined
                      : captured.permissionProfile,
                });
              const result = send();
              await fence.query("COMMIT");
              return result;
            } catch (error) {
              await fence.query("ROLLBACK").catch(() => {});
              throw error;
            }
          },
          onEvent: (m, p) => {
            const operation = captured?.operation;
            if (operation)
              mailbox.enqueue(Buffer.byteLength(JSON.stringify(p)), () =>
                onEvent(o.session_id, operation, m, p, captured),
              );
          },
          onRequest: (request) => {
            const operation = captured?.operation;
            if (operation)
              mailbox.enqueue(Buffer.byteLength(JSON.stringify(request)), () =>
                onRequest(o.session_id, operation, request, captured),
              );
          },
          onDisconnect: () =>
            mailbox.poison("Runtime disconnected; delivery uncertain"),
        });
        r = captured!;
        if (mailbox.poisoned) {
          adapter.close();
          throw Error("Runtime failed during initialization");
        }
        const key = await credentials.read();
        if (key) await adapter.loginWithApiKey(key);
        else if (!c.HARBOR_FIXTURE_MODE)
          throw Error("Runtime credentials not configured");
        const models = await adapter.listModels();
        await pool.query(
          "INSERT INTO runtime_capabilities(id,data) VALUES(true,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()",
          [
            JSON.stringify({
              ...models,
              account: (await adapter.readAccount()).account
                ? { authenticated: true, authMode: "apiKey" }
                : { authenticated: false, authMode: null },
            }),
          ],
        );
        const native = o.native_thread_id
          ? await adapter.resumeThread(o.native_thread_id, {
              cwd: "/workspace",
              permissionProfile: o.payload.permissionProfile,
            })
          : await adapter.startThread({
              cwd: "/workspace",
              model: o.payload.model,
              permissionProfile: o.payload.permissionProfile,
            });
        r.thread = native.thread.id;
        await pool.query(
          "UPDATE sessions SET native_thread_id=$2 WHERE id=$1",
          [o.session_id, r.thread],
        );
      }
      await pool.query("UPDATE operations SET generation=$2 WHERE id=$1", [
        o.id,
        r.generation,
      ]);
      await pool.query("UPDATE sessions SET generation=$2 WHERE id=$1", [
        o.session_id,
        r.generation,
      ]);
      r.operation = o.id;
      r.authorityActor = o.actor_hash;
      r.authorityScope = "execute";
      const turn = await r.adapter.startTurn(r.thread, o.payload.text, {
        ...o.payload,
        attachments: attachments.inputs,
      } as TurnOptions);
      r.turn = turn.turn.id;
      await pool.query("UPDATE operations SET native_turn_id=$2 WHERE id=$1", [
        o.id,
        r.turn,
      ]);
      await pool.query("UPDATE sessions SET native_turn_id=$2 WHERE id=$1", [
        o.session_id,
        r.turn,
      ]);
      await transaction(pool, async (db) => {
        const active = await db.query(
          "UPDATE operations SET state='running',updated_at=now() WHERE id=$1 AND state='dispatching' RETURNING session_id",
          [o.id],
        );
        if (active.rowCount) {
          await db.query("UPDATE sessions SET state='running' WHERE id=$1", [
            o.session_id,
          ]);
          await event(db, o.session_id, "operation.running", {
            operationId: o.id,
          });
        }
      });
    } catch {
      await update(o.id, "uncertain", {
        reason: "Dispatch failed or acknowledgement uncertain",
      });
      runtimes.get(o.session_id)?.adapter.close();
      runtimes.delete(o.session_id);
    }
  }
}
let ticking = false;
await boss.work(
  "harbor-dispatch",
  { pollingIntervalSeconds: 0.5 },
  async () => {
    if (ticking || !alive) return;
    ticking = true;
    try {
      await tick();
    } finally {
      ticking = false;
    }
  },
);
const timer = setInterval(() => {
  void boss
    .send("harbor-dispatch", {}, { singletonKey: "dispatch", retryLimit: 0 })
    .catch(() => {});
}, 250);
async function stop() {
  alive = false;
  clearInterval(timer);
  discoveryTransport?.close();
  for (const r of runtimes.values()) r.adapter.close();
  await closeCredentials?.();
  await boss.stop();
  fence.release();
  await pool.end();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void stop());
