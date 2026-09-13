import { openProjectTools } from "../e2e/navigation.ts";
import { terminalLimits } from "./limits.ts";
import { execFileSync } from "node:child_process";
import { terminalStreamChecks } from "./streams.ts";
import {
  expect,
  type BrowserContext,
  type Page,
  type APIResponse,
} from "@playwright/test";
import type { Pool } from "pg";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
export async function terminalReviewFixes(h: {
  context: BrowserContext;
  page: Page;
  db: Pool;
  origin: string;
  directOrigin: string;
  csrf: string;
  t: any;
  supervisor: ChildProcess;
  restartSupervisor: () => ChildProcess;
  command: (route: string, data: unknown, key?: string) => Promise<APIResponse>;
}) {
  if (process.argv.includes("--terminal-stream-check")) {
    await terminalStreamChecks(h);
    return;
  }
  const { context, page, db, origin, csrf, t, command } = h;
  let supervisor = h.supervisor;
  const headers = { Origin: origin, "X-CSRF-Token": csrf };
  const row = async (id: string) =>
    (await db.query("SELECT * FROM terminals WHERE id=$1", [id])).rows[0];
  const create = async () => {
    const response = await command(`/workspaces/${t.workspace_id}/terminals`, {
      permissionProfile: "read-only",
      cols: 80,
      rows: 24,
    });
    expect(response.status(), await response.text()).toBe(202);
    const term = (await response.json()).terminal;
    await expect
      .poll(async () => (await row(term.id)).state, { timeout: 20000 })
      .toBe("running");
    return term;
  };
  const stop = async (term: any) => {
    const r = await command(`/terminals/${term.id}/terminate`, {
      generation: term.generation,
    });
    expect(r.status(), await r.text()).toBe(202);
    await expect
      .poll(async () => (await row(term.id)).retired, { timeout: 20000 })
      .toBe(true);
  };
  const select = async (id: string) => {
    await expect
      .poll(async () =>
        page
          .getByLabel("Selected terminal")
          .locator(`option[value="${id}"]`)
          .count(),
      )
      .toBe(1);
    await page.getByLabel("Selected terminal").selectOption(id);
    await expect(
      page.getByRole("button", { name: "Take control", exact: true }),
    ).toBeEnabled();
  };
  const text = async (id: string) =>
    (
      await db.query(
        "SELECT bytes FROM terminal_output WHERE terminal_id=$1 ORDER BY sequence",
        [id],
      )
    ).rows
      .map((r) => r.bytes.toString())
      .join("");
  // Cut only the external browser transport. Every Harbor component stays real.
  for (const accepted of [false, true]) {
    const term = await create();
    let captured: any,
      forwarded = 0;
    await page.routeWebSocket(`**/terminals/${term.id}/stream`, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((raw) => {
        const b = JSON.parse(raw.toString());
        if (["resize", "heartbeat"].includes(b.type)) return;
        if (b.type === "input") {
          captured = b;
          if (accepted) {
            forwarded++;
            server.send(raw);
          } else {
            ws.close();
            server.close();
          }
        } else server.send(raw);
      });
      server.onMessage((raw) => {
        const b = JSON.parse(raw.toString());
        if (b.type === "ack" && b.action === "input") {
          ws.close();
          server.close();
        } else ws.send(raw);
      });
    });
    // Creation may already have selected/opened its socket before route install.
    // Reload forces the test-owned transport to be routed before any input.
    await page.reload();
    await openProjectTools(page);
    await page
      .getByRole("button", { name: "Open terminals", exact: true })
      .click();
    await select(term.id);
    await page
      .getByRole("button", { name: "Take control", exact: true })
      .click();
    await expect(
      page.getByText("You control this terminal.", { exact: true }),
    ).toBeVisible();
    const marker = accepted ? "ACCEPTED" : "MISSING";
    await page.locator(".terminal-canvas").evaluate((node, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      node.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, `printf 'RECONCILE_%s\\n' ${marker}\n`);
    await page.getByRole("button", { name: "Send paste", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Check input outcome", exact: true }),
    ).toBeVisible();
    expect(captured).toBeTruthy();
    if (accepted)
      await expect
        .poll(
          async () =>
            (
              await db.query(
                "SELECT state FROM terminal_input WHERE terminal_id=$1 AND epoch=$2 AND sequence=$3",
                [term.id, captured.epoch, captured.sequence],
              )
            ).rows[0]?.state,
        )
        .toMatch(/delivered|denied/);
    const before = await db.query(
      "SELECT epoch,sequence,state,hash FROM terminal_input WHERE terminal_id=$1 ORDER BY epoch,sequence",
      [term.id],
    );
    const outcomeResponse = page.waitForResponse((r) =>
      r.url().endsWith(`/terminals/${term.id}/input/outcome`),
    );
    await page
      .getByRole("button", { name: "Check input outcome", exact: true })
      .click();
    const outcome = await outcomeResponse;
    expect(outcome.status()).toBe(200);
    expect((await outcome.json()).input.state).toBe(
      accepted ? before.rows[0].state : "missing",
    );
    await expect(
      page.getByRole("button", { name: "Check input outcome", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await db.query(
          "SELECT epoch,sequence,state,hash FROM terminal_input WHERE terminal_id=$1 ORDER BY epoch,sequence",
          [term.id],
        )
      ).rows,
    ).toEqual(before.rows);
    expect(forwarded).toBe(accepted ? 1 : 0);
    if (!accepted) {
      expect((await row(term.id)).controller_until).not.toBe(null);
      expect(await text(term.id)).not.toContain("RECONCILE_MISSING");
    } else
      expect(
        (await text(term.id)).split("RECONCILE_ACCEPTED").length - 1,
      ).toBeLessThanOrEqual(1);
    await stop(term);
  }
  const retirement = await create();
  const exactPid = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(
      (m) =>
        m &&
        Number(m[2]) === supervisor.pid &&
        m[3].includes("tests/fixtures/codex/terminal.py"),
    );
  expect(exactPid).toHaveLength(1);
  const runtimePid = Number(exactPid[0]![1]);
  process.kill(runtimePid, "SIGSTOP");
  try {
    const first = await command(`/terminals/${retirement.id}/terminate`, {
      generation: retirement.generation,
    });
    expect(first.status()).toBe(202);
    await expect
      .poll(async () => (await row(retirement.id)).state, { timeout: 25000 })
      .toBe("uncertain");
    const uncertain = await row(retirement.id);
    expect(uncertain.failure_code).toBe("RETIREMENT_UNCONFIRMED");
    expect(uncertain.retired).toBe(false);
    expect(
      (
        await db.query(
          "SELECT writer_owner_id,writer_epoch FROM workspaces WHERE id=$1",
          [t.workspace_id],
        )
      ).rows[0],
    ).toEqual({
      writer_owner_id: retirement.id,
      writer_epoch: uncertain.writer_epoch,
    });
    // Production's third-attempt cap, independent from the real first failure.
    await db.query("UPDATE terminals SET termination_attempts=3 WHERE id=$1", [
      retirement.id,
    ]);
    expect(
      (
        await command(`/terminals/${retirement.id}/terminate`, {
          generation: retirement.generation,
        })
      ).status(),
    ).toBe(429);
    await db.query("UPDATE terminals SET termination_attempts=1 WHERE id=$1", [
      retirement.id,
    ]);
    await stop(retirement);
    expect((await row(retirement.id)).termination_attempts).toBe(2);
  } finally {
    try {
      process.kill(runtimePid, "SIGCONT");
    } catch {}
  }
  await terminalStreamChecks(h);
  await terminalLimits(h);
  // A real unclean restart while output persistence is blocked conservatively
  // discloses lost tail bytes. No fabricated byte count or input replay.
  const crashed = await create();
  const grant = await command(`/terminals/${crashed.id}/control`, {
    generation: crashed.generation,
    expectedEpoch: 0,
    acknowledgeUncertainInput: false,
  });
  const c = (await grant.json()).control;
  const send = await context.request.post(
    origin + `/api/v1/terminals/${crashed.id}/input`,
    {
      headers,
      data: {
        version: 1,
        generation: crashed.generation,
        epoch: c.epoch,
        controllerId: c.controllerId,
        sequence: 1,
        data: Buffer.from(
          "sleep 2; printf 'CRASH_%s\\n' UNPERSISTED\n",
        ).toString("base64"),
      },
    },
  );
  expect(send.status()).toBe(200);
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT state FROM terminal_input WHERE terminal_id=$1",
            [crashed.id],
          )
        ).rows[0]?.state,
    )
    .toBe("delivered");
  const crashPids = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(
      (m) =>
        m &&
        Number(m[2]) === supervisor.pid &&
        m[3].includes("tests/fixtures/codex/terminal.py"),
    );
  expect(crashPids).toHaveLength(1);
  const crashRuntime = Number(crashPids[0]![1]);
  const hold = await db.connect();
  try {
    await hold.query("BEGIN");
    await hold.query("SELECT id FROM terminals WHERE id=$1 FOR UPDATE", [
      crashed.id,
    ]);
    await new Promise((r) => setTimeout(r, 2500));
    await expect
      .poll(async () =>
        Number(
          (
            await db.query(
              "SELECT count(*) AS n FROM pg_stat_activity WHERE application_name='p006-supervisor' AND wait_event_type='Lock' AND query LIKE 'SELECT%terminals%FOR UPDATE%' ",
            )
          ).rows[0].n,
        ),
      )
      .toBeGreaterThan(0);
    // A sustained blocked persistence transaction also exercises the independent
    // 30 s storage watchdog: it retires the real child without a working DB write.
    await expect
      .poll(
        () => {
          try {
            process.kill(crashRuntime, 0);
            return false;
          } catch {
            return true;
          }
        },
        { timeout: 38000 },
      )
      .toBe(true);
    expect(
      (
        await db.query("SELECT writer_owner_id FROM workspaces WHERE id=$1", [
          t.workspace_id,
        ])
      ).rows[0].writer_owner_id,
    ).toBe(crashed.id);
    const exited = new Promise<void>((r) => supervisor.once("exit", () => r()));
    supervisor.kill("SIGKILL");
    await exited;
    await hold.query("COMMIT");
  } finally {
    await hold.query("ROLLBACK");
    hold.release();
  }
  supervisor = h.restartSupervisor();
  await expect
    .poll(async () => (await row(crashed.id)).retired, { timeout: 20000 })
    .toBe(true);
  expect((await row(crashed.id)).output_lost).toBe(true);
  const snapshot = await context.request.get(
    origin + `/api/v1/terminals/${crashed.id}/output?cursor=0`,
  );
  expect(snapshot.status()).toBe(200);
  expect((await snapshot.json()).lost).toBe(true);
  expect(await text(crashed.id)).not.toContain("CRASH_UNPERSISTED");
  await page.getByLabel("Selected terminal").selectOption(crashed.id);
  await expect(
    page.getByText(
      "Older output expired or was lost. The display was reset; this tail cannot reconstruct a full-screen application.",
      { exact: true },
    ),
  ).toBeVisible();
  // Two independent owner browser sessions. Emergency is first in the meta lock
  // queue; an input-row lock places the old implementation after its stale read.
  const term = await create();
  const second = await context
    .browser()!
    .newContext({ ignoreHTTPSErrors: true });
  const other = await second.newPage();
  await other.goto(origin + "/auth/login");
  await other
    .getByRole("button", { name: "Sign in as owner", exact: true })
    .click();
  const me = await (await second.request.get(origin + "/api/v1/me")).json();
  const ctl = (
    await (
      await command(`/terminals/${term.id}/control`, {
        generation: term.generation,
        expectedEpoch: 0,
        acknowledgeUncertainInput: false,
      })
    ).json()
  ).control;
  supervisor.kill("SIGSTOP");
  const admitted = await context.request.post(
    origin + `/api/v1/terminals/${term.id}/input`,
    {
      headers,
      data: {
        version: 1,
        generation: term.generation,
        epoch: ctl.epoch,
        controllerId: ctl.controllerId,
        sequence: 1,
        data: Buffer.from("printf 'EMERGENCY_%s\\n' FORBIDDEN\n").toString(
          "base64",
        ),
      },
    },
  );
  expect(admitted.status()).toBe(200);
  const meta = await db.connect(),
    input = await db.connect();
  try {
    await meta.query("BEGIN");
    await meta.query("SELECT emergency FROM harbor_meta FOR UPDATE");
    await input.query("BEGIN");
    await input.query(
      "SELECT sequence FROM terminal_input WHERE terminal_id=$1 FOR UPDATE",
      [term.id],
    );
    const emergency = second.request.post(
      origin + "/api/v1/security/emergency-stop",
      {
        headers: {
          Origin: origin,
          "X-CSRF-Token": me.csrfToken,
          "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
        },
        data: {},
      },
    );
    await expect
      .poll(async () =>
        Number(
          (
            await db.query(
              "SELECT count(*) AS n FROM pg_stat_activity WHERE application_name='p006-api' AND wait_event_type='Lock' AND query LIKE '%harbor_meta FOR UPDATE%'",
            )
          ).rows[0].n,
        ),
      )
      .toBeGreaterThan(0);
    supervisor.kill("SIGCONT");
    await expect
      .poll(async () =>
        Number(
          (
            await db.query(
              "SELECT count(*) AS n FROM pg_stat_activity WHERE application_name='p006-supervisor' AND wait_event_type='Lock' AND query LIKE '%harbor_meta FOR SHARE%'",
            )
          ).rows[0].n,
        ),
      )
      .toBeGreaterThan(0);
    await meta.query("COMMIT");
    const stopped = await emergency;
    expect(stopped.status(), await stopped.text()).toBe(200);
    expect(
      (await db.query("SELECT emergency FROM harbor_meta")).rows[0].emergency,
    ).toBe(true);
    await input.query("COMMIT");
    await expect
      .poll(async () => (await row(term.id)).retired, { timeout: 20000 })
      .toBe(true);
    expect(await text(term.id)).not.toContain("EMERGENCY_FORBIDDEN");
    expect(
      (
        await db.query(
          "SELECT state FROM terminal_input WHERE terminal_id=$1",
          [term.id],
        )
      ).rows[0].state,
    ).toBe("denied");
  } finally {
    supervisor.kill("SIGCONT");
    await meta.query("ROLLBACK");
    await input.query("ROLLBACK");
    meta.release();
    input.release();
    await second.close();
  }
}
