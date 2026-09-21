import { lockSessionResource } from "../../packages/storage/src/session-lock.ts";
import { saveConversationOutput } from "../../apps/supervisor/src/conversation-output.ts";
import { digest } from "../../packages/policy/src/index.ts";
import {
  expect,
  type Page,
  type BrowserContext,
  type APIResponse,
} from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { event, transaction } from "../../packages/storage/src/index.ts";
import { capacity } from "../../packages/storage/src/capacity.ts";
import { maintain } from "../../packages/storage/src/maintenance.ts";
interface Context {
  page: Page;
  context: BrowserContext;
  origin: string;
  db: Pool;
  artifacts: string;
  fixtureState: string;
  trace: string;
  command(route: string, body: unknown, key?: string): Promise<APIResponse>;
  newSession(): Promise<string>;
  snapshot(id: string): Promise<any>;
  restartApi(): Promise<void>;
  pauseSupervisor(): void;
  resumeSupervisor(): void;
  restartSupervisor(): Promise<void>;
  databaseOutage(): Promise<void>;
  assertResponse(
    route: string,
    method: string,
    status: number,
    data: unknown,
  ): void;
}
export async function p007(h: Context) {
  const { page, context, origin, db, command, newSession, snapshot } = h;
  const payload = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
    text: "P007 separate authorized new work",
  };
  const history = async (q: string) =>
    (await context.request.get(origin + "/api/v1/history?" + q)).json();
  let id = await newSession();
  await command(`/sessions/${id}/turns`, {
    ...payload,
    text: "P007 existing native history before metadata",
  });
  await expect
    .poll(async () => (await snapshot(id)).session.state, { timeout: 30000 })
    .toBe("succeeded");
  const originalNative = await readFile(
    path.join(h.fixtureState, id + ".json"),
    "utf8",
  );
  const registeredProject = (
    await db.query("SELECT canonical_path,root_id FROM projects WHERE id=$1", [
      (await snapshot(id)).session.projectId,
    ])
  ).rows[0];
  const sourceFile = path.join(
    registeredProject.canonical_path,
    "p007-preserved-" + id + ".txt",
  );
  await writeFile(
    sourceFile,
    "Run-owned source file preserved across metadata changes",
  );
  await page.goto(origin + "/?conversation=" + id);
  await page.locator(".session-row.selected .session-rename").click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByLabel("Conversation title", { exact: true })
    .fill("P007 searchable ledger");
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect
    .poll(async () => (await snapshot(id)).session.title)
    .toBe("P007 searchable ledger");
  const revision = (await snapshot(id)).session.metadataRevision;
  expect(
    (
      await command(`/sessions/${id}/metadata`, {
        expectedRevision: revision - 1,
        title: "stale overwrite",
      })
    ).status(),
  ).toBe(409);
  const renameKey = `${Date.now()}:${randomUUID()}`;
  const renameBody = {
    expectedRevision: revision,
    title: "P007 searchable ledger",
  };
  expect(
    (await command(`/sessions/${id}/metadata`, renameBody, renameKey)).status(),
  ).toBe(200);
  await h.restartApi();
  expect(
    (await command(`/sessions/${id}/metadata`, renameBody, renameKey)).status(),
  ).toBe(200);
  const page1 = await history("state=all&limit=1");
  h.assertResponse("/history", "get", 200, page1);
  expect(page1.sessions).toHaveLength(1);
  expect(page1.nextCursor).toBeTruthy();
  const page2 = await history(
    "state=all&limit=1&cursor=" + encodeURIComponent(page1.nextCursor),
  );
  expect(page2.sessions[0].id).not.toBe(page1.sessions[0].id);
  expect(
    (
      await context.request.get(
        origin +
          "/api/v1/history?state=all&q=changed&cursor=" +
          encodeURIComponent(page1.nextCursor),
      )
    ).status(),
  ).toBe(400);
  expect(
    (await history("q=P007%20searchable")).sessions.some(
      (s: any) => s.id === id,
    ),
  ).toBe(true);
  await page.reload();
  await page.locator(".session-row.selected .session-rename").click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect
    .poll(async () => (await snapshot(id)).session.archived)
    .toBe(true);
  expect((await history("q=P007%20searchable")).sessions).toHaveLength(0);
  expect(
    (await history("state=archived&q=P007%20searchable")).sessions[0].id,
  ).toBe(id);
  await page
    .getByRole("button", { name: "Search and filters", exact: true })
    .click();
  await page.locator(".history-filters select").selectOption("archived");
  await page
    .getByRole("dialog", { name: "Search and filters", exact: true })
    .locator(".session-row.selected .session-rename")
    .click();
  await page.getByRole("button", { name: "Unarchive", exact: true }).click();
  await expect
    .poll(async () => (await snapshot(id)).session.archived)
    .toBe(false);
  await page.locator(".history-filters select").selectOption("active");
  await page.keyboard.press("Escape");
  expect(await readFile(path.join(h.fixtureState, id + ".json"), "utf8")).toBe(
    originalNative,
  );
  expect(await readFile(sourceFile, "utf8")).toBe(
    "Run-owned source file preserved across metadata changes",
  );
  // P007 archival stays visibility-only while P003 owns actual writer retirement.
  const archiveActive = await newSession();
  await command(`/sessions/${archiveActive}/turns`, {
    ...payload,
    text: "[delay] archive while running",
  });
  await expect
    .poll(async () => (await snapshot(archiveActive)).session.state, {
      timeout: 30000,
    })
    .toBe("running");
  expect(
    (await command(`/sessions/${archiveActive}/archive`, {})).status(),
  ).toBe(200);
  await expect
    .poll(async () => (await snapshot(archiveActive)).session.state, {
      timeout: 30000,
    })
    .toBe("succeeded");
  const archivedActive = (await snapshot(archiveActive)).session;
  expect(archivedActive.archived).toBe(true);
  expect(
    (
      await command(`/sessions/${archiveActive}/metadata`, {
        expectedRevision: archivedActive.metadataRevision,
        archived: false,
      })
    ).status(),
  ).toBe(200);
  const microIds = [];
  for (let i = 0; i < 4; i++) {
    const micro = await newSession();
    microIds.push(micro);
    await db.query(
      "UPDATE sessions SET title='P007 microsecond page',created_at='2026-01-01T00:00:00.123456Z' WHERE id=$1",
      [micro],
    );
  }
  const seen: string[] = [];
  let microCursor: string | null = null;
  do {
    const result = await history(
      "q=P007%20microsecond%20page&limit=1" +
        (microCursor ? "&cursor=" + encodeURIComponent(microCursor) : ""),
    );
    seen.push(...result.sessions.map((r: any) => r.id));
    microCursor = result.nextCursor;
  } while (microCursor);
  expect(seen.sort()).toEqual(microIds.sort());
  id = await newSession();
  await page.goto(origin + "/?conversation=" + id);
  // Actual runtime crash; external fixture's native file is the only substituted boundary.
  const op = (
    await (
      await command(`/sessions/${id}/turns`, { ...payload, text: "[crash]" })
    ).json()
  ).operation;
  await expect
    .poll(async () => (await snapshot(id)).session.state, { timeout: 30000 })
    .toBe("uncertain");
  const before = await snapshot(id),
    nativePath = path.join(h.fixtureState, id + ".json");
  const native = JSON.parse(await readFile(nativePath, "utf8"));
  const recoveredId = randomUUID();
  native[0][1].turns[0].items.push({
    id: recoveredId,
    type: "agentMessage",
    text: "Native durable result recovered after transport loss",
  });
  native[0][1].turns[0].status = "completed";
  await writeFile(nativePath, JSON.stringify(native));
  const traceBefore = (await readFile(h.trace, "utf8"))
    .split("\n")
    .filter(Boolean).length;
  const recoveryKey = `${Date.now()}:${randomUUID()}`,
    request = { expectedGeneration: before.session.generation };
  const alternativeKey = `${Date.now()}:${randomUUID()}`;
  const races = await Promise.all([
    command(`/sessions/${id}/recovery`, request, recoveryKey),
    command(`/sessions/${id}/recovery`, request, alternativeKey),
  ]);
  expect(races.map((r) => r.status()).sort()).toEqual([202, 409]);
  const winner = races.findIndex((response) => response.status() === 202);
  const first = (await races[winner]!.json()).recovery;
  h.assertResponse("/sessions/{id}/recovery", "post", 202, { recovery: first });
  const recovery = async () =>
    (
      await context.request.get(origin + `/api/v1/sessions/${id}/recovery`)
    ).json();
  await expect
    .poll(async () => (await recovery()).recovery.state, { timeout: 30000 })
    .toBe("ready");
  const ready = await recovery();
  h.assertResponse("/sessions/{id}/recovery", "get", 200, ready);
  expect(ready.recovery.report.repairedItems).toBe(1);
  expect(
    (await snapshot(id)).messages.some(
      (m: any) =>
        m.text === "Native durable result recovered after transport loss",
    ),
  ).toBe(true);
  expect(
    (await readFile(h.trace, "utf8")).split("\n").filter(Boolean),
  ).toHaveLength(traceBefore);
  expect(
    (await snapshot(id)).operations.find((o: any) => o.id === op.id).state,
  ).toBe("uncertain");
  await h.restartApi();
  expect(
    (
      await (
        await command(
          `/sessions/${id}/recovery`,
          request,
          winner === 0 ? recoveryKey : alternativeKey,
        )
      ).json()
    ).recovery.id,
  ).toBe(first.id);
  expect(
    (
      await command(`/sessions/${id}/recovery/continue`, {
        ...payload,
        recoveryId: first.id,
        expectedGeneration: ready.recovery.generation,
        acknowledgeUnknownEffects: false,
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await command(`/sessions/${id}/recovery/continue`, {
        ...payload,
        recoveryId: first.id,
        expectedGeneration: ready.recovery.generation - 1,
        acknowledgeUnknownEffects: true,
      })
    ).status(),
  ).toBe(409);
  // A cookie that expires while continuation waits cannot acknowledge old effects.
  const expiring = await context
      .browser()!
      .newContext({ ignoreHTTPSErrors: true }),
    expiringPage = await expiring.newPage(),
    sessionHold = await db.connect();
  let deniedContinuation: Promise<any> | undefined;
  try {
    await expiringPage.goto(origin + "/auth/login");
    await expiringPage
      .getByRole("button", { name: "Sign in as owner", exact: true })
      .click();
    const csrf = (
        await (await expiring.request.get(origin + "/api/v1/me")).json()
      ).csrfToken,
      hash = digest(
        (await expiring.cookies()).find((c) => c.name === "__Host-harbor")!
          .value,
      );
    await db.query(
      "UPDATE browser_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE hash=$1",
      [hash],
    );
    await sessionHold.query("BEGIN");
    await sessionHold.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    deniedContinuation = expiring.request.post(
      origin + `/api/v1/sessions/${id}/recovery/continue`,
      {
        headers: {
          Origin: origin,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
        },
        data: {
          ...payload,
          recoveryId: first.id,
          expectedGeneration: ready.recovery.generation,
          acknowledgeUnknownEffects: true,
        },
      },
    );
    await expect
      .poll(async () =>
        Number(
          (
            await db.query(
              "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query='SELECT * FROM sessions WHERE id=$1 FOR UPDATE'",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT expires_at<=clock_timestamp() AS expired FROM browser_sessions WHERE hash=$1",
              [hash],
            )
          ).rows[0].expired,
        { timeout: 5000 },
      )
      .toBe(true);
    await sessionHold.query("ROLLBACK");
    expect((await deniedContinuation).status()).toBe(401);
    expect(
      (
        await db.query(
          "SELECT uncertainty_acknowledged_at FROM operations WHERE id=$1",
          [op.id],
        )
      ).rows[0].uncertainty_acknowledged_at,
    ).toBeNull();
    expect((await recovery()).recovery.state).toBe("ready");
    expect(
      (await snapshot(id)).operations.filter((o: any) => o.kind === "turn"),
    ).toHaveLength(1);
  } finally {
    await sessionHold.query("ROLLBACK");
    sessionHold.release();
    await deniedContinuation;
    await expiring.close();
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Start new operation after recovery" }),
  ).toBeDisabled();
  await page.getByLabel("New instructions after recovery").fill(payload.text);
  await page
    .getByLabel(
      "I understand that unknown effects may remain and authorize a separate new operation.",
    )
    .check();
  await expect(
    page.locator(".session-row.selected .session-rename"),
  ).toHaveCount(1);
  await page
    .getByRole("heading", { name: "The outcome is uncertain" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(h.artifacts, "p007-recovery-ready.png"),
    fullPage: true,
  });
  // Drop the accepted response in the browser, then use its same-intent retry after restart.
  let dropped = false;
  await page.route("**/api/v1/sessions/*/recovery/continue", async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Start new operation after recovery" })
    .click();
  await expect
    .poll(async () => (await recovery()).recovery.state)
    .toBe("consumed");
  await h.restartApi();
  const retry = page.getByRole("button", {
    name: /Retry.*Start acknowledged new operation|Retry same request/,
  });
  // The exact retry button label is owned by the common uncertain-intent component.
  const retryButton = page
    .getByRole("button")
    .filter({ hasText: /Retry/ })
    .first();
  await expect(retryButton).toBeVisible();
  await retryButton.click();
  await expect
    .poll(async () => (await snapshot(id)).session.state, { timeout: 30000 })
    .toBe("succeeded");
  const after = await snapshot(id);
  expect(after.operations.filter((o: any) => o.kind === "turn")).toHaveLength(
    2,
  );
  expect(after.operations.find((o: any) => o.id === op.id).state).toBe(
    "uncertain",
  );
  expect(
    (
      await command(`/sessions/${id}/recovery/continue`, {
        ...payload,
        recoveryId: first.id,
        expectedGeneration: ready.recovery.generation,
        acknowledgeUnknownEffects: true,
      })
    ).status(),
  ).toBe(409);
  // A later incomplete native read cannot overwrite already-confirmed content.
  await command(`/sessions/${id}/turns`, { ...payload, text: "[crash]" });
  await expect
    .poll(async () => (await snapshot(id)).session.state, { timeout: 30000 })
    .toBe("uncertain");
  const confirmed = (await snapshot(id)).messages.filter(
    (m: any) => m.role === "assistant" && m.status === "complete",
  );
  const changed = JSON.parse(await readFile(nativePath, "utf8"));
  const oldItem = changed[0][1].turns
    .flatMap((t: any) => t.items)
    .find((i: any) => i.type === "agentMessage");
  oldItem.text = "conflicting incomplete native content";
  await writeFile(nativePath, JSON.stringify(changed));
  await page.reload();
  await page
    .getByRole("button", {
      name: "Fence old runtime and inspect history",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await recovery()).recovery.state, { timeout: 30000 })
    .toBe("ready");
  expect((await recovery()).recovery.report.conflicts).toBeGreaterThan(0);
  for (const item of confirmed)
    expect(
      (await snapshot(id)).messages.find((m: any) => m.id === item.id).text,
    ).toBe(item.text);
  // Database rejects final readiness: each explicit retry reuses one bounded record.
  const failed = await newSession();
  await command(`/sessions/${failed}/turns`, { ...payload, text: "[crash]" });
  await expect
    .poll(async () => (await snapshot(failed)).session.state, {
      timeout: 30000,
    })
    .toBe("uncertain");
  await db.query(
    `CREATE SEQUENCE p007_settlement_observed; CREATE FUNCTION p007_reject_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.session_id='${failed}'::uuid AND NEW.state IN ('ready','failed') THEN PERFORM nextval('p007_settlement_observed'); RAISE EXCEPTION 'test readiness commit rejection'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER p007_reject_ready AFTER UPDATE ON session_recoveries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p007_reject_ready()`,
  );
  try {
    let currentGeneration = (await snapshot(failed)).session.generation;
    let body: any = { expectedGeneration: currentGeneration },
      rid = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt === 2) {
        await db.query(
          `ALTER SEQUENCE p007_settlement_observed RESTART WITH 1; CREATE OR REPLACE FUNCTION p007_reject_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.session_id='${failed}'::uuid AND NEW.state IN ('ready','failed') THEN PERFORM nextval('p007_settlement_observed'); RAISE EXCEPTION 'test readiness commit rejection'; END IF; RETURN NEW; END $$`,
        );
      }
      const key = `${Date.now()}:${randomUUID()}`;
      const answer = await command(`/sessions/${failed}/recovery`, body, key);
      expect(answer.status()).toBe(202);
      const received = (await answer.json()).recovery;
      rid ||= received.id;
      expect(received.id).toBe(rid);
      if (attempt <= 2) {
        await expect
          .poll(
            async () =>
              Number(
                (
                  await db.query(
                    "SELECT last_value FROM p007_settlement_observed",
                  )
                ).rows[0].last_value,
              ),
            { timeout: 30000 },
          )
          .toBeGreaterThanOrEqual(2);
        expect(
          (
            await db.query("SELECT state FROM session_recoveries WHERE id=$1", [
              rid,
            ])
          ).rows[0].state,
        ).toBe("fencing");
        if (attempt === 2) h.pauseSupervisor();
        await db.query(
          `CREATE OR REPLACE FUNCTION p007_reject_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.session_id='${failed}'::uuid AND NEW.state='ready' THEN RAISE EXCEPTION 'test readiness commit rejection'; END IF; RETURN NEW; END $$`,
        );
        if (attempt === 2) await h.restartSupervisor();
      }
      await expect
        .poll(
          async () =>
            (
              await (
                await context.request.get(
                  origin + `/api/v1/sessions/${failed}/recovery`,
                )
              ).json()
            ).recovery.state,
          { timeout: 30000 },
        )
        .toBe("failed");
      expect(
        (
          await (
            await command(`/sessions/${failed}/recovery`, body, key)
          ).json()
        ).recovery.attempt,
      ).toBe(attempt);
      expect(
        (
          await command(`/sessions/${failed}/recovery`, {
            expectedGeneration: currentGeneration,
          })
        ).status(),
      ).toBe(409);
      currentGeneration = (await snapshot(failed)).session.generation;
      expect(
        (await snapshot(failed)).operations.filter(
          (o: any) => o.kind === "turn",
        ),
      ).toHaveLength(1);
      body = {
        expectedGeneration: currentGeneration,
        recoveryId: rid,
        expectedAttempt: attempt,
      };
    }
    expect((await command(`/sessions/${failed}/recovery`, body)).status()).toBe(
      400,
    );
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM session_recoveries WHERE session_id=$1",
            [failed],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM recovery_audits WHERE recovery_id=$1",
            [rid],
          )
        ).rows[0].count,
      ),
    ).toBe(3);
    expect((await snapshot(failed)).session.state).toBe("uncertain");
  } finally {
    await db.query(
      "DROP TRIGGER p007_reject_ready ON session_recoveries; DROP FUNCTION p007_reject_ready(); DROP SEQUENCE p007_settlement_observed",
    );
  }
  const expiredRecovery = await newSession();
  await command(`/sessions/${expiredRecovery}/turns`, {
    ...payload,
    text: "[crash]",
  });
  await expect
    .poll(async () => (await snapshot(expiredRecovery)).session.state, {
      timeout: 30000,
    })
    .toBe("uncertain");
  const short = await context
      .browser()!
      .newContext({ ignoreHTTPSErrors: true }),
    shortPage = await short.newPage(),
    recoveryHold = await db.connect();
  let paused = false;
  try {
    await shortPage.goto(origin + "/auth/login");
    await shortPage
      .getByRole("button", { name: "Sign in as owner", exact: true })
      .click();
    const csrf = (await (await short.request.get(origin + "/api/v1/me")).json())
        .csrfToken,
      hash = digest(
        (await short.cookies()).find((c) => c.name === "__Host-harbor")!.value,
      );
    h.pauseSupervisor();
    paused = true;
    const accepted = await short.request.post(
      origin + `/api/v1/sessions/${expiredRecovery}/recovery`,
      {
        headers: {
          Origin: origin,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
        },
        data: {
          expectedGeneration: (await snapshot(expiredRecovery)).session
            .generation,
        },
      },
    );
    expect(accepted.status()).toBe(202);
    const record = (await accepted.json()).recovery;
    await db.query(
      "UPDATE browser_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE hash=$1",
      [hash],
    );
    await recoveryHold.query("BEGIN");
    await recoveryHold.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
      expiredRecovery,
    ]);
    h.resumeSupervisor();
    paused = false;
    await expect
      .poll(
        async () =>
          Number(
            (
              await db.query(
                "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM sessions%FOR UPDATE OF s'",
              )
            ).rows[0].count,
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "SELECT expires_at<=clock_timestamp() AS expired FROM browser_sessions WHERE hash=$1",
              [hash],
            )
          ).rows[0].expired,
        { timeout: 5000 },
      )
      .toBe(true);
    await recoveryHold.query("ROLLBACK");
    await expect
      .poll(
        async () =>
          (
            await db.query("SELECT state FROM session_recoveries WHERE id=$1", [
              record.id,
            ])
          ).rows[0].state,
        { timeout: 10000 },
      )
      .toBe("failed");
    expect(
      (
        await db.query(
          "SELECT fence_generation FROM session_recoveries WHERE id=$1",
          [record.id],
        )
      ).rows[0].fence_generation,
    ).toBeNull();
  } finally {
    if (paused) h.resumeSupervisor();
    await recoveryHold.query("ROLLBACK");
    recoveryHold.release();
    await short.close();
  }
  // Exact replay bounds are independent of uncertain durable state and delayed janitors.
  const replaySession = await newSession();
  await transaction(db, async (tx) => {
    await lockSessionResource(tx, replaySession);
    for (let i = 0; i < 2001; i++)
      await event(tx, replaySession, "test.replay", { i });
  });
  expect(
    Number(
      (
        await db.query("SELECT count(*) FROM events WHERE session_id=$1", [
          replaySession,
        ])
      ).rows[0].count,
    ),
  ).toBe(2000);
  await db.query(
    "UPDATE events SET created_at=now()-interval '8 days' WHERE session_id=$1",
    [replaySession],
  );
  await db.query("UPDATE sessions SET state='uncertain' WHERE id=$1", [
    replaySession,
  ]);
  const resync = await context.request.get(
    origin + `/api/v1/sessions/${replaySession}/events?cursor=0`,
  );
  expect(await resync.text()).toContain("event: resync");
  expect(
    Number(
      (
        await db.query("SELECT count(*) FROM events WHERE session_id=$1", [
          replaySession,
        ])
      ).rows[0].count,
    ),
  ).toBe(0);
  const snap = await snapshot(replaySession);
  const connectReplay = async (cursor: number) =>
    page.evaluate(
      ({ id, cursor }) =>
        new Promise<void>((resolve, reject) => {
          const source = new EventSource(
            `/api/v1/sessions/${id}/events?cursor=${cursor}`,
          );
          (window as any).p007Stream = { source, events: [], resync: 0 };
          const timeout = setTimeout(() => {
            source.close();
            reject(Error("Test stream timed out"));
          }, 10000);
          source.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
          source.onerror = () => {
            clearTimeout(timeout);
            reject(Error("Test stream unavailable"));
          };
          source.onmessage = (e) =>
            (window as any).p007Stream.events.push(JSON.parse(e.data));
          source.addEventListener("resync", () => {
            (window as any).p007Stream.resync++;
            source.close();
          });
        }),
      { id: replaySession, cursor },
    );
  await transaction(db, async (tx) => {
    await lockSessionResource(tx, replaySession);
    await event(tx, replaySession, "test.before-subscribe", {});
  });
  await connectReplay(snap.cursor);
  await transaction(db, async (tx) => {
    await lockSessionResource(tx, replaySession);
    await event(tx, replaySession, "test.after-gap", {});
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).p007Stream.events.length))
    .toBe(2);
  expect(
    await page.evaluate(() =>
      (window as any).p007Stream.events.map((e: any) => [e.sequence, e.type]),
    ),
  ).toEqual([
    [snap.cursor + 1, "test.before-subscribe"],
    [snap.cursor + 2, "test.after-gap"],
  ]);
  await transaction(db, async (tx) => {
    await lockSessionResource(tx, replaySession);
    for (let i = 0; i < 2001; i++)
      await event(tx, replaySession, "test.live-gap", { i });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).p007Stream.resync))
    .toBe(1);
  const recoveredSnapshot = await snapshot(replaySession);
  await connectReplay(recoveredSnapshot.cursor);
  await transaction(db, async (tx) => {
    await lockSessionResource(tx, replaySession);
    await event(tx, replaySession, "test.resumed", {});
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).p007Stream.events.length))
    .toBe(1);
  expect(
    await page.evaluate(() => (window as any).p007Stream.events[0].sequence),
  ).toBe(recoveredSnapshot.cursor + 1);
  await page.evaluate(() => (window as any).p007Stream.source.close());
  await maintain(db);
  // Real supervisor restart with outstanding approval: no old answer is resurrected or replayed.
  const approvalSession = await newSession();
  await command(`/sessions/${approvalSession}/turns`, {
    ...payload,
    text: "[approval]",
  });
  await expect
    .poll(async () => (await snapshot(approvalSession)).approvals.length, {
      timeout: 30000,
    })
    .toBe(1);
  const approval = (await snapshot(approvalSession)).approvals[0];
  await h.restartSupervisor();
  await expect
    .poll(async () => (await snapshot(approvalSession)).session.state, {
      timeout: 30000,
    })
    .toBe("uncertain");
  expect(
    (
      await command(`/approvals/${approval.id}/answer`, {
        generation: approval.generation,
        decision: "accept",
      })
    ).status(),
  ).toBe(409);
  // Restart changes the session fence but retains the original writer epoch.
  // P007 must release that exact P003 reservation, then permit a fresh turn.
  const restarted = (await snapshot(approvalSession)).session;
  const oldWriter = (
    await db.query(
      "SELECT writer_session_id,writer_generation FROM workspaces WHERE id=$1",
      [restarted.workspaceId],
    )
  ).rows[0];
  expect(oldWriter.writer_session_id).toBe(approvalSession);
  const recoveryAfterRestart = await command(
    `/sessions/${approvalSession}/recovery`,
    { expectedGeneration: restarted.generation },
  );
  expect(recoveryAfterRestart.status()).toBe(202);
  const recoveryId = (await recoveryAfterRestart.json()).recovery.id;
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM session_recoveries WHERE id=$1", [
            recoveryId,
          ])
        ).rows[0].state,
      { timeout: 30000 },
    )
    .toBe("ready");
  expect(
    (
      await db.query("SELECT writer_session_id FROM workspaces WHERE id=$1", [
        restarted.workspaceId,
      ])
    ).rows[0].writer_session_id,
  ).toBeNull();
  const fencedSession = (await snapshot(approvalSession)).session;
  expect(
    (
      await command(`/sessions/${approvalSession}/recovery/continue`, {
        ...payload,
        recoveryId,
        expectedGeneration: fencedSession.generation,
        acknowledgeUnknownEffects: true,
      })
    ).status(),
  ).toBe(202);
  await expect
    .poll(async () => (await snapshot(approvalSession)).session.state, {
      timeout: 30000,
    })
    .toBe("succeeded");
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT writer_session_id FROM workspaces WHERE id=$1",
            [restarted.workspaceId],
          )
        ).rows[0].writer_session_id,
      { timeout: 30000 },
    )
    .toBeNull();
  expect(
    (await snapshot(approvalSession)).operations.filter(
      (o: any) => o.state === "uncertain",
    ),
  ).toHaveLength(1);
  // Keep a distinct unresolved effect for the later actor-wide reserve test.
  expect(
    (
      await command(`/sessions/${approvalSession}/turns`, {
        ...payload,
        text: "[crash] reserved recovery",
      })
    ).status(),
  ).toBe(202);
  await expect
    .poll(async () => (await snapshot(approvalSession)).session.state, {
      timeout: 30000,
    })
    .toBe("uncertain");
  // Apply the actual additive migration over a legacy full conversation.
  const legacySchema = "p007_" + randomUUID().replaceAll("-", "");
  const legacy = await db.connect();
  try {
    await legacy.query(
      `CREATE SCHEMA ${legacySchema}; SET search_path TO ${legacySchema}`,
    );
    for (const file of [
      "001_initial.sql",
      "002_runtime_credentials.sql",
      "003_process_inspection.sql",
      "004_owner_binding.sql",
    ]) {
      await legacy.query(
        await readFile(
          new URL(
            "../../packages/storage/src/migrations/" + file,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    }
    const project = (await db.query("SELECT * FROM projects LIMIT 1")).rows[0],
      workspace = (
        await db.query("SELECT * FROM workspaces WHERE project_id=$1 LIMIT 1", [
          project.id,
        ])
      ).rows[0];
    await legacy.query(
      "INSERT INTO projects(id,name,root_id,relative_path,created_at,device,inode,canonical_path) SELECT id,name,root_id,relative_path,created_at,device,inode,canonical_path FROM public.projects WHERE id=$1",
      [project.id],
    );
    await legacy.query(
      "INSERT INTO workspaces(id,project_id) SELECT id,project_id FROM public.workspaces WHERE id=$1",
      [workspace.id],
    );
    const legacySession = randomUUID();
    await legacy.query(
      "INSERT INTO sessions(id,project_id,workspace_id,title,state,model,effort,permission_profile) VALUES($1,$2,$3,'Legacy full history','uncertain','fixture','medium','read-only')",
      [legacySession, project.id, workspace.id],
    );
    await legacy.query(
      "INSERT INTO operations(id,session_id,kind,state,payload,actor_hash) SELECT gen_random_uuid(),$1,'turn','uncertain','{}','legacy-test' FROM generate_series(1,500)",
      [legacySession],
    );
    await legacy.query(
      await readFile(
        new URL(
          "../../packages/storage/src/migrations/007_session_history.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(
      Number(
        (
          await legacy.query(
            "SELECT history_ceiling FROM sessions WHERE id=$1",
            [legacySession],
          )
        ).rows[0].history_ceiling,
      ),
    ).toBe(501);
    await legacy.query("BEGIN");
    await capacity(legacy, legacySession, "recovery");
    await legacy.query("ROLLBACK");
    expect(
      Number(
        (
          await legacy.query(
            "SELECT count(*) FROM operations WHERE session_id=$1",
            [legacySession],
          )
        ).rows[0].count,
      ),
    ).toBe(500);
  } finally {
    await legacy.query("ROLLBACK");
    await legacy.query("SET search_path TO public");
    await legacy.query(`DROP SCHEMA ${legacySchema} CASCADE`);
    legacy.release();
  }
  // Saturated ordinary history cannot spend an admitted target's control reserve.
  const capacitySession = await newSession();
  await db.query(
    "INSERT INTO operations(id,session_id,kind,state,payload,actor_hash) SELECT gen_random_uuid(),$1,'turn','succeeded','{}','fixture-history' FROM generate_series(1,399)",
    [capacitySession],
  );
  const held = (
    await (
      await command(`/sessions/${capacitySession}/turns`, {
        ...payload,
        text: "[approval]",
      })
    ).json()
  ).operation;
  await expect
    .poll(async () => (await snapshot(capacitySession)).session.state, {
      timeout: 30000,
    })
    .toBe("waiting_approval");
  expect(
    (await command(`/sessions/${capacitySession}/turns`, payload)).status(),
  ).toBe(429);
  const count = Number(
    (
      await db.query(
        "SELECT count(*) FROM intents WHERE actor='owner' AND control_target IS NULL",
      )
    ).rows[0].count,
  );
  await db.query(
    "INSERT INTO intents(actor,route,key,request_hash,result) SELECT 'owner','/test/p007-quota',$1||':'||gen_random_uuid()::text,'fixture','{}' FROM generate_series(1,$2::int)",
    [String(Date.now()), 10000 - count],
  );
  let quotaFailure = false;
  try {
    const details = (await snapshot(capacitySession)).session;
    expect(
      (
        await command(`/sessions/${capacitySession}/metadata`, {
          expectedRevision: details.metadataRevision,
          title: "quota denied",
        })
      ).status(),
    ).toBe(429);
    const folder = "quota-no-allocation-" + randomUUID();
    expect(
      (
        await command("/projects", {
          name: "Quota rejected allocation",
          rootId: registeredProject.root_id,
          path: folder,
          create: true,
        })
      ).status(),
    ).toBe(429);
    expect(
      await stat(
        path.join(path.dirname(registeredProject.canonical_path), folder),
      ).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    const credentialBefore = await (
      await context.request.get(origin + "/api/v1/security/runtime-credentials")
    ).json();
    expect(
      (
        await command("/security/runtime-credentials", {
          apiKey: "p007-quota-test-" + randomUUID(),
        })
      ).status(),
    ).toBe(429);
    expect(
      (
        await (
          await context.request.get(
            origin + "/api/v1/security/runtime-credentials",
          )
        ).json()
      ).credentialId,
    ).toBe(credentialBefore.credentialId);
    const cancelKey = `${Date.now()}:${randomUUID()}`;
    const cancel = await command(`/turns/${held.id}/cancel`, {}, cancelKey);
    expect(cancel.status()).toBe(202);
    expect(
      (await command(`/turns/${held.id}/cancel`, {}, cancelKey)).status(),
    ).toBe(202);
    await expect
      .poll(
        async () =>
          (await snapshot(capacitySession)).operations.find(
            (o: any) => o.id === held.id,
          ).state,
        { timeout: 30000 },
      )
      .toBe("interrupted");
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM operations WHERE session_id=$1",
            [capacitySession],
          )
        ).rows[0].count,
      ),
    ).toBe(401);
    // The previous real crash has an independent recovery reserve at the same actor-wide limit.
    const approvalState = await snapshot(approvalSession);
    const fenceKey = `${Date.now()}:${randomUUID()}`;
    const reserved = await command(
      `/sessions/${approvalSession}/recovery`,
      { expectedGeneration: approvalState.session.generation },
      fenceKey,
    );
    expect(reserved.status()).toBe(202);
    await expect
      .poll(
        async () =>
          (
            await (
              await context.request.get(
                origin + `/api/v1/sessions/${approvalSession}/recovery`,
              )
            ).json()
          ).recovery.state,
        { timeout: 30000 },
      )
      .toBe("ready");
    const removeKey = `${Date.now()}:${randomUUID()}`;
    expect(
      (
        await command("/security/runtime-credentials/remove", {}, removeKey)
      ).status(),
    ).toBe(200);
    expect(
      (
        await command("/security/runtime-credentials/remove", {}, removeKey)
      ).status(),
    ).toBe(200);
    const removalCounts = (
      await db.query(
        "SELECT (SELECT count(*) FROM intents) AS intents,(SELECT count(*) FROM audits) AS audits",
      )
    ).rows[0];
    // A removal invalidates discovery. Already-absent removal still performs
    // native cleanup, so its explicit pre-effect busy fence may reject while
    // discovery/recovery retires. Keep one key per logical call; only that
    // documented rejection may wait, and no alias/audit may be added by it.
    const removalAttempts: {
      index: number;
      attempt: number;
      status: number;
      code: string | null;
      elapsedMs: number;
    }[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const key = `${Date.now()}:${randomUUID()}`;
        const started = Date.now();
        for (let attempt = 0; ; attempt++) {
          const response = await command(
            "/security/runtime-credentials/remove",
            {},
            key,
          );
          const body = await response.json().catch(() => ({}));
          const code =
            typeof body?.error?.code === "string" &&
            /^[A-Z0-9_]{1,80}$/.test(body.error.code)
              ? body.error.code
              : null;
          removalAttempts.push({
            index: i,
            attempt,
            status: response.status(),
            code,
            elapsedMs: Date.now() - started,
          });
          if (response.status() === 200) {
            expect(body.configured).toBe(false);
            break;
          }
          const busy =
            response.status() === 409 && code === "CREDENTIAL_IN_USE";
          if (!busy || Date.now() - started >= 15000 || attempt >= 30) {
            await writeFile(
              path.join(h.artifacts, "p007-removal-failure.json"),
              JSON.stringify({
                index: i,
                status: response.status(),
                code: code ?? "UNAVAILABLE",
              }) + "\n",
            );
            expect(
              response.status(),
              "Empty credential removal must settle; only bounded pre-effect busy rejection may wait",
            ).toBe(200);
          }
          expect(
            (
              await db.query(
                "SELECT (SELECT count(*) FROM intents) AS intents,(SELECT count(*) FROM audits) AS audits",
              )
            ).rows[0],
          ).toEqual(removalCounts);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } finally {
      await writeFile(
        path.join(h.artifacts, "p007-empty-removal-retries.json"),
        JSON.stringify(
          {
            deadlineMs: 15000,
            sameKeyPerLogicalCall: true,
            attempts: removalAttempts,
          },
          null,
          2,
        ),
      );
    }
    expect(
      (
        await db.query(
          "SELECT (SELECT count(*) FROM intents) AS intents,(SELECT count(*) FROM audits) AS audits",
        )
      ).rows[0],
    ).toEqual(removalCounts);
  } catch (error) {
    quotaFailure = true;
    const e = error as any;
    const primitive = (value: unknown) =>
      typeof value === "number" || typeof value === "boolean"
        ? value
        : typeof value;
    await writeFile(
      path.join(h.artifacts, "p007-quota-failure.json"),
      JSON.stringify(
        {
          matcher: e.matcherResult?.name ?? "unknown",
          expected: primitive(e.matcherResult?.expected),
          actual: primitive(e.matcherResult?.actual),
          location: String(e.stack)
            .split("\n")
            .filter((line) => /at .*tests\/e2e\/p007\.ts:\d+/.test(line))
            .slice(0, 2),
        },
        null,
        2,
      ),
    ).catch(() => {});
    throw error;
  } finally {
    try {
      await db.query("DELETE FROM intents WHERE route='/test/p007-quota'");
      const restored = await command("/security/runtime-credentials", {
        apiKey: "p007-restored-fixture-" + randomUUID(),
      });
      const result = await restored.json();
      const code =
        typeof result.error?.code === "string" &&
        /^[A-Z_]{1,64}$/.test(result.error.code)
          ? result.error.code
          : null;
      const active = (
        await db.query(
          "SELECT state,count(*) AS n FROM operations WHERE state IN ('queued','dispatching','running','waiting_approval','waiting_input') GROUP BY state ORDER BY state",
        )
      ).rows;
      const recoveries = (
        await db.query(
          "SELECT state,count(*) AS n FROM session_recoveries GROUP BY state ORDER BY state",
        )
      ).rows;
      const evidence = {
        status: restored.status(),
        code,
        active,
        recoveries,
        originalFailure: quotaFailure,
      };
      await writeFile(
        path.join(h.artifacts, "p007-credential-cleanup.json"),
        JSON.stringify(evidence, null, 2),
      );
      // Preserve a prior assertion instead of replacing it with cleanup's result.
      if (!quotaFailure)
        expect(restored.status(), JSON.stringify(evidence)).toBe(200);
    } catch (error) {
      if (!quotaFailure) throw error;
      await writeFile(
        path.join(h.artifacts, "p007-cleanup-exception.json"),
        JSON.stringify({ category: "CLEANUP_FAILED_AFTER_ORIGINAL_ASSERTION" }),
      ).catch(() => {});
    }
  }
  // A connection can disappear while a transaction callback is between queries.
  // Use the real shared pool and an exact owned backend, without adding a test
  // error listener that would conceal an unhandled Client event.
  const disconnected = await db.connect();
  try {
    const backend = (await disconnected.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    expect(
      (await db.query("SELECT pg_terminate_backend($1) AS stopped", [backend]))
        .rows[0].stopped,
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(disconnected.query("SELECT 1")).rejects.toThrow();
  } finally {
    disconnected.release(true);
  }
  expect((await db.query("SELECT 1 AS healthy")).rows[0].healthy).toBe(1);
  const outage = await newSession();
  await command(`/sessions/${outage}/turns`, { ...payload, text: "[delay]" });
  await expect
    .poll(async () => (await snapshot(outage)).session.state, {
      timeout: 30000,
    })
    .toBe("running");
  await h.databaseOutage();
  await expect
    .poll(async () => (await snapshot(outage)).session.state, {
      timeout: 30000,
    })
    .toBe("uncertain");
  expect((await command(`/sessions/${outage}/turns`, payload)).status()).toBe(
    409,
  );
  await page.goto(origin + "/?conversation=" + id);

  const activeHistory = page
    .getByRole("dialog", { name: "Search and filters", exact: true })
    .getByRole("region", { name: "Conversation history" });
  await page
    .getByRole("button", { name: "Search and filters", exact: true })
    .click();
  await page
    .getByLabel("Search conversations", { exact: true })
    .fill("P007 searchable ledger");
  await expect(
    activeHistory
      .locator(".conversation-link")
      .filter({ hasText: "P007 searchable ledger" }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(h.artifacts, "p007-history-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(
    activeHistory
      .locator(".conversation-link")
      .filter({ hasText: "P007 searchable ledger" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: path.join(h.artifacts, "p007-history-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  // Personal workbench: names, authoritative final text and command diagnostics
  // survive refresh and preserve an explicit owner title even when it is blank-like.
  const named = await newSession();
  await command(`/sessions/${named}/turns`, { ...payload, text: "你好！" });
  await expect
    .poll(async () => (await snapshot(named)).session.state, { timeout: 30000 })
    .toBe("succeeded");
  expect((await snapshot(named)).session.title).toBe("New conversation");
  await page.goto(origin + "/?conversation=" + named);
  const taskText = "Repair the build [partial-final] [command-result]";
  await page.getByLabel("Message Codex", { exact: true }).fill(taskText);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(async () => (await snapshot(named)).session.state, { timeout: 30000 })
    .toBe("succeeded");
  await expect(page.locator(".header-title h1")).toHaveText(taskText);
  await expect(
    page.locator(".message-assistant .message-text").last(),
  ).toHaveText("Fixture response: " + taskText);
  await page.locator(".conversation-activity summary").click();
  await expect(page.locator(".conversation-activity pre")).toContainText(
    "Tests passed",
  );
  await expect(page.locator(".conversation-activity pre")).toContainText(
    "exit code: 0",
  );
  await page.reload();
  await expect(page.locator(".header-title h1")).toHaveText(taskText);
  await expect(
    page.locator(".session-row.selected .conversation-link"),
  ).toContainText(taskText);
  let namedSnapshot = await snapshot(named);
  expect(
    (
      await command(`/sessions/${named}/metadata`, {
        expectedRevision: namedSnapshot.session.metadataRevision,
        title: "New conversation",
      })
    ).status(),
  ).toBe(200);
  await command(`/sessions/${named}/turns`, {
    ...payload,
    text: "Second task [completion-only]",
  });
  await expect
    .poll(async () => (await snapshot(named)).session.state, { timeout: 30000 })
    .toBe("succeeded");
  namedSnapshot = await snapshot(named);
  expect(namedSnapshot.session.title).toBe("New conversation");
  expect(
    namedSnapshot.messages.filter((m: any) => m.role === "assistant").at(-1)
      .text,
  ).toBe("Fixture response: Second task [completion-only]");
  // Child events interleave before the parent acknowledgement/final completion.
  // They must neither contaminate history nor prematurely finish its operation.
  const parentSession = await newSession();
  await command(`/sessions/${parentSession}/turns`, {
    ...payload,
    text: "Parent task [child-thread]",
  });
  await expect
    .poll(
      async () =>
        (await snapshot(parentSession)).messages.some(
          (m: any) => m.text === "Parent waiting after child",
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  const waitingParent = await snapshot(parentSession);
  expect(waitingParent.session.state).toBe("running");
  expect(
    waitingParent.messages.some((m: any) =>
      m.text.includes("CHILD MUST NOT APPEAR"),
    ),
  ).toBe(false);
  expect(waitingParent.approvals).toHaveLength(0);
  await expect
    .poll(async () => (await snapshot(parentSession)).session.state, {
      timeout: 30000,
    })
    .toBe("succeeded");
  const parentDone = await snapshot(parentSession);
  expect(
    parentDone.messages.some(
      (m: any) => m.text === "Child approval rejected safely",
    ),
  ).toBe(true);
  expect(
    parentDone.messages.some(
      (m: any) => m.text === "Fixture response: Parent task [child-thread]",
    ),
  ).toBe(true);
  expect(
    parentDone.messages.some(
      (m: any) =>
        m.text.includes("CHILD MUST NOT APPEAR") ||
        m.text.includes("UNSAFE CHILD APPROVAL"),
    ),
  ).toBe(false);
  expect(parentDone.approvals).toHaveLength(0);

  // Real PostgreSQL boundary: optional diagnostics cannot exhaust final-text
  // quota, and replayed command starts cannot reopen completed records.
  const outputBoundary = await newSession();
  const boundaryOperation = randomUUID();
  await db.query(
    "INSERT INTO operations(id,session_id,kind,state,payload,actor_hash) VALUES($1,$2,'turn','succeeded','{}','fixture')",
    [boundaryOperation, outputBoundary],
  );
  const commandItem = {
    id: randomUUID(),
    type: "commandExecution",
    command: "true",
    cwd: "/workspace",
    aggregatedOutput: "ok",
    status: "completed",
    exitCode: 0,
  };
  await transaction(db, async (client) => {
    await lockSessionResource(client, outputBoundary);
    await saveConversationOutput(
      client,
      outputBoundary,
      boundaryOperation,
      "item/completed",
      { item: commandItem },
    );
    await saveConversationOutput(
      client,
      outputBoundary,
      boundaryOperation,
      "item/started",
      {
        item: { ...commandItem, status: "inProgress", aggregatedOutput: null },
      },
    );
  });
  expect(
    (
      await db.query(
        "SELECT status FROM messages WHERE session_id=$1 AND native_item_id=$2",
        [outputBoundary, commandItem.id],
      )
    ).rows[0].status,
  ).toBe("complete");
  const usedBytes = Number(
    (
      await db.query(
        "SELECT sum(octet_length(text)) AS bytes FROM messages WHERE session_id=$1",
        [outputBoundary],
      )
    ).rows[0].bytes,
  );
  let remainingBytes = 2097152 - usedBytes - 50;
  while (remainingBytes > 0) {
    const size = Math.min(262144, remainingBytes);
    await db.query(
      "INSERT INTO messages(id,session_id,role,text,status) VALUES($1,$2,'assistant',$3,'complete')",
      [randomUUID(), outputBoundary, "x".repeat(size)],
    );
    remainingBytes -= size;
  }
  await transaction(db, async (client) => {
    await lockSessionResource(client, outputBoundary);
    await saveConversationOutput(
      client,
      outputBoundary,
      boundaryOperation,
      "item/completed",
      {
        item: {
          ...commandItem,
          id: randomUUID(),
          aggregatedOutput: "z".repeat(200),
        },
      },
    );
  });
  expect(
    Number(
      (
        await db.query(
          "SELECT sum(octet_length(text)) AS bytes FROM messages WHERE session_id=$1",
          [outputBoundary],
        )
      ).rows[0].bytes,
    ),
  ).toBe(2097152 - 50);
}
