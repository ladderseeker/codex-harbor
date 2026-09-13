import { z } from "zod";
import {
  previewCreate,
  previewStart,
  previewStop,
  previewOpen,
} from "../../previews/src/contracts.ts";
const string = { type: "string" },
  uuid = { type: "string", format: "uuid" },
  integer = { type: "integer", minimum: 0 },
  nullable = { type: ["string", "null"] };
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
export const previewSchemas = {
  Preview: object({
    id: uuid,
    projectId: uuid,
    workspaceId: uuid,
    name: string,
    script: string,
    port: { type: "integer", minimum: 1024, maximum: 65535 },
    permissionProfile: { enum: ["read-only", "workspace-write"] },
    revision: { type: "integer", minimum: 1 },
    generation: integer,
    state: {
      enum: [
        "created",
        "queued",
        "starting",
        "ready",
        "stopping",
        "stopped",
        "exited",
        "failed",
        "uncertain",
      ],
    },
    retired: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    deadline: { type: ["string", "null"], format: "date-time" },
    failureCode: nullable,
    exitCode: { type: ["integer", "null"] },
    outputFloor: integer,
    outputLost: { type: "boolean" },
    stopAttempts: { type: "integer", minimum: 0, maximum: 3 },
    lastStopId: nullable,
  }),
};
const result = object({ preview: ref("Preview") });
const read = (schema: unknown, scope = "previews:read") => ({
  security: [
    { ownerCookie: [] },
    ...(scope === "browser" ? [] : [{ personalToken: [] }]),
  ],
  "x-required-scopes": scope === "browser" ? [] : [scope],
  responses: {
    200: {
      description: "Current preview metadata",
      content: { "application/json": { schema } },
    },
    ...Object.fromEntries(
      [400, 401, 403, 404, 409, 429, 503].map((code) => [
        code,
        {
          description: "Fail-closed bounded facade error",
          content: { "application/json": { schema: ref("Error") } },
        },
      ]),
    ),
  },
});
const mutation = (
  input: unknown,
  output: unknown,
  scope: string,
  status = 200,
  extraScopes: string[] = [],
) => {
  const op = read(output, scope);
  return {
    ...op,
    "x-required-scopes": scope === "browser" ? [] : [scope, ...extraScopes],
    parameters: [
      {
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: { type: "string", pattern: "^[0-9]{13}:[0-9a-f-]{36}$" },
        description:
          "Retained exact intent retry; no automatic process replay.",
      },
      {
        in: "header",
        name: "Origin",
        required: false,
        schema: string,
        description:
          "Exact Harbor Origin is required for cookie-authenticated mutations; bearer calls do not use it.",
      },
      {
        in: "header",
        name: "X-CSRF-Token",
        required: false,
        schema: string,
        description:
          "Required with the owner browser cookie; bearer calls do not use it.",
      },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema: input } },
    },
    responses: {
      ...op.responses,
      [status]: {
        description: "Accepted or exact retained result",
        content: { "application/json": { schema: output } },
      },
    },
  };
};
const edit = previewCreate
  .omit({ workspaceId: true })
  .extend({ expectedRevision: z.number().int().positive() });
export const previewPaths: Record<string, any> = {
  "/personal-preview-openings": {
    post: {
      ...mutation(
        object({
          workspaceId: uuid,
          port: { type: "integer", minimum: 1024, maximum: 65535 },
        }),
        object({
          bootstrapPath: string,
          expiresIn: { type: "integer", const: 30 },
        }),
        "browser",
      ),
      description:
        "Personal VPS only. Attach to an administrator-configured loopback development port. One-time opening expires in 30 seconds; viewer access expires after 15 minutes or API restart. Does not start or own the process.",
    },
  },
  "/personal-preview-openings/{id}": {
    get: {
      security: [{ ownerCookie: [] }],
      parameters: [{ in: "path", name: "id", required: true, schema: uuid }],
      responses: {
        200: {
          description:
            "Authenticated HTML body-only exchange into the configured separate HTTPS preview origin",
          content: { "text/html": { schema: string } },
        },
        410: { description: "Opening expired; prepare another from Harbor" },
      },
    },
  },
  "/workspaces/{id}/previews": {
    get: read(
      object({
        available: { type: "boolean" },
        previews: { type: "array", maxItems: 32, items: ref("Preview") },
      }),
    ),
  },
  "/previews": {
    post: mutation(
      z.toJSONSchema(previewCreate),
      result,
      "previews:manage",
      201,
      ["execute"],
    ),
  },
  "/previews/{id}": {
    get: read(result),
    patch: mutation(z.toJSONSchema(edit), result, "previews:manage", 200, [
      "execute",
    ]),
    delete: mutation(
      object({}),
      object({ removed: { const: true } }),
      "previews:manage",
      200,
      ["cancel"],
    ),
  },
  "/previews/{id}/start": {
    post: mutation(
      z.toJSONSchema(previewStart),
      result,
      "previews:manage",
      202,
      ["execute"],
    ),
  },
  "/previews/{id}/stop": {
    post: mutation(
      z.toJSONSchema(previewStop),
      object({ preview: ref("Preview"), stopId: nullable }),
      "previews:manage",
      202,
      ["cancel"],
    ),
  },
  "/previews/{id}/open": {
    post: mutation(
      z.toJSONSchema(previewOpen),
      object({ bootstrapPath: string, expiresIn: { const: 30 } }),
      "browser",
    ),
  },
  "/previews/{id}/logs": {
    get: {
      ...read(
        object({
          preview: ref("Preview"),
          gap: { type: "boolean" },
          cursor: integer,
          chunks: {
            type: "array",
            maxItems: 64,
            items: object({
              sequence: integer,
              generation: integer,
              dataBase64: { type: "string", maxLength: 21848 },
            }),
          },
        }),
      ),
      parameters: [
        { in: "query", name: "cursor", required: false, schema: integer },
      ],
    },
  },
  "/preview-openings/{id}": {
    get: {
      security: [{ ownerCookie: [] }],
      description:
        "Current owner browser only; returns a nonce-protected form which posts a single-use ticket in the body to the exact preview origin. The URL ID is not a credential.",
      responses: {
        200: {
          description: "Private preview bootstrap",
          content: { "text/html": { schema: string } },
        },
        410: { description: "Opening consumed or expired" },
      },
    },
  },
};
