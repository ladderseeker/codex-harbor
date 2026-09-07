import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { HistoryContext } from "./history.ts";
import { HarborError } from "../../../packages/policy/src/index.ts";
import { capacity } from "../../../packages/storage/src/capacity.ts";
import { event, publicRow } from "../../../packages/storage/src/index.ts";
import { turnSchema } from "../../../packages/contracts/src/index.ts";
export function recoveryView(r: any) {
  if (!r) return null;
  return {
    id: r.id,
    state: r.state,
    expectedGeneration: Number(r.expected_generation),
    generation: r.fence_generation === null ? null : Number(r.fence_generation),
    attempt: r.attempts,
    attemptsRemaining: 3 - r.attempts,
    report: r.report,
    continuedOperationId: r.continued_operation_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
interface Context extends HistoryContext {
  actor(req: any): string;
  acceptTurn(req: any, db: PoolClient, input: unknown): Promise<any>;
}
export function recoveryRoutes(app: FastifyInstance, context: Context) {
  const { pool, command, actor, acceptTurn, lockWorkspace } = context;
  app.get<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/recovery",
    async (req) => {
      const s = (
        await pool.query("SELECT * FROM sessions WHERE id=$1", [req.params.id])
      ).rows[0];
      if (!s) throw new HarborError(404, "NOT_FOUND", "Conversation not found");
      const recovery = (
        await pool.query(
          "SELECT * FROM session_recoveries WHERE session_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
          [s.id],
        )
      ).rows[0];
      return {
        generation: Number(s.generation),
        cursor: Number(s.sequence),
        state: s.state,
        unresolvedOperations: (
          await pool.query(
            "SELECT * FROM operations WHERE session_id=$1 AND state='uncertain' AND uncertainty_acknowledged_at IS NULL ORDER BY created_at,id",
            [s.id],
          )
        ).rows.map(publicRow),
        recovery: recoveryView(recovery),
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/recovery",
    async (req, reply) => {
      const b = z
        .object({
          expectedGeneration: z.number().int().nonnegative(),
          recoveryId: z.uuid().optional(),
          expectedAttempt: z.number().int().min(1).max(2).optional(),
        })
        .strict()
        .refine((x) => !!x.recoveryId === (x.expectedAttempt !== undefined))
        .parse(req.body);
      const result = await command(req, async (db) => {
        await lockWorkspace?.(db, req.params.id);
        const s = (
          await db.query("SELECT * FROM sessions WHERE id=$1 FOR UPDATE", [
            req.params.id,
          ])
        ).rows[0];
        if (!s)
          throw new HarborError(404, "NOT_FOUND", "Conversation not found");
        if (Number(s.generation) !== b.expectedGeneration)
          throw new HarborError(
            409,
            "STALE_GENERATION",
            "Runtime generation changed; refresh recovery status",
          );
        if (b.recoveryId) {
          const r = (
            await db.query(
              "UPDATE session_recoveries SET state='queued',attempts=attempts+1,actor_hash=$4,updated_at=now() WHERE id=$1 AND session_id=$2 AND state='failed' AND attempts=$3 AND attempts<3 AND expected_generation=$5 RETURNING *",
              [
                b.recoveryId,
                s.id,
                b.expectedAttempt,
                actor(req),
                b.expectedGeneration,
              ],
            )
          ).rows[0];
          if (!r)
            throw new HarborError(
              409,
              "RECOVERY_CONFLICT",
              "Recovery attempt changed or is exhausted",
            );
          await event(db, s.id, "recovery.queued", {
            recoveryId: r.id,
            attempt: r.attempts,
          });
          return { recovery: recoveryView(r) };
        }
        if (
          (
            await db.query(
              "SELECT 1 FROM session_recoveries WHERE session_id=$1 AND state IN ('queued','fencing','ready')",
              [s.id],
            )
          ).rowCount
        )
          throw new HarborError(
            409,
            "RECOVERY_CONFLICT",
            "A recovery already exists; refresh its result",
          );
        const ids = (
          await db.query(
            "SELECT id FROM operations WHERE session_id=$1 AND state='uncertain' AND uncertainty_acknowledged_at IS NULL ORDER BY id",
            [s.id],
          )
        ).rows.map((r) => r.id);
        if (!ids.length)
          throw new HarborError(
            409,
            "RECOVERY_NOT_REQUIRED",
            "No unresolved uncertain operation exists",
          );
        if (
          (
            await db.query(
              "SELECT 1 FROM session_recoveries WHERE session_id=$1 AND uncertain_operation_ids=$2::uuid[] AND state='failed'",
              [s.id, ids],
            )
          ).rowCount
        )
          throw new HarborError(
            409,
            "RECOVERY_CONFLICT",
            "Retry the existing failed recovery explicitly; its attempt budget remains in force",
          );
        await capacity(db, s.id, "recovery");
        const r = (
          await db.query(
            "INSERT INTO session_recoveries(id,session_id,actor_hash,expected_generation,state,uncertain_operation_ids,snapshot_cursor) VALUES($1,$2,$3,$4,'queued',$5,$6) RETURNING *",
            [randomUUID(), s.id, actor(req), s.generation, ids, s.sequence],
          )
        ).rows[0];
        await event(db, s.id, "recovery.queued", {
          recoveryId: r.id,
          attempt: 1,
        });
        return { recovery: recoveryView(r) };
      });
      return reply.code(202).send(result);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/recovery/continue",
    async (req, reply) => {
      const b = turnSchema
        .extend({
          recoveryId: z.uuid(),
          expectedGeneration: z.number().int().nonnegative(),
          acknowledgeUnknownEffects: z.literal(true),
        })
        .strict()
        .parse(req.body);
      const result = await command(req, async (db) => {
        await lockWorkspace?.(db, req.params.id);
        const s = (
          await db.query("SELECT * FROM sessions WHERE id=$1 FOR UPDATE", [
            req.params.id,
          ])
        ).rows[0];
        const r = (
          await db.query(
            "SELECT * FROM session_recoveries WHERE id=$1 AND session_id=$2 FOR UPDATE",
            [b.recoveryId, req.params.id],
          )
        ).rows[0];
        if (!s || !r)
          throw new HarborError(404, "NOT_FOUND", "Recovery not found");
        if (
          r.state !== "ready" ||
          Number(s.generation) !== b.expectedGeneration ||
          Number(r.fence_generation) !== b.expectedGeneration
        )
          throw new HarborError(
            409,
            "RECOVERY_CONFLICT",
            "Recovery is not ready at this generation",
          );
        const ids = (
          await db.query(
            "SELECT id FROM operations WHERE session_id=$1 AND state='uncertain' AND uncertainty_acknowledged_at IS NULL ORDER BY id",
            [s.id],
          )
        ).rows.map((x) => x.id);
        if (
          JSON.stringify(ids) !==
          JSON.stringify([...r.uncertain_operation_ids].sort())
        )
          throw new HarborError(
            409,
            "RECOVERY_CONFLICT",
            "Uncertain work changed after fencing",
          );
        await db.query(
          "UPDATE operations SET uncertainty_acknowledged_at=now(),recovery_id=$2 WHERE id=ANY($1::uuid[]) AND state='uncertain'",
          [ids, r.id],
        );
        const {
          recoveryId: _,
          expectedGeneration: __,
          acknowledgeUnknownEffects: ___,
          ...input
        } = b;
        const accepted = await acceptTurn(req, db, input);
        await db.query(
          "UPDATE session_recoveries SET state='consumed',continued_operation_id=$2,updated_at=now() WHERE id=$1",
          [r.id, accepted.operation.id],
        );
        await db.query(
          "INSERT INTO recovery_audits(recovery_id,slot,data) VALUES($1,4,$2) ON CONFLICT DO NOTHING",
          [
            r.id,
            JSON.stringify({
              kind: "acknowledged-new-operation",
              operationId: accepted.operation.id,
            }),
          ],
        );
        return accepted;
      });
      return reply.code(202).send(result);
    },
  );
}
