import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tokenSchema } from "../../../packages/contracts/src/tokens.ts";
import {
  HarborError,
  digest,
  secret,
  authorizePermission,
} from "../../../packages/policy/src/index.ts";
import type { Config } from "./config.ts";
const columns =
  "id,name,prefix,scopes,project_ids,permission_profile,expires_at,revoked,created_at,last_used_at";
export function registerTokenRoutes(
  app: FastifyInstance,
  pool: Pool,
  c: Config,
  command: (
    req: any,
    fn: (db: PoolClient) => Promise<unknown>,
  ) => Promise<unknown>,
) {
  app.get("/api/v1/security/api-tokens", async () => ({
    tokens: (
      await pool.query(
        `SELECT ${columns} FROM api_tokens ORDER BY created_at DESC LIMIT 100`,
      )
    ).rows,
  }));
  app.post("/api/v1/security/api-tokens", async (req) => {
    let oneTimeSecret: string | undefined;
    const result = (await command(req, async (db) => {
      const b = tokenSchema.parse(req.body);
      authorizePermission(b.permissionProfile, c.HARBOR_PERMISSION_CEILING);
      await db.query("SELECT pg_advisory_xact_lock(740017)");
      if (
        Number(
          (await db.query("SELECT count(*) FROM api_tokens")).rows[0].count,
        ) >= 100
      )
        throw new HarborError(429, "TOKEN_QUOTA", "Token record limit reached");
      const ids = [...new Set(b.projectIds)];
      if (
        (
          await db.query("SELECT id FROM projects WHERE id=ANY($1::uuid[])", [
            ids,
          ])
        ).rowCount !== ids.length
      )
        throw new HarborError(
          400,
          "INVALID_PROJECT",
          "Select existing projects",
        );
      oneTimeSecret = "hbr_" + secret();
      const token = (
        await db.query(
          `INSERT INTO api_tokens(id,name,verifier,prefix,identity_pin,instance_id,scopes,project_ids,permission_profile,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+($10*interval '1 day')) RETURNING ${columns}`,
          [
            randomUUID(),
            b.name,
            digest(oneTimeSecret),
            oneTimeSecret.slice(0, 10),
            digest(c.HARBOR_OIDC_ISSUER + "\0" + c.HARBOR_OWNER_SUBJECT),
            process.env.HARBOR_INSTANCE_ID ?? "harbor",
            [...new Set(b.scopes)],
            ids,
            b.permissionProfile,
            b.expiresInDays,
          ],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO audits(kind,record_id) VALUES('api-token.created',$1)",
        [token.id],
      );
      return { token, secretUnavailable: true };
    })) as object;
    return {
      ...result,
      ...(oneTimeSecret
        ? { secret: oneTimeSecret, secretUnavailable: false }
        : {}),
    };
  });
  app.post<{ Params: { id: string } }>(
    "/api/v1/security/api-tokens/:id/revoke",
    async (req) =>
      command(req, async (db) => {
        z.object({}).strict().parse(req.body);
        const row = (
          await db.query(
            `UPDATE api_tokens SET revoked=true WHERE id=$1 RETURNING ${columns}`,
            [req.params.id],
          )
        ).rows[0];
        if (!row) throw new HarborError(404, "NOT_FOUND", "Token not found");
        await db.query(
          "INSERT INTO audits(kind,record_id) VALUES('api-token.revoked',$1)",
          [row.id],
        );
        return { token: row };
      }),
  );
}
