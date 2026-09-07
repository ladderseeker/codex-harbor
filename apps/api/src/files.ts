import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import {
  randomUUID,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import { registerProgrammaticRoute } from "./token-access.ts";
import {
  requireAuthority,
  type Scope,
} from "../../../packages/policy/src/authority.ts";
import { HarborError } from "../../../packages/policy/src/index.ts";
import { selectedWorkspace } from "../../../packages/workspaces/src/service.ts";
import { readWorkspaceFile } from "../../../infra/files/client.ts";
import { workspaceFileCommand } from "../../../packages/files/src/workspace.ts";
import {
  saveFileSchema,
  stageFileSchema,
  commitFileSchema,
  inspectFileSchema,
  releaseFileSchema,
  fileOperationView,
} from "../../../packages/files/src/api.ts";
import {
  FILE_LIMITS,
  type FileAction,
} from "../../../packages/files/src/types.ts";
const prefix = "/api/v1/workspaces/:id";
export function fileRoutes(
  app: FastifyInstance,
  context: {
    pool: Pool;
    c: Config;
    actor(req: any): string;
    command(
      req: any,
      fn: (db: PoolClient) => Promise<unknown>,
    ): Promise<unknown>;
  },
) {
  const { pool, c, actor, command } = context,
    secret = randomBytes(32);
  const author = {
    name: process.env.HARBOR_GIT_AUTHOR_NAME ?? "Harbor owner",
    email: process.env.HARBOR_GIT_AUTHOR_EMAIL ?? "harbor@localhost",
  };
  if (
    !/^[^<>\r\n\0]{1,120}$/.test(author.name) ||
    !/^[^<>\s\0]{1,200}@[^<>\s\0]{1,200}$/.test(author.email)
  )
    throw Error("Invalid managed Git author configuration");
  const scope = (action: FileAction, write = false): Scope =>
    ((["status", "diff", "stage", "unstage", "commit"].includes(action)
      ? "git:"
      : "files:") + (write ? "write" : "read")) as Scope;
  const authorize = async (
    db: Pool | PoolClient,
    req: any,
    w: any,
    need: Scope,
  ) =>
    requireAuthority(db, actor(req), c, {
      scope: need,
      projectId: w.project_id,
      ...(need.endsWith(":write")
        ? { permissionProfile: "workspace-write" }
        : {}),
    });
  const cursor = (value: any) => {
    const body = Buffer.from(
      JSON.stringify({ ...value, expires: Date.now() + 300000 }),
    ).toString("base64url");
    return (
      body + "." + createHmac("sha256", secret).update(body).digest("base64url")
    );
  };
  const decode = (
    token: string,
    workspace: string,
    action: string,
    ref: string,
  ) => {
    try {
      const [body, signature] = token.split(".");
      const expected = createHmac("sha256", secret).update(body!).digest();
      const actual = Buffer.from(signature!, "base64url");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw Error();
      const v = JSON.parse(Buffer.from(body!, "base64url").toString());
      if (
        v.expires < Date.now() ||
        v.workspace !== workspace ||
        v.action !== action ||
        v.ref !== ref
      )
        throw Error();
      return v;
    } catch {
      throw new HarborError(
        409,
        "FILE_RESYNC",
        "File view changed; refresh the listing",
      );
    }
  };
  const register = (method: string, path: string, need: Scope) =>
    registerProgrammaticRoute(method, path, {
      scope: need,
      resource: async (db, req) => ({
        projectId: (await selectedWorkspace(db, req.params.id)).project_id,
        ...(need.endsWith(":write")
          ? { permissionProfile: "workspace-write" }
          : {}),
      }),
    });
  for (const [suffix, action] of [
    ["files/tree", "tree"],
    ["files/search", "search"],
    ["files/content", "content"],
    ["files/download", "download"],
    ["git/status", "status"],
    ["git/diff", "diff"],
  ] as const) {
    const route = prefix + "/" + suffix;
    register("GET", route, scope(action));
    app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
      route,
      async (req, reply) => {
        const w = await selectedWorkspace(pool, req.params.id);
        await authorize(pool, req, w, scope(action));
        if (!["ready", "archived"].includes(w.state))
          throw new HarborError(
            409,
            "WORKSPACE_UNAVAILABLE",
            "Workspace is unavailable",
          );
        const q = req.query,
          ref =
            q.ref ??
            (q.path
              ? req.params.id + ":" + Buffer.from(q.path).toString("base64url")
              : req.params.id + ":"),
          payload: Record<string, unknown> = { ref };
        if (q.cursor)
          Object.assign(payload, decode(q.cursor, w.id, action, ref));
        if (action === "tree")
          payload.limit = z.coerce
            .number()
            .int()
            .min(1)
            .max(200)
            .default(200)
            .parse(q.limit);
        if (
          action === "search" &&
          q.cursor &&
          (payload.q !== q.q || payload.mode !== (q.mode ?? "filename"))
        )
          throw new HarborError(
            409,
            "FILE_RESYNC",
            "Search filters changed; start a new bounded search",
          );
        if (action === "search")
          Object.assign(payload, {
            q: z.string().min(1).max(120).parse(q.q),
            mode: z
              .enum(["filename", "text"])
              .default("filename")
              .parse(q.mode),
          });
        if (action === "diff")
          payload.side = z.enum(["staged", "unstaged"]).parse(q.side);
        if (q.revision) payload.revision = q.revision;
        let result: any;
        try {
          result = await readWorkspaceFile(
            workspaceFileCommand(w, action, payload),
          );
        } catch (error) {
          throw new HarborError(
            (error as any).code === "FILE_CAPACITY" ? 429 : 409,
            (error as any).code ?? "FILE_UNAVAILABLE",
            "File view is unavailable or changed; refresh it",
          );
        }
        await authorize(pool, req, w, scope(action));
        if (action === "download") {
          const bytes = Buffer.from(result.data, "base64");
          if (bytes.length > FILE_LIMITS.downloadBytes)
            throw new HarborError(
              413,
              "FILE_TOO_LARGE",
              "Download limit exceeded",
            );
          reply
            .header("content-type", "application/octet-stream")
            .header(
              "content-disposition",
              `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(result.name).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
            )
            .header("x-content-type-options", "nosniff")
            .header("cache-control", "no-store");
          let stopped = false;
          const stream = Readable.from(
            (async function* () {
              for (let offset = 0; offset < bytes.length; offset += 65536) {
                if (stopped) return;
                await authorize(pool, req, w, "files:read");
                yield bytes.subarray(offset, offset + 65536);
              }
            })(),
          );
          const deadline = setTimeout(() => {
            stopped = true;
            stream.destroy();
          }, 30000);
          stream.on("close", () => {
            stopped = true;
            clearTimeout(deadline);
          });
          reply.raw.on("close", () => {
            stopped = true;
            stream.destroy();
          });
          return reply.send(stream);
        }
        if (action === "search") {
          result.cursor = result.nextPage
            ? cursor({
                workspace: w.id,
                action,
                ref,
                q: payload.q,
                mode: payload.mode,
                ...result.nextPage,
              })
            : null;
          delete result.nextPage;
        }
        if (action === "tree") {
          const current = await selectedWorkspace(pool, w.id);
          await authorize(pool, req, current, "files:read");
          result.workspace = {
            kind: current.kind,
            state: current.state,
            writerKind: current.writer_kind,
            writerEpoch: Number(current.writer_epoch),
          };
          result.cursor =
            result.nextOffset === null
              ? null
              : cursor({
                  workspace: w.id,
                  action,
                  ref,
                  offset: result.nextOffset,
                  revision: result.revision,
                });
          delete result.nextOffset;
        }
        if (action === "status") {
          const offset = q.cursor
            ? Number(decode(q.cursor, w.id, action, ref).offset)
            : 0;
          if (
            q.cursor &&
            decode(q.cursor, w.id, action, ref).revision !== result.revision
          )
            throw new HarborError(409, "GIT_CHANGED", "Git review changed");
          const all = result.entries;
          result.entries = all.slice(offset, offset + 200);
          result.cursor =
            offset + 200 < all.length
              ? cursor({
                  workspace: w.id,
                  action,
                  ref,
                  offset: offset + 200,
                  revision: result.revision,
                })
              : null;
          result.author = author;
          result.managedProfile = {
            hooks: false,
            filters: false,
            network: false,
          };
        }
        return result;
      },
    );
  }
  for (const kind of ["save", "stage", "unstage", "commit"] as const) {
    const route = prefix + (kind === "save" ? "/files/save" : "/git/" + kind),
      need = scope(kind, true);
    register("POST", route, need);
    app.post<{ Params: { id: string } }>(
      route,
      { bodyLimit: 2097152 },
      async (req, reply) => {
        const parsed = (
          kind === "save"
            ? saveFileSchema
            : kind === "commit"
              ? commitFileSchema
              : stageFileSchema
        ).parse(req.body);
        const result = await command(req, async (db) => {
          if (process.platform !== "linux")
            throw new HarborError(
              503,
              "FILE_NATIVE_FILESYSTEM_REQUIRED",
              "Managed file writes require the supported Linux filesystem boundary",
            );
          const w = await selectedWorkspace(db, req.params.id, true);
          await authorize(db, req, w, need);
          if (c.HARBOR_PERMISSION_CEILING !== "workspace-write")
            throw new HarborError(
              403,
              "PERMISSION_DENIED",
              "Managed file writes are disabled",
            );
          if (w.state !== "ready" || w.project_archived || w.archived_at)
            throw new HarborError(
              409,
              "WORKSPACE_UNAVAILABLE",
              "Workspace is unavailable or archived",
            );
          const uncertain = await db.query(
            "SELECT 1 FROM file_operations WHERE workspace_id=$1 AND state='uncertain' AND acknowledged_at IS NULL UNION ALL SELECT 1 FROM operations o JOIN sessions s ON s.id=o.session_id WHERE s.workspace_id=$1 AND o.state='uncertain' AND o.uncertainty_acknowledged_at IS NULL LIMIT 1",
            [w.id],
          );
          if (uncertain.rowCount || w.writer_kind === "terminal")
            throw new HarborError(
              409,
              "FILE_WORKSPACE_BLOCKED",
              "Resolve the workspace's existing uncertain or terminal ownership before requesting a new file mutation",
            );
          await db.query("SELECT pg_advisory_xact_lock(740018)");
          const count = (
            await db.query(
              "SELECT count(*)::int AS total,count(*) FILTER(WHERE workspace_id=$1)::int AS local,count(*) FILTER(WHERE workspace_id=$1 AND state='queued')::int AS queued,coalesce(sum(payload_bytes),0)::bigint AS bytes,coalesce(sum(payload_bytes) FILTER(WHERE workspace_id=$1),0)::bigint AS local_bytes FROM file_operations",
              [w.id],
            )
          ).rows[0];
          const payload = {
              ...parsed,
              ...(kind === "commit"
                ? { author, timestamp: Math.floor(Date.now() / 1000) }
                : {}),
            },
            bytes = Buffer.byteLength(JSON.stringify(payload));
          if (
            count.total >= 4096 ||
            count.local >= 128 ||
            count.queued >= 4 ||
            Number(count.bytes) + bytes > 67108864 ||
            Number(count.local_bytes) + bytes > 16777216
          )
            throw new HarborError(
              429,
              "FILE_QUOTA",
              "File operation capacity reached; existing operations remain recoverable",
            );
          const inspected = await readWorkspaceFile(
            workspaceFileCommand(
              w,
              kind === "save" ? "content" : "status",
              kind === "save" ? { ref: (parsed as any).ref } : {},
            ),
          );
          if (inspected.revision !== (parsed as any).expectedRevision)
            throw new HarborError(
              409,
              kind === "save" ? "FILE_CHANGED" : "GIT_CHANGED",
              "The reviewed revision changed; retain your draft and refresh the review",
            );
          await authorize(db, req, w, need);
          const id = randomUUID(),
            row = (
              await db.query(
                "INSERT INTO file_operations(id,workspace_id,project_id,actor_hash,kind,state,payload,payload_bytes,request_hash) VALUES($1,$2,$3,$4,$5,'queued',$6,$7,$8) RETURNING *",
                [
                  id,
                  w.id,
                  w.project_id,
                  actor(req),
                  kind,
                  JSON.stringify(payload),
                  bytes,
                  createHmac("sha256", secret)
                    .update(JSON.stringify(payload))
                    .digest("hex"),
                ],
              )
            ).rows[0];
          return { operation: fileOperationView(row) };
        });
        return reply.code(202).send(result);
      },
    );
  }
  for (const group of ["files", "git"] as const) {
    const route = prefix + "/" + group + "/operations",
      need = (group + ":read") as Scope;
    register("GET", route, need);
    app.get<{ Params: { id: string } }>(route, async (req) => {
      const w = await selectedWorkspace(pool, req.params.id);
      await authorize(pool, req, w, need);
      const rows = (
        await pool.query(
          "SELECT * FROM file_operations WHERE workspace_id=$1 AND (kind='save')=$2 ORDER BY created_at DESC,id DESC LIMIT 128",
          [w.id, group === "files"],
        )
      ).rows;
      await authorize(pool, req, w, need);
      return { operations: rows.map(fileOperationView) };
    });
  }
  const viewers = new Map<string, number>();
  const closeStreams = new Set<() => void>();
  app.addHook("preClose", async () => {
    for (const close of closeStreams) close();
  });
  register("GET", prefix + "/files/events", "files:read");
  app.get<{
    Params: { id: string };
    Querystring: { cursor?: string; ref?: string; fileRef?: string };
  }>(prefix + "/files/events", async (req, reply) => {
    const w = await selectedWorkspace(pool, req.params.id);
    await authorize(pool, req, w, "files:read");
    const viewer = actor(req);
    if (
      (viewers.get(viewer) ?? 0) >= 4 ||
      [...viewers.values()].reduce((a, b) => a + b, 0) >= 32
    )
      throw new HarborError(
        429,
        "FILE_VIEWERS",
        "File watcher capacity reached",
      );
    const ref = req.query.ref ?? w.id + ":";
    const fileRef = z.string().max(6000).optional().parse(req.query.fileRef);
    let sequence = z.coerce
        .number()
        .int()
        .nonnegative()
        .default(0)
        .parse(req.headers["last-event-id"] ?? req.query.cursor),
      closed = false,
      busy = false,
      revision: string | undefined,
      fileRevision: string | undefined;
    viewers.set(viewer, (viewers.get(viewer) ?? 0) + 1);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const close = () => {
      if (closed) return;
      closed = true;
      closeStreams.delete(close);
      const count = (viewers.get(viewer) ?? 1) - 1;
      if (count) viewers.set(viewer, count);
      else viewers.delete(viewer);
      clearInterval(timer);
      reply.raw.end();
    };
    const send = (type: string, data: any, id?: number) => {
      if (closed || reply.raw.destroyed || reply.raw.writableEnded) return;
      if (reply.raw.writableLength > 65536) {
        close();
        return;
      }
      reply.raw.write(
        `${id === undefined ? "" : `id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
      );
    };
    const poll = async () => {
      if (busy || closed) return;
      busy = true;
      try {
        await authorize(pool, req, w, "files:read");
        const latest = Number(
          (
            await pool.query(
              "SELECT files_revision FROM workspaces WHERE id=$1",
              [w.id],
            )
          ).rows[0].files_revision,
        );
        const events = (
          await pool.query(
            "SELECT sequence,data FROM file_events WHERE workspace_id=$1 AND sequence>$2 AND created_at>=clock_timestamp()-interval '1 hour' ORDER BY sequence LIMIT 1000",
            [w.id, sequence],
          )
        ).rows;
        await authorize(pool, req, w, "files:read");
        if (
          sequence < latest &&
          (!events.length || Number(events[0].sequence) !== sequence + 1)
        ) {
          send("resync", { sequence: latest });
          sequence = latest;
        } else
          for (const e of events) {
            sequence = Number(e.sequence);
            send("invalidate", e.data, sequence);
          }
        const tree = await readWorkspaceFile(
          workspaceFileCommand(w, "tree", { ref, limit: 200 }),
        );
        await authorize(pool, req, w, "files:read");
        let observedFile: string | undefined;
        if (fileRef) {
          try {
            const observed = await readWorkspaceFile(
              workspaceFileCommand(w, "content", { ref: fileRef }),
            );
            observedFile = JSON.stringify([
              observed.status,
              observed.revision,
              observed.reason,
            ]);
          } catch (error) {
            if ((error as any).code !== "FILE_MISSING") throw error;
            observedFile = "missing";
          }
          await authorize(pool, req, w, "files:read");
        }
        const fileChanged =
          fileRevision !== undefined && fileRevision !== observedFile;
        if (
          (revision !== undefined && revision !== tree.revision) ||
          fileChanged
        ) {
          const next = await pool.connect();
          try {
            await next.query("BEGIN");
            const n = Number(
              (
                await next.query(
                  "UPDATE workspaces SET files_revision=files_revision+1 WHERE id=$1 RETURNING files_revision",
                  [w.id],
                )
              ).rows[0].files_revision,
            );
            await next.query(
              "INSERT INTO file_events(workspace_id,sequence,data) VALUES($1,$2,$3)",
              [
                w.id,
                n,
                JSON.stringify(
                  fileChanged
                    ? { type: "file.changed", ref: fileRef }
                    : { type: "directory.changed", ref },
                ),
              ],
            );
            await next.query(
              "DELETE FROM file_events WHERE workspace_id=$1 AND (sequence<=$2-1000 OR created_at<clock_timestamp()-interval '1 hour')",
              [w.id, n],
            );
            await next.query("COMMIT");
          } catch (error) {
            await next.query("ROLLBACK");
            throw error;
          } finally {
            next.release();
          }
        }
        revision = tree.revision;
        fileRevision = observedFile;
        await authorize(pool, req, w, "files:read");
        send("heartbeat", { sequence });
      } catch {
        close();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void poll(), 2000);
    closeStreams.add(close);
    req.raw.on("close", close);
    if (
      req.headers["last-event-id"] === undefined &&
      req.query.cursor === undefined
    )
      send("resync", { sequence });
    void poll();
  });
  const opRoute = prefix + "/file-operations/:operationId";
  const operation = async (db: Pool | PoolClient, req: any) => {
    const row = (
      await db.query(
        "SELECT * FROM file_operations WHERE id=$1 AND workspace_id=$2",
        [req.params.operationId, req.params.id],
      )
    ).rows[0];
    if (!row)
      throw new HarborError(404, "NOT_FOUND", "File operation not found");
    return row;
  };
  for (const [method, suffix, write] of [
    ["GET", "", false],
    ["POST", "/inspect", true],
    ["POST", "/release", true],
  ] as const)
    registerProgrammaticRoute(method, opRoute + suffix, {
      scope: async (db, req) => scope((await operation(db, req)).kind, write),
      resource: async (db, req) => ({
        projectId: (await selectedWorkspace(db, req.params.id)).project_id,
        ...(write ? { permissionProfile: "workspace-write" } : {}),
      }),
    });
  app.get<{ Params: { id: string; operationId: string } }>(
    opRoute,
    async (req) => {
      const row = await operation(pool, req),
        w = await selectedWorkspace(pool, req.params.id);
      await authorize(pool, req, w, scope(row.kind));
      const inspection = (
        await pool.query(
          "SELECT id,state,attempts,expected_epoch,fence,report FROM file_inspections WHERE operation_id=$1",
          [row.id],
        )
      ).rows[0];
      await authorize(pool, req, w, scope(row.kind));
      return {
        operation: fileOperationView(row),
        inspection: inspection
          ? {
              id: inspection.id,
              state: inspection.state,
              attempts: inspection.attempts,
              expectedEpoch: Number(inspection.expected_epoch),
              fence:
                inspection.fence === null ? null : Number(inspection.fence),
              report: inspection.report
                ? {
                    ...inspection.report,
                    ...(inspection.report.recorded
                      ? {
                          recorded: fileOperationView({
                            result: inspection.report.recorded,
                          }).result,
                        }
                      : {}),
                    ...(inspection.report.result
                      ? {
                          result: fileOperationView({
                            result: inspection.report.result,
                          }).result,
                        }
                      : {}),
                  }
                : null,
            }
          : null,
      };
    },
  );
  app.post<{ Params: { id: string; operationId: string } }>(
    opRoute + "/inspect",
    async (req, reply) => {
      const b = inspectFileSchema.parse(req.body),
        result = await command(req, async (db) => {
          const w = await selectedWorkspace(db, req.params.id, true),
            row = await operation(db, req);
          await authorize(db, req, w, scope(row.kind, true));
          if (
            row.state !== "uncertain" ||
            w.writer_kind !== "file" ||
            w.writer_owner_id !== row.id ||
            Number(w.writer_epoch) !== b.expectedEpoch
          )
            throw new HarborError(
              409,
              "FILE_OWNERSHIP",
              "File operation reservation changed",
            );
          const current = (
            await db.query(
              "SELECT * FROM file_inspections WHERE operation_id=$1 FOR UPDATE",
              [row.id],
            )
          ).rows[0];
          if (current) {
            if (
              !b.inspectionId ||
              current.id !== b.inspectionId ||
              current.state !== "failed" ||
              current.attempts !== b.expectedAttempt ||
              current.attempts >= 3
            )
              throw new HarborError(
                409,
                "FILE_INSPECTION",
                "Inspection attempt changed or exhausted",
              );
            await db.query(
              "UPDATE file_inspections SET state='queued',attempts=attempts+1,actor_hash=$2,updated_at=now() WHERE id=$1",
              [current.id, actor(req)],
            );
            return { inspectionId: current.id };
          }
          if (b.inspectionId)
            throw new HarborError(
              409,
              "FILE_INSPECTION",
              "Inspection not found",
            );
          const id = randomUUID();
          await db.query(
            "INSERT INTO file_inspections(id,operation_id,actor_hash,expected_epoch,state) VALUES($1,$2,$3,$4,'queued')",
            [id, row.id, actor(req), b.expectedEpoch],
          );
          return { inspectionId: id };
        });
      return reply.code(202).send(result);
    },
  );
  app.post<{ Params: { id: string; operationId: string } }>(
    opRoute + "/release",
    async (req) => {
      const b = releaseFileSchema.parse(req.body);
      return command(req, async (db) => {
        const w = await selectedWorkspace(db, req.params.id, true),
          row = await operation(db, req);
        await authorize(db, req, w, scope(row.kind, true));
        const inspection = (
          await db.query(
            "SELECT * FROM file_inspections WHERE id=$1 AND operation_id=$2 FOR UPDATE",
            [b.inspectionId, row.id],
          )
        ).rows[0];
        if (
          !inspection ||
          inspection.state !== "ready" ||
          Number(inspection.fence) !== b.expectedEpoch ||
          w.writer_kind !== "file" ||
          w.writer_owner_id !== row.id ||
          Number(w.writer_epoch) !== b.expectedEpoch
        )
          throw new HarborError(
            409,
            "FILE_OWNERSHIP",
            "Inspection or reservation changed",
          );
        await db.query(
          "UPDATE file_operations SET acknowledged_at=now(),payload=NULL,payload_bytes=0,updated_at=now() WHERE id=$1 AND state='uncertain'",
          [row.id],
        );
        await db.query(
          "UPDATE workspaces SET writer_kind=NULL,writer_owner_id=NULL,writer_generation=NULL WHERE id=$1",
          [w.id],
        );
        await db.query(
          "UPDATE file_inspections SET state='consumed',updated_at=now() WHERE id=$1",
          [inspection.id],
        );
        await db.query(
          "INSERT INTO file_operation_audits(operation_id,slot,data) VALUES($1,3,$2) ON CONFLICT DO NOTHING",
          [
            row.id,
            JSON.stringify({ type: "acknowledged", epoch: b.expectedEpoch }),
          ],
        );
        return { released: true, operationId: row.id };
      });
    },
  );
}
