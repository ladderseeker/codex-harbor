import { reasoningEffortSchema } from "../../contracts/src/index.js";
import { z } from "zod";
const bytes = (maximum: number) =>
  z
    .string()
    .min(1)
    .refine((v) => Buffer.byteLength(v) <= maximum);
const rule = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("once"),
      local: z.string().max(16),
      timezone: z.string().max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("cron"),
      expression: bytes(200),
      timezone: z.string().max(100),
    })
    .strict(),
]);
export const scheduleConfigSchema = z
  .object({
    rule,
    workspaceMode: z.enum(["standalone", "existing"]),
    sourceWorkspaceId: z.uuid().optional(),
    sourcePolicy: z.enum(["committed", "snapshot"]).optional(),
    sessionId: z.uuid().optional(),
    baseRevision: z
      .string()
      .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
      .optional(),
    model: bytes(100),
    effort: reasoningEffortSchema,
    permissionProfile: z.enum(["read-only", "workspace-write"]),
    missedPolicy: z.enum(["skip", "catch_up"]).default("skip"),
    overlapPolicy: z.literal("skip").default("skip"),
  })
  .strict()
  .refine((c) =>
    c.workspaceMode === "standalone"
      ? !!c.sourceWorkspaceId &&
        !!c.sourcePolicy &&
        !(c.sourcePolicy === "snapshot" && c.baseRevision) &&
        !c.sessionId
      : !!c.sessionId &&
        !c.sourceWorkspaceId &&
        !c.sourcePolicy &&
        !c.baseRevision,
  );
export const createScheduleSchema = z
  .object({
    title: bytes(160)
      .transform((v) => v.trim())
      .pipe(bytes(160)),
    projectId: z.uuid(),
    prompt: bytes(32768)
      .transform((v) => v.trim())
      .pipe(bytes(32768)),
    config: scheduleConfigSchema,
    grantDays: z.number().int().min(1).max(90).default(30),
  })
  .strict();
export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;
