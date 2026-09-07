import { z } from "zod";
import { projectSchema, sessionSchema, turnSchema } from "./index.ts";
const string = { type: "string" },
  uuid = { type: "string", format: "uuid" },
  timestamp = { type: "string", format: "date-time" };
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: true });
const array = (items: unknown) => ({ type: "array", items });
export const publicSchemas = {
  Error: object({
    error: object({
      code: string,
      message: string,
      requestId: string,
      retryable: { type: "boolean" },
    }),
  }),
  Workspace: object({
    id: uuid,
    projectId: uuid,
    name: string,
    kind: { enum: ["local", "worktree", "copy"] },
    state: {
      enum: [
        "creating",
        "removing",
        "ready",
        "unavailable",
        "failed",
        "archived",
        "removed",
      ],
    },
    relativePath: string,
    baseRevision: { type: ["string", "null"] },
    sourceDirty: { type: "boolean" },
    writerSessionId: { type: ["string", "null"] },
    writerGeneration: { type: ["integer", "null"] },
    failureCode: { type: ["string", "null"] },
  }),
  Project: object({ id: uuid, name: string, createdAt: timestamp }),
  Session: object({
    id: uuid,
    projectId: uuid,
    workspaceId: uuid,
    title: string,
    state: {
      enum: [
        "idle",
        "queued",
        "dispatching",
        "running",
        "waiting_approval",
        "waiting_input",
        "succeeded",
        "failed",
        "interrupted",
        "uncertain",
      ],
    },
    model: string,
    effort: string,
    permissionProfile: { enum: ["read-only", "workspace-write"] },
    createdAt: timestamp,
    updatedAt: timestamp,
    generation: { type: "integer" },
    sequence: { type: "integer" },
  }),
  Message: object({
    id: uuid,
    role: { enum: ["user", "assistant", "system"] },
    text: string,
    status: string,
    createdAt: timestamp,
  }),
  Operation: object({
    id: uuid,
    sessionId: uuid,
    kind: string,
    state: string,
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
  Approval: object({
    id: uuid,
    sessionId: uuid,
    operationId: uuid,
    generation: { type: "integer" },
    requestId: string,
    kind: string,
    scope: { type: "object" },
    state: string,
    deadline: timestamp,
  }),
  Credentials: object({
    configured: { type: "boolean" },
    available: { type: "boolean" },
  }),
  Capabilities: object({
    models: array(object({ id: string, name: string, efforts: array(string) })),
    permissionProfiles: array({ enum: ["read-only", "workspace-write"] }),
    limits: object({
      maxProjects: { type: "integer" },
      maxSessions: { type: "integer" },
      maxQueued: { type: "integer" },
      maxInputBytes: { type: "integer" },
      maxConversationBytes: { type: "integer" },
      replayEventLimit: { type: "integer" },
      retryWindowHours: { type: "integer" },
    }),
    runtime: object({ version: string, experimental: { type: "boolean" } }),
    account: object({
      authenticated: { type: "boolean" },
      authMode: { type: ["string", "null"] },
    }),
    emergencyStopped: { type: "boolean" },
  }),
};
const ref = (name: keyof typeof publicSchemas) => ({
  $ref: "#/components/schemas/" + name,
});
const response = (schema: unknown, description = "Committed result") => ({
  description,
  content: { "application/json": { schema } },
});
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 429, 500, 503].map((status) => [
    status,
    response(ref("Error"), "Request rejected; inspect code and retryable"),
  ]),
) as Record<string, unknown>;
const idParameter = { in: "path", name: "id", required: true, schema: uuid };
const secure = { security: [{ ownerCookie: [] }] };
const read = (schema: unknown) => ({
  ...secure,
  responses: { "200": response(schema), ...errors },
});
const mutation = (schema: unknown, result: unknown, status = 200) => ({
  ...secure,
  parameters: [
    {
      in: "header",
      name: "Idempotency-Key",
      required: true,
      schema: { type: "string", pattern: "^[0-9]{13}:[0-9a-f-]{36}$" },
      description:
        "Unix milliseconds and UUID. Up to 5 minutes future clock skew; 24 hour retry window. Retained keys resolve to original result; unknown expired keys are rejected.",
    },
    { in: "header", name: "X-CSRF-Token", required: true, schema: string },
    { in: "header", name: "Origin", required: true, schema: string },
  ],
  requestBody: { required: true, content: { "application/json": { schema } } },
  responses: { [status]: response(result), ...errors },
});
const empty = { type: "object", additionalProperties: false };
const accepted = object({ operation: ref("Operation") });
const snapshot = object({
  session: ref("Session"),
  messages: array(ref("Message")),
  operations: array(ref("Operation")),
  approvals: array(ref("Approval")),
  cursor: { type: "integer", minimum: 0 },
  storage: object({
    conversationBytes: { type: "integer" },
    conversationLimitBytes: { type: "integer" },
  }),
  processes: object({
    status: { enum: ["known", "unavailable", "runtime_gone"] },
    generation: { type: "integer" },
    processes: array(object({ pid: { type: "integer" }, executable: string })),
  }),
});
const paths: Record<string, any> = {
  "/me": {
    get: read(
      object({ owner: object({ subject: string }), csrfToken: string }),
    ),
  },
  "/projects": {
    get: read(object({ projects: array(ref("Project")) })),
    post: mutation(
      z.toJSONSchema(projectSchema),
      object({ project: ref("Project") }),
    ),
  },
  "/projects/{id}/storage": {
    get: read(
      object(
        {
          status: { enum: ["known", "unavailable"] },
          usedBytes: { type: "integer" },
          byteLimit: { type: "integer" },
          usedInodes: { type: "integer" },
          inodeLimit: { type: "integer" },
        },
        ["status"],
      ),
    ),
  },
  "/project-roots": {
    get: read(object({ roots: array(object({ id: uuid, name: string })) })),
  },
  "/capabilities": { get: read(ref("Capabilities")) },
  "/sessions": {
    get: read(object({ sessions: array(ref("Session")) })),
    post: mutation(
      z.toJSONSchema(sessionSchema),
      object({ session: ref("Session") }),
    ),
  },
  "/sessions/{id}/snapshot": { get: read(snapshot) },
  "/sessions/{id}/events": {
    get: {
      ...secure,
      parameters: [
        {
          in: "query",
          name: "cursor",
          schema: { type: "integer", minimum: 0 },
        },
        {
          in: "header",
          name: "Last-Event-ID",
          schema: { type: "integer", minimum: 0 },
          description: "Takes precedence over cursor on reconnect.",
        },
      ],
      responses: {
        "200": {
          description:
            "Bounded authenticated SSE. resync event requires a fresh snapshot and stream at that cursor.",
          content: { "text/event-stream": { schema: string } },
        },
        ...errors,
      },
    },
  },
  "/sessions/{id}/turns": {
    post: mutation(z.toJSONSchema(turnSchema), accepted, 202),
  },
  "/operations/{id}": { get: read(accepted) },
  "/approvals/{id}/answer": {
    post: mutation(
      object(
        {
          generation: { type: "integer" },
          decision: { enum: ["accept", "decline"] },
          answers: {
            type: "object",
            additionalProperties: object({ answers: array(string) }),
          },
        },
        ["generation", "decision"],
      ),
      object({ approval: object({ id: uuid, state: { const: "answering" } }) }),
      202,
    ),
  },
  "/turns/{id}/cancel": {
    post: mutation(
      empty,
      object({
        operation: object({ id: uuid, state: { const: "queued" } }),
        message: string,
      }),
      202,
    ),
  },
  "/security/emergency-stop": {
    post: mutation(empty, object({ stopped: { const: true } })),
  },
  "/security/logout": {
    post: mutation(empty, object({ loggedOut: { const: true } })),
  },
  "/security/runtime-credentials": {
    get: read(ref("Credentials")),
    post: mutation(
      object({ apiKey: { type: "string", minLength: 16, maxLength: 4096 } }),
      ref("Credentials"),
    ),
  },
  "/security/runtime-credentials/remove": {
    post: mutation(empty, ref("Credentials")),
  },
  "/openapi.json": { get: read({ type: "object" }) },
};
const workspaceResult = object({ workspace: ref("Workspace") });
Object.assign(paths, {
  "/projects/{id}/workspaces": {
    get: read(object({ workspaces: array(ref("Workspace")) })),
    post: mutation(
      object(
        {
          name: string,
          kind: { enum: ["worktree", "copy"] },
          sourceWorkspaceId: uuid,
          revision: {
            type: "string",
            pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$",
          },
          dirtyPolicy: { enum: ["exclude", "snapshot"] },
        },
        ["name", "kind", "sourceWorkspaceId", "dirtyPolicy"],
      ),
      workspaceResult,
    ),
  },
  "/workspaces/{id}": {
    get: read(
      object({
        workspace: ref("Workspace"),
        inspection: object({
          available: { type: "boolean" },
          git: { type: "boolean" },
          dirty: { type: "boolean" },
        }),
      }),
    ),
    delete: mutation(empty, workspaceResult),
  },
  "/workspaces/{id}/archive": { post: mutation(empty, workspaceResult) },
  "/projects/{id}/archive": {
    post: mutation(empty, object({ project: ref("Project") })),
  },
  "/sessions/{id}/archive": {
    post: mutation(empty, object({ session: ref("Session") })),
  },
  "/workspaces/{id}/release": {
    post: mutation(
      object({
        acknowledgeUnknownEffects: { const: true },
        expectedSessionId: uuid,
        expectedGeneration: { type: "integer", minimum: 1 },
      }),
      object({
        release: object({
          id: uuid,
          state: { enum: ["queued", "dispatching", "completed", "failed"] },
        }),
      }),
    ),
  },
});
for (const [name, item] of Object.entries(paths))
  if (name.includes("{id}")) item.parameters = [idParameter];
export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Codex Harbor owner API",
    version: "1.0.0",
    description:
      "P001 owner-cookie facade; app-server is private. Uncertain execution is never automatically replayed.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      ownerCookie: { type: "apiKey", in: "cookie", name: "__Host-harbor" },
    },
    schemas: {
      ...publicSchemas,
      ProjectInput: z.toJSONSchema(projectSchema),
      SessionInput: z.toJSONSchema(sessionSchema),
      TurnInput: z.toJSONSchema(turnSchema),
    },
  },
  paths,
};
