const str = { type: "string" },
  uuid = { type: "string", format: "uuid" },
  integer = { type: "integer", minimum: 0 },
  nullableString = { type: ["string", "null"] };
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: true });
const array = (items: unknown, maxItems?: number) => ({
  type: "array",
  items,
  ...(maxItems ? { maxItems } : {}),
});
const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const identity = { type: "string", maxLength: 6000 };
export const fileSchemas = {
  FileEntry: object({
    ref: identity,
    name: str,
    kind: { enum: ["file", "directory", "symlink", "unavailable"] },
    size: integer,
    revision: str,
  }),
  FileOperation: object({
    id: uuid,
    workspaceId: uuid,
    kind: { enum: ["save", "stage", "unstage", "commit"] },
    state: {
      enum: ["queued", "dispatching", "succeeded", "failed", "uncertain"],
    },
    epoch: { type: ["integer", "null"] },
    result: { type: ["object", "null"] },
    failureCode: nullableString,
    acknowledgedAt: nullableString,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  }),
  FileInspection: object(
    {
      id: uuid,
      state: { enum: ["queued", "inspecting", "ready", "failed", "consumed"] },
      attempts: { type: "integer", minimum: 1, maximum: 3 },
      fence: { type: ["integer", "null"] },
      report: { type: ["object", "null"] },
    },
    ["id", "state", "attempts", "fence", "report"],
  ),
  FileContent: {
    oneOf: [
      object({ status: { const: "unavailable" }, reason: str }),
      object(
        {
          status: { enum: ["text", "binary"] },
          ref: identity,
          name: str,
          revision: str,
          size: integer,
          text: { type: "string", maxLength: 1048576 },
        },
        ["status", "ref", "name", "revision", "size"],
      ),
    ],
  },
  GitEntry: object(
    {
      ref: identity,
      path: str,
      index: str,
      worktree: str,
      conflict: { type: "boolean" },
      fileRevision: str,
      renameFrom: identity,
      unavailable: str,
    },
    ["ref", "path", "index", "worktree", "conflict"],
  ),
  GitStatus: object({
    head: object({ target: str, oid: nullableString, headBytes: str }),
    indexRevision: str,
    revision: str,
    entries: array(ref("GitEntry"), 200),
    complete: { type: "boolean" },
    cursor: nullableString,
    author: object({ name: str, email: str }),
    managedProfile: object({
      hooks: { const: false },
      filters: { const: false },
      network: { const: false },
    }),
  }),
  GitDiff: object(
    {
      status: {
        enum: ["text", "binary", "oversized", "unavailable", "conflict"],
      },
      ref: identity,
      revision: str,
      hunks: array(object({ id: str, text: str }), 2000),
      oldText: nullableString,
      newText: nullableString,
      oldMode: nullableString,
      newMode: nullableString,
      wholeFileOnly: { type: "boolean" },
      oldSha256: str,
      newSha256: str,
      side: { enum: ["staged", "unstaged"] },
    },
    ["status", "ref", "revision", "hunks"],
  ),
};
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 429, 503].map((n) => [
    String(n),
    {
      description:
        "Bounded rejection or unavailable outcome; inspect error.code. Retry the exact key/input only for ambiguous delivery. Quota does not consume reserved recovery aliases.",
      content: { "application/json": { schema: ref("Error") } },
    },
  ]),
);
const read = (schema: unknown, scope: string) => ({
  security: [{ ownerCookie: [] }, { personalToken: [] }],
  "x-required-token-scope": scope,
  responses: {
    "200": {
      description: "Current authorized bounded view",
      content: { "application/json": { schema } },
    },
    ...errors,
  },
});
const query = (name: string, schema: unknown = str, required = false) => ({
  in: "query",
  name,
  schema,
  required,
});
const mutation = (
  schema: unknown,
  result: unknown,
  scope: string,
  status = 202,
) => ({
  ...read(result, scope),
  parameters: [
    {
      in: "header",
      name: "Idempotency-Key",
      required: true,
      schema: { type: "string", pattern: "^[0-9]{13}:[0-9a-f-]{36}$" },
      description:
        "Timestamped immutable intent; exact retries return the retained operation without replaying the effect.",
    },
    {
      in: "header",
      name: "Origin",
      required: false,
      schema: str,
      description:
        "Exact application Origin required for cookie mutations; bearer requests do not use it.",
    },
    {
      in: "header",
      name: "X-CSRF-Token",
      required: false,
      schema: str,
      description: "Required for cookie mutations only.",
    },
  ],
  requestBody: { required: true, content: { "application/json": { schema } } },
  responses: {
    [String(status)]: {
      description: "Durable operation or reconciled original result",
      content: { "application/json": { schema: result } },
    },
    ...errors,
  },
});
const operation = object({ operation: ref("FileOperation") }),
  path = "/workspaces/{id}";
const save = object({
  ref: identity,
  expectedRevision: str,
  text: { type: "string", maxLength: 1048576 },
});
const selection = {
  ...object(
    { ref: identity, wholeFile: { const: true }, hunkIds: array(str, 2000) },
    ["ref"],
  ),
  oneOf: [
    { required: ["wholeFile"], not: { required: ["hunkIds"] } },
    { required: ["hunkIds"], not: { required: ["wholeFile"] } },
  ],
};
export const filePaths: Record<string, any> = {
  [path + "/files/tree"]: {
    get: {
      ...read(
        object({
          workspace: object({
            kind: { enum: ["local", "copy", "worktree"] },
            state: str,
            writerKind: {
              type: ["string", "null"],
              enum: ["conversation", "file", "terminal", null],
            },
            writerEpoch: integer,
          }),
          entries: array(ref("FileEntry"), 200),
          revision: str,
          cursor: nullableString,
          truncated: { type: "boolean" },
        }),
        "files:read",
      ),
      parameters: [
        query("ref", identity),
        query("path"),
        query("cursor"),
        query("limit", { type: "integer", minimum: 1, maximum: 200 }),
      ],
    },
  },
  [path + "/files/search"]: {
    get: {
      ...read(
        object({
          matches: array(
            object(
              {
                ref: identity,
                path: str,
                line: integer,
                snippet: str,
                revision: str,
              },
              ["ref", "path"],
            ),
            200,
          ),
          visited: integer,
          inspectedBytes: integer,
          skipped: integer,
          truncated: { type: "boolean" },
          cursor: nullableString,
        }),
        "files:read",
      ),
      parameters: [
        query("q", { type: "string", minLength: 1, maxLength: 120 }, true),
        query("mode", { enum: ["filename", "text"] }),
        query("cursor"),
      ],
    },
  },
  [path + "/files/content"]: {
    get: {
      ...read(ref("FileContent"), "files:read"),
      parameters: [query("ref", identity, true)],
    },
  },
  [path + "/files/download"]: {
    get: {
      ...read({}, "files:read"),
      parameters: [query("ref", identity, true), query("revision", str, true)],
      responses: {
        "200": {
          description:
            "Exact inspected bytes, <=16 MiB, attachment disposition, no-store, nosniff; current authority rechecked during transfer",
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        ...errors,
      },
    },
  },
  [path + "/files/save"]: { post: mutation(save, operation, "files:write") },
  [path + "/git/status"]: {
    get: {
      ...read(ref("GitStatus"), "git:read"),
      parameters: [query("cursor")],
    },
  },
  [path + "/git/diff"]: {
    get: {
      ...read(ref("GitDiff"), "git:read"),
      parameters: [
        query("ref", identity, true),
        query("side", { enum: ["staged", "unstaged"] }, true),
      ],
    },
  },
  [path + "/git/stage"]: {
    post: mutation(
      object({ expectedRevision: str, selections: array(selection, 100) }),
      operation,
      "git:write",
    ),
  },
  [path + "/git/unstage"]: {
    post: mutation(
      object({ expectedRevision: str, selections: array(selection, 100) }),
      operation,
      "git:write",
    ),
  },
  [path + "/git/commit"]: {
    post: mutation(
      object({
        expectedRevision: str,
        selectedRefs: array(identity, 100),
        message: { type: "string", minLength: 1, maxLength: 8192 },
      }),
      operation,
      "git:write",
    ),
  },
  [path + "/file-operations/{operationId}"]: {
    get: read(
      object({
        operation: ref("FileOperation"),
        inspection: { anyOf: [ref("FileInspection"), { type: "null" }] },
      }),
      "files:read for save; git:read for Git operations",
    ),
  },
  [path + "/file-operations/{operationId}/inspect"]: {
    post: mutation(
      object(
        {
          expectedEpoch: { type: "integer", minimum: 1 },
          inspectionId: uuid,
          expectedAttempt: { type: "integer", minimum: 1, maximum: 2 },
        },
        ["expectedEpoch"],
      ),
      object({ inspectionId: uuid }),
      "files:write for save; git:write for Git operations",
    ),
  },
  [path + "/file-operations/{operationId}/release"]: {
    post: mutation(
      object({
        expectedEpoch: { type: "integer", minimum: 1 },
        inspectionId: uuid,
        acknowledgeUnknownEffects: { const: true },
      }),
      object({ released: { const: true } }),
      "files:write for save; git:write for Git operations",
      200,
    ),
  },
  [path + "/files/events"]: {
    get: {
      ...read({}, "files:read"),
      parameters: [
        query("cursor", integer),
        query("ref", identity),
        query("fileRef", identity),
        { in: "header", name: "Last-Event-ID", schema: str },
      ],
      responses: {
        "200": {
          description:
            "Bounded invalidations; resync means reread the view, never replace an unsaved draft",
          content: { "text/event-stream": { schema: str } },
        },
        ...errors,
      },
    },
  },
};
for (const group of ["files", "git"])
  filePaths[path + "/" + group + "/operations"] = {
    get: read(
      object({ operations: array(ref("FileOperation"), 128) }),
      group + ":read",
    ),
  };
