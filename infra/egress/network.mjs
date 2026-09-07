import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { resolverProfile } from "./resolver.mjs";
const exec = promisify(execFile);
export const EGRESS_IMAGE = "codex-harbor-egress:1";
const ownerKey = "org.codex-harbor.egress";
const cleanupLocks = new Map();
async function serialCleanup(owner, action) {
  const previous = cleanupLocks.get(owner) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  cleanupLocks.set(owner, current);
  try {
    return await current;
  } finally {
    if (cleanupLocks.get(owner) === current) cleanupLocks.delete(owner);
  }
}
function identity(config) {
  const values = [
    config.instanceId ?? "local",
    config.projectId,
    config.sessionId,
  ];
  if (
    values.some(
      (v) =>
        typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v),
    ) ||
    !Number.isSafeInteger(config.generation) ||
    config.generation < 1
  )
    throw Error("Invalid egress identity");
  return createHash("sha256")
    .update(JSON.stringify([...values, config.generation]))
    .digest("hex");
}
async function docker(args) {
  try {
    return (
      await exec("docker", args, { timeout: 30000, maxBuffer: 128 * 1024 })
    ).stdout.trim();
  } catch {
    throw Error(
      `Restricted egress infrastructure unavailable (${args[0]}${args[0] === "network" || args[0] === "container" ? ` ${args[1]}` : ""})`,
    );
  }
}
async function removeOwned(kind, name, owner, required = true) {
  // An absent object is success, but never remove an object with different ownership.
  const ids = await docker(
    kind === "container"
      ? ["ps", "-aq", "--filter", `name=^/${name}$`]
      : ["network", "ls", "-q", "--filter", `name=^${name}$`],
  );
  if (!ids) return;
  let value;
  try {
    value = JSON.parse(await docker([kind, "inspect", name]))[0];
  } catch (error) {
    const remaining = await docker(
      kind === "container"
        ? ["ps", "-aq", "--filter", `name=^/${name}$`]
        : ["network", "ls", "-q", "--filter", `name=^${name}$`],
    );
    if (!remaining) return;
    throw error;
  }
  const labels = kind === "container" ? value.Config.Labels : value.Labels;
  if (labels?.[ownerKey] !== owner)
    throw Error("Egress resource ownership mismatch");
  try {
    await docker(
      kind === "container" ? ["rm", "-f", name] : ["network", "rm", name],
    );
  } catch (error) {
    const remaining = await docker(
      kind === "container"
        ? ["ps", "-aq", "--filter", `name=^/${name}$`]
        : ["network", "ls", "-q", "--filter", `name=^${name}$`],
    );
    if (remaining && required) throw error;
  }
}

/** Revokes only this exact session generation's labeled resources after its runner is stopped. */
export async function revokeEgress(config) {
  const owner = identity(config);
  return serialCleanup(owner, async () => {
    const containers = (
      await docker([
        "ps",
        "-a",
        "--format",
        "{{.Names}}",
        "--filter",
        `label=${ownerKey}=${owner}`,
      ])
    )
      .split("\n")
      .filter(Boolean);
    for (const name of containers) await removeOwned("container", name, owner);
    const networks = (
      await docker([
        "network",
        "ls",
        "--format",
        "{{.Name}}",
        "--filter",
        `label=${ownerKey}=${owner}`,
      ])
    )
      .split("\n")
      .filter(Boolean);
    for (const name of networks) await removeOwned("network", name, owner);
  });
}

/** Trusted fixed template. No user-supplied host allowlist, images, mounts or Docker flags. */
export async function provisionEgress(config) {
  const owner = identity(config);
  const dnsProfile = resolverProfile(
    process.env.HARBOR_EGRESS_DNS_PROFILE ?? "system",
  );
  const prefix = `harbor-egress-${owner.slice(0, 20)}-${randomBytes(6).toString("hex")}`;
  const networkName = `${prefix}-in`,
    outboundName = `${prefix}-out`,
    proxyName = `${prefix}-proxy`;
  const cleanup = () =>
    serialCleanup(owner, async () => {
      await removeOwned("container", proxyName, owner);
      await removeOwned("network", networkName, owner);
      await removeOwned("network", outboundName, owner);
    });
  try {
    if ((await docker(["info", "--format", "{{.OSType}}"])) !== "linux")
      throw Error("A supported Linux engine is required");
    await docker([
      "network",
      "create",
      "--driver",
      "bridge",
      "--internal",
      "--opt",
      "com.docker.network.bridge.gateway_mode_ipv4=isolated",
      "--label",
      `${ownerKey}=${owner}`,
      networkName,
    ]);
    await docker([
      "network",
      "create",
      "--driver",
      "bridge",
      "--label",
      `${ownerKey}=${owner}`,
      outboundName,
    ]);
    const network = JSON.parse(
      await docker(["network", "inspect", networkName]),
    )[0];
    if (
      !network.Internal ||
      network.EnableIPv6 ||
      network.Options?.["com.docker.network.bridge.gateway_mode_ipv4"] !==
        "isolated" ||
      network.IPAM.Config.length !== 1
    )
      throw Error("Unsupported internal network");
    const subnet = network.IPAM.Config[0].Subnet;
    if (typeof subnet !== "string" || !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(subnet))
      throw Error("Unsupported internal subnet");
    await docker([
      "create",
      "--name",
      proxyName,
      "--label",
      `${ownerKey}=${owner}`,
      "--network",
      networkName,
      "--user",
      "10002:10002",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--ipc",
      "none",
      "--pids-limit",
      "64",
      "--memory",
      "128m",
      "--memory-swap",
      "128m",
      "--cpus",
      "0.5",
      "--log-driver",
      "local",
      "--log-opt",
      "max-size=1m",
      "--log-opt",
      "max-file=1",
      "--log-opt",
      "compress=false",
      "--env",
      `HARBOR_EGRESS_INTERNAL_SUBNET=${subnet}`,
      "--env",
      `HARBOR_EGRESS_DNS_PROFILE=${dnsProfile}`,
      EGRESS_IMAGE,
    ]);
    await docker([
      "network",
      "connect",
      "--gw-priority",
      "1",
      outboundName,
      proxyName,
    ]);
    await docker(["start", proxyName]);
    for (let attempt = 0; attempt < 40; attempt++) {
      const container = JSON.parse(
        await docker(["container", "inspect", proxyName]),
      )[0];
      if (
        !container.State.Running ||
        container.State.Health?.Status === "unhealthy"
      )
        throw Error("Restricted egress proxy unavailable");
      if (container.State.Health?.Status === "healthy") {
        const address =
          container.NetworkSettings.Networks[networkName]?.IPAddress;
        if (!address || !/^\d+\.\d+\.\d+\.\d+$/.test(address))
          throw Error("Restricted egress address unavailable");
        return {
          networkName,
          outboundName,
          proxyName,
          proxyUrl: `http://${address}:3128`,
          modelBaseUrl: `http://${address}:3128/v1`,
          cleanup,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw Error("Restricted egress readiness timeout");
  } catch (error) {
    try {
      await cleanup();
    } catch {
      throw Error(
        "Restricted egress failed; owned resource cleanup also failed",
      );
    }
    throw error;
  }
}
