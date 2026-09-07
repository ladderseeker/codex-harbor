/** Real PostgreSQL deferred COMMIT failure after actual private storage allocation. */
import { request } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createPool } from "../../packages/storage/src/index.ts";
if (process.platform !== "linux" || process.getuid?.() !== 0)
  throw Error("Owned Linux administrator fixture required");
const manifest = JSON.parse(
  await readFile(
    process.env.HARBOR_DEPLOY_ADMISSION ??
      "/var/lib/harbor-p009-tools/admission.json",
    "utf8",
  ),
);
const c = JSON.parse(await readFile(manifest.config, "utf8"));
const password = (
  await readFile(`/etc/codex-harbor/${manifest.id}/database.password`, "utf8")
).trim();
const db = createPool(
  `postgres://harbor:${password}@localhost/harbor?host=${encodeURIComponent(`/run/codex-harbor/${manifest.id}/postgres`)}`,
);
const installation = JSON.parse(
  await readFile(
    `/var/lib/codex-harbor/${manifest.id}/installation.json`,
    "utf8",
  ),
);
const inventory = async () =>
  JSON.parse(
    (
      await promisify(execFile)(
        installation.release + "/bin/harborctl",
        ["--config", manifest.config, "inventory"],
        { timeout: 30000, maxBuffer: 65536 },
      )
    ).stdout,
  );
const owner = JSON.parse(
  await readFile(manifest.control + "/owner.json", "utf8"),
);
const api = await request.newContext({ storageState: owner.storage });
const name = "commit-loss-" + randomUUID().slice(0, 8),
  trigger = "p009_project_commit_loss";
try {
  const meResponse = await api.get(c.origin + "/api/v1/me");
  assert.equal(meResponse.status(), 200);
  const me = await meResponse.json();
  await db.query(`CREATE FUNCTION p009_project_commit_loss() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='P009 commit-loss fixture' THEN RAISE EXCEPTION 'owned commit-loss injection'; END IF; RETURN NEW; END $$;
    CREATE CONSTRAINT TRIGGER p009_project_commit_loss AFTER INSERT ON projects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p009_project_commit_loss()`);
  const key = Date.now() + ":" + randomUUID();
  const create = () =>
    api.post(c.origin + "/api/v1/projects", {
      headers: {
        Origin: c.origin,
        "x-csrf-token": me.csrfToken,
        "Idempotency-Key": key,
      },
      data: {
        rootId: c.roots[0].id,
        name: "P009 commit-loss fixture",
        path: name,
        create: true,
      },
    });
  assert.equal((await create()).status(), 500);
  assert.equal(
    (
      await db.query("SELECT 1 FROM projects WHERE name=$1", [
        "P009 commit-loss fixture",
      ])
    ).rowCount,
    0,
  );
  const path = c.roots[0].path + "/" + name + "/workspace";
  const before = await stat(path, { bigint: true });
  const detected = (await inventory()).unregistered.find(
    (r: any) => r.managedName === name,
  );
  assert.ok(detected);
  assert.equal(detected.registrationPath, name + "/workspace");
  await db.query(
    `DROP TRIGGER ${trigger} ON projects; DROP FUNCTION ${trigger}()`,
  );
  assert.equal(
    (await create()).status(),
    500,
    "Same creation key cannot pretend the unregistered directory was rolled back",
  );
  const adopted = await api.post(c.origin + "/api/v1/projects", {
    headers: {
      Origin: c.origin,
      "x-csrf-token": me.csrfToken,
      "Idempotency-Key": Date.now() + ":" + randomUUID(),
    },
    data: {
      rootId: c.roots[0].id,
      name: "Recovered allocation",
      path: name + "/workspace",
      create: false,
    },
  });
  assert.equal(adopted.status(), 200, await adopted.text());
  const project = (await adopted.json()).project;
  const stored = (
    await db.query("SELECT device,inode FROM projects WHERE id=$1", [
      project.id,
    ])
  ).rows[0];
  assert.equal(stored.device, before.dev.toString());
  assert.equal(stored.inode, before.ino.toString());
  assert.ok(
    !(await inventory()).unregistered.some((r: any) => r.managedName === name),
  );
  const evidence = {
    installedArtifact: installation.artifact,
    actualAllocationInventoryDetected: true,
    reconciliationRemovedOnlyRegisteredEntry: true,
    actualCommitLossReproduced: true,
    unregisteredAllocationRetained: true,
    sameCreateRetryFailedExplicitly: true,
    explicitExistingRegistrationRecoveredSameInode: true,
    projectId: project.id,
  };
  await writeFile(
    manifest.control + "/allocation-loss-result.json",
    JSON.stringify(evidence, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence));
} finally {
  await db.query(
    `DROP TRIGGER IF EXISTS ${trigger} ON projects; DROP FUNCTION IF EXISTS ${trigger}()`,
  );
  await db.end();
  await api.dispose();
}
