import { openProjectTools } from "../e2e/navigation.ts";
import { expect, type Browser } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

// Only scheduler time is controlled. Authentication, grants, leases and approvals
// retain their real clocks. Harbor API, UI, database and supervisor are real.
export async function scheduleDstE2e(o: {
  browser: Browser;
  db: Pool;
  origin: string;
  artifacts: string;
  restartSupervisor: () => Promise<void>;
}) {
  const context = await o.browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(o.origin + "/auth/login");
  await page
    .getByRole("button", { name: "Sign in as owner", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add project", exact: true }).first(),
  ).toBeVisible();
  const me = await (await context.request.get(o.origin + "/api/v1/me")).json();
  const post = async (route: string, data: unknown, status = 200) => {
    const response = await context.request.post(o.origin + "/api/v1" + route, {
      headers: {
        Origin: o.origin,
        "X-CSRF-Token": me.csrfToken,
        "Idempotency-Key": `${Date.now()}:${randomUUID()}`,
      },
      data,
    });
    expect(response.status()).toBe(status);
    return response.json();
  };
  const roots = await (
    await context.request.get(o.origin + "/api/v1/project-roots")
  ).json();
  const { project } = await post(
    "/projects",
    {
      name: "DST acceptance",
      rootId: roots.roots[0].id,
      path: "dst-" + randomUUID(),
      create: true,
    },
    200,
  );
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const { session } = await post(
    "/sessions",
    { projectId: project.id, title: "Timezone results", ...settings },
    200,
  );
  await page.reload();
  await openProjectTools(page, "schedules");
  await page.getByRole("button", { name: "Schedules", exact: true }).click();
  await page
    .getByRole("button", { name: "Create schedule", exact: true })
    .click();
  const clock = async (instant: string) => {
    await o.db.query(
      "INSERT INTO schedule_test_clock(now_at) VALUES($1) ON CONFLICT(singleton) DO UPDATE SET now_at=$1",
      [instant],
    );
  };
  const cases = [
    {
      name: "spring gap",
      timezone: "America/New_York",
      expression: "30 2 * * *",
      before: "2026-03-07T08:00:00Z",
      invalid: "2026-03-08T02:30",
      local: "2026-03-09T02:30",
      instant: "2026-03-09T06:30:00Z",
      offset: "-04:00",
    },
    {
      name: "first fold",
      timezone: "America/New_York",
      expression: "30 1 * * *",
      before: "2026-11-01T04:00:00Z",
      local: "2026-11-01T01:30",
      instant: "2026-11-01T05:30:00Z",
      offset: "-04:00",
      second: "2026-11-01T06:30:00Z",
      next: "2026-11-02T06:30:00Z",
    },
    {
      name: "half-hour gap",
      timezone: "Australia/Lord_Howe",
      expression: "15 2 * * *",
      before: "2026-10-03T00:00:00Z",
      invalid: "2026-10-04T02:15",
      local: "2026-10-05T02:15",
      instant: "2026-10-04T15:15:00Z",
      offset: "+11:00",
    },
    {
      name: "skipped day",
      timezone: "Pacific/Apia",
      expression: "0 12 * * *",
      before: "2011-12-29T23:00:00Z",
      invalid: "2011-12-30T12:00",
      local: "2011-12-31T12:00",
      instant: "2011-12-30T22:00:00Z",
      offset: "+14:00",
    },
  ];
  const evidence: unknown[] = [];
  for (const c of cases) {
    await clock(c.before);
    await page.getByLabel("Timezone", { exact: true }).fill(c.timezone);
    if (c.invalid) {
      await page.getByLabel("Recurrence", { exact: true }).selectOption("once");
      await page
        .getByLabel("Local date and time", { exact: true })
        .fill(c.invalid);
      const rejected = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/v1/schedules/preview") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Preview next occurrences", exact: true })
        .click();
      expect((await rejected).status()).toBe(400);
      await expect(page.getByRole("alert")).toContainText("does not exist");
      await expect(page.locator(".schedule-preview li")).toHaveCount(0);
    }
    await page.getByLabel("Recurrence", { exact: true }).selectOption("cron");
    await page.getByLabel("Five-field cron").fill(c.expression);
    const previewResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/schedules/preview") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Preview next occurrences", exact: true })
      .click();
    const preview = await (await previewResponse).json();
    expect(preview.preview[0]).toMatchObject({
      local: c.local,
      instant: c.instant,
      offset: c.offset,
    });
    await expect(page.locator(".schedule-preview li").first()).toContainText(
      c.local.replace("T", " "),
    );
    await expect(page.locator(".schedule-preview li").first()).toContainText(
      c.timezone,
    );
    await expect(page.locator(".schedule-preview li").first()).toContainText(
      c.instant,
    );
    const rule = {
      kind: "cron",
      expression: c.expression,
      timezone: c.timezone,
    };
    const schedule = await post(
      "/schedules",
      {
        title: c.name,
        projectId: project.id,
        prompt: "DST identity " + c.name,
        config: {
          rule,
          workspaceMode: "existing",
          sessionId: session.id,
          ...settings,
        },
        grantDays: 1,
      },
      201,
    );
    expect(schedule.preview[0].instant).toBe(c.instant);
    await clock(c.instant);
    await expect
      .poll(
        async () =>
          (
            await o.db.query(
              "SELECT state FROM schedule_occurrences WHERE schedule_id=$1 AND kind='recurring'",
              [schedule.id],
            )
          ).rows[0]?.state,
        { timeout: 45000 },
      )
      .toBe("succeeded");
    const rows = async () =>
      (
        await o.db.query(
          "SELECT id,local_minute,intended_at,turn_id,state FROM schedule_occurrences WHERE schedule_id=$1 AND kind='recurring'",
          [schedule.id],
        )
      ).rows;
    const initial = await rows();
    expect(initial).toHaveLength(1);
    expect(initial[0].local_minute).toBe(c.local);
    expect(initial[0].intended_at.toISOString()).toBe(
      new Date(c.instant).toISOString(),
    );
    if (c.second) {
      await clock(c.second);
      const restartedAt = Date.now();
      await o.restartSupervisor();
      await expect
        .poll(
          async () =>
            (
              await o.db.query(
                "SELECT last_planned_at FROM schedules WHERE id=$1",
                [schedule.id],
              )
            ).rows[0]?.last_planned_at?.getTime() ?? 0,
          { timeout: 30000 },
        )
        .toBeGreaterThanOrEqual(restartedAt);
      const cursor = (
        await o.db.query(
          "SELECT state,next_due_at FROM schedules WHERE id=$1",
          [schedule.id],
        )
      ).rows[0];
      expect(cursor.state).toBe("enabled");
      expect(cursor.next_due_at.toISOString()).toBe(
        new Date(c.next!).toISOString(),
      );
      expect(await rows()).toEqual(initial);
      const after = await post("/schedules/preview", {
        projectId: project.id,
        rule,
      });
      expect(after.preview[0].instant).toBe(c.next);
    }
    const history = await (
      await context.request.get(
        o.origin + `/api/v1/schedules/${schedule.id}/runs`,
      )
    ).json();
    expect(history.occurrences).toHaveLength(1);
    expect(history.occurrences[0].id).toBe(initial[0].id);
    expect(
      (
        await o.db.query(
          "SELECT count(*)::int AS n FROM operations WHERE id=$1",
          [initial[0].turn_id],
        )
      ).rows[0].n,
    ).toBe(1);
    await post(`/schedules/${schedule.id}/pause`, { expectedRevision: 1 });
    evidence.push({
      name: c.name,
      timezone: c.timezone,
      preview: preview.preview[0],
      occurrence: initial[0],
      secondFoldSuppressedAfterRestart: !!c.second,
    });
  }
  await page.screenshot({
    path: path.join(o.artifacts, "dst-preview.png"),
    fullPage: true,
  });
  await writeFile(
    path.join(o.artifacts, "dst-cases.json"),
    JSON.stringify(evidence, null, 2),
  );
  await context.close();
}
