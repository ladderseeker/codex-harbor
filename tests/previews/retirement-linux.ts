/** Actual Docker removal races at the fixed relay identity; root-owned test shim only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { retireRelay, RELAY_IMAGE } from "../../infra/previews/launcher.ts";
import { sourceDigest } from "../../scripts/source-digest.ts";
assert.equal(process.platform, "linux");
assert.equal(process.getuid?.(), 0);
const dir = await mkdtemp("/var/lib/harbor-verification/preview-retire-"),
  originalPath = process.env.PATH!;
const docker = execFileSync("which", ["docker"], { encoding: "utf8" }).trim();
const identity = {
  id: randomUUID(),
  generation: 1,
  instanceId: "preview-retirement-canary",
  port: 3000,
};
const name = `harbor-preview-relay-${identity.id}-1`;
let active: string | undefined;
const create = (owner = identity.instanceId) => {
  active = execFileSync(
    docker,
    [
      "create",
      "--name",
      name,
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true",
      "--entrypoint=/bin/true",
      "--label",
      "org.codex-harbor.owner=preview-relay",
      "--label",
      "org.codex-harbor.instance=" + owner,
      "--label",
      "org.codex-harbor.preview=" + identity.id,
      "--label",
      "org.codex-harbor.generation=1",
      RELAY_IMAGE,
    ],
    { encoding: "utf8" },
  ).trim();
  return active;
};
const outcomes = [];
try {
  await writeFile(
    path.join(dir, "docker"),
    `#!/usr/bin/python3\nimport json,subprocess,sys,os\nc=json.load(open(${JSON.stringify(path.join(dir, "barrier.json"))}))\na=sys.argv[1:]\nr=subprocess.run([c['docker'],*a],capture_output=True) if c['mode']=='inspect' else None\nselected=(c['mode']=='inspect' and a[:2]==['ps','-aq'] and 'name=^/'+c['name']+'$' in a and r.stdout.strip()) or (c['mode']=='remove' and a==['rm','--force',c['id']])\nif selected and not os.path.exists(c['marker']):\n open(c['marker'],'x').close()\n subprocess.run([c['docker'],'rm','--force',c['id']],check=True,capture_output=True)\nif r is None:r=subprocess.run([c['docker'],*a],capture_output=True)\nsys.stdout.buffer.write(r.stdout);sys.stderr.buffer.write(r.stderr);sys.exit(r.returncode)\n`,
    { mode: 0o700 },
  );
  for (const mode of ["inspect", "remove"]) {
    const id = create();
    const marker = path.join(dir, mode + ".fired");
    await writeFile(
      path.join(dir, "barrier.json"),
      JSON.stringify({ docker, id, name, mode, marker }),
      { mode: 0o600 },
    );
    process.env.PATH = dir + ":" + originalPath;
    let error: unknown;
    try {
      await retireRelay(identity);
    } catch (e) {
      error = e;
    }
    process.env.PATH = originalPath;
    assert.equal(await readFile(marker, "utf8"), "");
    let absent = false;
    try {
      execFileSync(docker, ["inspect", id], { stdio: "pipe" });
    } catch {
      absent = true;
    }
    assert.equal(absent, true);
    outcomes.push({
      mode,
      retiredWithoutError: !error,
      exactContainerAbsent: true,
    });
    active = undefined;
    if (error) throw error;
  }
  const wrong = create("other-owned-test-instance");
  await assert.rejects(retireRelay(identity), /ownership mismatch/);
  assert.equal(
    JSON.parse(
      execFileSync(docker, ["inspect", wrong], { encoding: "utf8" }),
    )[0].Id,
    wrong,
  );
  execFileSync(docker, ["rm", "--force", wrong], { stdio: "pipe" });
  active = undefined;
  await writeFile(
    path.join(dir, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        source: sourceDigest(),
        outcomes,
        wrongInstancePreserved: true,
        scope:
          "Actual fixed relay Docker races through a root-owned test-only PATH barrier; no attribution of the historical lifetime failure",
      },
      null,
      2,
    ),
  );
  console.log("Preview retirement result: " + dir + "/result.json");
} catch (error) {
  await writeFile(
    path.join(dir, "failure.json"),
    JSON.stringify(
      {
        status: "failed",
        source: sourceDigest(),
        outcomes,
        code: (error as any).code ?? null,
        absentContainer: /No such (object|container)/i.test(
          String((error as any).stderr),
        ),
        scope: "Actual owned Docker removal barrier",
      },
      null,
      2,
    ),
  );
  console.error("Preview retirement failure: " + dir + "/failure.json");
  throw error;
} finally {
  process.env.PATH = originalPath;
  if (active)
    execFileSync(docker, ["rm", "--force", active], { stdio: "pipe" });
  await rm(path.join(dir, "docker"), { force: true });
}
