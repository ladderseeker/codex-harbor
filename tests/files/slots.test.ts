import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("file helper slots serialize concurrent claims and retain dead ownership until exact retirement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harbor-file-slots-"));
  const call = async (action: string, id: string) =>
    JSON.parse(
      (
        await exec(
          "python3",
          ["infra/files/slots.py", dir, action, id, String(process.pid)],
          { timeout: 5000 },
        )
      ).stdout,
    );
  try {
    const ids = Array.from({ length: 12 }, () => randomUUID());
    const settled = await Promise.allSettled(
      ids.map((id) => call("claim", id)),
    );
    const outcomes = settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    assert.equal(outcomes.filter((o) => o.claimed).length, 4);
    const rows = JSON.parse(
      await readFile(join(dir, "file-slots.json"), "utf8"),
    );
    assert.equal(rows.length, 4);
    assert.equal((await call("claim", rows[0].id)).claimed, false);
    await call("release", randomUUID());
    assert.equal(
      JSON.parse(await readFile(join(dir, "file-slots.json"), "utf8")).length,
      4,
    );
    const original = rows[0].id;
    await call("release", original);
    const successor = randomUUID();
    assert.equal((await call("claim", successor)).claimed, true);
    await call("release", original);
    assert.equal(
      JSON.parse(await readFile(join(dir, "file-slots.json"), "utf8")).some(
        (r: any) => r.id === successor,
      ),
      true,
    );
    // Controlled private ledger fixture simulates a broker whose bounded cleanup time passed.
    const stale = JSON.parse(
      await readFile(join(dir, "file-slots.json"), "utf8"),
    );
    stale[0].pid = 2147483647;
    stale[0].createdAt = Date.now() / 1000 - 121;
    await writeFile(join(dir, "file-slots.json"), JSON.stringify(stale), {
      mode: 0o600,
    });
    const denied = await call("claim", randomUUID());
    assert.equal(denied.claimed, false);
    assert.deepEqual(denied.stale, [stale[0].id]);
    assert.equal(
      JSON.parse(await readFile(join(dir, "file-slots.json"), "utf8")).length,
      4,
      "enumeration never frees an unconfirmed container",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
