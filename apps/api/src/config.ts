import { z } from "zod";
const schema = z.object({
  HARBOR_PREVIEW_DOMAIN: z
    .string()
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/)
    .optional(),
  HARBOR_PREVIEW_HTTPS_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(443),
  HARBOR_PREVIEW_PORT: z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .default(3002),
  HARBOR_PREVIEW_SOCKET: z.string().startsWith("/").optional(),
  HARBOR_CONTROL_SOCKET: z.string().startsWith("/").optional(),
  HARBOR_CREDENTIAL_KEY_FILE: z.string().startsWith("/").optional(),
  DATABASE_URL: z.string().min(1),
  HARBOR_ORIGIN: z
    .url()
    .refine(
      (s) => new URL(s).protocol === "https:" && new URL(s).origin === s,
      "Canonical HTTPS origin required",
    ),
  HARBOR_OIDC_ISSUER: z.url(),
  HARBOR_OIDC_CLIENT_ID: z.string().min(1),
  HARBOR_OIDC_CLIENT_SECRET: z.string().optional(),
  HARBOR_OWNER_SUBJECT: z.string().min(1),
  HARBOR_PROJECT_ROOTS: z.string(),
  HARBOR_PERMISSION_CEILING: z
    .enum(["read-only", "workspace-write"])
    .default("read-only"),
  HARBOR_MODELS: z.string().default("gpt-5.4"),
  HARBOR_PORT: z.coerce.number().default(3000),
  HARBOR_HOST: z.string().default("127.0.0.1"),
  HARBOR_IDLE_SECONDS: z.coerce.number().positive().default(1800),
  HARBOR_ABSOLUTE_SECONDS: z.coerce.number().positive().default(43200),
  HARBOR_MAX_PROJECTS: z.coerce.number().positive().default(20),
  HARBOR_MAX_SESSIONS: z.coerce.number().positive().default(200),
  HARBOR_MAX_QUEUED: z.coerce.number().positive().default(20),
  HARBOR_FIXTURE_MODE: z.enum(["private-test"]).optional(),
});
export function config(env = process.env) {
  const c = schema.parse(env);
  const roots = z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().min(1),
        path: z.string().startsWith("/"),
      }),
    )
    .parse(JSON.parse(c.HARBOR_PROJECT_ROOTS));
  if (
    c.HARBOR_FIXTURE_MODE &&
    (env.NODE_ENV !== "test" ||
      !["localhost", "127.0.0.1"].includes(new URL(c.HARBOR_ORIGIN).hostname))
  )
    throw new Error("Fixture mode requires a private loopback test instance");
  return { ...c, roots, models: c.HARBOR_MODELS.split(",") };
}
export type Config = ReturnType<typeof config>;
