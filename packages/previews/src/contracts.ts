import { z } from "zod";
const bytes = (limit: number) =>
  z
    .string()
    .min(1)
    .refine((s) => Buffer.byteLength(s) <= limit);
export const previewCreate = z
  .object({
    workspaceId: z.uuid(),
    name: bytes(160),
    script: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$/),
    port: z.number().int().min(1024).max(65535),
    permissionProfile: z.enum(["read-only", "workspace-write"]),
  })
  .strict();
export const previewStart = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export const previewStop = z
  .object({
    expectedGeneration: z.number().int().positive(),
    acknowledgeUnconfirmed: z.uuid().optional(),
  })
  .strict();
export const previewOpen = z
  .object({ expectedGeneration: z.number().int().positive() })
  .strict();
export function previewView(p: any) {
  return {
    id: p.id,
    projectId: p.project_id,
    workspaceId: p.workspace_id,
    name: p.name,
    script: p.script,
    port: p.port,
    permissionProfile: p.permission_profile,
    revision: p.revision,
    generation: Number(p.generation),
    state: p.state,
    retired: p.retired,
    createdAt: p.created_at,
    deadline: p.deadline,
    failureCode: p.failure_code ?? null,
    exitCode: p.exit_code ?? null,
    outputFloor: Number(p.output_floor),
    outputLost: p.output_lost,
    stopAttempts: p.stop_attempts,
    lastStopId: p.last_stop_id ?? null,
  };
}
