import path from "node:path";
import { personalPreviewConfig } from "./personal-preview-config.ts";
import { realpathSync, statSync } from "node:fs";
import { z } from "zod";
const limit = (maximum: number) =>
  z.preprocess(
    (value) =>
      value === undefined
        ? 4
        : typeof value === "string" && /^[1-9][0-9]*$/.test(value)
          ? Number(value)
          : value,
    z.number().int().min(1).max(maximum),
  );
const schema = z.object({
  HARBOR_MAX_ACTIVE_TURNS: limit(16),
  HARBOR_MAX_CONVERSATION_RUNTIMES: limit(32),
  HARBOR_PERSONAL_PREVIEWS: z.string().default("[]"),
  HARBOR_PERSONAL_PREVIEW_PORT: z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .default(3350),
  HARBOR_PERSONAL_VPS_MODE: z.literal("personal").optional(),
  HARBOR_PERSONAL_VPS_STATE_DIR: z.string().startsWith("/").optional(),
  HARBOR_PERSONAL_VPS_CODEX_HOME: z.string().startsWith("/").optional(),
  HARBOR_PERSONAL_VPS_CODEX_BINARY: z.string().startsWith("/").optional(),
  HARBOR_LOCAL_MODE: z.literal("personal").optional(),
  HARBOR_LOCAL_CODEX_HOME: z.string().startsWith("/").optional(),
  HARBOR_LOCAL_CODEX_BINARY: z.string().startsWith("/").optional(),
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
  if (c.HARBOR_MAX_CONVERSATION_RUNTIMES < c.HARBOR_MAX_ACTIVE_TURNS)
    throw Error(
      "Conversation runtime limit must be at least the active turn limit",
    );
  if (
    c.HARBOR_LOCAL_MODE &&
    (c.HARBOR_PERSONAL_VPS_MODE ||
      c.HARBOR_FIXTURE_MODE ||
      ["test", "production"].includes(env.NODE_ENV ?? "") ||
      env.HARBOR_MANAGED_RELEASE ||
      !["localhost", "127.0.0.1"].includes(new URL(c.HARBOR_ORIGIN).hostname) ||
      c.HARBOR_HOST !== "127.0.0.1" ||
      new URL(c.HARBOR_OIDC_ISSUER).hostname !== "127.0.0.1" ||
      !c.HARBOR_LOCAL_CODEX_HOME ||
      !c.HARBOR_LOCAL_CODEX_BINARY ||
      env.HARBOR_STORAGE_SOCKET ||
      env.HARBOR_FILE_SOCKET ||
      env.HARBOR_PREVIEW_SOCKET ||
      env.HARBOR_LAUNCHER_SOCKET)
  )
    throw Error(
      "Personal local mode requires a separate loopback instance and private Codex configuration",
    );
  if (
    c.HARBOR_PERSONAL_VPS_MODE &&
    (c.HARBOR_LOCAL_MODE ||
      c.HARBOR_FIXTURE_MODE ||
      process.platform !== "linux" ||
      process.getuid?.() === 0 ||
      c.HARBOR_HOST !== "127.0.0.1" ||
      new URL(c.HARBOR_OIDC_ISSUER).protocol !== "https:" ||
      !c.HARBOR_PERSONAL_VPS_STATE_DIR ||
      !c.HARBOR_PERSONAL_VPS_CODEX_HOME ||
      !c.HARBOR_PERSONAL_VPS_CODEX_BINARY ||
      env.HARBOR_MANAGED_RELEASE ||
      env.HARBOR_STORAGE_SOCKET ||
      env.HARBOR_FILE_SOCKET ||
      env.HARBOR_PREVIEW_SOCKET ||
      env.HARBOR_LAUNCHER_SOCKET ||
      env.HARBOR_CONTROL_SOCKET ||
      env.HARBOR_CREDENTIAL_KEY_FILE)
  )
    throw Error(
      "Personal VPS mode requires a separate nonroot Linux instance, loopback backend, HTTPS identity provider and private native Codex configuration",
    );
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
  if (
    env.HARBOR_SCHEDULE_TEST_CLOCK &&
    (env.HARBOR_SCHEDULE_TEST_CLOCK !== "1" ||
      env.NODE_ENV !== "test" ||
      !c.HARBOR_FIXTURE_MODE)
  )
    throw new Error("Schedule test clock requires a private test instance");
  if (c.HARBOR_PERSONAL_VPS_MODE) {
    if (roots.length === 0)
      throw Error("Personal VPS mode requires approved project roots");
    const state = realpathSync(c.HARBOR_PERSONAL_VPS_STATE_DIR!);
    const home = realpathSync(c.HARBOR_PERSONAL_VPS_CODEX_HOME!);
    if (
      state !== path.resolve(c.HARBOR_PERSONAL_VPS_STATE_DIR!) ||
      !statSync(state).isDirectory() ||
      !home.startsWith(state + "/")
    )
      throw Error(
        "Personal VPS native home must be within canonical private instance state",
      );
    for (const root of roots) {
      const canonical = realpathSync(root.path);

      if (
        canonical !== path.resolve(root.path) ||
        !statSync(canonical).isDirectory()
      )
        throw Error(
          "Approved project roots must be existing canonical directories without symlinks",
        );
      if (
        canonical === "/" ||
        state === canonical ||
        state.startsWith(canonical + "/") ||
        canonical.startsWith(state + "/")
      )
        throw Error(
          "Approved project roots must be separate from private native state",
        );
    }
  }
  const personalPreviews = personalPreviewConfig(
    c.HARBOR_PERSONAL_PREVIEWS,
    c.HARBOR_ORIGIN,
    [
      c.HARBOR_PORT,
      c.HARBOR_PREVIEW_PORT,
      c.HARBOR_PERSONAL_PREVIEW_PORT,
      Number(new URL(c.DATABASE_URL).port || 5432),
    ],
  );
  if (
    personalPreviews.length &&
    !c.HARBOR_PERSONAL_VPS_MODE &&
    !c.HARBOR_FIXTURE_MODE
  )
    throw Error("Personal preview endpoints require personal VPS mode");
  if (
    personalPreviews.length &&
    c.HARBOR_PERSONAL_PREVIEW_PORT === c.HARBOR_PORT
  )
    throw Error("Personal preview gateway must have a separate listener");
  return { ...c, roots, personalPreviews, models: c.HARBOR_MODELS.split(",") };
}
export type Config = ReturnType<typeof config>;
