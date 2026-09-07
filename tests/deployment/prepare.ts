/** Disposable production-admission fixture. Fixture mode is never enabled in Harbor. */
import { xfsFixture } from "../isolation/xfs-fixture.ts";
import { writeFile, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
const fixture = await xfsFixture();
const freePort = async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};
const [httpsPort, oidcPort, apiPort, databasePort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
]);
const id = "deploy-" + randomUUID().slice(0, 8),
  control = fixture.control;
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    control + "/tls.key",
    "-out",
    control + "/tls.crt",
    "-days",
    "2",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
for (const file of ["tls.key", "tls.crt"])
  await chmod(control + "/" + file, 0o600);
execFileSync(
  "ssh-keygen",
  ["-t", "ed25519", "-N", "", "-f", control + "/backup-key"],
  { stdio: "ignore" },
);
await writeFile(control + "/known-hosts", "", { mode: 0o600 });
await writeFile(control + "/restic-password", randomUUID() + randomUUID(), {
  mode: 0o600,
});
const c = {
  instance: id,
  origin: `https://localhost:${httpsPort}`,
  oidcIssuer: `https://127.0.0.1:${oidcPort}`,
  oidcClientId: "p009-test",
  ownerSubject: "owner",
  apiUid: Number(process.env.HARBOR_DEPLOY_TEST_UID ?? 22009),
  apiPort,
  databasePort,
  xfsProfile: fixture.profile,
  roots: JSON.parse(fixture.env.HARBOR_PROJECT_ROOTS),
  tls: {
    mode: "files",
    certificate: control + "/tls.crt",
    key: control + "/tls.key",
  },
  extraCaFile: control + "/tls.crt",
  dnsProfile: "cloudflare-doh",
  permissionCeiling: "workspace-write",
  backup: {
    host: "127.0.0.1",
    port: 2229,
    user: "harborbackup",
    path: "/repository",
    sshKey: control + "/backup-key",
    knownHosts: control + "/known-hosts",
    passwordFile: control + "/restic-password",
  },
};
await writeFile(control + "/deployment.json", JSON.stringify(c), {
  mode: 0o600,
});
await writeFile(
  (process.env.HARBOR_DEPLOY_TEST_TOOLS ?? "/var/lib/harbor-p009-tools") +
    "/admission.json",
  JSON.stringify({
    id,
    control,
    config: control + "/deployment.json",
    base: fixture.base,
    ids: fixture.ids,
  }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    instance: id,
    config: control + "/deployment.json",
    control,
  }),
);
