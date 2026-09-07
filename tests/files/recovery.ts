import { expect } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function filesRecovery(h: any) {
  const { local, get, command, env } = h,
    base = `/workspaces/${local.id}`;
  const db = new pg.Pool({ connectionString: env.DATABASE_URL });
  const state = async (id: string) =>
    (await get(base + "/file-operations/" + id)).operation;
  const settle = async (r: any) => {
    expect(r.status(), await r.text()).toBe(202);
    const op = (await r.json()).operation;
    await expect
      .poll(async () => (await state(op.id)).state, { timeout: 30000 })
      .toBe("succeeded");
    return state(op.id);
  };
  try {
    let status = await get(base + "/git/status");
    const refs = status.entries.map((e: any) => e.ref);
    expect(refs.length).toBeGreaterThan(0);
    await settle(
      await command(base + "/git/stage", {
        expectedRevision: status.revision,
        selections: refs.map((ref: string) => ({ ref, wholeFile: true })),
      }),
    );
    status = await get(base + "/git/status");
    await db.query(
      `CREATE FUNCTION file_result_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='succeeded' THEN RAISE EXCEPTION 'owned result commit fault'; END IF; RETURN NEW; END $$`,
    );
    await db.query(
      "CREATE CONSTRAINT TRIGGER file_result_fault AFTER UPDATE ON file_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION file_result_fault()",
    );
    const key = `${Date.now()}:${randomUUID()}`,
      body = {
        expectedRevision: status.revision,
        selectedRefs: refs,
        message: "One commit despite lost result persistence",
      };
    const accepted = await command(base + "/git/commit", body, key);
    expect(accepted.status(), await accepted.text()).toBe(202);
    const op = (await accepted.json()).operation;
    const receiptFile = join(
      env.HARBOR_LAUNCHER_STATE_DIR ?? env.HARBOR_FIXTURE_STATE_DIR,
      "file-receipts",
      op.id + ".json",
    );
    let receipt: any;
    await expect
      .poll(
        async () => {
          try {
            receipt = JSON.parse(await readFile(receiptFile, "utf8"));
            return receipt.state;
          } catch {
            return "missing";
          }
        },
        { timeout: 30000 },
      )
      .toBe("completed");
    expect((await state(op.id)).state).toBe("dispatching");
    const completedOid = receipt.result.commitOid;
    expect((await get(base + "/git/status")).head.oid).toBe(completedOid);
    const beforeSuccessor = await get(
      base + "/files/content?ref=" + encodeURIComponent(refs[0]),
    );
    const queuedReply = await command(base + "/files/save", {
      ref: refs[0],
      expectedRevision: beforeSuccessor.revision,
      text: "MUST_NOT_START_AFTER_RECOVERY",
    });
    expect(queuedReply.status(), await queuedReply.text()).toBe(202);
    const queued = (await queuedReply.json()).operation;
    const old = h.supervisor,
      stopped = new Promise<void>((r) => old.once("exit", () => r()));
    old.kill("SIGKILL");
    await stopped;
    await db.query("DROP TRIGGER file_result_fault ON file_operations");
    await db.query("DROP FUNCTION file_result_fault()");
    h.supervisor = h.start("apps/supervisor/src/main.ts");
    await expect
      .poll(async () => (await state(op.id)).state, { timeout: 30000 })
      .toBe("uncertain");
    await expect
      .poll(async () => (await state(queued.id)).state, { timeout: 10000 })
      .toBe("failed");
    expect((await state(queued.id)).failureCode).toBe("PREDECESSOR_UNCERTAIN");
    const repeat = await command(base + "/git/commit", body, key);
    expect(repeat.status()).toBe(202);
    expect((await repeat.json()).operation.id).toBe(op.id);
    await h.page.reload();
    await h.page
      .getByRole("button", { name: "Files and changes", exact: true })
      .click();
    await expect(h.page.locator(".file-operation")).toContainText("uncertain");
    await expect(
      h.page.getByRole("button", {
        name: "Inspect and fence file operation",
        exact: true,
      }),
    ).toBeVisible();
    const original = await state(op.id);
    expect((await get(base + "/git/status")).head.oid).toBe(completedOid);
    expect((await command(base + "/archive", {})).status()).toBe(409);
    await db.query(
      `INSERT INTO file_operations(id,workspace_id,project_id,actor_hash,kind,state,payload,payload_bytes,request_hash) SELECT gen_random_uuid(),workspace_id,project_id,actor_hash,'save','failed',NULL,0,request_hash FROM file_operations CROSS JOIN generate_series(1,128-(SELECT count(*)::int FROM file_operations WHERE workspace_id=$2)) WHERE id=$1`,
      [op.id, local.id],
    );
    const currentContent = await get(
      base + "/files/content?ref=" + encodeURIComponent(refs[0]),
    );
    expect(
      (
        await command(base + "/files/save", {
          ref: refs[0],
          expectedRevision: currentContent.revision,
          text: "ordinary capacity cannot consume recovery",
        })
      ).status(),
    ).toBe(409);
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM file_operations WHERE workspace_id=$1",
            [local.id],
          )
        ).rows[0].n,
      ),
    ).toBe(128);
    const inspectionKey = `${Date.now()}:${randomUUID()}`;
    const inspect = await command(
      base + "/file-operations/" + op.id + "/inspect",
      { expectedEpoch: original.epoch },
      inspectionKey,
    );
    expect(inspect.status(), await inspect.text()).toBe(202);
    await expect
      .poll(
        async () =>
          (await get(base + "/file-operations/" + op.id)).inspection?.state,
        { timeout: 30000 },
      )
      .toBe("ready");
    const viewed = await get(base + "/file-operations/" + op.id);
    expect(viewed.operation.state).toBe("uncertain");
    await expect(h.page.locator(".file-operation")).toContainText(
      "Inspection: ready",
    );
    await expect(h.page.locator(".file-operation")).toContainText(completedOid);
    expect(viewed.inspection.report.result.commitOid).toBe(completedOid);
    const inspectRetry = await command(
      base + "/file-operations/" + op.id + "/inspect",
      { expectedEpoch: original.epoch },
      inspectionKey,
    );
    expect((await inspectRetry.json()).inspectionId).toBe(viewed.inspection.id);
    expect(
      (
        await command(base + "/file-operations/" + op.id + "/release", {
          expectedEpoch: original.epoch,
          inspectionId: viewed.inspection.id,
          acknowledgeUnknownEffects: true,
        })
      ).status(),
    ).toBe(409);
    const releaseKey = `${Date.now()}:${randomUUID()}`,
      releaseBody = {
        expectedEpoch: viewed.inspection.fence,
        inspectionId: viewed.inspection.id,
        acknowledgeUnknownEffects: true,
      };
    expect(
      (
        await command(
          base + "/file-operations/" + op.id + "/release",
          releaseBody,
          releaseKey,
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await command(
          base + "/file-operations/" + op.id + "/release",
          releaseBody,
          releaseKey,
        )
      ).status(),
    ).toBe(200);
    expect(
      (await get(base + "/files/content?ref=" + encodeURIComponent(refs[0])))
        .text,
    ).toBe(beforeSuccessor.text);
    expect((await state(queued.id)).state).toBe("failed");
    const retained = await state(op.id);
    expect(retained.state).toBe("uncertain");
    expect(retained.acknowledgedAt).toBeTruthy();
    expect((await get(base + "/git/status")).head.oid).toBe(completedOid);
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM file_operations WHERE kind='commit' AND id=$1",
            [op.id],
          )
        ).rows[0].n,
      ),
    ).toBe(1);
    expect(
      (
        await db.query(
          "SELECT writer_kind,writer_owner_id FROM workspaces WHERE id=$1",
          [local.id],
        )
      ).rows[0],
    ).toEqual({ writer_kind: null, writer_owner_id: null });
  } finally {
    await db
      .query("DROP TRIGGER IF EXISTS file_result_fault ON file_operations")
      .catch(() => {});
    await db
      .query("DROP FUNCTION IF EXISTS file_result_fault()")
      .catch(() => {});
    await db.end();
  }
}
