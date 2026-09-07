import { z } from "zod";
export const permissionSchema = z.enum(["read-only", "workspace-write"]);
export type PermissionProfile = z.infer<typeof permissionSchema>;
export const turnSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(32768)
      .refine(
        (text) => new TextEncoder().encode(text).length <= 32768,
        "Input exceeds byte limit",
      ),
    model: z.string().min(1).max(100),
    effort: z.enum(["low", "medium", "high"]),
    permissionProfile: permissionSchema,
    attachmentIds: z.array(z.uuid()).max(4).default([]),
    draftRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    rootId: z.string().uuid(),
    path: z.string().min(1).max(240),
    create: z.boolean().default(false),
  })
  .strict();
export const sessionSchema = z
  .object({
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(100).default("New conversation"),
    model: z.string().min(1).max(100),
    effort: z.enum(["low", "medium", "high"]).default("medium"),
    permissionProfile: permissionSchema.default("read-only"),
  })
  .strict();
export type SessionState =
  | "idle"
  | "queued"
  | "dispatching"
  | "running"
  | "waiting_approval"
  | "waiting_input"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "uncertain";
export interface Session {
  id: string;
  projectId: string;
  workspaceId: string;
  title: string;
  state: SessionState;
  model: string;
  effort: string;
  permissionProfile: PermissionProfile;
  createdAt: string;
  updatedAt: string;
}
export interface Message {
  operationId?: string | null;
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  status: string;
  createdAt: string;
}
export interface Operation {
  id: string;
  sessionId: string;
  kind: string;
  state: string;
  createdAt: string;
  updatedAt: string;
}
export interface Approval {
  id: string;
  sessionId: string;
  operationId: string;
  generation: number;
  requestId: string;
  kind: string;
  scope: unknown;
  state: string;
  deadline: string;
}
export interface HarborEvent {
  schemaVersion: 1;
  conversationId: string;
  sequence: number;
  type: string;
  timestamp: string;
  data: unknown;
}
export interface ProcessInspection {
  status: "known" | "unavailable" | "runtime_gone";
  generation: number;
  processes: { pid: number; executable: string }[];
}
export interface Snapshot {
  processes: ProcessInspection;
  storage: { conversationBytes: number; conversationLimitBytes: number };
  session: Session;
  messages: Message[];
  operations: Operation[];
  approvals: Approval[];
  cursor: number;
}
export const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
