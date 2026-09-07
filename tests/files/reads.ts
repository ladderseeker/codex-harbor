import { Ajv2020 } from "ajv/dist/2020.js";
import { openapi } from "../../packages/contracts/src/openapi.ts";
import { request as httpsRequest } from "node:https";
import { expect, request } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  writeFile,
  readFile,
  symlink,
  link,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
export async function filesReads(h: any) {
  const { second: workspace, project, command, get, origin, env } = h;
  const base = `/workspaces/${workspace.id}`;
  const db = new pg.Pool({ connectionString: env.DATABASE_URL });
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const validate = (name: string, value: unknown) => {
    const check = ajv.compile({
      $ref: "#/components/schemas/" + name,
      components: openapi.components,
    });
    expect(check(value), JSON.stringify(check.errors)).toBe(true);
  };
  const clients: Awaited<ReturnType<typeof request.newContext>>[] = [];
  const ref = (path: string) =>
    workspace.id + ":" + Buffer.from(path).toString("base64url");
  try {
    const row = (
      await db.query("SELECT canonical_path FROM workspaces WHERE id=$1", [
        workspace.id,
      ])
    ).rows[0];
    const root = row.canonical_path;
    await mkdir(join(root, "bounded"));
    for (let i = 0; i < 205; i++)
      await writeFile(
        join(root, "bounded", String(i).padStart(3, "0") + ".txt"),
        "HARBOR_LITERAL_MATCH\n",
      );
    let tree = await get(
      base + "/files/tree?ref=" + encodeURIComponent(ref("bounded")),
    );
    const treeCheck = ajv.compile({
      ...openapi.paths["/workspaces/{id}/files/tree"].get.responses["200"]
        .content["application/json"].schema,
      components: openapi.components,
    });
    expect(treeCheck(tree), JSON.stringify(treeCheck.errors)).toBe(true);
    validate("GitStatus", await get(base + "/git/status"));
    validate("Capabilities", await get("/capabilities"));
    expect(tree.entries).toHaveLength(200);
    expect(tree.cursor).toBeTruthy();
    const next = await get(
      base +
        "/files/tree?ref=" +
        encodeURIComponent(ref("bounded")) +
        "&cursor=" +
        encodeURIComponent(tree.cursor),
    );
    expect(next.entries).toHaveLength(5);
    expect(
      new Set([...tree.entries, ...next.entries].map((e: any) => e.ref)).size,
    ).toBe(205);
    const searchRoute =
      base +
      "/files/search?ref=" +
      encodeURIComponent(ref("bounded")) +
      "&mode=text&q=HARBOR_LITERAL_MATCH";
    let search = await get(searchRoute);
    expect(search.matches).toHaveLength(200);
    expect(search.cursor).toBeTruthy();
    const more = await get(
      searchRoute + "&cursor=" + encodeURIComponent(search.cursor),
    );
    expect(more.matches).toHaveLength(5);
    expect(
      new Set([...search.matches, ...more.matches].map((e: any) => e.ref)).size,
    ).toBe(205);
    await writeFile(join(root, "binary"), Buffer.from([0, 255, 0]));
    await writeFile(join(root, "oversized"), Buffer.alloc(1048577, 97));
    await writeFile(join(root, "safe.txt"), "private fixture content\n");
    await symlink("/var/run/docker.sock", join(root, "escape"));
    await link(join(root, "safe.txt"), join(root, "hard"));
    expect(
      (
        await get(
          base + "/files/content?ref=" + encodeURIComponent(ref("binary")),
        )
      ).status,
    ).toBe("binary");
    expect(
      (
        await get(
          base + "/files/content?ref=" + encodeURIComponent(ref("oversized")),
        )
      ).reason,
    ).toBe("FILE_TOO_LARGE");
    expect(
      (
        await get(
          base + "/files/content?ref=" + encodeURIComponent(ref("hard")),
        )
      ).reason,
    ).toBe("FILE_HARDLINK");
    await rm(join(root, "hard"));
    const created = await command("/security/api-tokens", {
      name: "P004 cookie-free reader",
      projectIds: [project.id],
      scopes: ["files:read"],
      permissionProfile: "read-only",
      expiresInDays: 1,
    });
    expect(created.status()).toBe(200);
    const token = await created.json();
    const reader = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: "Bearer " + token.secret },
    });
    clients.push(reader);
    const anonymous = await request.newContext({ ignoreHTTPSErrors: true });
    clients.push(anonymous);
    const contentRoute =
      origin +
      "/api/v1" +
      base +
      "/files/content?ref=" +
      encodeURIComponent(ref("safe.txt"));
    const content = await (await reader.get(contentRoute)).json();
    validate("FileContent", content);
    const downloadRoute =
      origin +
      "/api/v1" +
      base +
      "/files/download?ref=" +
      encodeURIComponent(ref("safe.txt")) +
      "&revision=" +
      content.revision;
    expect((await reader.get(downloadRoute)).status()).toBe(200);
    expect((await anonymous.get(downloadRoute)).status()).toBe(401);
    expect(
      (await reader.get(origin + "/api/v1" + base + "/git/status")).status(),
    ).toBe(403);
    expect(
      (
        await reader.post(origin + "/api/v1" + base + "/files/save", {
          headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
          data: {
            ref: ref("safe.txt"),
            expectedRevision: content.revision,
            text: "denied",
          },
        })
      ).status(),
    ).toBe(403);
    const otherProjectResponse = await command("/projects", {
      name: "Other file authority",
      rootId: h.rootId,
      path: "other",
      create: true,
    });
    expect(
      otherProjectResponse.status(),
      await otherProjectResponse.text(),
    ).toBe(200);
    const otherProject = (await otherProjectResponse.json()).project;
    const otherWorkspace = (
      await get(`/projects/${otherProject.id}/workspaces`)
    ).workspaces[0];
    expect(
      (
        await reader.get(
          origin + `/api/v1/workspaces/${otherWorkspace.id}/files/tree`,
        )
      ).status(),
    ).toBe(403);
    const events: string[] = [];
    let streamClosed = false;
    const stream = httpsRequest(
      origin +
        "/api/v1" +
        base +
        "/files/events?fileRef=" +
        encodeURIComponent(ref("bounded/000.txt")),
      {
        rejectUnauthorized: false,
        headers: { Authorization: "Bearer " + token.secret },
      },
      (response) => {
        response.on("data", (bytes) => {
          events.push(bytes.toString());
          if (events.join("").length > 65536) stream.destroy();
        });
        response.on("end", () => {
          streamClosed = true;
        });
        response.on("close", () => {
          streamClosed = true;
        });
      },
    );
    stream.on("error", () => {
      streamClosed = true;
    });
    stream.end();
    try {
      await expect
        .poll(() => events.join(""), { timeout: 10000 })
        .toContain("event: heartbeat");
      // The subscription must observe an external directory change, then recover
      // a live replay gap without treating missing events as a complete history.
      await writeFile(
        join(root, "bounded", "000.txt"),
        "changed open nested file\n",
      );
      await expect
        .poll(() => events.join(""), { timeout: 15000 })
        .toContain("file.changed");
      await writeFile(
        join(root, "watch-created.txt"),
        "external watcher probe\n",
      );
      await expect
        .poll(() => events.join(""), { timeout: 15000 })
        .toContain("directory.changed");
      const priorResyncs = events.join("").split("event: resync").length - 1;
      await db.query(
        "UPDATE workspaces SET files_revision=files_revision+1001 WHERE id=$1",
        [workspace.id],
      );
      await db.query("DELETE FROM file_events WHERE workspace_id=$1", [
        workspace.id,
      ]);
      await expect
        .poll(() => events.join("").split("event: resync").length - 1, {
          timeout: 10000,
        })
        .toBeGreaterThan(priorResyncs);
      const priorChanges =
        events.join("").split("directory.changed").length - 1;
      await rm(join(root, "watch-created.txt"));
      await expect
        .poll(() => events.join("").split("directory.changed").length - 1, {
          timeout: 15000,
        })
        .toBeGreaterThan(priorChanges);
      expect(
        (
          await command(`/security/api-tokens/${token.token.id}/revoke`, {})
        ).status(),
      ).toBe(200);
      await expect.poll(() => streamClosed, { timeout: 10000 }).toBe(true);
      expect((await reader.get(downloadRoute)).status()).toBe(401);
    } finally {
      stream.destroy();
    }
    for (const cause of ["revoke", "expire"]) {
      const writerToken = await (
        await command("/security/api-tokens", {
          name: "P004 queued writer",
          projectIds: [project.id],
          scopes: ["files:read", "files:write"],
          permissionProfile: "workspace-write",
          expiresInDays: 1,
        })
      ).json();
      const writer = await request.newContext({
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { Authorization: "Bearer " + writerToken.secret },
      });
      clients.push(writer);
      h.supervisor.kill("SIGSTOP");
      try {
        const accepted = await writer.post(
          origin + "/api/v1" + base + "/files/save",
          {
            headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
            data: {
              ref: ref("safe.txt"),
              expectedRevision: content.revision,
              text: "MUST_NOT_DISPATCH",
            },
          },
        );
        expect(accepted.status(), await accepted.text()).toBe(202);
        const operation = (await accepted.json()).operation;
        if (cause === "revoke")
          expect(
            (
              await command(
                `/security/api-tokens/${writerToken.token.id}/revoke`,
                {},
              )
            ).status(),
          ).toBe(200);
        else
          await db.query(
            "UPDATE api_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
            [writerToken.token.id],
          );
        h.supervisor.kill("SIGCONT");
        await expect
          .poll(
            async () =>
              (await get(base + "/file-operations/" + operation.id)).operation
                .state,
            { timeout: 30000 },
          )
          .toBe("failed");
        expect(await readFile(join(root, "safe.txt"), "utf8")).toBe(
          "private fixture content\n",
        );
        expect(
          (
            await db.query("SELECT epoch FROM file_operations WHERE id=$1", [
              operation.id,
            ])
          ).rows[0].epoch,
        ).toBeNull();
        expect((await writer.get(contentRoute)).status()).toBe(401);
      } finally {
        h.supervisor.kill("SIGCONT");
      }
    }
    const limitedToken = await (
      await command("/security/api-tokens", {
        name: "P004 profile ceiling",
        projectIds: [project.id],
        scopes: ["files:read", "files:write"],
        permissionProfile: "read-only",
        expiresInDays: 1,
      })
    ).json();
    const limited = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: "Bearer " + limitedToken.secret },
    });
    clients.push(limited);
    expect(
      (
        await limited.post(origin + "/api/v1" + base + "/files/save", {
          headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
          data: {
            ref: ref("safe.txt"),
            expectedRevision: content.revision,
            text: "ceiling denied",
          },
        })
      ).status(),
    ).toBe(403);
    await db.query(
      `INSERT INTO file_operations(id,workspace_id,project_id,actor_hash,kind,state,payload,payload_bytes,request_hash) SELECT gen_random_uuid(),workspace_id,project_id,actor_hash,'save','failed',NULL,0,request_hash FROM (SELECT * FROM file_operations WHERE workspace_id=$1 LIMIT 1) seed CROSS JOIN generate_series(1,128-(SELECT count(*)::int FROM file_operations WHERE workspace_id=$1))`,
      [workspace.id],
    );
    expect(
      (
        await command(base + "/files/save", {
          ref: ref("safe.txt"),
          expectedRevision: content.revision,
          text: "quota denied before effect",
        })
      ).status(),
    ).toBe(429);
    expect(await readFile(join(root, "safe.txt"), "utf8")).toBe(
      "private fixture content\n",
    );
    expect((await command(base + "/archive", {})).status()).toBe(200);
    expect(
      (
        await command(base + "/files/save", {
          ref: ref("safe.txt"),
          expectedRevision: content.revision,
          text: "archived denied",
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await get(
          base + "/files/content?ref=" + encodeURIComponent(ref("safe.txt")),
        )
      ).text,
    ).toBe("private fixture content\n");
  } finally {
    await Promise.all(clients.map((client) => client.dispose()));
    await db.end();
  }
}
