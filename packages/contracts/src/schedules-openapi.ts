import { reasoningEfforts } from "./index.js";
const text = { type: "string" },
  uuid = { type: "string", format: "uuid" },
  positive = { type: "integer", minimum: 1 };
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: "null" }] });
const timestamp = { type: "string", format: "date-time" };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const array = (items: unknown, maxItems = 50) => ({
  type: "array",
  items,
  maxItems,
});
const state = { enum: ["enabled", "paused", "attention", "completed"] };
const result = object({ id: uuid, revision: positive, state });
const rule = {
  oneOf: [
    object({
      kind: { const: "once" },
      local: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
      },
      timezone: { ...text, maxLength: 100 },
    }),
    object({
      kind: { const: "cron" },
      expression: {
        ...text,
        maxLength: 200,
        description:
          "Five numeric fields. UTF-8 limit 200 bytes; first DST fold only, nonexistent recurring minutes skipped.",
      },
      timezone: { ...text, maxLength: 100 },
    }),
  ],
};
const config = object(
  {
    rule,
    workspaceMode: { enum: ["standalone", "existing"] },
    sourceWorkspaceId: uuid,
    sourcePolicy: { enum: ["committed", "snapshot"] },
    sessionId: uuid,
    baseRevision: { ...text, pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" },
    model: { ...text, minLength: 1, maxLength: 100 },
    effort: { enum: reasoningEfforts },
    permissionProfile: { enum: ["read-only", "workspace-write"] },
    missedPolicy: { enum: ["skip", "catch_up"], default: "skip" },
    overlapPolicy: { const: "skip", default: "skip" },
  },
  ["rule", "workspaceMode", "model", "effort", "permissionProfile"],
);
const input = object(
  {
    title: {
      ...text,
      minLength: 1,
      maxLength: 160,
      description: "Trimmed, maximum 160 UTF-8 bytes.",
    },
    projectId: uuid,
    prompt: {
      ...text,
      minLength: 1,
      maxLength: 32768,
      description: "Trimmed, maximum 32768 UTF-8 bytes.",
    },
    config: ref("ScheduleConfig"),
    grantDays: { ...positive, maximum: 90, default: 30 },
  },
  ["title", "projectId", "prompt", "config"],
);
export const scheduleSchemas = {
  ScheduleRule: rule,
  ScheduleConfig: {
    ...config,
    allOf: [
      {
        if: { properties: { workspaceMode: { const: "standalone" } } },
        then: {
          required: ["sourceWorkspaceId", "sourcePolicy"],
          not: { required: ["sessionId"] },
        },
        else: {
          required: ["sessionId"],
          not: {
            anyOf: [
              { required: ["sourceWorkspaceId"] },
              { required: ["sourcePolicy"] },
              { required: ["baseRevision"] },
            ],
          },
        },
      },
      {
        if: {
          properties: { sourcePolicy: { const: "snapshot" } },
          required: ["sourcePolicy"],
        },
        then: { not: { required: ["baseRevision"] } },
      },
    ],
  },
  ScheduleInput: input,
  ScheduleMinute: object({
    local: text,
    instant: timestamp,
    offset: text,
    timezone: text,
  }),
  Schedule: object(
    {
      id: uuid,
      projectId: uuid,
      title: text,
      revision: positive,
      ruleRevision: positive,
      state,
      reason: nullable(text),
      nextDueAt: nullable(timestamp),
      updatedAt: timestamp,
      config: ref("ScheduleConfig"),
      prompt: text,
      grant: nullable(
        object({
          epoch: positive,
          expiresAt: timestamp,
          revoked: { type: "boolean" },
          source: { enum: ["owner", "token"] },
        }),
      ),
      retention: nullable({ type: "object" }),
    },
    [
      "id",
      "projectId",
      "title",
      "revision",
      "ruleRevision",
      "state",
      "reason",
      "nextDueAt",
      "updatedAt",
      "config",
      "grant",
      "retention",
    ],
  ),
  ScheduleOccurrence: object({
    id: uuid,
    scheduleId: uuid,
    state: {
      enum: [
        "accepted",
        "preparing_workspace",
        "queued_turn",
        "running",
        "attention",
        "succeeded",
        "failed",
        "cancelled",
        "skipped",
        "uncertain",
      ],
    },
    reason: nullable(text),
    kind: { enum: ["recurring", "manual", "range"] },
    localMinute: nullable(text),
    intendedAt: timestamp,
    startedAt: nullable(timestamp),
    endedAt: nullable(timestamp),
    acknowledgedAt: nullable(timestamp),
    provenance: { type: "object" },
    sessionId: nullable(uuid),
    workspaceId: nullable(uuid),
    turnId: nullable(uuid),
    cancellation: nullable(object({ state: text, attempts: positive })),
  }),
};
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 422, 429, 500, 503].map((code) => [
    code,
    {
      description:
        code === 429
          ? "Bounded admission or rate limit; Retry-After applies to rate rejection."
          : "Structured Harbor error; definitive 4xx is not an uncertain new operation.",
      content: { "application/json": { schema: ref("Error") } },
    },
  ]),
);
const operation = (
  scopes: string[],
  response: unknown,
  body?: unknown,
  status = 200,
  idempotent = true,
) => ({
  security: [{ ownerCookie: [] }, { personalToken: [] }],
  "x-required-token-scopes": scopes,
  description:
    "Current project grants and source-token execution ceiling apply. Standalone preparation requires workspace-write authority. Activation creates a bounded grant; logout preserves it, source-token revocation/expiry denies future dispatch. No schedule grant grants approval authority. Exact retained retries reconcile before current revision admission. Reuse identical timestamped key/body after lost response within 24h; never replay an uncertain native turn.",
  parameters: body
    ? [
        ...(idempotent
          ? [
              {
                in: "header",
                name: "Idempotency-Key",
                required: true,
                schema: { type: "string", pattern: "^[0-9]+:[0-9a-fA-F-]+$" },
              },
            ]
          : []),
        {
          in: "header",
          name: "Origin",
          required: false,
          schema: text,
          description:
            "Required exact application Origin for cookie mutations; unused for cookie-free bearer requests.",
        },
        {
          in: "header",
          name: "X-CSRF-Token",
          required: false,
          schema: text,
          description:
            "Required for cookie mutations; unused for cookie-free bearer requests.",
        },
      ]
    : [],
  ...(body
    ? {
        requestBody: {
          required: true,
          content: { "application/json": { schema: body } },
        },
      }
    : {}),
  responses: {
    [status]: {
      description: "Successful bounded result",
      content: { "application/json": { schema: response } },
    },
    ...errors,
  },
});
const manage = ["schedules:manage"],
  execute = [...manage, "execute"],
  read = ["schedules:read"];
const revisionBody = object({ expectedRevision: positive });
const preview = array(ref("ScheduleMinute"), 8);
const pageParameters = [
  { in: "query", name: "projectId", schema: uuid },
  {
    in: "query",
    name: "limit",
    schema: { ...positive, maximum: 50, default: 20 },
  },
  {
    in: "query",
    name: "cursor",
    schema: { ...text, maxLength: 1024 },
    description:
      "Opaque, filter/project-grant-bound cursor expires after five minutes.",
  },
];
const runs = () => ({
  ...operation(
    read,
    object({
      occurrences: array(ref("ScheduleOccurrence")),
      nextCursor: nullable(text),
      retention: object({
        days: { const: 90 },
        perSchedule: { const: 256 },
        unresolvedPreserved: { const: true },
      }),
    }),
  ),
  parameters: pageParameters,
});
export const schedulePaths: Record<string, any> = {
  "/schedules": {
    get: {
      ...operation(
        read,
        object({
          schedules: array(ref("Schedule")),
          nextCursor: nullable(text),
          limits: object({
            enabledPerProject: { const: 16 },
            enabledGlobal: { const: 64 },
            retainedPerProject: { const: 64 },
            retainedGlobal: { const: 256 },
          }),
        }),
      ),
      parameters: [
        ...pageParameters,
        { in: "query", name: "q", schema: { ...text, maxLength: 120 } },
        {
          in: "query",
          name: "state",
          schema: { enum: ["all", ...state.enum], default: "all" },
        },
      ],
    },
    post: operation(
      execute,
      object({ id: uuid, grantId: uuid, revision: positive, preview }),
      ref("ScheduleInput"),
      201,
    ),
  },
  "/schedules/preview": {
    post: operation(
      read,
      object({
        preview,
        timeEngine: object({
          node: text,
          icu: text,
          tz: text,
          polyfill: text,
          policy: text,
          digest: text,
        }),
      }),
      object({ projectId: uuid, rule }),
      200,
      false,
    ),
  },
  "/schedules/{id}": {
    get: operation(read, object({ schedule: ref("Schedule") })),
    put: operation(
      execute,
      object({ schedule: result }),
      object({ expectedRevision: positive, schedule: ref("ScheduleInput") }),
    ),
  },
  "/schedules/{id}/activation": {
    post: operation(
      execute,
      object({ grantId: uuid, epoch: positive, preview, schedule: result }),
      object(
        {
          expectedRevision: positive,
          grantDays: { ...positive, maximum: 90, default: 30 },
        },
        ["expectedRevision"],
      ),
    ),
  },
  "/schedules/{id}/pause": {
    post: operation(manage, object({ schedule: result }), revisionBody),
  },
  "/schedules/{id}/runs": {
    get: runs(),
    post: operation(
      execute,
      object({
        occurrence: object({ id: uuid, state: { const: "accepted" } }),
        schedule: result,
      }),
      revisionBody,
      202,
    ),
  },
  "/schedules/{id}/runs/{occurrenceId}/cancel": {
    post: operation(
      [...manage, "cancel"],
      {
        type: "object",
        required: ["occurrence"],
        properties: {
          occurrence: object({ id: uuid, state: text }),
          operation: object(
            { id: uuid, state: text, control_attempts: positive },
            ["id", "state"],
          ),
          message: text,
        },
        additionalProperties: true,
      },
      object({ expectedAttempt: { ...positive, maximum: 3, default: 1 } }, []),
      202,
    ),
  },
  "/schedule-attention": { get: runs() },
};
for (const [path, item] of Object.entries(schedulePaths)) {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  if (names.length)
    item.parameters = names.map((name) => ({
      in: "path",
      name,
      required: true,
      schema: uuid,
    }));
}
