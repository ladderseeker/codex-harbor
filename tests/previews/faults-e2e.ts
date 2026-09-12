import { expect, type BrowserContext } from "@playwright/test";
import type { Pool } from "pg";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Actual admission/COMMIT faults and supervisor process loss, with no replay. */
export async function previewFaults(h: {
  db: Pool;
  context: BrowserContext;
  origin: string;
  csrf: string;
  previewId: string;
  supervisor: ChildProcess;
  restartSupervisor: () => ChildProcess;
  artifacts: string;
}) {
  const row = async () =>
    (await h.db.query("SELECT * FROM previews WHERE id=$1", [h.previewId]))
      .rows[0];
  const command = async (
    suffix: string,
    data: unknown,
    status = 202,
    key = `${Date.now()}:${randomUUID()}`,
  ) => {
    const r = await h.context.request.post(
      h.origin + "/api/v1/previews/" + h.previewId + suffix,
      {
        headers: {
          Origin: h.origin,
          "X-CSRF-Token": h.csrf,
          "Idempotency-Key": key,
        },
        data,
      },
    );
    expect(r.status()).toBe(status);
    return r.json();
  };
  const start = async () => {
    const before = await row();
    await command("/start", { expectedRevision: before.revision });
    await expect
      .poll(async () => (await row()).state, { timeout: 30000 })
      .toBe("ready");
    return row();
  };
  const waitRetired = async () => {
    await expect
      .poll(async () => (await row()).retired, { timeout: 20000 })
      .toBe(true);
    expect(
      (
        await h.db.query(
          "SELECT count(*)::int n FROM preview_readers WHERE owner_id=$1",
          [h.previewId],
        )
      ).rows[0].n,
    ).toBe(0);
  };
  // Reject the actual deferred COMMIT after physical retirement. Ownership must
  // survive in uncertainty, and only an acknowledged reserved retry releases it.
  const active = await start();
  await h.db.query(
    `CREATE FUNCTION preview_retirement_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${h.previewId}'::uuid AND NEW.retired AND NOT OLD.retired THEN RAISE EXCEPTION 'owned preview retirement commit fault'; END IF; RETURN NEW; END $$`,
  );
  await h.db.query(
    "CREATE CONSTRAINT TRIGGER preview_retirement_fault AFTER UPDATE ON previews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION preview_retirement_fault()",
  );
  const stopKey = `${Date.now()}:${randomUUID()}`;
  let stopped: any;
  h.supervisor.kill("SIGSTOP");
  try {
    stopped = await command(
      "/stop",
      { expectedGeneration: Number(active.generation) },
      202,
      stopKey,
    );
    for (let pending = 0; pending < 4; pending++)
      expect(
        await command("/stop", {
          expectedGeneration: Number(active.generation),
        }),
      ).toEqual(stopped);
    expect((await row()).stop_attempts).toBe(1);
    expect(
      Number(
        (
          await h.db.query(
            "SELECT count(*) FROM intents WHERE control_target=$1",
            [`preview-stop:${h.previewId}:${active.generation}`],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
  } finally {
    h.supervisor.kill("SIGCONT");
  }
  await expect
    .poll(async () => (await row()).state, { timeout: 20000 })
    .toBe("uncertain");
  const uncertain = await row();
  expect(uncertain.retired).toBe(false);
  expect(uncertain.lease_epoch).not.toBeNull();
  expect(
    (
      await h.db.query(
        "SELECT count(*)::int n FROM preview_readers WHERE owner_id=$1",
        [h.previewId],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    await command(
      "/stop",
      { expectedGeneration: Number(active.generation) },
      202,
      stopKey,
    ),
  ).toEqual(stopped);
  await command(
    "/stop",
    { expectedGeneration: Number(active.generation) },
    409,
  );
  await command("/start", { expectedRevision: uncertain.revision }, 409);
  // Exhausting ordinary metadata/control capacity cannot consume reserved stop.
  await h.db.query("UPDATE previews SET command_count=128 WHERE id=$1", [
    h.previewId,
  ]);
  const capacityRoute = "/owned-preview-history-" + h.previewId;
  await h.db.query(
    "INSERT INTO intents(actor,route,key,request_hash,result) SELECT 'owner',$1,n::text,'owned-public-fixture','{}' FROM generate_series(1,10000) n",
    [capacityRoute],
  );
  await command("/start", { expectedRevision: uncertain.revision }, 429);
  const second = await command("/stop", {
    expectedGeneration: Number(active.generation),
    acknowledgeUnconfirmed: stopped.stopId,
  });
  await expect
    .poll(async () => (await row()).state, { timeout: 20000 })
    .toBe("uncertain");
  expect((await row()).stop_attempts).toBe(2);
  await h.db.query(
    "DROP TRIGGER preview_retirement_fault ON previews; DROP FUNCTION preview_retirement_fault()",
  );
  await command("/stop", {
    expectedGeneration: Number(active.generation),
    acknowledgeUnconfirmed: second.stopId,
  });
  await waitRetired();
  expect((await row()).stop_attempts).toBe(3);
  expect(
    Number(
      (
        await h.db.query(
          "SELECT count(*) FROM intents WHERE control_target=$1",
          [`preview-stop:${h.previewId}:${active.generation}`],
        )
      ).rows[0].count,
    ),
  ).toBe(3);
  await h.db.query("DELETE FROM intents WHERE actor='owner' AND route=$1", [
    capacityRoute,
  ]);
  await command("/start", { expectedRevision: (await row()).revision }, 429);
  await h.db.query("UPDATE previews SET command_count=0 WHERE id=$1", [
    h.previewId,
  ]);

  // The native launch happened, but the ready transaction is rejected. The same
  // generation is retired and cannot be silently dispatched a second time.
  await h.db.query(
    `CREATE FUNCTION preview_ready_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${h.previewId}'::uuid AND NEW.state='ready' THEN RAISE EXCEPTION 'owned preview ready commit fault'; END IF; RETURN NEW; END $$`,
  );
  await h.db.query(
    "CREATE CONSTRAINT TRIGGER preview_ready_fault AFTER UPDATE ON previews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION preview_ready_fault()",
  );
  await command("/start", { expectedRevision: (await row()).revision });
  await expect
    .poll(async () => (await row()).state, { timeout: 30000 })
    .toBe("failed");
  await waitRetired();
  const failed = await row();
  expect(failed.failure_code).toBe("START_UNCERTAIN");
  await h.db.query(
    "DROP TRIGGER preview_ready_fault ON previews; DROP FUNCTION preview_ready_fault()",
  );
  await new Promise((r) => setTimeout(r, 500));
  expect((await row()).generation).toBe(failed.generation);
  expect((await row()).state).toBe("failed");

  // Supervisor loss retires the exact prior identity and reports a conservative
  // output gap when the replacement process starts.
  const running = await start();
  h.supervisor.kill("SIGKILL");
  await new Promise<void>((resolve) =>
    h.supervisor.exitCode !== null || h.supervisor.signalCode !== null
      ? resolve()
      : h.supervisor.once("exit", () => resolve()),
  );
  const replacement = h.restartSupervisor();
  expect(replacement.pid).not.toBe(h.supervisor.pid);
  await waitRetired();
  const restarted = await row();
  expect(restarted.generation).toBe(running.generation);
  expect(restarted.output_lost).toBe(true);
  expect(restarted.failure_code).toBe("SUPERVISOR_RESTARTED");
  await new Promise((r) => setTimeout(r, 500));
  expect((await row()).retired).toBe(true);

  // An elapsed persisted lifetime is independently enforced, even without any
  // further browser connection or explicit stop action.
  const lifetime = await start();
  await h.db.query(
    "UPDATE previews SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1",
    [h.previewId],
  );
  await waitRetired();
  expect((await row()).failure_code).toBe("LIFETIME_EXPIRED");
  await writeFile(
    path.join(h.artifacts, "fault-cases.json"),
    JSON.stringify(
      {
        status: "passed",
        retirementCommitRejected: true,
        pendingNewKeysRetainOneIntent: true,
        threePhysicalAttemptsRemainAvailable: true,
        ownershipRetainedUntilAcknowledgedRetry: true,
        reservedStopAfterOrdinaryCapacity: true,
        readyCommitRejectedNoReplay: failed.generation,
        supervisorRestartRetiredNoReplay: running.generation,
        persistedLifetimeRetired: lifetime.generation,
        scope:
          "Actual Harbor API/PG deferred COMMIT faults and supervisor SIGKILL; external Codex fixture on macOS, actual native runtime when managed Linux",
      },
      null,
      2,
    ),
  );
}
