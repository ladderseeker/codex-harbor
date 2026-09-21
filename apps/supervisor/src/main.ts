import {
  lockSessionResource,
  lockSessionResources,
} from "../../../packages/storage/src/session-lock.ts";
import {
  runtimeState,
  queueReason,
} from "../../../packages/storage/src/conversation-runtimes.ts";
import { classifyIdle, capacityReason } from "./runtime-capacity.ts";
import {
  inspectRecoveredLocalRuntime,
  PersonalRuntimeNotStartedError,
} from "../../../packages/codex-adapter/src/local-runtime.ts";
import { settleBackgroundRetirement } from "./background-retirement.ts";
import { saveConversationOutput } from "./conversation-output.ts";
import { processSchedules } from "../../../packages/schedules/src/worker.ts";
import {
  initializeScheduleQueue,
  SCHEDULE_QUEUE,
} from "../../../packages/schedules/src/queue.ts";
import { TerminalSupervisor } from "./terminals.ts";
import { PreviewSupervisor } from "./previews.ts";
import { prepareAttachments } from "../../../packages/attachments/src/materialize.ts";
import { maintainAttachments } from "../../../packages/attachments/src/store.ts";
import {
  processFiles,
  recoverFileStartup,
  retireActiveFiles,
} from "./files.ts";
import { processRecovery } from "./recovery.ts";
import {
  deploymentAdmission,
  deploymentState,
  verifyInstalledSchema,
} from "../../../packages/storage/src/deployment.ts";
import { processWorkspaceStorage } from "./workspace-storage.ts";
import {
  processWorkspaceReleases,
  releaseRecoveredWorkspace,
} from "./workspace-recovery.ts";
import {
  claimWorkspace,
  releaseWorkspace,
  workspaceAdmission,
  WorkspaceAdmissionChanged,
} from "./workspace-admission.ts";
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
if (process.env.HARBOR_MANAGED_RELEASE) await verifyInstalledSchema(pool);
else await migrate(pool);
const personal = !!(c.HARBOR_LOCAL_MODE || c.HARBOR_PERSONAL_VPS_MODE);
const ownerPin = digest(c.HARBOR_OIDC_ISSUER + "\0" + c.HARBOR_OWNER_SUBJECT);
await bindIdentity(pool, ownerPin);
if (c.HARBOR_LOCAL_MODE || c.HARBOR_PERSONAL_VPS_MODE)
  await pool.query("DELETE FROM runtime_capabilities");
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
let terminals: TerminalSupervisor | undefined;
let previews: PreviewSupervisor | undefined;
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
  retiring?: boolean;
  activation?: Promise<void>;
};
const runtimes = new Map<string, RuntimeState>();
const terminalRepairs = new Map<string, string>();
const cancellationRepairs = new Map<string, "failed" | "succeeded">();
const retirement = new RetirementRegistry<CodexAdapter>();
const retire = async (adapter: CodexAdapter) => {
  const confirmed = await retirement.retire(adapter);
  const owned = adapter.ownedIdentity();
  if (
    confirmed &&
    owned?.cgroup &&
    !(
      await pool.query(
        "SELECT 1 FROM conversation_runtimes WHERE generation=$1 AND native_identity->'cgroup'->>'path'=$2 LIMIT 1",
        [owned.cgroup.generation, owned.cgroup.path],
      )
    ).rowCount
  )
    await adapter.cleanupRetiredOwnership().catch(() => {
      console.error("Empty retired runtime ownership cleanup remains pending");
    });
  return confirmed;
};
fence.on("error", () => {
  alive = false;
  void terminals?.stop();
  void previews?.stop();
  const owned = [...runtimes.values()].map((runtime) => runtime.adapter);
  if (discoveryTransport) owned.push(discoveryTransport);
  for (const adapter of owned) adapter.close();
  const deadline = setTimeout(() => process.exit(1), 25000);
  void Promise.allSettled([
    ...owned.map((adapter) => adapter.closeAndWait()),
    retireActiveFiles(),
  ]).finally(() => {
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
  await lockSessionResources(
    db,
    (await db.query("SELECT id FROM sessions ORDER BY id")).rows.map(
      (row) => row.id,
    ),
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
  // A legacy exclusive reservation cannot silently become shared authority.
  if (
    personal &&
    (
      await db.query(
        "SELECT 1 FROM workspaces WHERE writer_owner_id IS NOT NULL LIMIT 1",
      )
    ).rowCount
  )
    throw Error(
      "Drain legacy personal workspace reservations before upgrading",
    );
  const retained = personal
    ? (await db.query("SELECT * FROM conversation_runtimes")).rows
    : [];
  for (const member of retained) {
    if (
      (await inspectRecoveredLocalRuntime(
        member.native_identity,
        Number(member.generation),
      )) === "absent"
    ) {
      await db.query(
        "DELETE FROM conversation_runtimes WHERE session_id=$1 AND generation=$2",
        [member.session_id, member.generation],
      );
      await db.query(
        "UPDATE sessions SET background_until=NULL,background_stop_requested=false WHERE id=$1",
        [member.session_id],
      );
      await event(db, member.session_id, "background.stopped", {
        generation: Number(member.generation),
      });
    } else {
      await db.query(
        "UPDATE conversation_runtimes SET state='unknown',idle_until=NULL WHERE session_id=$1 AND generation=$2",
        [member.session_id, member.generation],
      );
      await db.query(
        "UPDATE sessions SET state='uncertain',background_until=NULL,background_stop_requested=true WHERE id=$1",
        [member.session_id],
      );
    }
  }
  const abandonedBackground = await db.query(
    "UPDATE sessions SET state='uncertain',background_until=NULL,background_stop_requested=true WHERE background_until IS NOT NULL RETURNING id",
  );
  for (const row of abandonedBackground.rows)
    await event(db, row.id, "runtime.uncertain", {
      reason:
        "Supervisor restarted while development processes were retained; workspace ownership requires trusted process retirement before recovery",
    });
  for (const row of rows.rows) {
    await db.query(
      "UPDATE sessions SET state='uncertain',generation=CASE WHEN $3 THEN generation ELSE $2 END WHERE id=$1",
      [row.session_id, g, personal],
    );
    await event(db, row.session_id, "runtime.uncertain", {
      reason: "Supervisor restarted; dispatched effects are not replayed",
    });
  }
  return g;
});
if (!c.HARBOR_PERSONAL_VPS_MODE) {
  await recoverFileStartup(pool);
  terminals = new TerminalSupervisor(pool, c, () => alive);
  terminals.start();
  previews = new PreviewSupervisor(pool, c, () => alive);
  await previews.start();
}
if (c.HARBOR_FIXTURE_MODE) {
  const probe = await createRuntime({
    sessionId: randomUUID(),
    projectId: randomUUID(),
    workspacePath: c.roots[0]!.path,
    generation,
    fixture: true,
  });
  try {
    const key = c.HARBOR_PERSONAL_VPS_MODE ? null : await credentials.read();
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
    if (!(await retireSessionRuntime(id, r)))
      throw new HarborError(
        503,
        "RUNTIME_TERMINATION_UNCONFIRMED",
        "Credential cleanup requires confirmed runtime termination",
      );
  }
  if (!personal && !c.HARBOR_FIXTURE_MODE) {
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
  if (
    !personal &&
    (!c.HARBOR_FIXTURE_MODE || process.env.HARBOR_STORAGE_SOCKET)
  ) {
    for (const project of projects) {
      withinDeadline();
      await clearManagedCredentials(project.root_id, project.relative_path);
    }
  }
}
const closeCredentials = await serveCredentials(credentials, c);
let lastDiscovery = 0;
async function discover() {
  if (
    discovering ||
    credentials.mutating ||
    (await deploymentState(pool)).maintenance ||
    (await deploymentState(pool)).activation_required
  )
    return;
  discovering = true;
  try {
    if (
      Date.now() - lastDiscovery < 60000 &&
      (await pool.query("SELECT 1 FROM runtime_capabilities")).rowCount
    )
      return;
    lastDiscovery = Date.now();
    const project =
      (await pool.query("SELECT * FROM projects ORDER BY created_at LIMIT 1"))
        .rows[0] ??
      (c.HARBOR_LOCAL_MODE || c.HARBOR_PERSONAL_VPS_MODE
        ? { id: randomUUID(), relative_path: null }
        : undefined);
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
    const workspacePath =
      (c.HARBOR_LOCAL_MODE || c.HARBOR_PERSONAL_VPS_MODE) &&
      project.relative_path === null
        ? c.roots[0]!.path
        : await resolveProject(
            c.roots,
            project.root_id,
            project.relative_path,
            false,
            !!c.HARBOR_PERSONAL_VPS_MODE,
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
      const key = c.HARBOR_PERSONAL_VPS_MODE ? null : await credentials.read();
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
await initializeScheduleQueue(boss);
await boss.work(SCHEDULE_QUEUE, { pollingIntervalSeconds: 0.5 }, async () => {
  // The opaque job wakes the ordinary durable poller; it never dispatches native work directly.
  if (alive)
    await boss.send(
      "harbor-dispatch",
      {},
      { singletonKey: "dispatch", retryLimit: 0 },
    );
});
let scheduleTick: Promise<void> | undefined;
const scheduleFence = async (
  db: import("pg").PoolClient,
  settlementOnly = false,
) => {
  const deployment = await deploymentState(db);
  if (deployment.maintenance || deployment.activation_required)
    throw Error("Schedule deployment admission closed");
  const meta = (
    await db.query("SELECT generation,identity_pin,emergency FROM harbor_meta")
  ).rows[0];
  if (
    !alive ||
    credentials.mutating ||
    Number(meta.generation) !== generation ||
    meta.identity_pin !== ownerPin ||
    (meta.emergency && !settlementOnly)
  )
    throw Error("Schedule dispatcher fenced or stopped");
};
async function update(id: string, state: string, data: unknown = {}) {
  await transaction(pool, async (db) => {
    const found = await db.query(
      "SELECT session_id FROM operations WHERE id=$1",
      [id],
    );
    if (!found.rowCount) return;
    const sessionId = found.rows[0].session_id;
    await lockSessionResource(db, sessionId);
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
function belongsToTurn(params: Record<string, any>, runtime: RuntimeState) {
  return Boolean(
    runtime.thread &&
      runtime.turn &&
      params.threadId === runtime.thread &&
      (params.turnId ?? params.turn?.id) === runtime.turn,
  );
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
  if (!belongsToTurn(p, captured) || captured.operation !== operationId) return;
  let completed = false;
  await transaction(pool, async (db) => {
    await lockSessionResource(db, sessionId);
    const valid = await db.query(
      "SELECT 1 FROM operations WHERE id=$1 AND generation=$2 AND state IN ('dispatching','running','waiting_approval','waiting_input')",
      [operationId, captured.generation],
    );
    if (!valid.rowCount || captured.mailbox.poisoned) return;
    await saveConversationOutput(db, sessionId, operationId, method, p);
    if (method === "turn/completed") {
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
      if (personal && p.turn.status === "completed") {
        await db.query(
          "UPDATE sessions SET background_until=clock_timestamp()+interval '30 minutes',background_stop_requested=false WHERE id=$1",
          [sessionId],
        );
        await event(db, sessionId, "background.retained", { expiresIn: 1800 });
      }
      if (personal)
        await runtimeState(db, sessionId, captured.generation, "idle", true);
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
    personal &&
    p.turn.status === "completed" &&
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
      await lockSessionResource(db, sessionId);
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
    if (personal && p.turn.status === "completed") {
      await classifyRuntime(sessionId, captured);
      return;
    }
    await retireSessionRuntime(sessionId, captured, false, operationId);
  }
}
async function classifyRuntime(sessionId: string, runtime: RuntimeState) {
  if (
    runtime.operation ||
    runtime.retiring ||
    runtimes.get(sessionId) !== runtime
  )
    return;
  const result = classifyIdle(
    await runtime.adapter.inspectProcesses().catch(() => ({
      status: "unavailable" as const,
      generation: runtime.generation,
      processes: [],
    })),
    runtime.generation,
  );
  if (
    runtime.operation ||
    runtime.retiring ||
    runtimes.get(sessionId) !== runtime
  )
    return;
  if (result === "gone") {
    await retireSessionRuntime(sessionId, runtime);
    return;
  }
  await transaction(pool, async (db) => {
    await lockSessionResource(db, sessionId);
    if (
      !runtime.operation &&
      !runtime.retiring &&
      runtimes.get(sessionId) === runtime
    )
      await runtimeState(db, sessionId, runtime.generation, result);
  });
}
async function retireSessionRuntime(
  sessionId: string,
  runtime: RuntimeState,
  automatic = false,
  completedOperation?: string,
) {
  if (runtime.retiring) return false;
  const admitted = await transaction(pool, async (db) => {
    await sessionWorkspace(db, sessionId, true);
    const session = (
      await db.query("SELECT generation FROM sessions WHERE id=$1 FOR UPDATE", [
        sessionId,
      ])
    ).rows[0];
    if (
      !session ||
      Number(session.generation) !== runtime.generation ||
      runtime.retiring
    )
      return false;
    if (
      completedOperation !== undefined &&
      runtime.operation !== completedOperation
    )
      return false;
    if (automatic) {
      const member = (
        await db.query(
          "SELECT * FROM conversation_runtimes WHERE session_id=$1 AND generation=$2 FOR UPDATE",
          [sessionId, runtime.generation],
        )
      ).rows[0];
      if (
        !member ||
        member.state !== "idle" ||
        runtime.operation ||
        runtimes.get(sessionId) !== runtime
      )
        return false;
      const classification = classifyIdle(
        await runtime.adapter.inspectProcesses(),
        runtime.generation,
      );
      if (classification !== "idle") {
        await runtimeState(
          db,
          sessionId,
          runtime.generation,
          classification === "gone" ? "unknown" : classification,
        );
        return false;
      }
      if (
        runtime.operation ||
        runtime.retiring ||
        runtimes.get(sessionId) !== runtime
      )
        return false;
    }
    runtime.retiring = true;
    if (completedOperation !== undefined) runtime.operation = "";
    if (personal)
      await runtimeState(db, sessionId, runtime.generation, "retiring");
    return true;
  });
  if (!admitted) return false;
  return settleBackgroundRetirement({
    retire: async () =>
      (await retire(runtime.adapter)) ||
      (await retirement.confirmed(runtime.adapter)),
    uncertain: async () => {
      if (runtimes.get(sessionId) === runtime) runtimes.delete(sessionId);
      await transaction(pool, async (db) => {
        await lockSessionResource(db, sessionId);
        if (personal)
          await runtimeState(db, sessionId, runtime.generation, "unknown");
        const saved = await db.query(
          "UPDATE sessions SET state='uncertain',background_until=NULL,background_stop_requested=true WHERE id=$1 AND generation=$2 RETURNING id",
          [sessionId, runtime.generation],
        );
        if (saved.rowCount)
          await event(db, sessionId, "runtime.uncertain", {
            reason:
              "Runtime retirement could not be confirmed; this conversation remains reserved.",
          });
      });
    },
    release: async () => {
      if (runtimes.get(sessionId) === runtime) runtimes.delete(sessionId);
      if (!personal)
        await releaseWorkspace(pool, sessionId, runtime.generation);
      await transaction(pool, async (db) => {
        await lockSessionResource(db, sessionId);
        await db.query(
          "DELETE FROM conversation_runtimes WHERE session_id=$1 AND generation=$2",
          [sessionId, runtime.generation],
        );
        const saved = await db.query(
          "UPDATE sessions SET background_until=NULL,background_stop_requested=false WHERE id=$1 AND generation=$2 RETURNING id",
          [sessionId, runtime.generation],
        );
        if (saved.rowCount)
          await event(db, sessionId, "background.stopped", {});
      });
      await runtime.adapter.cleanupRetiredOwnership().catch(() => {
        console.error(
          "Empty retired runtime ownership cleanup remains pending",
        );
      });
    },
  });
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
  if (
    !belongsToTurn(r.params, captured) ||
    captured.operation !== operationId
  ) {
    captured.adapter.rejectRequest(r.id);
    return;
  }
  await transaction(pool, async (db) => {
    await lockSessionResource(db, sessionId);
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
    if (personal)
      await runtimeState(db, sessionId, captured.generation, state, true);
    await event(db, sessionId, "approval.pending", { operationId });
  });
}
let filesTick: Promise<void> | undefined;
let lastMaintenance = 0;
async function tick() {
  if (!alive) return;
  await fence.query("SELECT 1");
  for (const [operation, reason] of terminalRepairs) {
    try {
      await update(operation, "uncertain", { reason });
      terminalRepairs.delete(operation);
    } catch {
      // A failed independent settlement remains pending without starving peers.
    }
  }
  for (const [operation, state] of cancellationRepairs) {
    try {
      await pool.query(
        "UPDATE operations SET state=$2,updated_at=now() WHERE id=$1 AND kind='cancel'",
        [operation, state],
      );
      cancellationRepairs.delete(operation);
    } catch {
      // Cancel bookkeeping cannot prevent the target's uncertainty from persisting.
    }
  }
  if (Date.now() - lastMaintenance > 60000) {
    await maintain(pool);
    await maintainAttachments(pool);
    lastMaintenance = Date.now();
  }
  if (credentials.mutating) return;
  if ((await deploymentState(pool)).activation_required) return;
  if (!c.HARBOR_PERSONAL_VPS_MODE) {
    if (!scheduleTick)
      scheduleTick = processSchedules(pool, boss, c, scheduleFence)
        .catch(() => {
          console.error("Schedule metadata reconciliation remains pending");
        })
        .finally(() => {
          scheduleTick = undefined;
        });
    await processWorkspaceStorage(
      pool,
      !!c.HARBOR_FIXTURE_MODE,
      c.roots,
      async (db, row) => {
        if (!row.actor_hash.startsWith("schedule:")) return;
        const need = {
          scope: "execute" as const,
          projectId: row.project_id,
          internalOperation: { kind: "workspace" as const, id: row.id },
        };
        await requireAuthority(db, row.actor_hash, c, need);
        await scheduleFence(db);
        await requireAuthority(db, row.actor_hash, c, need);
      },
    );
    if (!filesTick)
      filesTick = processFiles(pool, c, () => alive, { generation, ownerPin })
        .catch(() => {
          console.error("File effect settlement remains pending");
        })
        .finally(() => {
          filesTick = undefined;
        });
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
  }
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
          (w.writer_owner_id &&
            (w.writer_kind !== "conversation" || w.writer_owner_id !== id))
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
          if (w.writer_owner_id !== null) throw Error("Reservation changed");
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
      if (r.operation)
        await update(r.operation, "interrupted", { reason: "Emergency stop" });
      await retireSessionRuntime(id, r);
    }
    await transaction(pool, async (db) => {
      const ids = (
        await db.query(
          "SELECT DISTINCT session_id FROM operations WHERE state='queued' ORDER BY session_id",
        )
      ).rows.map((row) => row.session_id);
      await lockSessionResources(db, ids);
      await db.query(
        "UPDATE operations SET state='interrupted' WHERE state='queued' AND session_id=ANY($1::uuid[])",
        [ids],
      );
    });
    return;
  }
  if (personal) {
    // Reconcile disconnected members independently; an uncertain sibling never
    // blocks confirmed capacity belonging to a different conversation.
    const members = (
      await pool.query(
        "SELECT cr.*,s.background_stop_requested,s.archived FROM conversation_runtimes cr JOIN sessions s ON s.id=cr.session_id ORDER BY cr.last_activity_at,cr.session_id",
      )
    ).rows;
    for (const member of members) {
      const runtime = runtimes.get(member.session_id);
      if (!runtime) {
        if (
          (await inspectRecoveredLocalRuntime(
            member.native_identity,
            Number(member.generation),
          )) === "absent"
        )
          await pool.query(
            "DELETE FROM conversation_runtimes WHERE session_id=$1 AND generation=$2",
            [member.session_id, member.generation],
          );
        continue;
      }
      if (runtime.operation || runtime.retiring) continue;
      if (member.background_stop_requested || member.archived) {
        await retireSessionRuntime(member.session_id, runtime);
        continue;
      }
      await classifyRuntime(member.session_id, runtime);
      const current = (
        await pool.query(
          "SELECT state,idle_until FROM conversation_runtimes WHERE session_id=$1 AND generation=$2",
          [member.session_id, runtime.generation],
        )
      ).rows[0];
      if (
        current?.state === "idle" &&
        current.idle_until &&
        new Date(current.idle_until).getTime() <= Date.now()
      )
        await retireSessionRuntime(member.session_id, runtime, true);
    }
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
        await lockSessionResource(db, a.session_id);
        await db.query("UPDATE approvals SET state=$2 WHERE id=$1", [
          a.id,
          expired ? "expired" : "resolved",
        ]);
        if (personal)
          await runtimeState(
            db,
            a.session_id,
            runtime.generation,
            "active",
            true,
          );
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
          await lockSessionResource(db, a.session_id);
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
          await lockSessionResource(db, cancel.session_id);
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
          await lockSessionResource(db, cancel.session_id);
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
  const maintenance = (await deploymentState(pool)).maintenance;
  const candidates = await pool.query(
    "SELECT o.*,s.native_thread_id,s.project_id,s.workspace_id,s.state AS session_state,s.background_stop_requested,s.archived,p.root_id,w.relative_path,w.device,w.inode,w.canonical_path,w.common_path,w.common_device,w.common_inode FROM operations o JOIN sessions s ON s.id=o.session_id JOIN projects p ON p.id=s.project_id JOIN workspaces w ON w.id=s.workspace_id WHERE o.kind='turn' AND o.state='queued' ORDER BY o.created_at,o.id LIMIT $1",
    [c.HARBOR_MAX_QUEUED],
  );
  for (const o of candidates.rows) {
    const blocked = async (reason: Parameters<typeof queueReason>[2]) =>
      transaction(pool, (db) => queueReason(db, o, reason));
    if (maintenance) {
      await blocked("maintenance");
      continue;
    }
    if (
      o.background_stop_requested ||
      runtimes.get(o.session_id)?.retiring ||
      o.session_state === "uncertain" ||
      (
        await pool.query(
          "SELECT 1 FROM operations WHERE session_id=$1 AND state='uncertain' AND uncertainty_acknowledged_at IS NULL LIMIT 1",
          [o.session_id],
        )
      ).rowCount
    ) {
      await blocked("retirement_unknown");
      continue;
    }
    if (
      runtimes.get(o.session_id)?.operation ||
      (
        await pool.query(
          "SELECT 1 FROM operations WHERE session_id=$1 AND kind='turn' AND state IN ('dispatching','running','waiting_approval','waiting_input') LIMIT 1",
          [o.session_id],
        )
      ).rowCount
    ) {
      await blocked("session_busy");
      continue;
    }
    const active = Number(
      (
        await pool.query(
          "SELECT count(*) FROM operations WHERE kind='turn' AND state IN ('dispatching','running','waiting_approval','waiting_input')",
        )
      ).rows[0].count,
    );
    if (active >= c.HARBOR_MAX_ACTIVE_TURNS) {
      await blocked("active_capacity");
      continue;
    }
    try {
      await requireAuthority(pool, o.actor_hash, c, {
        internalOperation: { kind: "turn", id: o.id },
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
    if (personal && !runtimes.has(o.session_id)) {
      let members = (
        await pool.query(
          "SELECT * FROM conversation_runtimes ORDER BY last_activity_at,session_id",
        )
      ).rows;
      if (members.some((member) => member.session_id === o.session_id)) {
        await blocked("retirement_unknown");
        continue;
      }
      for (const member of members) {
        if (members.length < c.HARBOR_MAX_CONVERSATION_RUNTIMES) break;
        const victim = runtimes.get(member.session_id);
        if (member.state === "idle" && victim && !victim.operation)
          await retireSessionRuntime(member.session_id, victim, true);
        members = (
          await pool.query(
            "SELECT * FROM conversation_runtimes ORDER BY last_activity_at,session_id",
          )
        ).rows;
      }
      if (members.length >= c.HARBOR_MAX_CONVERSATION_RUNTIMES) {
        await blocked(capacityReason(members.map((member) => member.state)));
        continue;
      }
    }
    let runtimeCreationAttempted = false;
    try {
      authorizePermission(
        o.payload.permissionProfile,
        c.HARBOR_PERMISSION_CEILING,
      );
      const workspacePath = await verifyWorkspace(o);
      const credentialVersion = await credentials.version();
      let existing = runtimes.get(o.session_id);
      if (
        existing &&
        (existing.permissionProfile !== o.payload.permissionProfile ||
          existing.credentialVersion !== credentialVersion)
      ) {
        if (!(await retireSessionRuntime(o.session_id, existing))) {
          await blocked("retirement_unknown");
          continue;
        }
        existing = undefined;
      }
      const runtimeGeneration =
        existing?.generation ??
        Number(
          (
            await pool.query(
              "SELECT nextval('runtime_generation_seq') AS generation",
            )
          ).rows[0].generation,
        );
      o.generation = runtimeGeneration;
      const admitted = await workspaceAdmission(pool, async (db) => {
        await requireAuthority(db, o.actor_hash, c, {
          internalOperation: { kind: "turn", id: o.id },
          scope: "execute",
          projectId: o.project_id,
          permissionProfile: o.payload.permissionProfile,
        });
        if (
          !(await claimWorkspace(
            db,
            o.workspace_id,
            o.session_id,
            runtimeGeneration,
            personal && !!existing,
            personal,
          ))
        )
          return false;
        await requireAuthority(db, o.actor_hash, c, {
          internalOperation: { kind: "turn", id: o.id },
          scope: "execute",
          projectId: o.project_id,
          permissionProfile: o.payload.permissionProfile,
        });
        await deploymentAdmission(db);
        const lockedSession = (
          await db.query(
            "SELECT generation FROM sessions WHERE id=$1 FOR UPDATE",
            [o.session_id],
          )
        ).rows[0];
        const reusable = () =>
          existing &&
          runtimes.get(o.session_id) === existing &&
          !existing.retiring &&
          !existing.mailbox.poisoned &&
          !existing.operation &&
          Number(lockedSession?.generation) === runtimeGeneration;
        if (existing && !reusable()) throw new WorkspaceAdmissionChanged();
        if (personal) {
          if (!existing)
            await db.query(
              "INSERT INTO conversation_runtimes(session_id,workspace_id,generation,state,permission_profile,credential_version) VALUES($1,$2,$3,'starting',$4,$5)",
              [
                o.session_id,
                o.workspace_id,
                runtimeGeneration,
                o.payload.permissionProfile,
                credentialVersion,
              ],
            );
          else {
            const member = (
              await db.query(
                "SELECT state,native_identity FROM conversation_runtimes WHERE session_id=$1 AND generation=$2 FOR UPDATE",
                [o.session_id, runtimeGeneration],
              )
            ).rows[0];
            if (
              !reusable() ||
              !member?.native_identity ||
              !["idle", "protected"].includes(member.state)
            )
              throw new WorkspaceAdmissionChanged();
            await runtimeState(
              db,
              o.session_id,
              runtimeGeneration,
              "active",
              true,
            );
          }
        }
        await db.query("UPDATE sessions SET generation=$2 WHERE id=$1", [
          o.session_id,
          runtimeGeneration,
        ]);
        await db.query(
          "UPDATE operations SET state='dispatching',queue_reason=NULL,generation=$2 WHERE id=$1 AND state='queued'",
          [o.id, runtimeGeneration],
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
        // Claim before releasing the same fence used by retirement. Completion
        // callbacks must never observe an unclaimed gap after durable admission.
        if (existing) {
          if (!reusable()) throw new WorkspaceAdmissionChanged();
          existing.operation = o.id;
        }
        return true;
      });
      if (!admitted) {
        await blocked("workspace_busy");
        continue;
      }
      const attachments = await prepareAttachments(
        pool,
        o.session_id,
        o.id,
        workspacePath,
        !!c.HARBOR_FIXTURE_MODE,
      );
      let r = existing;
      if (!r) {
        if (!personal)
          await pool.query(
            "UPDATE workspaces SET writer_generation=$2 WHERE id=$1 AND writer_session_id=$3",
            [o.workspace_id, runtimeGeneration, o.session_id],
          );
        let captured: RuntimeState;
        const mailbox = new RuntimeMailbox((reason) => {
          const current = captured && runtimes.get(o.session_id) === captured;
          const operation = current ? captured.operation : undefined;
          if (current) runtimes.delete(o.session_id);
          if (captured) {
            if (!operation && !captured.retiring)
              void retireSessionRuntime(o.session_id, captured).catch(() => {});
            else
              void retireSessionRuntime(o.session_id, captured).catch(() => {});
          }
          // Terminal persistence is independent of normal notification processing.
          if (operation)
            void update(operation, "uncertain", { reason }).catch(() => {
              terminalRepairs.set(operation, reason);
            });
        });
        runtimeCreationAttempted = true;
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
          onOwnedIdentity: personal
            ? async (identity) => {
                const saved = await pool.query(
                  "UPDATE conversation_runtimes SET native_identity=$3 WHERE session_id=$1 AND generation=$2 AND state='starting' RETURNING session_id",
                  [o.session_id, runtimeGeneration, JSON.stringify(identity)],
                );
                if (!saved.rowCount)
                  throw Error("Runtime membership changed before launch");
              }
            : undefined,
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
              captured.retiring ||
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
                  internalOperation: { kind: "turn", id: captured.operation },
                  scope: captured.authorityScope,
                  projectId: o.project_id,
                  permissionProfile:
                    captured.authorityScope === "cancel"
                      ? undefined
                      : captured.permissionProfile,
                });
              }
              await deploymentAdmission(
                fence,
                captured.authorityScope !== "execute",
              );
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
                captured.retiring ||
                runtimes.get(o.session_id) !== captured
              )
                throw Error("Runtime generation invalid");
              // Session/generation locks can themselves wait past expiration.
              // Re-evaluate authority after every lock, immediately before wire send.
              if (captured.authorityActor)
                await requireAuthority(fence, captured.authorityActor, c, {
                  internalOperation: { kind: "turn", id: captured.operation },
                  projectId: o.project_id,
                  scope: captured.authorityScope,
                  permissionProfile:
                    captured.authorityScope === "cancel"
                      ? undefined
                      : captured.permissionProfile,
                });
              await verifyWorkspace(o);
              const result = send();
              await fence.query("COMMIT");
              return result;
            } catch (error) {
              await fence.query("ROLLBACK").catch(() => {});
              throw error;
            }
          },
          onEvent: (m, p) => {
            // Child threads can be noisy; reject them before charging the parent
            // mailbox, while same-thread early events wait for turn activation.
            if (!captured?.thread || p.threadId !== captured.thread) return;
            const operation = captured?.operation;
            const activation = captured?.activation;
            if (operation)
              mailbox.enqueue(
                Buffer.byteLength(JSON.stringify(p)),
                async () => {
                  await activation;
                  await onEvent(o.session_id, operation, m, p, captured);
                },
              );
          },
          onRequest: (request) => {
            const operation = captured?.operation;
            if (!operation || request.params.threadId !== captured.thread) {
              captured?.adapter.rejectRequest(request.id);
              return;
            }
            const activation = captured?.activation;
            if (operation)
              mailbox.enqueue(
                Buffer.byteLength(JSON.stringify(request)),
                async () => {
                  await activation;
                  await onRequest(o.session_id, operation, request, captured);
                },
              );
            else captured?.adapter.rejectRequest(request.id);
          },
          onDisconnect: () =>
            mailbox.poison("Runtime disconnected; delivery uncertain"),
        });
        r = captured!;
        if (mailbox.poisoned) {
          adapter.close();
          throw Error("Runtime failed during initialization");
        }
        const key = c.HARBOR_PERSONAL_VPS_MODE
          ? null
          : await credentials.read();
        if (key) await adapter.loginWithApiKey(key);
        else if (
          !c.HARBOR_FIXTURE_MODE &&
          !(c.HARBOR_LOCAL_MODE || c.HARBOR_PERSONAL_VPS_MODE)
        )
          throw Error("Runtime credentials not configured");
        const models = await adapter.listModels();
        await pool.query(
          "INSERT INTO runtime_capabilities(id,data) VALUES(true,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()",
          [
            JSON.stringify({
              ...models,
              account: await adapter.readAccount().then(({ account }) => ({
                authenticated: !!account,
                authMode: account?.type ?? null,
              })),
            }),
          ],
        );
        const native = o.native_thread_id
          ? await adapter.resumeThread(o.native_thread_id, {
              cwd:
                c.HARBOR_LOCAL_MODE || c.HARBOR_PERSONAL_VPS_MODE
                  ? workspacePath
                  : "/workspace",
              permissionProfile: o.payload.permissionProfile,
            })
          : await adapter.startThread({
              cwd:
                c.HARBOR_LOCAL_MODE || c.HARBOR_PERSONAL_VPS_MODE
                  ? workspacePath
                  : "/workspace",
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
      if (personal)
        await transaction(pool, (db) =>
          runtimeState(db, o.session_id, r!.generation, "active", true),
        );
      r.authorityActor = o.actor_hash;
      r.authorityScope = "execute";
      // Native notifications/requests can precede the turn/start response. Hold
      // persistence until that response supplies the authoritative parent turn ID.
      let activate!: () => void;
      r.activation = new Promise<void>((resolve) => {
        activate = resolve;
      });
      r.turn = "";
      try {
        const turn = await r.adapter.startTurn(r.thread, o.payload.text, {
          ...o.payload,
          attachments: attachments.inputs,
        } as TurnOptions);
        r.turn = turn.turn.id;
      } finally {
        activate();
        r.activation = undefined;
      }
      await pool.query("UPDATE operations SET native_turn_id=$2 WHERE id=$1", [
        o.id,
        r.turn,
      ]);
      await pool.query("UPDATE sessions SET native_turn_id=$2 WHERE id=$1", [
        o.session_id,
        r.turn,
      ]);
      await transaction(pool, async (db) => {
        // Match notification persistence: conversation before its operation.
        // An immediate native request may already be waiting to persist here.
        await lockSessionResource(db, o.session_id);
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
    } catch (error) {
      const failed = runtimes.get(o.session_id);
      const provenUnstarted =
        personal &&
        !failed &&
        (!runtimeCreationAttempted ||
          error instanceof PersonalRuntimeNotStartedError);
      const dispatched =
        (await pool.query("SELECT state FROM operations WHERE id=$1", [o.id]))
          .rows[0]?.state !== "queued";
      await update(
        o.id,
        dispatched && !provenUnstarted ? "uncertain" : "failed",
        {
          reason: provenUnstarted
            ? "Runtime did not start; no native request was dispatched"
            : dispatched
              ? "Dispatch failed or acknowledgement uncertain"
              : "Queued workspace admission failed",
          databaseCode:
            typeof (error as any)?.code === "string" &&
            /^[0-9A-Z]{5}$/.test((error as any).code)
              ? (error as any).code
              : null,
        },
      );
      if (failed) await retireSessionRuntime(o.session_id, failed);
      else if (
        personal &&
        Number.isSafeInteger(Number(o.generation)) &&
        Number(o.generation) > 0
      ) {
        if (provenUnstarted)
          await transaction(pool, async (db) => {
            await lockSessionResource(db, o.session_id);
            const released = await db.query(
              "DELETE FROM conversation_runtimes WHERE session_id=$1 AND generation=$2 AND state='starting' AND native_identity IS NULL RETURNING session_id",
              [o.session_id, Number(o.generation)],
            );
            if (released.rowCount)
              await event(db, o.session_id, "runtime.not-started", {
                generation: Number(o.generation),
              });
          });
        else
          await transaction(pool, (db) =>
            runtimeState(db, o.session_id, Number(o.generation), "unknown"),
          );
      }
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
  await terminals?.stop();
  await previews?.stop();
  clearInterval(timer);
  discoveryTransport?.close();
  for (const [id, r] of runtimes) {
    await retireSessionRuntime(id, r);
  }
  await retireActiveFiles();
  await filesTick;
  await closeCredentials?.();
  await boss.stop();
  await scheduleTick;
  fence.release();
  await pool.end();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void stop());
