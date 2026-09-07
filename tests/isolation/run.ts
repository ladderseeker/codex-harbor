if (process.argv.includes("--workspaces")) {
  await import("../workspaces/linux.ts");
  process.exit(process.exitCode ?? 0);
}
if (process.platform === "linux" && process.env.HARBOR_TEST_XFS_MOUNT) {
  await import("./xfs.js");
  process.exit(0);
}
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  stat,
  realpath,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import {
  runnerArguments,
  RUNNER_IMAGE,
  startConfinedRunner,
} from "../../infra/runner/launcher.js";
import { revokeEgress } from "../../infra/egress/network.mjs";
import { CodexAdapter } from "../../packages/codex-adapter/src/index.js";
const exec = promisify(execFile);
const run = async (args: string[]) =>
  exec("docker", args, { timeout: 120_000, maxBuffer: 1024 * 1024 });
const id = randomUUID();
const root = await realpath(await mkdtemp(join(tmpdir(), "harbor-isolation-")));
const workspace = join(root, "project");
const volume = `harbor-test-${id}-${id}-codex`;
const authority = await realpath(
  await mkdtemp(join(tmpdir(), "harbor-isolation-authority-")),
);
let adapter: CodexAdapter | undefined;
let adapter2: CodexAdapter | undefined;
let prerequisites = false;
try {
  await mkdir(workspace);
  await writeFile(join(root, "control-plane-canary"), "not mounted");
  process.env.HARBOR_PROJECT_ROOTS = JSON.stringify([
    { id: "test", name: "test", path: root },
  ]);
  assert.equal(
    (await run(["info", "--format", "{{.OSType}}"])).stdout.trim(),
    "linux",
  );
  await run(["image", "inspect", RUNNER_IMAGE]);
  await run([
    "volume",
    "create",
    "--label",
    "org.codex-harbor.owner=native-history",
    "--label",
    "org.codex-harbor.instance=test",
    "--label",
    `org.codex-harbor.session=${id}`,
    volume,
  ]);
  prerequisites = true;
  const identity = await stat(workspace, { bigint: true });
  const config = {
    workspaceDevice: identity.dev.toString(),
    workspaceInode: identity.ino.toString(),
    sessionId: id,
    projectId: id,
    workspacePath: workspace,
    generation: 1,
    instanceId: "test",
  };
  const args = await runnerArguments(config);
  const image = args.indexOf(RUNNER_IMAGE);
  const probe = `const fs=require('fs'),net=require('net');const assert=require('assert');assert.equal(process.getuid(),10001);assert.throws(()=>fs.writeFileSync('/forbidden','x'));assert.throws(()=>fs.writeFileSync('/workspace/forbidden','x'));for(const p of ['/var/run/docker.sock','/control-plane-canary','/proc/1/root/control-plane-canary'])assert.equal(fs.existsSync(p),false);const status=fs.readFileSync('/proc/self/status','utf8');assert.match(status,/CapEff:\\s+0+/);assert.match(status,/NoNewPrivs:\\s+1/);assert.equal(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'128');assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'536870912');Promise.all(['169.254.169.254','10.0.0.1','1.1.1.1','2606:4700:4700::1111'].map(host=>new Promise((resolve,reject)=>{const s=net.connect({host,port:443});s.setTimeout(1000);s.on('connect',()=>{s.destroy();reject(Error('egress escaped'))});s.on('error',()=>resolve());s.on('timeout',()=>{s.destroy();resolve()})}))).then(()=>console.log('PASS nonroot/read-only/capabilities/no-new-privileges/cgroup/IPv4/IPv6 isolation')).catch(e=>{console.error(e.message);process.exitCode=1});`;
  const result = await run([...args.slice(0, image + 1), "node", "-e", probe]);
  console.log(result.stdout.trim());
  process.env.HARBOR_LAUNCHER_STATE_DIR = authority;
  let disconnected = false;
  adapter = new CodexAdapter(await startConfinedRunner(config), {
    onDisconnect: () => {
      disconnected = true;
    },
  });
  const initialized = await adapter.initialize();
  assert.equal(initialized.platformOs, "linux");
  assert.equal((await adapter.readAccount()).account, null);
  const container = `harbor-test-${id}-1`;
  await run(["exec", container, "node", "-e", probe]);
  const gatewayProbe = `const http=require('http'),assert=require('assert');const base=new URL(process.env.HARBOR_MODEL_BASE_URL);async function request(path,host=base.host,method='POST'){return new Promise((resolve,reject)=>{const q=http.request({hostname:base.hostname,port:base.port,path,method,headers:{Host:host,'Content-Type':'application/json'}},r=>{r.resume();resolve(r.statusCode)});q.setTimeout(15000,()=>q.destroy(Error('gateway timeout')));q.on('error',reject);q.end('{}')})};(async()=>{for(const [path,host]of[['/v1/responses','www.cloudflare.com'],['http://www.cloudflare.com/','www.cloudflare.com'],['/v1/responses?url=https://example.com',base.host]])assert.equal(await request(path,host),403);assert.equal(await request('/v1/responses'),401);console.log('PASS fixed model gateway: upstream401; fronting, absolute target and query denied')})().catch(e=>{console.error(e.message);process.exitCode=1});`;
  console.log(
    (await run(["exec", container, "node", "-e", gatewayProbe])).stdout.trim(),
  );
  const modelEgressAvailable = true;
  adapter2 = new CodexAdapter(
    await startConfinedRunner({ ...config, generation: 2 }),
  );
  await adapter2.initialize();
  for (let i = 0; i < 20 && !disconnected; i++)
    await new Promise((r) => setTimeout(r, 50));
  assert.equal(disconnected, true);
  await assert.rejects(
    startConfinedRunner({ ...config, generation: 1 }),
    /Stale/,
  );
  console.log(
    "PASS actual Linux Codex initialization and generation revocation",
  );
  if (!modelEgressAvailable)
    console.error(
      "UNVERIFIED: approved model egress was refused by DNS/address validation in this environment.",
    );
  console.error(
    "UNVERIFIED: persistent disk hard quotas and authenticated Codex approval/cancel smoke remain mandatory.",
  );
  process.exitCode = 2;
} catch (error) {
  if ((error as { stderr?: string }).stderr)
    console.error((error as { stderr: string }).stderr.slice(0, 2000));
  console.error(
    "UNVERIFIED Linux isolation:",
    error instanceof Error
      ? error.message.replace(
          /Command failed:[\s\S]*/,
          "required Docker image or execution prerequisite unavailable",
        )
      : "failed",
  );
  process.exitCode = prerequisites ? 1 : 2;
} finally {
  adapter?.close();
  adapter2?.close();
  await new Promise((r) => setTimeout(r, 500));
  for (const generation of [1, 2])
    await revokeEgress({
      instanceId: "test",
      projectId: id,
      sessionId: id,
      generation,
    }).catch(() => {
      console.error("Owned test egress cleanup incomplete");
      process.exitCode = 1;
    });
  await run(["volume", "rm", volume]).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
  await rm(authority, { recursive: true, force: true });
}
