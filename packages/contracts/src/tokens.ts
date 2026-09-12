import { z } from "zod";
const tokenScopes = [
  "read",
  "execute",
  "approve",
  "cancel",
  "schedules:read",
  "schedules:manage",
  "files:read",
  "files:write",
  "git:read",
  "git:write",
  "terminal:read",
  "terminal:control",
  "terminal:terminate",
  "previews:read",
  "previews:manage",
] as const;
export const tokenSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z.array(z.enum(tokenScopes)).min(1).max(tokenScopes.length),
    projectIds: z.array(z.uuid()).min(1).max(20),
    permissionProfile: z.enum(["read-only", "workspace-write"]),
    expiresInDays: z.number().int().min(1).max(90),
  })
  .strict();
