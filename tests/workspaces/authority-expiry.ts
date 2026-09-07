import { expect, type Browser, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { digest } from "../../packages/policy/src/index.ts";
export async function workspaceAuthorityExpiry(input: {
  browser: Browser;
  owner: BrowserContext;
  origin: string;
  database: string;
  workspaceId: string;
  sessionId: string;
  generation: number;
  pause: () => void;
  resume: () => void;
}) {
  const db = new pg.Pool({ connectionString: input.database }),
    hold = await db.connect();
  let short: BrowserContext | undefined,
    paused = false;
  const login = async () => {
    short = await input.browser.newContext({ ignoreHTTPSErrors: true });
    const page = await short.newPage();
    await page.goto(input.origin + "/auth/login");
    await page
      .getByRole("button", { name: "Sign in as owner", exact: true })
      .click();
    const me = await (
      await short.request.get(input.origin + "/api/v1/me")
    ).json();
    const hash = digest(
      (await short.cookies()).find((c) => c.name === "__Host-harbor")!.value,
    );
    return {
      hash,
      headers: {
        Origin: input.origin,
        "X-CSRF-Token": me.csrfToken,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
    };
  };
  const body = {
    acknowledgeUnknownEffects: true,
    expectedSessionId: input.sessionId,
    expectedGeneration: input.generation,
  };
  try {
    for (const queued of [false, true]) {
      const grant = await login();
      if (queued) {
        input.pause();
        paused = true;
      }
      let response: ReturnType<BrowserContext["request"]["post"]>;
      if (queued) {
        response = short!.request.post(
          input.origin + `/api/v1/workspaces/${input.workspaceId}/release`,
          { headers: grant.headers, data: body },
        );
        expect((await response).status()).toBe(200);
      }
      await db.query(
        "UPDATE browser_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE hash=$1",
        [grant.hash],
      );
      await hold.query("BEGIN");
      await hold.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        input.workspaceId,
      ]);
      if (queued) {
        input.resume();
        paused = false;
      } else
        response = short!.request.post(
          input.origin + `/api/v1/workspaces/${input.workspaceId}/release`,
          { headers: grant.headers, data: body },
        );
      await expect
        .poll(
          async () =>
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%workspaces%FOR UPDATE%' AND pid<>pg_backend_pid()",
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
                [grant.hash],
              )
            ).rows[0].expired,
          { timeout: 5000 },
        )
        .toBe(true);
      await hold.query("ROLLBACK");
      if (queued)
        await expect
          .poll(
            async () =>
              (
                await db.query(
                  "SELECT state FROM workspace_releases WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1",
                  [input.workspaceId],
                )
              ).rows[0]?.state,
            { timeout: 10000 },
          )
          .toBe("failed");
      else expect((await response!).status()).toBe(401);
      expect(
        (
          await db.query(
            "SELECT writer_session_id FROM workspaces WHERE id=$1",
            [input.workspaceId],
          )
        ).rows[0].writer_session_id,
      ).toBe(input.sessionId);
      await short!.close();
      short = undefined;
    }
  } finally {
    if (paused) input.resume();
    await hold.query("ROLLBACK");
    hold.release();
    await short?.close();
    await db.end();
  }
}
