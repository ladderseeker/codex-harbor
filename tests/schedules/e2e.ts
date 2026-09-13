import { openProjectTools } from "../e2e/navigation.ts";
import { scheduleModulesE2e } from "./modules-e2e.ts";
import { scheduleReviewControlsE2e } from "./review-controls-e2e.ts";
import { scheduleWorkspacesE2e } from "./workspaces-e2e.ts";
import { scheduleBoundsE2e } from "./bounds-e2e.ts";
import { scheduleFaultsE2e } from "./faults-e2e.ts";
import { scheduleLifecycleE2e } from "./lifecycle-e2e.ts";
import { scheduleAuthorityE2e } from "./authority-e2e.ts";
import { Ajv2020 } from "ajv/dist/2020.js";
import { openapi } from "../../packages/contracts/src/openapi.ts";
import path from "node:path";
import { expect, type Browser } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
export async function scheduleE2e(options: {
  browser: Browser;
  db: Pool;
  origin: string;
  artifacts: string;
  fixtureState: string;
  pauseSupervisor: () => void;
  resumeSupervisor: () => void;
  restartSupervisor: (whileStopped?: () => Promise<void>) => Promise<void>;
}) {
  const { browser, db, origin } = options;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const validate = (
    route: string,
    method: string,
    status: number,
    value: unknown,
  ) => {
    const schema = (openapi.paths as any)[route][method].responses[status]
      .content["application/json"].schema;
    const check = ajv.compile({ ...schema, components: openapi.components });
    expect(check(value), JSON.stringify(check.errors)).toBe(true);
  };
  await db.query(
    "INSERT INTO schedule_test_clock(now_at) VALUES(clock_timestamp()) ON CONFLICT(singleton) DO UPDATE SET now_at=clock_timestamp()",
  );
  let context = await browser.newContext({ ignoreHTTPSErrors: true });
  const login = async () => {
    const page = await context.newPage();
    await page.goto(origin + "/auth/login");
    await page
      .getByRole("button", { name: "Sign in as owner", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add project", exact: true }).first(),
    ).toBeVisible();
    return (await context.request.get(origin + "/api/v1/me")).json();
  };
  let me = await login();
  const post = async (
    route: string,
    data: unknown,
    key = `${Date.now()}:${randomUUID()}`,
  ) => {
    const r = await context.request.post(origin + "/api/v1" + route, {
      headers: {
        Origin: origin,
        "X-CSRF-Token": me.csrfToken,
        "Idempotency-Key": key,
      },
      data,
    });
    expect([200, 201, 202], await r.text()).toContain(r.status());
    return r.json();
  };
  const roots = (
    await (await context.request.get(origin + "/api/v1/project-roots")).json()
  ).roots;
  const project = (
    await post("/projects", {
      name: "Scheduled acceptance",
      rootId: roots[0].id,
      path: "schedule-" + randomUUID(),
      create: true,
    })
  ).project;
  const settings = {
    model: "fixture",
    effort: "medium",
    permissionProfile: "read-only",
  };
  const session = (
    await post("/sessions", {
      projectId: project.id,
      title: "Offline schedule",
      ...settings,
    })
  ).session;
  const schedule = await post("/schedules", {
    title: "Offline minute",
    projectId: project.id,
    prompt: "P008 offline occurrence",
    config: {
      rule: { kind: "cron", expression: "* * * * *", timezone: "UTC" },
      workspaceMode: "existing",
      sessionId: session.id,
      ...settings,
    },
    grantDays: 1,
  });
  validate("/schedules", "post", 201, schedule);
  await context.close();
  await db.query("UPDATE schedule_test_clock SET now_at=$1", [
    schedule.preview[0].instant,
  ]);
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT state FROM schedule_occurrences WHERE schedule_id=$1 AND kind='recurring'",
            [schedule.id],
          )
        ).rows[0]?.state,
      { timeout: 45000 },
    )
    .toBe("succeeded");
  const operations = (
    await db.query(
      "SELECT id FROM operations WHERE session_id=$1 AND kind='turn'",
      [session.id],
    )
  ).rows;
  expect(operations).toHaveLength(1);
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  me = await login();
  const history = await (
    await context.request.get(origin + `/api/v1/schedules/${schedule.id}/runs`)
  ).json();
  validate("/schedules/{id}/runs", "get", 200, history);
  expect(history.occurrences[0].state).toBe("succeeded");
  await post(`/schedules/${schedule.id}/pause`, { expectedRevision: 1 });
  const key = `${Date.now()}:${randomUUID()}`;
  const manual = await post(
    `/schedules/${schedule.id}/runs`,
    { expectedRevision: 1 },
    key,
  );
  const replay = await post(
    `/schedules/${schedule.id}/runs`,
    { expectedRevision: 1 },
    key,
  );
  validate("/schedules/{id}/runs", "post", 202, manual);
  expect(replay.occurrence.id).toBe(manual.occurrence.id);
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM schedule_occurrences WHERE id=$1", [
            manual.occurrence.id,
          ])
        ).rows[0]?.state,
      { timeout: 45000 },
    )
    .toBe("succeeded");
  expect(
    (await db.query("SELECT state FROM schedules WHERE id=$1", [schedule.id]))
      .rows[0].state,
  ).toBe("paused");
  expect(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM schedule_occurrences WHERE schedule_id=$1 AND kind='manual'",
          [schedule.id],
        )
      ).rows[0].count,
    ),
  ).toBe(1);
  const page = context.pages().at(-1)!;
  await openProjectTools(page);
  await page.getByRole("button", { name: "Schedules", exact: true }).click();
  await page
    .getByRole("button", { name: "Create schedule", exact: true })
    .click();
  await page
    .getByLabel("Schedule title", { exact: true })
    .fill("Standalone reviewed occurrence");
  await page
    .getByLabel("Scheduled prompt", { exact: true })
    .fill("P008 standalone UI snapshot");
  await page.getByLabel("Recurrence", { exact: true }).selectOption("once");
  const intended = new Date(
    Date.parse(
      (
        await db.query("SELECT now_at FROM schedule_test_clock")
      ).rows[0].now_at.toISOString(),
    ) +
      5 * 60000,
  )
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Local date and time", { exact: true }).fill(intended);
  await page.getByLabel("Timezone", { exact: true }).fill("UTC");
  const localWorkspace = (
    await db.query(
      "SELECT id FROM workspaces WHERE project_id=$1 AND kind='local'",
      [project.id],
    )
  ).rows[0].id;
  await page
    .getByLabel("Source workspace", { exact: true })
    .selectOption(localWorkspace);
  await page
    .getByLabel("Source content", { exact: true })
    .selectOption("snapshot");
  await page
    .getByRole("button", { name: "Preview next occurrences", exact: true })
    .click();
  await expect(page.locator(".schedule-preview li")).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page
    .getByLabel("Schedule title", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(options.artifacts, "schedule-editor-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.body.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.locator(".schedule-preview").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(options.artifacts, "schedule-editor-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create and activate schedule", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Standalone reviewed occurrence",
      exact: true,
    }),
  ).toBeVisible();
  const standalone = (
    await db.query(
      "SELECT id FROM schedules WHERE title='Standalone reviewed occurrence'",
    )
  ).rows[0].id;
  await context.close();
  await db.query("UPDATE schedule_test_clock SET now_at=$1", [
    intended + ":00Z",
  ]);
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT state FROM schedule_occurrences WHERE schedule_id=$1 AND kind='recurring'",
            [standalone],
          )
        ).rows[0]?.state,
      { timeout: 60000 },
    )
    .toBe("succeeded");
  const completed = (
    await db.query(
      "SELECT o.workspace_id,o.session_id,w.state,w.kind FROM schedule_occurrences o JOIN workspaces w ON w.id=o.workspace_id WHERE o.schedule_id=$1",
      [standalone],
    )
  ).rows[0];
  expect(completed.workspace_id).not.toBe(localWorkspace);
  expect(completed.session_id).not.toBe(session.id);
  expect(completed.kind).toBe("copy");
  expect(completed.state).toBe("ready");
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  me = await login();
  await scheduleAuthorityE2e({
    context,
    db,
    origin,
    projectId: project.id,
    sessionId: session.id,
    post,
    pauseSupervisor: options.pauseSupervisor,
    resumeSupervisor: options.resumeSupervisor,
  });
  await scheduleFaultsE2e({
    db,
    context,
    origin,
    projectId: project.id,
    sessionId: session.id,
    csrf: me.csrfToken,
    fixtureState: options.fixtureState,
    post,
    pauseSupervisor: options.pauseSupervisor,
    resumeSupervisor: options.resumeSupervisor,
    restartSupervisor: options.restartSupervisor,
  });
  await scheduleLifecycleE2e({
    db,
    context,
    origin,
    projectId: project.id,
    post,
    restartSupervisor: options.restartSupervisor,
    closeViewer: async () => {
      await context.close();
    },
    openViewer: async () => {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      me = await login();
    },
  });
  // Give the preceding intentional negative/control burst its own rate window.
  await new Promise((resolve) => setTimeout(resolve, 10050));
  await scheduleBoundsE2e({
    db,
    context,
    origin,
    projectId: project.id,
    sessionId: session.id,
    csrf: me.csrfToken,
    post,
  });
  await new Promise((resolve) => setTimeout(resolve, 10050));
  await scheduleWorkspacesE2e({
    db,
    context,
    origin,
    csrf: me.csrfToken,
    post,
    restartSupervisor: options.restartSupervisor,
    pauseSupervisor: options.pauseSupervisor,
    resumeSupervisor: options.resumeSupervisor,
  });
  await expect
    .poll(
      async () =>
        (
          await db.query("SELECT state FROM schedules WHERE id=$1", [
            standalone,
          ])
        ).rows[0].state,
    )
    .toBe("completed");
  await scheduleModulesE2e({
    db,
    context,
    origin,
    csrf: me.csrfToken,
    projectId: project.id,
    sessionId: session.id,
    post,
    restartSupervisor: options.restartSupervisor,
  });
  await scheduleReviewControlsE2e({
    db,
    projectId: project.id,
    sessionId: session.id,
    post,
    pauseSupervisor: options.pauseSupervisor,
    resumeSupervisor: options.resumeSupervisor,
  });
  await context.close();
}
