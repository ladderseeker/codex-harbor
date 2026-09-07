import { requireAuthority } from "../../../packages/policy/src/authority.ts";
import {
  admitOrdinaryIntent,
  lockIntentAdmission,
} from "../../../packages/storage/src/admission.ts";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  readFile,
  realpath,
  stat,
  chmod,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { z } from "zod";
import type pg from "pg";
import type { Config } from "../../api/src/config.ts";
import {
  checkKey,
  HarborError,
  digest,
} from "../../../packages/policy/src/index.ts";
import { transaction } from "../../../packages/storage/src/index.ts";
const requestSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("status"), actor: z.string().length(64) })
    .strict(),
  z
    .object({
      action: z.literal("set"),
      actor: z.string().length(64),
      idempotencyKey: z.string().max(100),
      apiKey: z
        .string()
        .min(16)
        .max(4096)
        .refine((s) => !/[\r\n]/.test(s)),
    })
    .strict(),
  z
    .object({
      action: z.literal("remove"),
      actor: z.string().length(64),
      idempotencyKey: z.string().max(100),
    })
    .strict(),
]);
export class CredentialStore {
  mutating = false;
  constructor(
    private pool: pg.Pool,
    private c: Config,
    private beforeChange: () => Promise<void> = async () => {},
  ) {}
  private async key() {
    const filename = this.c.HARBOR_CREDENTIAL_KEY_FILE;
    if (!filename)
      throw new HarborError(
        503,
        "CREDENTIAL_STORE_UNAVAILABLE",
        "Administrator credential key file is not configured",
      );
    const resolved = await realpath(filename),
      metadata = await stat(resolved);
    for (const root of this.c.roots) {
      const canonical = await realpath(root.path);
      if (resolved === canonical || resolved.startsWith(canonical + path.sep))
        throw new Error("Credential key must be outside project roots");
    }
    if (
      (metadata.mode & 0o077) !== 0 ||
      metadata.uid !== process.getuid?.() ||
      !metadata.isFile()
    )
      throw new Error(
        "Credential key file must be private and supervisor-owned",
      );
    const key = await readFile(resolved);
    if (key.length !== 32)
      throw new Error("Credential key must contain 32 bytes");
    return key;
  }
  async version() {
    return (
      (
        await this.pool.query(
          "SELECT updated_at::text AS version FROM runtime_credentials",
        )
      ).rows[0]?.version ?? "none"
    );
  }
  async read() {
    const row = (await this.pool.query("SELECT * FROM runtime_credentials"))
      .rows[0];
    if (!row) return null;
    const cipher = createDecipheriv(
      "aes-256-gcm",
      await this.key(),
      Buffer.from(row.iv, "base64"),
    );
    cipher.setAAD(
      Buffer.from(
        (process.env.HARBOR_INSTANCE_ID ?? "harbor") +
          "\0" +
          this.c.HARBOR_OWNER_SUBJECT,
      ),
    );
    cipher.setAuthTag(Buffer.from(row.tag, "base64"));
    return Buffer.concat([
      cipher.update(Buffer.from(row.ciphertext, "base64")),
      cipher.final(),
    ]).toString("utf8");
  }
  async handle(raw: unknown) {
    const request = requestSchema.parse(raw);
    const ownerPin = digest(
      this.c.HARBOR_OIDC_ISSUER + "\0" + this.c.HARBOR_OWNER_SUBJECT,
    );
    if (request.action !== "status" && this.mutating)
      throw new HarborError(
        409,
        "CREDENTIAL_IN_USE",
        "Another credential change is active",
      );
    if (request.action !== "status") this.mutating = true;
    try {
      return await transaction(this.pool, async (db) => {
        const actor = await requireAuthority(db, request.actor, this.c);
        if (actor.kind !== "browser")
          throw new HarborError(
            403,
            "BROWSER_REQUIRED",
            "Owner browser required",
          );
        if (request.action === "status") {
          const stored = (
            await db.query("SELECT ciphertext FROM runtime_credentials")
          ).rows[0];
          let available = false;
          try {
            await this.key();
            available = true;
          } catch {}
          return {
            configured: !!stored,
            available,
            credentialId: stored
              ? createHash("sha256")
                  .update(stored.ciphertext)
                  .digest("hex")
                  .slice(0, 16)
              : null,
          };
        }
        const encryptionKey = await this.key();
        const route = "/security/runtime-credentials/" + request.action;
        const hash = createHmac("sha256", encryptionKey)
          .update(request.action === "set" ? request.apiKey : "remove")
          .digest("hex");
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          this.c.HARBOR_OWNER_SUBJECT + route + request.idempotencyKey,
        ]);
        const prior = await db.query(
          "SELECT * FROM intents WHERE actor=$1 AND route=$2 AND key=$3",
          [this.c.HARBOR_OWNER_SUBJECT, route, request.idempotencyKey],
        );
        if (prior.rowCount) {
          if (prior.rows[0].request_hash !== hash)
            throw new HarborError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Intent already identifies another credential change",
            );
          await requireAuthority(db, request.actor, this.c);
          return prior.rows[0].result;
        }
        checkKey(request.idempotencyKey);
        await lockIntentAdmission(db, this.c.HARBOR_OWNER_SUBJECT);
        let controlTarget: string | null = null;
        if (request.action === "set")
          await admitOrdinaryIntent(db, this.c.HARBOR_OWNER_SUBJECT);
        else {
          const existing = (
            await db.query(
              "SELECT ciphertext FROM runtime_credentials FOR UPDATE",
            )
          ).rows[0];
          if (!existing) {
            await requireAuthority(db, request.actor, this.c);
            await this.beforeChange();
            await requireAuthority(db, request.actor, this.c);
            return { credentialId: null, configured: false, available: true };
          }
          controlTarget =
            "credential-remove:" +
            createHash("sha256").update(existing.ciphertext).digest("hex");
          if (
            (
              await db.query(
                "SELECT 1 FROM intents WHERE actor=$1 AND control_target=$2",
                [this.c.HARBOR_OWNER_SUBJECT, controlTarget],
              )
            ).rowCount
          )
            throw new HarborError(
              409,
              "CREDENTIAL_REMOVE_PENDING",
              "Reconcile the existing removal intent",
            );
        }
        await requireAuthority(db, request.actor, this.c);
        await this.beforeChange();
        if (
          !(
            await db.query(
              "SELECT 1 FROM browser_sessions WHERE hash=$1 AND NOT revoked AND expires_at>clock_timestamp() AND last_seen>clock_timestamp()-($2*interval '1 second') AND identity_pin=$3 AND (SELECT identity_pin FROM harbor_meta)=$3",
              [request.actor, this.c.HARBOR_IDLE_SECONDS, ownerPin],
            )
          ).rowCount
        )
          throw new HarborError(
            401,
            "AUTH_EXPIRED",
            "Owner authorization expired during credential cleanup",
          );
        if (request.action === "set") {
          const iv = randomBytes(12),
            cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
          cipher.setAAD(
            Buffer.from(
              (process.env.HARBOR_INSTANCE_ID ?? "harbor") +
                "\0" +
                this.c.HARBOR_OWNER_SUBJECT,
            ),
          );
          const encrypted = Buffer.concat([
            cipher.update(request.apiKey, "utf8"),
            cipher.final(),
          ]);
          await db.query(
            "INSERT INTO runtime_credentials(id,ciphertext,iv,tag) VALUES(true,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,iv=EXCLUDED.iv,tag=EXCLUDED.tag,updated_at=now()",
            [
              encrypted.toString("base64"),
              iv.toString("base64"),
              cipher.getAuthTag().toString("base64"),
            ],
          );
        } else await db.query("DELETE FROM runtime_credentials");
        const committed = (
          await db.query("SELECT ciphertext FROM runtime_credentials")
        ).rows[0];
        const result = {
          credentialId: committed
            ? createHash("sha256")
                .update(committed.ciphertext)
                .digest("hex")
                .slice(0, 16)
            : null,
          configured: request.action === "set",
          available: true,
        };
        await db.query(
          "INSERT INTO intents(actor,route,key,request_hash,result,control_target) VALUES($1,$2,$3,$4,$5,$6)",
          [
            this.c.HARBOR_OWNER_SUBJECT,
            route,
            request.idempotencyKey,
            hash,
            JSON.stringify(result),
            controlTarget,
          ],
        );
        await db.query("INSERT INTO audits(kind) VALUES($1)", [
          "credential." + request.action,
        ]);
        await db.query("DELETE FROM runtime_capabilities");
        return result;
      });
    } finally {
      if (request.action !== "status") this.mutating = false;
    }
  }
}
export async function serveCredentials(store: CredentialStore, c: Config) {
  if (!c.HARBOR_CONTROL_SOCKET) return undefined;
  const directory = await realpath(path.dirname(c.HARBOR_CONTROL_SOCKET)),
    metadata = await stat(directory);
  if ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid?.())
    throw Error(
      "Control socket directory must be private and supervisor-owned",
    );
  for (const root of c.roots) {
    const canonical = await realpath(root.path);
    if (directory === canonical || directory.startsWith(canonical + path.sep))
      throw Error("Control socket cannot be inside project roots");
  }
  const marker = c.HARBOR_CONTROL_SOCKET + ".owner";
  try {
    const existing = await stat(c.HARBOR_CONTROL_SOCKET);
    const owner = JSON.parse(await readFile(marker, "utf8"));
    if (
      !existing.isSocket() ||
      existing.uid !== process.getuid?.() ||
      owner.instance !== (process.env.HARBOR_INSTANCE_ID ?? "harbor") ||
      owner.inode !== existing.ino ||
      owner.device !== existing.dev
    )
      throw Error("Control socket is not owned by this instance");
    await unlink(c.HARBOR_CONTROL_SOCKET);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const server = createServer((socket) => {
    let body = "",
      handled = false;
    socket.setTimeout(90000, () => socket.destroy());
    socket.on("data", (chunk) => {
      if (handled) return;
      body += chunk.toString("utf8");
      if (Buffer.byteLength(body) > 8192) {
        socket.destroy();
        return;
      }
      const end = body.indexOf("\n");
      if (end < 0) return;
      handled = true;
      let request: unknown;
      try {
        request = JSON.parse(body.slice(0, end));
      } catch {
        socket.destroy();
        return;
      } finally {
        body = "";
      }
      void store
        .handle(request)
        .then((result) => socket.end(JSON.stringify({ result }) + "\n"))
        .catch((error) =>
          socket.end(
            JSON.stringify({
              error: {
                status: error instanceof HarborError ? error.statusCode : 503,
                code:
                  error instanceof HarborError
                    ? error.code
                    : "CREDENTIAL_UNAVAILABLE",
                message:
                  error instanceof HarborError
                    ? error.message
                    : "Credential operation unavailable",
              },
            }) + "\n",
          ),
        );
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(c.HARBOR_CONTROL_SOCKET, resolve);
  });
  await chmod(c.HARBOR_CONTROL_SOCKET, 0o600);
  const owned = await stat(c.HARBOR_CONTROL_SOCKET);
  await writeFile(
    marker,
    JSON.stringify({
      instance: process.env.HARBOR_INSTANCE_ID ?? "harbor",
      inode: owned.ino,
      device: owned.dev,
    }),
    { mode: 0o600 },
  );
  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      const current = await stat(c.HARBOR_CONTROL_SOCKET!);
      if (current.ino === owned.ino && current.dev === owned.dev)
        await unlink(c.HARBOR_CONTROL_SOCKET!);
    } catch {
      /* Already closed. */
    }
  };
}
