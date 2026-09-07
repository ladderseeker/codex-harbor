import { writeFile } from "node:fs/promises";
import {
  installedModules,
  installedModuleStatus,
  restoreInstalledModules,
} from "../../packages/storage/src/deployment-modules.ts";
import { planSchedule } from "../../packages/schedules/src/planner.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { PgBoss } from "pg-boss";
import {
  createPool,
  migrate,
  transaction,
  bindIdentity,
} from "../../packages/storage/src/index.ts";
import { digest } from "../../packages/policy/src/index.ts";
import { requireAuthority } from "../../packages/policy/src/authority.ts";
import {
  createActivatedSchedule,
  admitRecurringOccurrence,
} from "../../packages/schedules/src/admission.ts";
import {
  initializeScheduleQueue,
  SCHEDULE_QUEUE,
} from "../../packages/schedules/src/queue.ts";
import { scheduleActor } from "../../packages/schedules/src/authority.ts";

test(
  "P008 real PG/pg-boss occurrence atomicity and independent bounded grant",
  { timeout: 90000 },
  async () => {
    const name = "harbor-p008-admission-" + randomUUID(),
      password = randomBytes(24).toString("hex");
    const docker = (args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env, POSTGRES_PASSWORD: password },
        stdio: ["ignore", "pipe", "pipe"],
      });
    let pool: ReturnType<typeof createPool> | undefined,
      boss: PgBoss | undefined;
    const oldInstance = process.env.HARBOR_INSTANCE_ID;
    const oldTest = [
      process.env.NODE_ENV,
      process.env.HARBOR_FIXTURE_MODE,
      process.env.HARBOR_SCHEDULE_TEST_CLOCK,
    ];
    process.env.NODE_ENV = "test";
    process.env.HARBOR_FIXTURE_MODE = "private-test";
    process.env.HARBOR_SCHEDULE_TEST_CLOCK = "1";
    process.env.HARBOR_INSTANCE_ID = name;
    try {
      docker([
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--label",
        "org.codex-harbor.test=" + name,
        "-e",
        "POSTGRES_PASSWORD",
        "--tmpfs",
        "/var/lib/postgresql/data:rw,size=268435456",
        "-p",
        "127.0.0.1::5432",
        "postgres:17.6-bookworm",
      ]);
      let port: string | undefined;
      for (let attempt = 0; attempt < 50; attempt++) {
        const published = JSON.parse(
          docker([
            "inspect",
            "--format",
            "{{json .NetworkSettings.Ports}}",
            name,
          ]),
        );
        port = published["5432/tcp"]?.[0]?.HostPort;
        if (port) break;
        await sleep(100);
      }
      assert.ok(
        port,
        "Owned PostgreSQL loopback port was not published within five seconds",
      );
      const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
      pool = createPool(url);
      let ready = false;
      for (let i = 0; i < 40; i++) {
        try {
          await pool.query("SELECT 1");
          ready = true;
          break;
        } catch {
          await sleep(100);
        }
      }
      assert.equal(ready, true);
      await migrate(pool);
      const c = {
        HARBOR_OIDC_ISSUER: "https://issuer.example.test",
        HARBOR_OWNER_SUBJECT: "owner",
        HARBOR_IDLE_SECONDS: 3600,
        models: ["fixture"],
        HARBOR_PERMISSION_CEILING: "workspace-write" as const,
      };
      const pin = digest(c.HARBOR_OIDC_ISSUER + "\0" + c.HARBOR_OWNER_SUBJECT),
        actor = digest(randomUUID());
      await bindIdentity(pool, pin);
      await pool.query(
        "INSERT INTO browser_sessions(hash,csrf,expires_at,identity_pin) VALUES($1,'test',clock_timestamp()+interval '1 hour',$2)",
        [actor, pin],
      );
      const project = randomUUID(),
        workspace = randomUUID(),
        session = randomUUID();
      await pool.query(
        "INSERT INTO projects(id,name,root_id,relative_path) VALUES($1,'Fixture',$2,'fixture')",
        [project, randomUUID()],
      );
      await pool.query("INSERT INTO workspaces(id,project_id) VALUES($1,$2)", [
        workspace,
        project,
      ]);
      await pool.query(
        "INSERT INTO sessions(id,project_id,workspace_id,title,model,effort,permission_profile) VALUES($1,$2,$3,'Fixture','fixture','medium','read-only')",
        [session, project, workspace],
      );
      boss = new PgBoss({
        connectionString: url,
        supervise: false,
        schedule: false,
      });
      boss.on("error", () => {});
      await boss.start();
      await initializeScheduleQueue(boss);
      await pool.query(
        "INSERT INTO runtime_capabilities(id,data) VALUES(true,$1)",
        [
          JSON.stringify({
            data: [
              {
                id: "fixture",
                supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
              },
            ],
          }),
        ],
      );
      const input = {
        title: "Unattended",
        projectId: project,
        prompt: "immutable scheduled prompt",
        config: {
          rule: { kind: "cron", expression: "* * * * *", timezone: "UTC" },
          workspaceMode: "existing",
          sessionId: session,
          model: "fixture",
          effort: "medium",
          permissionProfile: "read-only",
        },
      };
      await pool.query(
        "INSERT INTO schedule_test_clock(now_at) VALUES(clock_timestamp())",
      );
      const schedule = await transaction(pool, (db) =>
        createActivatedSchedule(db, actor, c, input),
      );
      const minute = schedule.preview[0];
      await pool.query("UPDATE schedule_test_clock SET now_at=$1", [
        minute.instant,
      ]);
      await pool.query(
        "UPDATE browser_sessions SET revoked=true WHERE hash=$1",
        [actor],
      );
      await pool.query(
        `CREATE FUNCTION schedule_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned schedule commit fault'; END $$`,
      );
      await pool.query(
        "CREATE CONSTRAINT TRIGGER schedule_commit_fault AFTER INSERT ON schedule_occurrences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION schedule_commit_fault()",
      );
      await assert.rejects(
        transaction(pool, (db) =>
          admitRecurringOccurrence(
            db,
            boss!,
            c,
            schedule.id,
            minute,
            schedule.preview[1].instant,
          ),
        ),
        /owned schedule commit fault/,
      );
      assert.equal(
        Number(
          (await pool.query("SELECT count(*) FROM schedule_occurrences"))
            .rows[0].count,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await pool.query("SELECT count(*) FROM pgboss.job WHERE name=$1", [
              SCHEDULE_QUEUE,
            ])
          ).rows[0].count,
        ),
        0,
      );
      await pool.query(
        "DROP TRIGGER schedule_commit_fault ON schedule_occurrences",
      );
      const accepted = await Promise.all(
        [0, 1].map(() =>
          transaction(pool!, (db) =>
            admitRecurringOccurrence(
              db,
              boss!,
              c,
              schedule.id,
              minute,
              schedule.preview[1].instant,
            ),
          ),
        ),
      );
      assert.equal(accepted[0].id, accepted[1].id);
      assert.equal(accepted.filter((x) => x.replayed).length, 1);
      const occurrence = (
        await pool.query("SELECT * FROM schedule_occurrences WHERE id=$1", [
          accepted[0].id,
        ])
      ).rows[0];
      const job = (
        await pool.query("SELECT data FROM pgboss.job WHERE id=$1", [
          occurrence.id,
        ])
      ).rows[0];
      assert.deepEqual(Object.keys(job.data).sort(), ["epoch", "occurrenceId"]);
      assert.equal(JSON.stringify(job.data).includes(input.prompt), false);
      const internal = scheduleActor(schedule.grantId, occurrence.id),
        need = {
          projectId: project,
          scope: "execute" as const,
          permissionProfile: "read-only",
          internalOperation: { kind: "turn" as const, id: occurrence.turn_id },
        };
      assert.equal(
        (await requireAuthority(pool, internal, c, need)).kind,
        "schedule",
      );
      await assert.rejects(
        requireAuthority(pool, internal, c, {
          ...need,
          internalOperation: { kind: "turn", id: randomUUID() },
        }),
      );
      await assert.rejects(
        requireAuthority(pool, internal, c, { ...need, scope: "approve" }),
      );
      await pool.query("UPDATE schedules SET state='paused' WHERE id=$1", [
        schedule.id,
      ]);
      await assert.rejects(requireAuthority(pool, internal, c, need));
      await pool.query("UPDATE schedules SET state='enabled' WHERE id=$1", [
        schedule.id,
      ]);
      const hold = await pool.connect();
      try {
        await pool.query(
          "UPDATE schedule_grants SET expires_at=clock_timestamp()+interval '1200 milliseconds' WHERE id=$1",
          [schedule.grantId],
        );
        await hold.query("BEGIN");
        await hold.query("SELECT id FROM schedules WHERE id=$1 FOR UPDATE", [
          schedule.id,
        ]);
        const waiting = requireAuthority(pool, internal, c, need).then(
          () => "accepted",
          () => "denied",
        );
        await sleep(1500);
        await hold.query("COMMIT");
        assert.equal(await waiting, "denied");
      } finally {
        await hold.query("ROLLBACK").catch(() => {});
        hold.release();
      }
      // Real planner persistence: three selected catch-up minutes never refill as phases settle.
      await pool.query(
        "UPDATE browser_sessions SET revoked=false,last_seen=clock_timestamp() WHERE hash=$1",
        [actor],
      );
      const catchup = await transaction(pool, (db) =>
        createActivatedSchedule(db, actor, c, {
          ...input,
          config: { ...input.config, missedPolicy: "catch_up" },
        }),
      );
      const observed = new Date(
        Date.parse(catchup.preview[0].instant) + 10 * 60000,
      ).toISOString();
      await pool.query("UPDATE schedule_test_clock SET now_at=$1", [observed]);
      await planSchedule(pool, boss, c, catchup.id);
      let saved = (
        await pool.query("SELECT catch_up FROM schedules WHERE id=$1", [
          catchup.id,
        ])
      ).rows[0].catch_up;
      assert.equal(saved.minutes.length, 2);
      const selected = saved.excluded;
      // A planner blocked behind an edit must not admit its stale minute under the new state.
      const staleSchedule = await transaction(pool, (db) =>
        createActivatedSchedule(db, actor, c, input),
      );
      const staleMinute = staleSchedule.preview[0];
      const staleBatch = {
        through: staleMinute.instant,
        next: staleSchedule.preview[1].instant,
        minutes: [staleMinute],
        excluded: [staleMinute.local],
      };
      await pool.query("UPDATE schedules SET catch_up=$2 WHERE id=$1", [
        staleSchedule.id,
        JSON.stringify(staleBatch),
      ]);
      await pool.query("UPDATE schedule_test_clock SET now_at=$1", [
        staleMinute.instant,
      ]);
      const editLock = await pool.connect();
      try {
        await editLock.query("BEGIN");
        await editLock.query(
          "SELECT id FROM schedules WHERE id=$1 FOR UPDATE",
          [staleSchedule.id],
        );
        const staleAttempt = transaction(pool, (db) =>
          admitRecurringOccurrence(
            db,
            boss!,
            c,
            staleSchedule.id,
            staleMinute,
            staleBatch.next,
            {
              configRevision: 1,
              ruleRevision: 1,
              grantId: staleSchedule.grantId,
              batch: staleBatch,
            },
          ),
        ).then(
          () => "accepted",
          (error) => error.code,
        );
        await sleep(100);
        await editLock.query("UPDATE schedules SET catch_up=NULL WHERE id=$1", [
          staleSchedule.id,
        ]);
        await editLock.query("COMMIT");
        assert.equal(await staleAttempt, "SCHEDULE_CHANGED");
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM schedule_occurrences WHERE schedule_id=$1",
                [staleSchedule.id],
              )
            ).rows[0].count,
          ),
          0,
        );
      } finally {
        await editLock.query("ROLLBACK").catch(() => {});
        editLock.release();
      }
      await pool.query("UPDATE schedule_test_clock SET now_at=$1", [observed]);

      await pool.query(
        "UPDATE schedule_test_clock SET now_at=now_at+interval '20 minutes'",
      );
      await planSchedule(pool, boss, c, catchup.id);
      assert.deepEqual(
        (
          await pool.query("SELECT catch_up FROM schedules WHERE id=$1", [
            catchup.id,
          ])
        ).rows[0].catch_up.excluded,
        selected,
      );
      for (let i = 0; i < 3; i++) {
        await pool.query(
          "UPDATE schedule_occurrences SET state='succeeded',ended_at=clock_timestamp() WHERE schedule_id=$1 AND state='accepted'",
          [catchup.id],
        );
        await planSchedule(pool, boss, c, catchup.id);
      }
      const history = (
        await pool.query(
          "SELECT local_minute,kind FROM schedule_occurrences WHERE schedule_id=$1 ORDER BY intended_at",
          [catchup.id],
        )
      ).rows;
      assert.equal(history.filter((r) => r.kind === "recurring").length, 3);
      assert.equal(history.filter((r) => r.kind === "range").length, 1);
      assert.equal(
        (
          await pool.query("SELECT catch_up FROM schedules WHERE id=$1", [
            catchup.id,
          ])
        ).rows[0].catch_up,
        null,
      );
      // Fixed installed-module restore uses real persisted schedule/grant/job state.
      // This is local metadata rebind, not a protected backup or runner restore.
      const originalOccurrence = (
        await pool.query("SELECT * FROM schedule_occurrences WHERE id=$1", [
          occurrence.id,
        ])
      ).rows[0];
      assert.equal(installedModules.P008.length, 6);
      assert.ok((await installedModuleStatus(pool)).enabledSchedules > 0);
      if (process.env.HARBOR_TEST_ADMIN_BRIDGE === "1") {
        assert.equal(process.platform, "linux");
        assert.equal(process.getuid?.(), 0);
        const destination = "restore-" + randomUUID();
        const bridgeInput = {
          action: "restore-rebind",
          restoreId: randomUUID(),
          sourceInstance: name,
          sourceOwner: c.HARBOR_OWNER_SUBJECT,
          projects: [],
          workspaces: [],
          attachments: [],
          attachmentFiles: [],
        };
        const bridge = (input: unknown) =>
          JSON.parse(
            execFileSync(
              process.execPath,
              ["--import", "tsx", "infra/deploy/database.ts"],
              {
                input: JSON.stringify(input),
                encoding: "utf8",
                timeout: 60000,
                env: {
                  ...process.env,
                  DATABASE_URL: url,
                  HARBOR_INSTANCE_ID: destination,
                  HARBOR_OWNER_SUBJECT: c.HARBOR_OWNER_SUBJECT,
                  HARBOR_OIDC_ISSUER: c.HARBOR_OIDC_ISSUER,
                },
              },
            ),
          );
        const inventory = bridge({ action: "registry" });
        assert.deepEqual(inventory.modules.P008, [...installedModules.P008]);
        assert.equal(JSON.stringify(inventory).includes(input.prompt), false);
        assert.equal(bridge(bridgeInput).disabled, true);
        const originalHistoryCount = (
          await pool.query(
            "SELECT count(*) FROM deployment_restored_operations",
          )
        ).rows[0].count;
        assert.equal(bridge(bridgeInput).disabled, true);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM deployment_restored_operations",
            )
          ).rows[0].count,
          originalHistoryCount,
        );
        const deployment = bridge({ action: "status" }).deployment;
        assert.equal(deployment.maintenance, true);
        assert.equal(deployment.activation_required, true);
        assert.equal(
          (
            await pool.query(
              "SELECT revoked FROM browser_sessions WHERE hash=$1",
              [actor],
            )
          ).rows[0].revoked,
          true,
        );
      } else await transaction(pool, (db) => restoreInstalledModules(db, name));
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM schedules WHERE state<>'paused' OR active_grant_id IS NOT NULL OR catch_up IS NOT NULL",
            )
          ).rows[0].count,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM schedule_grants WHERE NOT revoked",
            )
          ).rows[0].count,
        ),
        0,
      );
      assert.equal(
        Number(
          (await pool.query("SELECT count(*) FROM schedule_test_clock")).rows[0]
            .count,
        ),
        0,
      );
      const historical = (
        await pool.query(
          "SELECT historical FROM deployment_restored_operations WHERE kind='schedule-occurrence' AND id=$1 AND source_instance=$2",
          [occurrence.id, name],
        )
      ).rows[0].historical;
      assert.equal(historical.prompt, originalOccurrence.prompt);
      assert.equal(historical.state, originalOccurrence.state);
      assert.equal(historical.turn_id, originalOccurrence.turn_id);
      assert.equal(
        (
          await pool.query(
            "SELECT state FROM schedule_occurrences WHERE id=$1",
            [occurrence.id],
          )
        ).rows[0].state,
        "cancelled",
      );
      assert.equal(
        (
          await pool.query("SELECT data FROM pgboss.job WHERE id=$1", [
            occurrence.id,
          ])
        ).rows[0].data.occurrenceId,
        occurrence.id,
      );
      await assert.rejects(requireAuthority(pool, internal, c, need));
      assert.equal((await installedModuleStatus(pool)).enabledSchedules, 0);
      if (
        process.env.HARBOR_TEST_ADMIN_BRIDGE === "1" &&
        process.env.HARBOR_SCHEDULE_BRIDGE_RESULT
      )
        await writeFile(
          process.env.HARBOR_SCHEDULE_BRIDGE_RESULT,
          JSON.stringify(
            {
              status: "passed",
              node: process.version,
              platform: process.platform,
              actualAdministratorBridge: true,
              registryIncludesSchedules: true,
              originalQueueIdentityRetained: true,
              restoreRetryStable: true,
              destinationActivationRequired: true,
              oldBrowserRevoked: true,
              scope:
                "fresh synthetic PostgreSQL state and actual source administrator bridge; no installed artifact, filesystem restore, native process, backup or transfer",
            },
            null,
            2,
          ) + "\n",
        );
    } finally {
      await boss?.stop();
      await pool?.end();
      try {
        docker(["rm", "--force", name]);
      } catch {}
      for (const [index, key] of [
        "NODE_ENV",
        "HARBOR_FIXTURE_MODE",
        "HARBOR_SCHEDULE_TEST_CLOCK",
      ].entries()) {
        if (oldTest[index] === undefined) delete process.env[key];
        else process.env[key] = oldTest[index];
      }
      if (oldInstance === undefined) delete process.env.HARBOR_INSTANCE_ID;
      else process.env.HARBOR_INSTANCE_ID = oldInstance;
    }
  },
);
