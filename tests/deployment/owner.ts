import { request } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const manifest = JSON.parse(
  await readFile(
    (process.env.HARBOR_DEPLOY_TEST_TOOLS ?? "/var/lib/harbor-p009-tools") +
      "/admission.json",
    "utf8",
  ),
);
const c = JSON.parse(await readFile(manifest.config, "utf8"));
const api = await request.newContext();
try {
  const login = await api.get(c.origin + "/auth/login", { maxRedirects: 0 });
  assert.equal(login.status(), 302);
  const authorize = new URL(login.headers().location!);
  const choice = await api.get(
    c.oidcIssuer +
      "/choose?query=" +
      encodeURIComponent(authorize.searchParams.toString()) +
      "&subject=" +
      encodeURIComponent(c.ownerSubject),
    { maxRedirects: 0 },
  );
  assert.equal(choice.status(), 302);
  assert.equal(
    (await api.get(choice.headers().location!, { maxRedirects: 0 })).status(),
    302,
  );
  const me = await (await api.get(c.origin + "/api/v1/me")).json();
  const created = await api.post(c.origin + "/api/v1/projects", {
    headers: {
      Origin: c.origin,
      "x-csrf-token": me.csrfToken,
      "Idempotency-Key": Date.now() + ":" + randomUUID(),
    },
    data: {
      rootId: c.roots[0].id,
      name: "Deployment source",
      path: "deployment-source",
      create: true,
    },
  });
  assert.equal(created.status(), 200, await created.text());
  const project = (await created.json()).project;
  // Protected run-owned evidence retains the test cookie for later revocation assertions.
  await writeFile(
    manifest.control + "/owner.json",
    JSON.stringify({ project, storage: await api.storageState() }),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      ownerAuthenticated: true,
      projectCreatedByActualApi: true,
      projectId: project.id,
    }),
  );
} finally {
  await api.dispose();
}
