import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { releaseImage } from "../deploy/images.mjs";
import { FRAME_BYTES, type RelayInput, type RelayOutput } from "./protocol.ts";
const exec = promisify(execFile);
export const RELAY_IMAGE = "codex-harbor-preview-relay:24.11.1-p011";
export type RelayIdentity = {
  id: string;
  generation: number;
  instanceId: string;
  port: number;
};
const env = () => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  DOCKER_HOST: process.env.DOCKER_HOST,
  DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
});
function name(c: RelayIdentity) {
  if (
    !/^[a-f0-9-]{36}$/.test(c.id) ||
    !Number.isSafeInteger(c.generation) ||
    c.generation < 1 ||
    !/^[a-z0-9_-]{1,64}$/.test(c.instanceId) ||
    !Number.isInteger(c.port) ||
    c.port < 1024 ||
    c.port > 65535
  )
    throw Error("Invalid relay identity");
  return `harbor-preview-relay-${c.id}-${c.generation}`;
}
async function listed(c: RelayIdentity) {
  return (
    await exec("docker", ["ps", "-aq", "--filter", `name=^/${name(c)}$`], {
      env: env(),
      timeout: 5000,
      maxBuffer: 4096,
    })
  ).stdout.trim();
}
async function inspectExact(c: RelayIdentity) {
  const n = name(c),
    listing = await listed(c);
  if (!listing) return;
  let raw: string;
  try {
    raw = (
      await exec("docker", ["inspect", "--format", "{{json .}}", listing], {
        env: env(),
        timeout: 5000,
        maxBuffer: 65536,
      })
    ).stdout;
  } catch (error) {
    // --rm may remove this exact container between listing and inspection.
    // A successful fresh absence check is required; daemon errors or any
    // replacement at the reserved name remain unconfirmed.
    if (!(await listed(c))) return;
    throw error;
  }
  const r = JSON.parse(raw);
  if (
    !/^[a-f0-9]{64}$/.test(r.Id) ||
    r.Name !== "/" + n ||
    r.Config.Labels?.["org.codex-harbor.owner"] !== "preview-relay" ||
    r.Config.Labels?.["org.codex-harbor.instance"] !== c.instanceId ||
    r.Config.Labels?.["org.codex-harbor.preview"] !== c.id ||
    r.Config.Labels?.["org.codex-harbor.generation"] !== String(c.generation)
  )
    throw Error("Relay ownership mismatch");
  return r;
}
export async function retireRelay(c: RelayIdentity) {
  const r = await inspectExact(c);
  if (!r) return;
  try {
    await exec("docker", ["rm", "--force", r.Id], {
      env: env(),
      timeout: 15000,
      maxBuffer: 4096,
    });
  } catch (error) {
    if (!(await inspectExact(c))) return;
    throw error;
  }
  if (await inspectExact(c)) throw Error("Relay retirement unconfirmed");
}

export class PreviewRelay extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private ended = false;
  private closing?: Promise<void>;
  readonly ready: Promise<void>;
  constructor(
    readonly child: ChildProcessWithoutNullStreams,
    readonly runnerId: string,
    readonly relayId: string,
    private retire: () => Promise<void>,
  ) {
    super();
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(Error("Relay initialization timeout"));
        this.child.kill("SIGTERM");
      }, 5000);
      const ready = (f: RelayOutput) => {
        if (f.type === "ready") {
          clearTimeout(timeout);
          this.off("frame", ready);
          resolve();
        }
      };
      this.on("frame", ready);
      this.once("closed", () => {
        clearTimeout(timeout);
        reject(Error("Relay closed"));
      });
    });
    this.ready.catch(() => undefined);
    child.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const at = this.buffer.indexOf(10);
        if (at < 0) {
          if (this.buffer.length > FRAME_BYTES) this.abort();
          break;
        }
        if (at > FRAME_BYTES) {
          this.abort();
          break;
        }
        try {
          const frame = JSON.parse(
            this.buffer.subarray(0, at).toString("utf8"),
          );
          this.buffer = this.buffer.subarray(at + 1);
          this.emit("frame", frame as RelayOutput);
        } catch {
          this.abort();
          break;
        }
      }
    });
    // Project responses and private protocol are never logged.
    child.stderr.on("data", () => undefined);
    child.on("error", () => this.finish());
    child.on("close", () => this.finish());
  }
  private finish() {
    if (this.ended) return;
    this.ended = true;
    this.emit("closed");
  }
  private abort() {
    this.child.kill("SIGTERM");
    this.finish();
  }
  send(frame: RelayInput) {
    if (this.ended) throw Error("Relay is closed");
    const data = JSON.stringify(frame) + "\n";
    if (
      Buffer.byteLength(data) > FRAME_BYTES ||
      this.child.stdin.writableLength + Buffer.byteLength(data) > 256 * 1024
    )
      throw Error("Relay backlog limit");
    this.child.stdin.write(data);
  }
  async close() {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      this.child.stdin.end();
      await this.retire();
      this.child.kill("SIGTERM");
      this.finish();
    })();
    try {
      await this.closing;
    } catch (error) {
      this.closing = undefined;
      throw error;
    }
  }
}
export async function launchRelay(c: RelayIdentity, fixture = false) {
  const n = name(c);
  if (fixture) {
    if (
      process.env.NODE_ENV !== "test" ||
      process.env.HARBOR_FIXTURE_MODE !== "private-test"
    )
      throw Error("Private relay fixture disabled");
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./relay.ts", import.meta.url))],
      {
        stdio: "pipe",
        env: { PATH: process.env.PATH, HARBOR_RELAY_PORT: String(c.port) },
      },
    );
    const relay = new PreviewRelay(
      child,
      "fixture-preview-" + c.id,
      "fixture-relay-" + c.id,
      async () => {
        child.kill("SIGTERM");
        await new Promise<void>((resolve, reject) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          const t = setTimeout(
            () => reject(Error("Fixture relay retirement unconfirmed")),
            5000,
          );
          child.once("close", () => {
            clearTimeout(t);
            resolve();
          });
        });
      },
    );
    try {
      await relay.ready;
      return relay;
    } catch (error) {
      await relay.close();
      throw error;
    }
  }
  const runnerName = `harbor-${c.instanceId}-preview-${c.id}-${c.generation}`;
  const runner = JSON.parse(
    (
      await exec("docker", ["inspect", "--format", "{{json .}}", runnerName], {
        env: env(),
        timeout: 5000,
        maxBuffer: 65536,
      })
    ).stdout,
  );
  if (
    !/^[a-f0-9]{64}$/.test(runner.Id) ||
    runner.Name !== "/" + runnerName ||
    !runner.State.Running ||
    runner.Config.Labels?.["org.codex-harbor.owner"] !== "runner" ||
    runner.Config.Labels?.["org.codex-harbor.instance"] !== c.instanceId ||
    runner.Config.Labels?.["org.codex-harbor.purpose"] !== "preview" ||
    runner.HostConfig.NetworkMode !== "none" ||
    runner.HostConfig.Privileged ||
    runner.HostConfig.PidMode === "host" ||
    Object.keys(runner.NetworkSettings.Ports ?? {}).length
  )
    throw Error("Exact confined preview runner required");
  const args = [
    "create",
    "--rm",
    "-i",
    "--name",
    n,
    "--label",
    "org.codex-harbor.owner=preview-relay",
    "--label",
    "org.codex-harbor.instance=" + c.instanceId,
    "--label",
    "org.codex-harbor.preview=" + c.id,
    "--label",
    "org.codex-harbor.generation=" + c.generation,
    "--network=container:" + runner.Id,
    "--user=10003:10003",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--security-opt",
    "seccomp=" +
      fileURLToPath(new URL("../runner/seccomp.json", import.meta.url)),
    "--pids-limit=32",
    "--memory=134217728",
    "--memory-swap=134217728",
    "--cpus=0.5",
    "--ipc=none",
    "--log-driver=none",
    "--env",
    "HARBOR_RELAY_PORT=" + c.port,
    releaseImage("previewRelay", RELAY_IMAGE),
  ];
  const id = (
    await exec("docker", args, { env: env(), timeout: 15000, maxBuffer: 4096 })
  ).stdout.trim();
  if (!/^[a-f0-9]{64}$/.test(id)) {
    await retireRelay(c);
    throw Error("Relay identity unavailable");
  }
  try {
    const created = await inspectExact(c);
    if (
      created?.Id !== id ||
      created.HostConfig.NetworkMode !== "container:" + runner.Id ||
      created.Mounts.length ||
      created.HostConfig.PidMode ||
      created.HostConfig.Privileged
    )
      throw Error("Relay confinement mismatch");
  } catch (error) {
    await retireRelay(c);
    throw error;
  }
  const child = spawn("docker", ["start", "--attach", "--interactive", id], {
    env: env(),
    stdio: "pipe",
  });
  const relay = new PreviewRelay(child, runner.Id, id, () => retireRelay(c));
  try {
    await relay.ready;
    return relay;
  } catch (error) {
    await relay.close();
    throw error;
  }
}
