import {
  expect,
  type APIResponse,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  chown,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

/** Real Linux Harbor, PostgreSQL and supervisor. Only Codex/OIDC are external fixtures. */
export type ConcurrencyContext = {
  context: BrowserContext;
  page: Page;
  origin: string;
  post: (
    route: string,
    data: unknown,
    headers?: Record<string, string>,
  ) => Promise<APIResponse>;
  projectId: string;
  workspaceId: string;
  projectPath: string;
  artifacts: string;
  databaseUrl: string;
  restartSupervisor: (
    limits?: { active: number; runtimes: number },
    settled?: {
      operationId: string;
      state: "queued" | "failed";
      queueReason?: "maintenance";
    },
  ) => Promise<void>;
  stopSupervisor: () => Promise<void>;
};
type Runtime = {
  state: string;
  generation: number;
  lastActivityAt: string;
  idleUntil: string | null;
};
type Snapshot = {
  session: {
    id: string;
    generation: number;
    runtime: Runtime | null;
  };
  operations: Array<{ id: string; state: string; queueReason: string | null }>;
  messages: Array<{ text: string; role: string }>;
  approvals: Array<{ id: string; generation: number; state: string }>;
};

export async function runConcurrency(h: ConcurrencyContext) {
  const db = new Pool({ connectionString: h.databaseUrl });
  const checks: string[] = [];
  const sessions: Array<{ id: string; title: string }> = [];
  const body = (text: string) => ({
    text,
    model: "fixture",
    effort: "medium",
    permissionProfile: "workspace-write",
  });
  const get = async (route: string) => {
    const response = await h.context.request.get(h.origin + "/api/v1" + route);
    expect(response.status()).toBe(200);
    return response.json();
  };
  const snapshot = (id: string): Promise<Snapshot> =>
    get(`/sessions/${id}/snapshot`);
  const nativeThread = async (id: string): Promise<string | null> =>
    (await db.query("SELECT native_thread_id FROM sessions WHERE id=$1", [id]))
      .rows[0].native_thread_id;
  const operation = async (id: string) =>
    (await get(`/operations/${id}`)).operation;
  const create = async (title: string) => {
    const response = await h.post("/sessions", {
      projectId: h.projectId,
      workspaceId: h.workspaceId,
      title,
      model: "fixture",
      effort: "medium",
      permissionProfile: "workspace-write",
    });
    expect(response.status()).toBe(200);
    const { session } = await response.json();
    sessions.push({ id: session.id, title });
    return session.id as string;
  };
  const send = async (id: string, text: string, key?: string) => {
    const response = await h.post(
      `/sessions/${id}/turns`,
      body(text),
      key ? { "Idempotency-Key": key } : {},
    );
    const reply = await response.json();
    const code = reply.error?.code;
    expect(
      response.status(),
      typeof code === "string" && /^[A-Z_]+$/.test(code)
        ? code
        : "Turn admission",
    ).toBe(202);
    return reply.operation.id as string;
  };
  const state = async (id: string, expected: string) =>
    expect
      .poll(async () => (await operation(id)).state, { timeout: 30_000 })
      .toBe(expected);
  const reason = async (id: string, expected: string) =>
    expect
      .poll(
        async () => {
          const op = await operation(id);
          return [op.state, op.queueReason];
        },
        { timeout: 30_000 },
      )
      .toEqual(["queued", expected]);
  const runtime = async (id: string, expected: string | null) =>
    expect
      .poll(async () => (await snapshot(id)).session.runtime?.state ?? null, {
        timeout: 30_000,
      })
      .toBe(expected);
  const members = async () =>
    (
      await db.query(
        "SELECT session_id,generation,state,last_activity_at,native_identity FROM conversation_runtimes ORDER BY last_activity_at,session_id",
      )
    ).rows;
  const stop = async (id: string) => {
    const held = (await snapshot(id)).session.runtime;
    if (!held) return;
    expect(
      (
        await h.post(`/sessions/${id}/background-stop`, {
          generation: Number(held.generation),
        })
      ).status(),
    ).toBe(200);
    await runtime(id, null);
  };
  const stopAll = async () => {
    for (const row of await members()) await stop(row.session_id);
  };
  const cancel = async (id: string) => {
    expect((await h.post(`/turns/${id}/cancel`, {})).status()).toBe(202);
    await state(id, "interrupted");
  };
  const select = async (id: string) => {
    await h.page.reload();
    await h.page
      .locator(".conversation-link")
      .filter({ hasText: sessions.find((s) => s.id === id)!.title })
      .click();
  };
  const status = async (id: string) => {
    await select(id);
    await h.page.locator(".session-row.selected .session-rename").click();
    await h.page.getByRole("button", { name: "Status", exact: true }).click();
  };
  const closeStatus = () =>
    h.page
      .getByRole("dialog", { name: "Conversation status", exact: true })
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  let injectedUnknown: { session: string; generation: number } | undefined;
  try {
    // P018-01: first submission uses the actual composer; two other same-directory
    // sessions overlap it and write separate canaries under the native fixture UID.
    const a = await create("P018 Alpha"),
      b = await create("P018 Beta"),
      c = await create("P018 Gamma");
    await select(a);
    await h.page
      .getByLabel("Permissions", { exact: true })
      .selectOption("workspace-write");
    await h.page
      .getByLabel("Message Codex")
      .fill("[delay-long] [write-file:p018-a.txt]");
    const accepted = h.page.waitForResponse(
      (response) =>
        response.url().endsWith(`/sessions/${a}/turns`) &&
        response.request().method() === "POST",
    );
    await h.page.getByRole("button", { name: "Send", exact: true }).click();
    const ar = await accepted;
    expect(ar.status()).toBe(202);
    const ao = (await ar.json()).operation.id;
    const [bo, co] = await Promise.all([
      send(b, "[delay-long] [write-file:p018-b.txt]"),
      send(c, "[delay-long] [write-file:p018-c.txt]"),
    ]);
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT count(*)::int AS n FROM operations WHERE id=ANY($1::uuid[]) AND state='running'",
              [[ao, bo, co]],
            )
          ).rows[0].n,
        { timeout: 15_000 },
      )
      .toBe(3);
    const overlap = await members();
    expect(overlap).toHaveLength(3);
    expect(new Set(overlap.map((row) => row.generation)).size).toBe(3);
    const same = await send(a, "serialized second query");
    await reason(same, "session_busy");
    await Promise.all([
      state(ao, "succeeded"),
      state(bo, "succeeded"),
      state(co, "succeeded"),
      state(same, "succeeded"),
    ]);
    const threads = await Promise.all([a, b, c].map(nativeThread));
    expect(threads.every(Boolean)).toBe(true);
    expect(new Set(threads).size).toBe(3);
    for (const name of ["p018-a.txt", "p018-b.txt", "p018-c.txt"]) {
      expect(await readFile(join(h.projectPath, name), "utf8")).toBe(
        `P018 ${name}`,
      );
      expect((await stat(join(h.projectPath, name))).uid).toBe(
        (await stat(h.projectPath)).uid,
      );
    }
    checks.push(
      "P018-01 actual composer/API three-way same-directory writable overlap, distinct native threads and same-session serialization",
    );

    // P018-03: no synthetic activity timestamps; completed execution sets age.
    const d = await create("P018 Delta");
    await state(await send(d, "fourth idle member"), "succeeded");
    for (const id of [a, b, c, d]) await runtime(id, "idle");
    const before = await members();
    expect(before).toHaveLength(4);
    const oldest = before[0].session_id,
      retained = before.at(-1)!.session_id;
    const lastActivity = (await snapshot(oldest)).session.runtime!
      .lastActivityAt;
    for (let i = 0; i < 3; i++) await snapshot(oldest);
    expect((await snapshot(oldest)).session.runtime!.lastActivityAt).toBe(
      lastActivity,
    );
    const oldThread = await nativeThread(oldest);
    const e = await create("P018 Epsilon");
    await state(await send(e, "capacity evicts oldest"), "succeeded");
    await runtime(oldest, null);
    expect(await members()).toHaveLength(4);
    const retainedGeneration = (await snapshot(retained)).session.runtime!
      .generation;
    await state(
      await send(retained, "reuse exact retained runtime"),
      "succeeded",
    );
    expect((await snapshot(retained)).session.runtime!.generation).toBe(
      retainedGeneration,
    );
    await state(await send(oldest, "resume evicted thread"), "succeeded");
    expect(await nativeThread(oldest)).toBe(oldThread);
    expect(
      (
        await h.post(`/sessions/${oldest}/background-stop`, {
          generation: Number(before[0].generation),
        })
      ).status(),
    ).toBe(409);
    expect((await snapshot(oldest)).session.runtime).not.toBeNull();
    expect(
      (await snapshot(oldest)).messages.some(
        (message) =>
          message.role === "assistant" &&
          message.text.includes("Fixture response"),
      ),
    ).toBe(true);
    checks.push(
      "P018-03 oldest meaningful activity eviction before expiry, polling stability, exact generation reuse and history/thread resume",
    );

    // Resource changes and selecting a conversation never change query ordering.
    await h.page.reload();
    await expect(h.page.locator(".rail-dot.resource-held")).toHaveCount(4);
    const ordering = await h.page
      .locator(".conversation-link")
      .allTextContents();
    await status(retained);
    await expect(
      h.page.locator('[aria-label="Conversation runtime"]'),
    ).toContainText(/idle/i);
    await expect(h.page.locator("body")).toContainText(
      "Conversations share this directory and run independently.",
    );
    await closeStatus();
    expect(
      await h.page.locator(".conversation-link").allTextContents(),
    ).toEqual(ordering);
    await h.page.screenshot({
      path: join(h.artifacts, "concurrency-desktop.png"),
      fullPage: true,
    });
    await h.page.setViewportSize({ width: 390, height: 844 });
    if (!(await h.page.locator(".sidebar.is-open").count()))
      await h.page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await expect(h.page.locator(".rail-dot.resource-held")).toHaveCount(4);
    await expect
      .poll(async () => {
        const box = await h.page.locator(".sidebar.is-open").boundingBox();
        const viewport = h.page.viewportSize();
        return (
          !!box &&
          !!viewport &&
          Math.abs(box.x) < 0.5 &&
          Math.abs(box.width - 260) < 0.5 &&
          box.x + box.width <= viewport.width
        );
      })
      .toBe(true);
    expect(
      await h.page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    await h.page.screenshot({
      path: join(h.artifacts, "concurrency-mobile.png"),
      fullPage: true,
    });
    await h.page.setViewportSize({ width: 1280, height: 900 });
    await stopAll();

    // Force completion inspection to pause while a same-session successor is queued.
    // Retirement must own the completed generation until it is actually absent.
    const retiringSession = await create("P018 retirement fence");
    const retiringTurn = await send(retiringSession, "[delay-long]");
    await state(retiringTurn, "running");
    const retiringGeneration = (await snapshot(retiringSession)).session
      .generation;
    const successor = await send(
      retiringSession,
      "after interrupted retirement",
    );
    await reason(successor, "session_busy");
    const gate = await db.connect();
    await db.query(
      "CREATE TABLE test_p018_runtime_gate(session_id uuid PRIMARY KEY)",
    );
    await db.query("INSERT INTO test_p018_runtime_gate VALUES($1)", [
      retiringSession,
    ]);
    await db.query(`CREATE FUNCTION test_p018_inspection_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.process_inspection IS DISTINCT FROM OLD.process_inspection AND EXISTS(SELECT 1 FROM test_p018_runtime_gate WHERE session_id=NEW.id)
      THEN PERFORM pg_advisory_xact_lock(741801); END IF; RETURN NEW; END $$`);
    await db.query(
      "CREATE TRIGGER test_p018_inspection_gate BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION test_p018_inspection_gate()",
    );
    try {
      await gate.query("SELECT pg_advisory_lock(741801)");
      await cancel(retiringTurn);
      await expect
        .poll(
          async () =>
            (
              await db.query(
                "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'",
              )
            ).rows[0].n,
        )
        .toBe(1);
      expect((await operation(successor)).state).toBe("queued");
      // Snapshot takes the session lock held by this deliberate inspection gate.
      // Read committed metadata without that lock until the gate is released.
      expect(
        Number(
          (
            await db.query("SELECT generation FROM sessions WHERE id=$1", [
              retiringSession,
            ])
          ).rows[0].generation,
        ),
      ).toBe(retiringGeneration);
      await gate.query("SELECT pg_advisory_unlock(741801)");
      await state(successor, "succeeded");
      await runtime(retiringSession, "idle");
      expect((await snapshot(retiringSession)).session.generation).not.toBe(
        retiringGeneration,
      );
    } finally {
      await gate.query("SELECT pg_advisory_unlock_all()");
      gate.release();
      await db.query("DROP TRIGGER test_p018_inspection_gate ON sessions");
      await db.query("DROP FUNCTION test_p018_inspection_gate()");
    }
    // Admission wins the same workspace/session fence before a concurrent stop.
    // The accepted turn retains its exact generation and cannot be retired by stop.
    const admissionGeneration = (await snapshot(retiringSession)).session
      .generation;
    await db.query(`CREATE FUNCTION test_p018_admission_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.state='active' AND OLD.state IN ('idle','protected') AND EXISTS(SELECT 1 FROM test_p018_runtime_gate WHERE session_id=NEW.session_id)
      THEN PERFORM pg_advisory_xact_lock(741802); END IF; RETURN NEW; END $$`);
    await db.query(
      "CREATE TRIGGER test_p018_admission_gate BEFORE UPDATE ON conversation_runtimes FOR EACH ROW EXECUTE FUNCTION test_p018_admission_gate()",
    );
    const admissionGate = await db.connect();
    try {
      await admissionGate.query("SELECT pg_advisory_lock(741802)");
      const admittedTurn = await send(
        retiringSession,
        "[delay-long] retained admission",
      );
      let admissionPid = 0;
      await expect
        .poll(async () => {
          const row = (
            await db.query(
              "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'",
            )
          ).rows[0];
          admissionPid = row?.pid ?? 0;
          return admissionPid > 0;
        })
        .toBe(true);
      const concurrentStop = h.post(
        `/sessions/${retiringSession}/background-stop`,
        { generation: admissionGeneration },
      );
      await expect
        .poll(
          async () =>
            (
              await db.query(
                "SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))",
                [admissionPid],
              )
            ).rows[0].n,
        )
        .toBeGreaterThan(0);
      await admissionGate.query("SELECT pg_advisory_unlock(741802)");
      expect((await concurrentStop).status()).toBe(409);
      await state(admittedTurn, "succeeded");
      await runtime(retiringSession, "idle");
      expect((await snapshot(retiringSession)).session.generation).toBe(
        admissionGeneration,
      );
    } finally {
      await admissionGate.query("SELECT pg_advisory_unlock_all()");
      admissionGate.release();
      await db.query(
        "DROP TRIGGER test_p018_admission_gate ON conversation_runtimes",
      );
      await db.query("DROP FUNCTION test_p018_admission_gate()");
      await db.query("DROP TABLE test_p018_runtime_gate");
    }
    await stop(retiringSession);
    checks.push(
      "Same-session completion retirement and retained admission serialize at real database barriers",
    );

    // P018-02/04: approval and input waits consume all four active slots.
    const waiting = [a, b, c, d];
    const waits = await Promise.all(
      waiting.map((id, i) => send(id, i === 1 ? "[input]" : "[approval]")),
    );
    for (let i = 0; i < waits.length; i++)
      await state(waits[i], i === 1 ? "waiting_input" : "waiting_approval");
    const queuedKey = `${Date.now()}:${randomUUID()}`;
    const queued = await send(e, "cancel while capacity full", queuedKey);
    expect(await send(e, "cancel while capacity full", queuedKey)).toBe(queued);
    await reason(queued, "active_capacity");
    expect(await members()).toHaveLength(4);
    await select(e);
    await expect(
      h.page
        .getByRole("status")
        .filter({ hasText: "Waiting for an active-turn slot." }),
    ).toBeVisible();
    await h.page.reload();
    await reason(queued, "active_capacity");
    await cancel(queued);
    for (const id of waiting) {
      const approval = (await snapshot(id)).approvals.find(
        (entry) => entry.state === "pending",
      )!;
      expect(approval).toBeTruthy();
      expect(
        (
          await h.post(`/approvals/${approval.id}/answer`, {
            generation: Number(approval.generation),
            decision: "decline",
          })
        ).status(),
      ).toBe(202);
    }
    await Promise.all(
      waits.map((id, index) =>
        state(id, index === 1 ? "interrupted" : "succeeded"),
      ),
    );
    checks.push(
      "P018-02/04 default active/live four-slot limits, approval/input protection, durable queue/reconnect, idempotent acceptance and queued cancellation",
    );
    await stopAll();

    // P018-05: fixture boundary launches actual OS children, so the production
    // native inspector, not fixture flags, establishes protected classification.
    for (const id of waiting) {
      await state(await send(id, "[background]"), "succeeded");
      await runtime(id, "protected");
    }
    const protectedBefore = await members();
    expect(protectedBefore.every((row) => row.state === "protected")).toBe(
      true,
    );
    const blocked = await send(e, "new head blocked by protected capacity");
    await reason(blocked, "protected_capacity");
    const reused = await send(a, "eligible reuse behind blocked head");
    await state(reused, "succeeded");
    await reason(blocked, "protected_capacity");
    expect((await snapshot(a)).session.runtime!.generation).toBe(
      Number(protectedBefore.find((row) => row.session_id === a)!.generation),
    );
    await status(a);
    await expect(
      h.page.locator('[aria-label="Conversation runtime"]'),
    ).toContainText(/background|protected/i);
    await h.page
      .getByRole("button", { name: "Stop processes", exact: true })
      .click();
    await runtime(a, null);
    await closeStatus();
    await state(blocked, "succeeded");
    for (const id of [b, c, d]) {
      await runtime(id, "protected");
      expect((await snapshot(id)).session.runtime!.generation).toBe(
        Number(
          protectedBefore.find((row) => row.session_id === id)!.generation,
        ),
      );
    }
    checks.push(
      "P018-04/05 blocked-head fairness with protected-runtime reuse; actual child classification; targeted stop preserves all siblings",
    );
    // Archive is an explicit retirement cause for the selected idle session.
    expect((await h.post(`/sessions/${b}/archive`, {})).status()).toBe(200);
    await runtime(b, null);
    await runtime(c, "protected");
    checks.push(
      "P018-07 archive retires the selected protected member and preserves sibling",
    );
    await stopAll();

    // A nondefault configuration travels through the real supervisor startup.
    await h.restartSupervisor({ active: 1, runtimes: 2 });
    const slow = await send(c, "[delay-long]");
    await state(slow, "running");
    const constrained = await send(d, "lower active budget");
    await reason(constrained, "active_capacity");
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM operations WHERE state IN ('dispatching','running','waiting_approval','waiting_input') AND kind='turn'",
        )
      ).rows[0].n,
    ).toBe(1);
    await state(slow, "succeeded");
    await state(constrained, "succeeded");
    expect(await members()).toHaveLength(2);
    checks.push(
      "P018-02 administrator nondefault active=1/runtime=2 propagation and independent counts after restart",
    );
    await stopAll();

    // Pause dispatch, then revoke the queued actor. Restoring this test identity
    // afterward does not retroactively authorize or replay the failed operation.
    await h.stopSupervisor();
    const revoked = await send(c, "authority revoked while queued");
    const actor = (
      await db.query("SELECT actor_hash FROM operations WHERE id=$1", [revoked])
    ).rows[0].actor_hash;
    await db.query("UPDATE browser_sessions SET revoked=true WHERE hash=$1", [
      actor,
    ]);
    try {
      await h.restartSupervisor();
      await expect
        .poll(
          async () =>
            (
              await db.query("SELECT state FROM operations WHERE id=$1", [
                revoked,
              ])
            ).rows[0].state,
          { timeout: 30_000 },
        )
        .toBe("failed");
    } finally {
      await db.query(
        "UPDATE browser_sessions SET revoked=false WHERE hash=$1",
        [actor],
      );
    }
    expect(
      (await snapshot(c)).messages.some(
        (message) =>
          message.role === "assistant" &&
          message.text.includes("authority revoked while queued"),
      ),
    ).toBe(false);
    checks.push(
      "P018-07 queued authorization revalidation prevents revoked actor dispatch",
    );

    await h.stopSupervisor();
    const maintenance = await send(c, "maintenance waiting");
    await db.query(
      "UPDATE deployment_state SET maintenance=true WHERE id=true",
    );
    try {
      await h.restartSupervisor(undefined, {
        operationId: maintenance,
        state: "queued",
        queueReason: "maintenance",
      });
      await reason(maintenance, "maintenance");
      expect(await members()).toHaveLength(0);
    } finally {
      await db.query(
        "UPDATE deployment_state SET maintenance=false WHERE id=true",
      );
    }
    await state(maintenance, "succeeded");
    await stopAll();
    checks.push(
      "P018-07 maintenance preserves queued work and prevents runtime admission",
    );

    await h.stopSupervisor();
    const replaced = await send(c, "workspace identity replaced while queued");
    const saved = h.projectPath + ".p018-original",
      originalInfo = await stat(h.projectPath);
    await rename(h.projectPath, saved);
    await mkdir(h.projectPath, { mode: 0o700 });
    await chown(h.projectPath, originalInfo.uid, originalInfo.gid);
    try {
      await h.restartSupervisor(undefined, {
        operationId: replaced,
        state: "failed",
      });
      await state(replaced, "failed");
      expect(await members()).toHaveLength(0);
    } finally {
      await h.stopSupervisor();
      await rm(h.projectPath, { recursive: true });
      await rename(saved, h.projectPath);
      await h.restartSupervisor();
    }
    checks.push("P018-07 canonical directory identity revalidated after wait");

    // P018-06: controlled durable recovery fault only. No live PID is fabricated
    // or signaled: foreign-host identity explicitly means ownership is unknown.
    await h.stopSupervisor();
    const unknown = await create("P018 Unknown");
    const generation = Number(
      (await db.query("SELECT nextval('runtime_generation_seq') generation"))
        .rows[0].generation,
    );
    await db.query("UPDATE sessions SET generation=$2 WHERE id=$1", [
      unknown,
      generation,
    ]);
    await db.query(
      "INSERT INTO conversation_runtimes(session_id,workspace_id,generation,state,native_identity,permission_profile,credential_version) VALUES($1,$2,$3,'retiring',$4,'workspace-write','p018-controlled-fault')",
      [
        unknown,
        h.workspaceId,
        generation,
        JSON.stringify({ groupId: 2, host: "p018-unavailable-test-host" }),
      ],
    );
    injectedUnknown = { session: unknown, generation };
    await h.restartSupervisor({ active: 1, runtimes: 2 });
    await runtime(unknown, "unknown");
    await state(
      await send(c, "[background] known sibling beside unknown"),
      "succeeded",
    );
    await runtime(c, "protected");
    const unknownBlocked = await send(
      d,
      "uncertain capacity cannot invent slot",
    );
    await reason(unknownBlocked, "retirement_unknown");
    expect(await members()).toHaveLength(2);
    await status(unknown);
    await expect(
      h.page.locator('[aria-label="Conversation runtime"]'),
    ).toContainText(/unknown/i);
    await h.page.screenshot({
      path: join(h.artifacts, "concurrency-unknown.png"),
      fullPage: true,
    });
    await closeStatus();
    await cancel(unknownBlocked);
    await stop(c);
    await state(
      await send(d, "confirmed free slot beside unknown"),
      "succeeded",
    );
    await runtime(unknown, "unknown");
    await stop(d);
    checks.push(
      "P018-06 restart retains unknown retirement capacity, blocks replacement at limit, and allows unrelated confirmed free slot",
    );
    checks.push(
      "P018-08 desktop/mobile multiple resource indicators, query ordering, queue/protected/unknown/status and targeted stop UI",
    );
    await writeFile(
      join(h.artifacts, "concurrency-result.json"),
      JSON.stringify(
        {
          passed: true,
          checks,
          limits: [
            "External Codex/OIDC deterministic; native process sandbox and live account acceptance require separate mandatory gates",
            "Unknown recovery uses an explicit durable-state fault; actual missing-process inspection is covered by native contracts",
            "This lane does not prove lowering a running process's immutable configuration without restart",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "P018 real-stack concurrency acceptance passed: " +
        checks.length +
        " grouped checks",
    );
  } finally {
    await db
      .query("UPDATE deployment_state SET maintenance=false WHERE id=true")
      .catch(() => undefined);
    if (injectedUnknown) {
      await h.stopSupervisor();
      await db.query(
        "DELETE FROM conversation_runtimes WHERE session_id=$1 AND generation=$2 AND native_identity->>'host'='p018-unavailable-test-host'",
        [injectedUnknown.session, injectedUnknown.generation],
      );
    }
    await db.end();
  }
}
