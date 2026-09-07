import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { transaction } from "../../storage/src/index.ts";
import {
  requireAuthority,
  type AuthorityConfig,
  type AuthorityNeed,
} from "../../policy/src/authority.ts";
import { checkKey, digest, HarborError } from "../../policy/src/index.ts";
export async function scheduleCommand(
  pool: Pool,
  c: AuthorityConfig,
  input: {
    actor: string;
    scheduleId: string;
    key: unknown;
    route: string;
    body: unknown;
    need: AuthorityNeed;
    control?:
      | { kind: "pause" }
      | { kind: "cancel"; occurrenceId: string; attempt: number };
  },
  action: (db: PoolClient, schedule: any) => Promise<unknown>,
) {
  const requestHash = digest(
    JSON.stringify({ route: input.route, body: input.body }),
  );
  return transaction(pool, async (db) => {
    const caller = await requireAuthority(db, input.actor, c, input.need);
    if (caller.kind === "schedule")
      throw new HarborError(
        403,
        "SCHEDULE_AUTHORITY",
        "Execution grants cannot manage schedules",
      );
    const intentActor =
      caller.kind === "token" ? input.actor : c.HARBOR_OWNER_SUBJECT;
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      intentActor + ":" + String(input.key),
    ]);
    await db.query("SELECT pg_advisory_xact_lock(740028)");
    const schedule = (
      await db.query("SELECT * FROM schedules WHERE id=$1 FOR UPDATE", [
        input.scheduleId,
      ])
    ).rows[0];
    if (!schedule)
      throw new HarborError(404, "NOT_FOUND", "Schedule not found");
    const need = { ...input.need, projectId: schedule.project_id };
    await requireAuthority(db, input.actor, c, need);
    const old = (
      await db.query(
        "SELECT request_hash,result FROM schedule_commands WHERE actor_hash=$1 AND idempotency_key=$2",
        [intentActor, String(input.key)],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== requestHash)
        throw new HarborError(
          409,
          "INTENT_CONFLICT",
          "Idempotency key describes a different request",
        );
      return old.result;
    }
    const now = Number(
      (
        await db.query(
          "SELECT extract(epoch FROM clock_timestamp())*1000 AS ms",
        )
      ).rows[0].ms,
    );
    checkKey(input.key, now);
    const key = input.key as string;
    await db.query(
      "DELETE FROM schedule_commands WHERE (schedule_id,slot) IN (SELECT schedule_id,slot FROM schedule_commands WHERE schedule_id=$1 AND retry_until<clock_timestamp() LIMIT 128)",
      [schedule.id],
    );
    let epoch: number | null = null,
      occurrence: string | null = null;
    if (input.control?.kind === "pause" && schedule.active_grant_id)
      epoch = Number(
        (
          await db.query("SELECT epoch FROM schedule_grants WHERE id=$1", [
            schedule.active_grant_id,
          ])
        ).rows[0].epoch,
      );
    if (input.control?.kind === "cancel") {
      occurrence = input.control.occurrenceId;
      if (
        !(
          await db.query(
            "SELECT 1 FROM schedule_occurrences WHERE id=$1 AND schedule_id=$2",
            [occurrence, schedule.id],
          )
        ).rowCount
      )
        throw new HarborError(404, "NOT_FOUND", "Occurrence not found");
    }
    const slot =
      input.control?.kind === "pause"
        ? `pause:${epoch ?? 0}`
        : occurrence
          ? `cancel:${occurrence}:${input.control?.kind === "cancel" ? input.control.attempt : 1}`
          : `ordinary:${randomUUID()}`;
    const coalesced = (
      await db.query(
        "SELECT result,request_hash FROM schedule_commands WHERE schedule_id=$1 AND slot=$2",
        [schedule.id, slot],
      )
    ).rows[0];
    if (coalesced) {
      if (coalesced.request_hash !== requestHash)
        throw new HarborError(
          409,
          "CONTROL_SETTLED",
          "This target already has a retained control outcome",
        );
      return coalesced.result;
    }
    if (
      !input.control &&
      Number(
        (
          await db.query(
            "SELECT count(*) FROM schedule_commands WHERE schedule_id=$1 AND slot LIKE 'ordinary:%'",
            [schedule.id],
          )
        ).rows[0].count,
      ) >= 128
    )
      throw new HarborError(
        429,
        "SCHEDULE_COMMAND_QUOTA",
        "Schedule management intent capacity reached; pause and cancellation remain available",
      );
    await requireAuthority(db, input.actor, c, need);
    const result = await action(db, schedule);
    await requireAuthority(db, input.actor, c, need);
    if (Buffer.byteLength(JSON.stringify(result)) > 8192)
      throw Error("Schedule command result bound exceeded");
    await db.query(
      "INSERT INTO schedule_commands(schedule_id,slot,actor_hash,grant_epoch,occurrence_id,idempotency_key,request_hash,result,retry_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        schedule.id,
        slot,
        intentActor,
        epoch,
        occurrence,
        key,
        requestHash,
        JSON.stringify(result),
        new Date(Math.max(now, Number(key.split(":")[0])) + 86400000),
      ],
    );
    return result;
  });
}
