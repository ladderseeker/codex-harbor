import { spawn } from "node:child_process";
import { publishPersonalAttachments } from "./personal.ts";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { transaction } from "../../storage/src/index.ts";
import {
  lockSession,
  operationAttachments,
  validateAttachmentModalities,
} from "./store.ts";
import type { NativeStorage } from "../../../infra/storage/admission.ts";
import type { AttachmentInput } from "../../codex-adapter/src/index.ts";
export async function prepareAttachments(
  pool: Pool,
  sessionId: string,
  operationId: string,
  workspace: string,
  fixture: boolean,
): Promise<{
  directory?: NativeStorage;
  project?: NativeStorage;
  inputs: AttachmentInput[];
}> {
  return transaction(pool, async (db) => {
    await lockSession(db, sessionId);
    const files = await operationAttachments(db, sessionId, operationId);
    const operation = (
      await db.query(
        "SELECT o.payload,p.root_id,p.relative_path AS project_relative,p.canonical_path AS project_path,p.device AS project_device,p.inode AS project_inode,w.canonical_path AS workspace_path FROM operations o JOIN sessions s ON s.id=o.session_id JOIN projects p ON p.id=s.project_id JOIN workspaces w ON w.id=s.workspace_id AND w.project_id=p.id WHERE o.id=$1 AND o.session_id=$2",
        [operationId, sessionId],
      )
    ).rows[0];
    if (!operation || operation.workspace_path !== workspace)
      throw Error("Attachment operation workspace unavailable");
    await validateAttachmentModalities(db, files, operation.payload.model);
    const inputs: AttachmentInput[] = files.map((f) => ({
      id: f.id,
      kind: ["image/png", "image/jpeg"].includes(f.media_type)
        ? "image"
        : "text",
      name: f.name,
      path: `/attachments/${f.id}`,
    }));
    if (
      process.env.HARBOR_LOCAL_MODE === "personal" ||
      process.env.HARBOR_PERSONAL_VPS_MODE === "personal"
    ) {
      if (!inputs.length) return { inputs };
      const directory = (
        await db.query(
          "SELECT canonical,device,inode FROM session_attachment_storage WHERE session_id=$1",
          [sessionId],
        )
      ).rows[0];
      const result = await publishPersonalAttachments(
        sessionId,
        workspace,
        directory,
        files,
      );
      await db.query(
        "INSERT INTO session_attachment_storage(session_id,canonical,device,inode) VALUES($1,$2,$3,$4) ON CONFLICT(session_id) DO NOTHING",
        [
          sessionId,
          result.directory.canonical,
          result.directory.device,
          result.directory.inode,
        ],
      );
      for (const f of result.files)
        await db.query(
          "UPDATE attachments SET device=$2,inode=$3 WHERE id=$1",
          [f.id, f.device, f.inode],
        );
      return {
        directory: result.directory,
        inputs: inputs.map((f) => ({
          ...f,
          path: `${result.directory.canonical}/${f.id}`,
        })),
      };
    }
    if (fixture) {
      if (
        process.env.NODE_ENV !== "test" ||
        process.env.HARBOR_FIXTURE_MODE !== "private-test"
      )
        throw Error("Private fixture mode disabled");
      if (!process.env.HARBOR_STORAGE_SOCKET) return { inputs };
    }
    if (process.platform !== "linux" || process.getuid?.() !== 0)
      throw Error("Trusted Linux attachment authority required");
    const profile = JSON.parse(process.env.HARBOR_XFS_PROFILE ?? "null");
    const project: NativeStorage = {
      canonical: operation.project_path,
      device: operation.project_device,
      inode: operation.project_inode,
    };
    const root = profile?.roots?.find(
      (r: { id: string }) => r.id === operation.root_id,
    );
    if (!root) throw Error("Managed attachment storage unavailable");
    const relativePath = relative(root.path, project.canonical);
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\/workspace$/.test(relativePath) ||
      relativePath !== operation.project_relative
    )
      throw Error("Managed attachment project mapping invalid");
    const directory = (
      await db.query(
        "SELECT canonical,device,inode FROM session_attachment_storage WHERE session_id=$1",
        [sessionId],
      )
    ).rows[0];
    const result = await new Promise<{
      directory: NativeStorage;
      files: { id: string; device: string; inode: string }[];
    }>((resolve, reject) => {
      const child = spawn(
        "python3",
        [
          fileURLToPath(
            new URL("../../../infra/storage/quota.py", import.meta.url),
          ),
        ],
        {
          stdio: "pipe",
          env: {
            PATH: process.env.PATH,
            HARBOR_XFS_PROFILE: process.env.HARBOR_XFS_PROFILE,
            HARBOR_LAUNCHER_STATE_DIR: process.env.HARBOR_LAUNCHER_STATE_DIR,
          },
        },
      );
      let output = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
      child.stdout.on("data", (b) => {
        output += b;
        if (output.length > 8192) child.kill("SIGKILL");
      });
      child.stderr.resume();
      child.stdin.on("error", () => {});
      child.on("error", () => {
        clearTimeout(timer);
        reject(Error("Attachment publication unavailable"));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        try {
          if (code !== 0)
            throw Error(
              "Attachment publication or identity verification failed",
            );
          resolve(JSON.parse(output));
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.end(
        JSON.stringify({
          action: "attachments",
          project,
          rootId: root.id,
          relativePath,
          sessionId,
          directory,
          files: files.map((f) => ({
            id: f.id,
            digest: f.digest,
            content: f.content.toString("base64"),
            device: f.device,
            inode: f.inode,
          })),
        }),
      );
    });
    await db.query(
      "INSERT INTO session_attachment_storage(session_id,canonical,device,inode) VALUES($1,$2,$3,$4) ON CONFLICT(session_id) DO NOTHING",
      [
        sessionId,
        result.directory.canonical,
        result.directory.device,
        result.directory.inode,
      ],
    );
    for (const f of result.files)
      await db.query("UPDATE attachments SET device=$2,inode=$3 WHERE id=$1", [
        f.id,
        f.device,
        f.inode,
      ]);
    return { directory: result.directory, project, inputs };
  });
}
