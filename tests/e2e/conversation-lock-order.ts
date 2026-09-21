import {
  expect,
  type APIResponse,
  type BrowserContext,
} from "@playwright/test";
import type { Pool, PoolClient } from "pg";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { acknowledgementPool } from "./acknowledgement-db.ts";

type WaitNode = {
  pid: number;
  application: string;
  lockWait: boolean;
  parentQuery: boolean;
  blockers: number[];
};

/** PostgreSQL may report a tuple-queue predecessor rather than the transaction
 * holding the parent. Require a bounded observed chain to the exact test gate. */
export function parentWaitChains(
  nodes: WaitNode[],
  gatePid: number,
  application: string,
) {
  const graph = new Map(nodes.map((node) => [node.pid, node]));
  const chains: { pid: number; chain: number[] }[] = [];
  for (const node of nodes) {
    if (node.application !== application || !node.lockWait || !node.parentQuery)
      continue;
    const queue = [[node.pid]];
    const visited = new Set([node.pid]);
    for (let index = 0; index < queue.length && index < 128; index++) {
      const chain = queue[index];
      const current = chain.at(-1)!;
      if (current === gatePid) {
        chains.push({ pid: node.pid, chain });
        break;
      }
      if (chain.length >= 32) continue;
      for (const blocker of graph.get(current)?.blockers ?? []) {
        if (visited.has(blocker)) continue;
        visited.add(blocker);
        queue.push([...chain, blocker]);
      }
    }
  }
  return chains;
}

export async function observeParentWaitGraph(
  db: Pool,
  gatePid: number,
  application: string,
) {
  const rows = (
    await db.query(
      "SELECT pid,CASE WHEN application_name IN ('harbor-e2e-api','harbor-e2e-supervisor') THEN application_name ELSE 'other' END AS application,wait_event_type='Lock' AS lock_wait,query=$1 AS parent_query,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() ORDER BY pid LIMIT 129",
      [
        "SELECT id FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      ],
    )
  ).rows;
  if (rows.length > 128)
    throw Error("Fixture wait graph exceeds diagnostic bound");
  const nodes: WaitNode[] = rows.map((row) => ({
    pid: Number(row.pid),
    application: row.application,
    lockWait: row.lock_wait === true,
    parentQuery: row.parent_query === true,
    blockers: row.blockers.map(Number),
  }));
  return { nodes, chains: parentWaitChains(nodes, gatePid, application) };
}

/** Real API pruning and supervisor notification persistence must wait at the
 * parent without holding the conversation needed by an admitted parent owner. */
export async function conversationLockOrder(h: {
  db: Pool;
  command(route: string, body: unknown): Promise<APIResponse>;
  context: BrowserContext;
  origin: string;
  artifacts: string;
  fixtureState: string;
  newSession(): Promise<string>;
  pauseSupervisor(): void;
  resumeSupervisor(): void;
}) {
  const db = acknowledgementPool(h.db.options.connectionString!);
  const cases: {
    name: string;
    sessionId: string;
    parentPid: number;
    waitingPids: number[];
    sessionAvailable: boolean | null;
    waitGraph: Awaited<ReturnType<typeof observeParentWaitGraph>>;
  }[] = [];
  let gate: PoolClient | undefined;
  let paused = false;
  let pendingSnapshot: Promise<APIResponse | undefined> | undefined;
  let snapshotError = false;
  async function holdParent(sessionId: string) {
    gate = await db.connect();
    await gate.query("BEGIN");
    const binding = (
      await gate.query("SELECT project_id FROM sessions WHERE id=$1", [
        sessionId,
      ])
    ).rows[0];
    await gate.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
      binding.project_id,
    ]);
    return Number(
      (await gate.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    );
  }
  async function releaseParent() {
    if (!gate) return;
    const owned = gate;
    gate = undefined;
    try {
      await owned.query("ROLLBACK");
    } finally {
      owned.release(true);
    }
  }
  async function observeParentWait(
    name: string,
    sessionId: string,
    parentPid: number,
    minimum = 1,
    applicationName = "harbor-e2e-api",
  ) {
    const recorded: (typeof cases)[number] = {
      name,
      sessionId,
      parentPid,
      waitingPids: [],
      sessionAvailable: null,
      waitGraph: { nodes: [], chains: [] },
    };
    cases.push(recorded);
    await expect
      .poll(
        async () => {
          recorded.waitGraph = await observeParentWaitGraph(
            db,
            parentPid,
            applicationName,
          );
          recorded.waitingPids = recorded.waitGraph.chains.map(
            (entry) => entry.pid,
          );
          return recorded.waitingPids.length;
        },
        { timeout: 10000 },
      )
      .toBeGreaterThanOrEqual(minimum);
    const probe = await db.connect();
    let sessionAvailable = false;
    try {
      await probe.query("BEGIN");
      await probe.query(
        "SELECT id FROM sessions WHERE id=$1 FOR UPDATE NOWAIT",
        [sessionId],
      );
      sessionAvailable = true;
    } catch {
      // Do not expose driver details; the assertion records the failed invariant.
    } finally {
      await probe.query("ROLLBACK").catch(() => undefined);
      probe.release(true);
    }
    recorded.sessionAvailable = sessionAvailable;
    expect(
      sessionAvailable,
      name + " must not lock the session before its parent",
    ).toBe(true);
  }
  try {
    const snapshotSession = await h.newSession();
    const snapshotParent = await holdParent(snapshotSession);
    pendingSnapshot = h.context.request
      .get(h.origin + `/api/v1/sessions/${snapshotSession}/snapshot`)
      .catch(() => {
        snapshotError = true;
        return undefined;
      });
    await observeParentWait(
      "API snapshot replay pruning",
      snapshotSession,
      snapshotParent,
    );
    await releaseParent();
    const snapshot = await pendingSnapshot;
    expect(snapshotError).toBe(false);
    expect(snapshot?.status()).toBe(200);
    expect((await snapshot!.json()).session.id).toBe(snapshotSession);

    const sessionId = await h.newSession();
    const accepted = await h.command(`/sessions/${sessionId}/turns`, {
      model: "fixture",
      effort: "medium",
      permissionProfile: "read-only",
      text: "[approval]",
    });
    expect(accepted.status()).toBe(202);
    const operationId = (await accepted.json()).operation.id;
    let approval: any;
    await expect
      .poll(
        async () => {
          approval = (
            await db.query(
              "SELECT id,generation FROM approvals WHERE operation_id=$1 AND state='pending'",
              [operationId],
            )
          ).rows[0];
          return !!approval;
        },
        { timeout: 30000 },
      )
      .toBe(true);
    h.pauseSupervisor();
    paused = true;
    const answered = await h.command(`/approvals/${approval.id}/answer`, {
      generation: Number(approval.generation),
      decision: "accept",
    });
    expect(answered.status()).toBe(202);
    const native = (
      await db.query(
        "SELECT native_thread_id,native_turn_id FROM sessions WHERE id=$1",
        [sessionId],
      )
    ).rows[0];
    const notificationParent = await holdParent(sessionId);
    h.resumeSupervisor();
    paused = false;
    // The external fixture persists completion before emitting turn/completed.
    // This is a protocol barrier, not a sleep or a fabricated Harbor event.
    await expect
      .poll(
        async () => {
          const threads = JSON.parse(
            await readFile(
              path.join(h.fixtureState, sessionId + ".json"),
              "utf8",
            ),
          );
          return threads
            .find(
              ([id]: [string, unknown]) => id === native.native_thread_id,
            )?.[1]
            .turns.find((turn: any) => turn.id === native.native_turn_id)
            ?.status;
        },
        { timeout: 10000 },
      )
      .toBe("completed");
    await observeParentWait(
      "Supervisor approval settlement and native output",
      sessionId,
      notificationParent,
      2,
      "harbor-e2e-supervisor",
    );
    await releaseParent();
    await expect
      .poll(
        async () =>
          (
            await db.query("SELECT state FROM operations WHERE id=$1", [
              operationId,
            ])
          ).rows[0].state,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    await expect
      .poll(
        async () =>
          (
            await db.query("SELECT state FROM approvals WHERE id=$1", [
              approval.id,
            ])
          ).rows[0].state,
        { timeout: 10000 },
      )
      .toBe("resolved");
    expect(
      (
        await db.query(
          "SELECT text FROM messages WHERE operation_id=$1 AND role='assistant' AND status='complete'",
          [operationId],
        )
      ).rows
        .map((row) => row.text)
        .join(""),
    ).toContain("Approved input received.");
    expect(
      (
        await db.query(
          "SELECT count(*) FROM events WHERE session_id=$1 AND type='operation.uncertain'",
          [sessionId],
        )
      ).rows[0].count,
    ).toBe("0");
    expect(
      Number(
        (
          await db.query(
            "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()",
          )
        ).rows[0].deadlocks,
      ),
    ).toBe(0);
  } finally {
    if (paused) h.resumeSupervisor();
    await releaseParent();
    await pendingSnapshot;
    await db.end();
    await writeFile(
      path.join(h.artifacts, "conversation-lock-order.json"),
      JSON.stringify({ cases }, null, 2),
    );
  }
}
