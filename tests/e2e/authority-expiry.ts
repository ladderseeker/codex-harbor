import { expect } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  requireAuthority,
  authenticateBrowser,
  type AuthorityConfig,
} from "../../packages/policy/src/authority.ts";
import { digest, HarborError } from "../../packages/policy/src/index.ts";
/** Actual PostgreSQL row-lock waits against production helpers, inside the owned E2E DB. */
export async function authorityExpiry(
  db: Pool,
  c: AuthorityConfig,
  projectId: string,
) {
  const pin = digest(c.HARBOR_OIDC_ISSUER + "\0" + c.HARBOR_OWNER_SUBJECT);
  for (const kind of ["token", "browser-absolute", "browser-idle"] as const) {
    const id = randomUUID(),
      hash = "lock-expiry-" + id,
      hold = await db.connect();
    let waiting: Promise<unknown> | undefined;
    try {
      if (kind === "token")
        await db.query(
          "INSERT INTO api_tokens(id,name,verifier,prefix,identity_pin,instance_id,scopes,project_ids,permission_profile,expires_at) VALUES($1,'Lock expiry regression',$2,'test',$3,$4,ARRAY['execute'],$5,'read-only',clock_timestamp()+interval '1500 milliseconds')",
          [
            id,
            hash,
            pin,
            process.env.HARBOR_INSTANCE_ID ?? "harbor",
            [projectId],
          ],
        );
      else
        await db.query(
          "INSERT INTO browser_sessions(hash,csrf,expires_at,last_seen,identity_pin) VALUES($1,'test',clock_timestamp()+($2*interval '1 second'),clock_timestamp(),$3)",
          [hash, kind === "browser-absolute" ? 1.5 : 60, pin],
        );
      await hold.query("BEGIN");
      await hold.query(
        kind === "token"
          ? "SELECT id FROM api_tokens WHERE id=$1 FOR UPDATE"
          : "SELECT hash FROM browser_sessions WHERE hash=$1 FOR UPDATE",
        [kind === "token" ? id : hash],
      );
      const settings = {
        ...c,
        HARBOR_IDLE_SECONDS:
          kind === "browser-idle" ? 1 : c.HARBOR_IDLE_SECONDS,
      };
      waiting = (
        kind === "browser-idle"
          ? authenticateBrowser(db, settings, hash)
          : requireAuthority(
              db,
              kind === "token" ? "pat:" + id : hash,
              settings,
            )
      ).then(
        () => "accepted",
        (error) =>
          error instanceof HarborError ? error.statusCode : "unexpected",
      );
      await expect
        .poll(async () =>
          Number(
            (
              await db.query(
                "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND (query LIKE 'SELECT id FROM api_tokens WHERE id=%FOR SHARE%' OR query LIKE 'SELECT hash FROM browser_sessions WHERE hash=%FOR%')",
              )
            ).rows[0].count,
          ),
        )
        .toBeGreaterThan(0);
      await expect
        .poll(
          async () =>
            (
              await hold.query(
                kind === "token"
                  ? "SELECT expires_at<=clock_timestamp() AS expired FROM api_tokens WHERE id=$1"
                  : kind === "browser-absolute"
                    ? "SELECT expires_at<=clock_timestamp() AS expired FROM browser_sessions WHERE hash=$1"
                    : "SELECT last_seen<=clock_timestamp()-interval '1 second' AS expired FROM browser_sessions WHERE hash=$1",
                [kind === "token" ? id : hash],
              )
            ).rows[0].expired,
          { timeout: 5000 },
        )
        .toBe(true);
      const oldSeen =
        kind !== "token"
          ? (
              await hold.query(
                "SELECT last_seen FROM browser_sessions WHERE hash=$1",
                [hash],
              )
            ).rows[0].last_seen.getTime()
          : null;
      await hold.query("ROLLBACK");
      expect(await waiting).toBe(401);
      if (kind !== "token")
        expect(
          (
            await db.query(
              "SELECT last_seen FROM browser_sessions WHERE hash=$1",
              [hash],
            )
          ).rows[0].last_seen.getTime(),
        ).toBe(oldSeen);
    } finally {
      await hold.query("ROLLBACK");
      hold.release();
      await waiting;
      await db.query("DELETE FROM api_tokens WHERE id=$1", [id]);
      await db.query("DELETE FROM browser_sessions WHERE hash=$1", [hash]);
    }
  }
}
