/** Real lower-ID upgrade. No promotion, backup or installed-service mutation. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { createPool, migrate } from "../../packages/storage/src/index.ts";

const predecessor = "717ca45";
test(
  "P011 fresh schema and exact 014-after-016 predecessor PostgreSQL upgrade",
  { timeout: 90000 },
  async () => {
    const name = "harbor-p011-upgrade-" + randomUUID();
    const password = randomBytes(24).toString("hex");
    const docker = (args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env, POSTGRES_PASSWORD: password },
        stdio: ["ignore", "pipe", "pipe"],
      });
    let old: ReturnType<typeof createPool> | undefined;
    let fresh: ReturnType<typeof createPool> | undefined;
    try {
      docker([
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--label",
        "org.codex-harbor.test=" + name,
        "-e",
        "POSTGRES_PASSWORD",
        "-p",
        "127.0.0.1::5432",
        "postgres:17.6-bookworm",
      ]);
      let port: string | undefined;
      for (let attempt = 0; attempt < 50; attempt++) {
        const published = JSON.parse(
          docker([
            "inspect",
            "--format",
            "{{json .NetworkSettings.Ports}}",
            name,
          ]),
        );
        port = published["5432/tcp"]?.[0]?.HostPort;
        if (port) break;
        await sleep(100);
      }
      assert.ok(
        port,
        "Owned PostgreSQL loopback port was not published within five seconds",
      );
      const base = `postgres://postgres:${password}@127.0.0.1:${port}/`;
      old = createPool(base + "postgres");
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try {
          await old.query("SELECT 1");
          ready = true;
          break;
        } catch {
          await sleep(100);
        }
      }
      assert.equal(ready, true);
      await old.query("CREATE DATABASE fresh_schema");
      fresh = createPool(base + "fresh_schema");
      await migrate(fresh);
      const directory = "packages/storage/src/migrations/";
      const versions = execFileSync(
        "git",
        ["ls-tree", "--name-only", predecessor, directory],
        { encoding: "utf8" },
      ).trim();
      assert.ok(versions);
      const paths = execFileSync(
        "git",
        ["ls-tree", "-r", "--name-only", predecessor, directory],
        { encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter((p) => p.endsWith(".sql"))
        .sort();
      assert.ok(paths.some((p) => p.endsWith("016_installed_modules.sql")));
      assert.ok(!paths.some((p) => p.endsWith("014_previews.sql")));
      await old.query(
        "CREATE TABLE harbor_migrations(version text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const exact: Record<string, string> = {};
      for (const path of paths) {
        const sql = execFileSync("git", ["show", `${predecessor}:${path}`], {
          encoding: "utf8",
        });
        const digest = createHash("sha256").update(sql).digest("hex");
        const version = path.split("/").at(-1)!;
        exact[version] = digest;
        await old.query("BEGIN");
        await old.query(sql);
        await old.query(
          "INSERT INTO harbor_migrations(version,digest) VALUES($1,$2)",
          [version, digest],
        );
        await old.query("COMMIT");
      }
      const project = randomUUID();
      await old.query(
        "INSERT INTO projects(id,name,root_id,relative_path) VALUES($1,'Retained predecessor project',$2,'owned')",
        [project, randomUUID()],
      );
      await migrate(old);
      const rows = (
        await old.query(
          "SELECT version,digest FROM harbor_migrations ORDER BY version",
        )
      ).rows;
      assert.equal(rows.length, paths.length + 1);
      for (const [version, digest] of Object.entries(exact))
        assert.equal(rows.find((r) => r.version === version)?.digest, digest);
      assert.equal(
        (await old.query("SELECT name FROM projects WHERE id=$1", [project]))
          .rows[0].name,
        "Retained predecessor project",
      );
      assert.deepEqual(
        rows,
        (
          await fresh.query(
            "SELECT version,digest FROM harbor_migrations ORDER BY version",
          )
        ).rows,
      );
      assert.equal(
        Number(
          (await old.query("SELECT count(*) FROM previews")).rows[0].count,
        ),
        0,
      );
      const local = (await readdir(directory))
        .filter((p) => p.endsWith(".sql"))
        .sort();
      for (const row of rows)
        assert.equal(
          row.digest,
          createHash("sha256")
            .update(await readFile(directory + row.version))
            .digest("hex"),
        );
      assert.equal(local.length, rows.length);
    } finally {
      await fresh?.end();
      await old?.end();
      try {
        docker(["rm", "--force", name]);
      } catch {}
    }
  },
);
