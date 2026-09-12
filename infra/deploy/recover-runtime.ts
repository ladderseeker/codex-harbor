import { retireRelay } from "../previews/launcher.ts";
import { selectedWorkspace } from "../../packages/workspaces/src/service.ts";
/** Exact stopped-service runner lock recovery; never a project-facing capability. */
import {
  readFile,
  lstat,
  readdir,
  unlink,
  rmdir,
  open,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPool, transaction } from "../../packages/storage/src/index.ts";
import { revokeEgress } from "../egress/network.mjs";
const exec = promisify(execFile);
let body = "";
for await (const chunk of process.stdin) {
  body += chunk;
  if (body.length > 4096) throw Error("Recovery input bound");
}
const input = JSON.parse(body);
if (
  process.platform !== "linux" ||
  process.getuid?.() !== 0 ||
  !input.acknowledged
)
  throw Error("Explicit trusted recovery acknowledgement required");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
if (
  !uuid.test(input.projectId) ||
  !(
    uuid.test(input.sessionId) ||
    (typeof input.sessionId === "string" &&
      ((input.sessionId.startsWith("terminal-") &&
        uuid.test(input.sessionId.slice(9))) ||
        (input.sessionId.startsWith("preview-") &&
          uuid.test(input.sessionId.slice(8)))))
  ) ||
  !Number.isSafeInteger(input.generation) ||
  input.generation < 0 ||
  !/^\d+$/.test(input.lockInode)
)
  throw Error("Exact recovery identity required");
const instanceId = process.env.HARBOR_INSTANCE_ID!;
for (const role of ["api", "supervisor", "storage"]) {
  const state = (
    await exec(
      "systemctl",
      [
        "show",
        "--property=ActiveState",
        "--value",
        `codex-harbor-${instanceId}-${role}.service`,
      ],
      { timeout: 5000 },
    )
  ).stdout.trim();
  if (!["inactive", "failed"].includes(state))
    throw Error("Control services must be stopped before lock recovery");
}
const pool = createPool(process.env.DATABASE_URL!);
try {
  if (
    !(await pool.query("SELECT 1 FROM projects WHERE id=$1", [input.projectId]))
      .rowCount
  )
    throw Error("Unknown project identity");
  const isTerminal = input.sessionId.startsWith("terminal-");
  const isPreview = input.sessionId.startsWith("preview-");
  if (
    !(
      await pool.query(
        isPreview
          ? "SELECT 1 FROM previews WHERE id=$1 AND project_id=$2 AND generation=$3 AND restored_from IS NULL"
          : isTerminal
            ? "SELECT 1 FROM terminals WHERE id=$1 AND project_id=$2 AND generation=$3"
            : "SELECT 1 FROM sessions WHERE id=$1 AND project_id=$2 UNION ALL SELECT 1 FROM runtime_bootstrap WHERE runtime_id=$1",
        isPreview
          ? [input.sessionId.slice(8), input.projectId, input.generation]
          : isTerminal
            ? [input.sessionId.slice(9), input.projectId, input.generation]
            : [input.sessionId, input.projectId],
      )
    ).rowCount
  )
    throw Error("Unknown native identity");
  const key = `${instanceId}-${input.projectId}-${input.sessionId}`;
  const folder = process.env.HARBOR_LAUNCHER_STATE_DIR!,
    lock = `${folder}/${key}.lock`;
  const lockStat = await lstat(lock, { bigint: true });
  if (
    !lockStat.isDirectory() ||
    lockStat.uid !== 0n ||
    (lockStat.mode & 0o077n) !== 0n ||
    lockStat.ino.toString() !== input.lockInode
  )
    throw Error("Stale lock identity changed");
  let ledger;
  try {
    ledger = JSON.parse(await readFile(`${folder}/${key}.json`, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if ((ledger?.generation ?? 0) !== input.generation)
    throw Error("Recovery generation changed");
  if (isPreview) {
    const preview = (
      await pool.query("SELECT port FROM previews WHERE id=$1", [
        input.sessionId.slice(8),
      ])
    ).rows[0];
    await retireRelay({
      id: input.sessionId.slice(8),
      generation: input.generation,
      instanceId,
      port: preview.port,
    });
  }
  if (ledger) {
    const name = `harbor-${instanceId}-${input.sessionId}-${input.generation}`;
    if (ledger.container !== name)
      throw Error("Ledger container identity mismatch");
    const present = (
      await exec("docker", ["ps", "-aq", "--filter", `name=^/${name}$`], {
        timeout: 10000,
        maxBuffer: 4096,
      })
    ).stdout.trim();
    if (present) {
      const labels = JSON.parse(
        (
          await exec(
            "docker",
            ["inspect", "--format", "{{json .Config.Labels}}", name],
            { timeout: 10000, maxBuffer: 4096 },
          )
        ).stdout,
      );
      if (
        labels["org.codex-harbor.owner"] !== "runner" ||
        labels["org.codex-harbor.instance"] !== instanceId
      )
        throw Error("Runner owner mismatch");
      await exec("docker", ["rm", "--force", name], {
        timeout: 15000,
        maxBuffer: 4096,
      });
      if (
        (
          await exec("docker", ["ps", "-aq", "--filter", `name=^/${name}$`], {
            timeout: 10000,
          })
        ).stdout.trim()
      )
        throw Error("Runner retirement unconfirmed");
    }
    await revokeEgress({
      instanceId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      generation: input.generation,
    });
  }
  if (isTerminal) {
    await transaction(pool, async (db) => {
      const before = (
        await db.query("SELECT * FROM terminals WHERE id=$1", [
          input.sessionId.slice(9),
        ])
      ).rows[0];
      const w = await selectedWorkspace(db, before.workspace_id, true);
      const row = (
        await db.query("SELECT * FROM terminals WHERE id=$1 FOR UPDATE", [
          before.id,
        ])
      ).rows[0];
      if (
        row.project_id !== input.projectId ||
        Number(row.generation) !== input.generation
      )
        throw Error("Terminal recovery identity changed");
      if (row.retired) return;
      if (
        w.writer_kind !== "terminal" ||
        w.writer_owner_id !== row.id ||
        Number(w.writer_epoch) !== Number(row.writer_epoch)
      )
        throw Error("Terminal recovery reservation changed");
      await db.query(
        "INSERT INTO deployment_restored_operations(kind,id,source_instance,historical) VALUES('terminal-recovery',$1,$2,$3) ON CONFLICT DO NOTHING",
        [row.id, instanceId, JSON.stringify(row)],
      );
      await db.query(
        "UPDATE workspaces SET writer_kind=NULL,writer_owner_id=NULL,writer_generation=NULL WHERE id=$1 AND writer_kind='terminal' AND writer_owner_id=$2 AND writer_epoch=$3",
        [w.id, row.id, row.writer_epoch],
      );
      await db.query(
        "UPDATE terminal_input SET state=CASE WHEN state='dispatching' THEN 'uncertain' ELSE 'denied' END,bytes=NULL,settled_at=clock_timestamp(),failure_code='ADMINISTRATOR_RECOVERED' WHERE terminal_id=$1 AND state IN ('accepted','dispatching')",
        [row.id],
      );
      await db.query(
        "UPDATE terminals SET state='interrupted',retired=true,writer_epoch=NULL,controller_until=NULL,controller_actor=NULL,controller_id=NULL,input_uncertain=true,output_lost=true,failure_code='ADMINISTRATOR_RECOVERED' WHERE id=$1",
        [row.id],
      );
    });
  }
  if (isPreview) {
    await transaction(pool, async (db) => {
      const before = (
        await db.query("SELECT * FROM previews WHERE id=$1", [
          input.sessionId.slice(8),
        ])
      ).rows[0];
      const w = await selectedWorkspace(db, before.workspace_id, true);
      const row = (
        await db.query("SELECT * FROM previews WHERE id=$1 FOR UPDATE", [
          before.id,
        ])
      ).rows[0];
      if (
        row.project_id !== input.projectId ||
        Number(row.generation) !== input.generation ||
        row.restored_from
      )
        throw Error("Preview recovery identity changed");
      if (row.retired) return;
      await db.query(
        "INSERT INTO deployment_restored_operations(kind,id,source_instance,historical) VALUES('preview-recovery',$1,$2,$3) ON CONFLICT DO NOTHING",
        [row.id, instanceId, JSON.stringify(row)],
      );
      if (row.permission_profile === "workspace-write") {
        if (
          w.writer_kind !== "preview" ||
          w.writer_owner_id !== row.id ||
          String(w.writer_epoch) !== String(row.lease_epoch)
        )
          throw Error("Preview recovery reservation changed");
        await db.query(
          "UPDATE workspaces SET writer_kind=NULL,writer_owner_id=NULL,writer_generation=NULL WHERE id=$1 AND writer_kind='preview' AND writer_owner_id=$2 AND writer_epoch=$3",
          [w.id, row.id, row.lease_epoch],
        );
      } else {
        if (
          !(
            await db.query(
              "DELETE FROM preview_readers WHERE owner_id=$1 AND workspace_id=$2 AND generation=$3 AND epoch=$4 RETURNING owner_id",
              [row.id, w.id, row.generation, row.lease_epoch],
            )
          ).rowCount
        )
          throw Error("Preview recovery reader changed");
      }
      await db.query(
        "UPDATE preview_grants SET revoked=true WHERE preview_id=$1",
        [row.id],
      );
      await db.query(
        "UPDATE preview_openings SET revoked=true WHERE preview_id=$1",
        [row.id],
      );
      await db.query(
        "UPDATE preview_stops SET state='completed' WHERE preview_id=$1 AND generation=$2 AND state IN ('queued','retiring')",
        [row.id, row.generation],
      );
      await db.query(
        "UPDATE previews SET state='stopped',retired=true,lease_epoch=NULL,output_lost=true,failure_code='ADMINISTRATOR_RECOVERED' WHERE id=$1",
        [row.id],
      );
    });
  }
  const children = await readdir(lock);
  if (children.some((name) => name !== "next"))
    throw Error("Unrecognized recovery lock content");
  if (children.includes("next")) {
    const item = await lstat(lock + "/next");
    if (!item.isFile() || item.uid !== 0 || item.size > 4096)
      throw Error("Unexpected pending ledger inode");
    await unlink(lock + "/next");
  }
  if ((await lstat(lock, { bigint: true })).ino.toString() !== input.lockInode)
    throw Error("Lock changed during retirement");
  await rmdir(lock);
  const directory = await open(folder, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  process.stdout.write(
    JSON.stringify({
      retired: true,
      lockRecovered: true,
      generationPreserved: input.generation,
      admission: "maintenance",
      originalUncertaintyPreserved: true,
    }),
  );
} finally {
  await pool.end();
}
