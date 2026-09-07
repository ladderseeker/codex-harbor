import { z } from "zod";
export const terminalSize = {
  cols: z.number().int().min(20).max(240),
  rows: z.number().int().min(5).max(80),
};
export const terminalCreate = z
  .object({
    permissionProfile: z.enum(["read-only", "workspace-write"]),
    ...terminalSize,
  })
  .strict();
export const terminalControl = z
  .object({
    generation: z.number().int().positive(),
    expectedEpoch: z.number().int().nonnegative(),
    acknowledgeUncertainInput: z.boolean(),
  })
  .strict();
export const terminalFrameIdentity = {
  version: z.literal(1),
  generation: z.number().int().positive(),
  epoch: z.number().int().positive(),
  controllerId: z.uuid(),
};
export const terminalInput = z
  .object({
    ...terminalFrameIdentity,
    sequence: z.number().int().positive(),
    data: z.string().min(4).max(5464),
  })
  .strict();
export const terminalResize = z
  .object({
    ...terminalFrameIdentity,
    sequence: z.number().int().positive(),
    ...terminalSize,
  })
  .strict();
export const terminalHeartbeat = z.object(terminalFrameIdentity).strict();
export const terminalTerminate = z
  .object({ generation: z.number().int().positive() })
  .strict();
export function terminalView(t: any) {
  return {
    id: t.id,
    projectId: t.project_id,
    workspaceId: t.workspace_id,
    workspaceName: t.workspace_name ?? null,
    profile: t.permission_profile,
    state: t.state,
    generation: Number(t.generation),
    createdAt: t.created_at,
    deadline: t.deadline,
    retired: t.retired,
    exitCode: t.exit_code,
    failureCode: t.failure_code,
    controllerEpoch: Number(t.controller_epoch),
    controllerUntil: t.controller_until,
    inputSequence: Number(t.input_sequence),
    inputUncertain: t.input_uncertain,
    outputSequence: Number(t.output_sequence),
    outputFloor: Number(t.output_floor),
    outputLost: t.output_lost,
  };
}
