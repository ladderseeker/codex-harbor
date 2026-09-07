import { z } from "zod";
export const fileRef = z.string().min(38).max(6000);
const selection = z
  .object({
    ref: fileRef,
    wholeFile: z.boolean().optional(),
    hunkIds: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .max(2000)
      .optional(),
  })
  .strict()
  .refine((v) =>
    v.wholeFile === true ? !v.hunkIds?.length : !!v.hunkIds?.length,
  );
export const saveFileSchema = z
  .object({
    ref: fileRef,
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    text: z
      .string()
      .refine((v) => Buffer.byteLength(v) <= 1048576 && !v.includes("\0")),
  })
  .strict();
export const stageFileSchema = z
  .object({
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    selections: z.array(selection).min(1).max(100),
  })
  .strict();
export const commitFileSchema = z
  .object({
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    selectedRefs: z.array(fileRef).min(1).max(100),
    message: z
      .string()
      .trim()
      .min(1)
      .refine((v) => Buffer.byteLength(v) <= 8192 && !v.includes("\0")),
  })
  .strict();
export const inspectFileSchema = z
  .object({
    expectedEpoch: z.number().int().positive(),
    inspectionId: z.uuid().optional(),
    expectedAttempt: z.number().int().min(1).max(2).optional(),
  })
  .strict()
  .refine((v) => !!v.inspectionId === (v.expectedAttempt !== undefined));
export const releaseFileSchema = z
  .object({
    expectedEpoch: z.number().int().positive(),
    inspectionId: z.uuid(),
    acknowledgeUnknownEffects: z.literal(true),
  })
  .strict();
export function fileOperationView(row: any) {
  const { identity: _privateIdentity, ...publicResult } = row.result ?? {};
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    state: row.state,
    epoch: row.epoch === null ? null : Number(row.epoch),
    result: row.result === null ? null : publicResult,
    failureCode: row.failure_code,
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
