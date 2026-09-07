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
import { createPool } from "../../packages/storage/src/index.ts";
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
  !uuid.test(input.sessionId) ||
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
  if (
    !(
      await pool.query(
        "SELECT 1 FROM sessions WHERE id=$1 AND project_id=$2 UNION ALL SELECT 1 FROM runtime_bootstrap WHERE runtime_id=$1",
        [input.sessionId, input.projectId],
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
