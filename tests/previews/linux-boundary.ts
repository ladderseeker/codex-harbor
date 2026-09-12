import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { confinementProbe } from "../isolation/probes.ts";
const exec = promisify(execFile);
/** Trusted test driver checks only immutable IDs belonging to its fresh preview. */
export async function previewLinuxBoundary(
  db: Pool,
  id: string,
  artifacts: string,
) {
  if (process.platform !== "linux" || process.getuid?.() !== 0)
    throw Error("Actual Linux authority required");
  const p = (await db.query("SELECT * FROM previews WHERE id=$1", [id]))
    .rows[0];
  const inspect = async (id: string) =>
    JSON.parse(
      (
        await exec("docker", ["inspect", "--format", "{{json .}}", id], {
          timeout: 5000,
          maxBuffer: 65536,
        })
      ).stdout,
    );
  const runner = await inspect(p.runner_id),
    relay = await inspect(p.relay_id);
  assert.equal(runner.Id, p.runner_id);
  assert.equal(relay.Id, p.relay_id);
  assert.equal(runner.Config.Labels["org.codex-harbor.purpose"], "preview");
  assert.equal(runner.HostConfig.NetworkMode, "none");
  assert.equal(relay.HostConfig.NetworkMode, "container:" + runner.Id);
  assert.equal(relay.HostConfig.PidMode, "");
  assert.equal(relay.Mounts.length, 0);
  assert.equal(relay.Config.User, "10003:10003");
  assert.equal(relay.HostConfig.Privileged, false);
  assert.equal(relay.HostConfig.ReadonlyRootfs, true);
  assert.equal(relay.HostConfig.PidsLimit, 32);
  assert.equal(relay.HostConfig.Memory, 134217728);
  assert.equal(Object.keys(relay.NetworkSettings.Ports ?? {}).length, 0);
  const mount = runner.Mounts.find((m: any) => m.Destination === "/workspace");
  assert.equal(mount.RW, p.permission_profile === "workspace-write");
  const common = runner.Mounts.find(
    (m: any) => m.Destination === "/git-common",
  );
  if (common)
    assert.equal(common.RW, p.permission_profile === "workspace-write");
  const probe = await exec(
    "docker",
    [
      "exec",
      runner.Id,
      "node",
      "-e",
      confinementProbe +
        ";assert.equal(fs.existsSync('/home/runner/.codex/auth.json'),false);assert.equal(process.env.HARBOR_MODEL_BASE_URL,undefined);",
    ],
    { timeout: 5000, maxBuffer: 8192 },
  );
  assert.match(probe.stdout, /PASS nonroot/);
  let hostAccepted = false;
  const host = createServer((socket) => {
    hostAccepted = true;
    socket.destroy();
  });
  await new Promise<void>((resolve) => host.listen(0, "0.0.0.0", resolve));
  const port = (host.address() as { port: number }).port;
  const addresses = [
    ...new Set(
      Object.values(networkInterfaces()).flatMap((v) =>
        (v ?? [])
          .filter((a) => !a.internal && a.family === "IPv4")
          .map((a) => a.address),
      ),
    ),
  ];
  assert.ok(addresses.length);
  try {
    for (const [container, uid] of [
      [runner.Id, 10001],
      [relay.Id, 10003],
    ] as const) {
      const source = `const assert=require('assert'),fs=require('fs'),net=require('net'),os=require('os');assert.equal(process.getuid(),${uid});assert.deepEqual(Object.keys(os.networkInterfaces()),['lo']);${uid === 10003 ? "assert.equal(fs.existsSync('/workspace'),false);assert.equal(fs.existsSync('/var/run/docker.sock'),false);" : ""}Promise.all(${JSON.stringify(addresses)}.map(host=>new Promise((resolve,reject)=>{const s=net.connect({host,port:${port}});s.setTimeout(1000);s.on('connect',()=>{s.destroy();reject(Error('Host canary escaped'))});s.on('error',()=>resolve());s.on('timeout',()=>{s.destroy();resolve()})}))).then(()=>console.log('HOST_DENIED')).catch(()=>{process.exitCode=1});`;
      const result = await exec(
        "docker",
        ["exec", container, "node", "-e", source],
        { timeout: 5000, maxBuffer: 8192 },
      );
      assert.match(result.stdout, /HOST_DENIED/);
    }
  } finally {
    await new Promise<void>((resolve) => host.close(() => resolve()));
  }
  assert.equal(
    hostAccepted,
    false,
    "Preview reached owned host-service canary",
  );
  await exec(
    "cc",
    [
      "-O2",
      "tests/terminals/namespace-probe.c",
      "-o",
      path.join(mount.Source, "namespace-probe"),
    ],
    { timeout: 15000, maxBuffer: 4096 },
  );
  const namespace = await exec(
    "docker",
    ["exec", runner.Id, "/workspace/namespace-probe"],
    { timeout: 5000, maxBuffer: 4096 },
  );
  assert.match(namespace.stdout, /namespace and mount denied/);
  if (p.permission_profile === "read-only") {
    await exec(
      "docker",
      [
        "exec",
        runner.Id,
        "node",
        "-e",
        "const assert=require('assert'),fs=require('fs');assert.throws(()=>fs.writeFileSync('/workspace/preview-write-denied','x'),e=>['EROFS','EACCES'].includes(e.code));",
      ],
      { timeout: 5000, maxBuffer: 4096 },
    );
  }
  const result = {
    status: "passed",
    previewId: id,
    generation: Number(p.generation),
    profile: p.permission_profile,
    runner: runner.Id,
    relay: relay.Id,
    runnerImage: runner.Image,
    relayImage: relay.Image,
    selectedMountReadOnly: !mount.RW,
    commonPresent: !!common,
    relayProjectMounts: 0,
    relayNetwork: "exact runner container namespace",
    hostServiceDenied: true,
    metadataPrivateIPv4IPv6Denied: true,
    modelAccount: false,
  };
  await writeFile(
    path.join(artifacts, "boundary-" + id + ".json"),
    JSON.stringify(result, null, 2),
  );
  return result;
}
