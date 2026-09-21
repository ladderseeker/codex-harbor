/** Bounded account/native boundary; actual Harbor admission is tested by --concurrency. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import {
  CODEX_VERSION,
  type CodexAdapter,
} from "../../packages/codex-adapter/src/index.ts";
import { createRuntime } from "../../packages/codex-adapter/src/runtime.ts";
import { inspectRecoveredLocalRuntime } from "../../packages/codex-adapter/src/local-runtime.ts";
import { publishPersonalAttachments } from "../../packages/attachments/src/personal.ts";
import {
  hashBytes,
  validateMedia,
} from "../../packages/attachments/src/media.ts";
import { png } from "../fixtures/png.ts";
import { sourceDigest } from "../../scripts/source-digest.ts";

type Config = { stateRoot: string; binary: string; model: string };
const owned: CodexAdapter[] = [];
const completed = new Map<string, { status: string; at: number }>();
let phase = "prerequisites",
  turnRequests = 0,
  root: string | undefined;
let unexpectedRequest = false,
  timedOut = false;
let timer: NodeJS.Timeout | undefined;
const original = { ...process.env };
const inside = (parent: string, child: string) => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};
async function privateDirectory(candidate: string) {
  assert.ok(isAbsolute(candidate) && candidate === (await realpath(candidate)));
  const info = await lstat(candidate);
  assert.ok(
    info.isDirectory() &&
      info.uid === process.getuid?.() &&
      (info.mode & 0o077) === 0,
  );
}
try {
  assert.ok(
    process.platform === "linux" && process.getuid?.() !== 0,
    "NONROOT_LINUX_REQUIRED",
  );
  assert.ok(
    !process.env.HARBOR_FIXTURE_MODE && !process.env.HARBOR_LOCAL_MODE,
    "NATIVE_VPS_REQUIRED",
  );
  const configPath = process.env.HARBOR_P024_LIVE_CONFIG;
  assert.ok(configPath && isAbsolute(configPath), "EXPLICIT_CONFIG_REQUIRED");
  assert.equal(
    await realpath(configPath),
    configPath,
    "CANONICAL_CONFIG_REQUIRED",
  );
  const configInfo = await lstat(configPath);
  assert.ok(
    configInfo.isFile() &&
      !configInfo.isSymbolicLink() &&
      configInfo.uid === process.getuid?.() &&
      (configInfo.mode & 0o077) === 0,
    "PRIVATE_CONFIG_REQUIRED",
  );
  const config: Config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(Object.keys(config).sort(), [
    "binary",
    "model",
    "stateRoot",
  ]);
  assert.match(config.model, /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
  await privateDirectory(config.stateRoot);
  assert.notEqual(config.stateRoot, await realpath(homedir()));
  assert.ok(
    !inside(join(await realpath(homedir()), ".codex"), config.stateRoot),
  );
  assert.deepEqual(
    (await readdir(config.stateRoot)).sort(),
    ["codex"],
    "FRESH_DEDICATED_STATE_REQUIRED",
  );
  const home = join(config.stateRoot, "codex");
  await privateDirectory(home);
  assert.deepEqual(
    await readdir(home),
    ["auth.json"],
    "CREDENTIAL_ONLY_DEDICATED_HOME_REQUIRED",
  );
  const auth = await lstat(join(home, "auth.json"));
  assert.ok(
    auth.isFile() &&
      !auth.isSymbolicLink() &&
      auth.uid === process.getuid?.() &&
      (auth.mode & 0o077) === 0 &&
      auth.size > 0,
  );
  // The worker never copies or reads account contents. Main provisions this one-time home.
  assert.ok(
    isAbsolute(config.binary) &&
      config.binary === (await realpath(config.binary)),
  );
  const binaryInfo = await stat(config.binary);
  assert.ok(binaryInfo.isFile() && (binaryInfo.mode & 0o022) === 0);
  assert.equal(
    (await readFile(config.binary)).subarray(0, 4).toString("hex"),
    "7f454c46",
    "DIRECT_NATIVE_BINARY_REQUIRED",
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(config.binary)) hash.update(chunk);
  const binarySha256 = hash.digest("hex");
  root = config.stateRoot;
  const workspace = join(root, "workspace");
  await mkdir(workspace, { mode: 0o700 });
  process.env.HARBOR_PERSONAL_VPS_MODE = "personal";
  process.env.HARBOR_PERSONAL_VPS_CODEX_HOME = home;
  process.env.HARBOR_PERSONAL_VPS_CODEX_BINARY = config.binary;
  delete process.env.HARBOR_PERSONAL_PREVIEWS;
  const identity = await stat(workspace, { bigint: true });
  timer = setTimeout(() => {
    timedOut = true;
    for (const adapter of owned) adapter.close();
  }, 240_000);
  phase = "publication";
  const session = randomUUID();
  const image = await validateMedia(png(), "image/png");
  const marker = "HARBOR_P024_SYNTHETIC_" + randomUUID();
  const file = Buffer.from(marker);
  const files = [
    { id: randomUUID(), content: image },
    { id: randomUUID(), content: file },
  ].map((f) => ({ ...f, digest: hashBytes(f.content) }));
  const published = await publishPersonalAttachments(
    session,
    workspace,
    undefined,
    files,
  );
  let response = "";
  const adapter = await createRuntime({
    sessionId: session,
    projectId: randomUUID(),
    generation: 1,
    workspacePath: workspace,
    workspaceDevice: String(identity.dev),
    workspaceInode: String(identity.ino),
    attachmentDirectory: published.directory,
    onTransport: (a) => {
      owned.push(a);
    },
    onEvent: (method, params) => {
      if (method === "turn/completed") {
        const turn = params.turn as { id: string; status: string };
        completed.set(turn.id, { status: turn.status, at: Date.now() });
      }
      if (method === "item/agentMessage/delta")
        response += String(params.delta ?? "");
    },
    onRequest: () => {
      unexpectedRequest = true;
      for (const a of owned) a.close();
    },
  });
  assert.ok((await adapter.readAccount()).account, "DEDICATED_AUTH_REQUIRED");
  assert.ok(
    (await adapter.listModels()).data.some(
      (m: any) =>
        m.model === config.model &&
        m.inputModalities?.includes("image") &&
        m.inputModalities?.includes("text") &&
        m.supportedReasoningEfforts?.some(
          (e: any) => e.reasoningEffort === "low",
        ),
    ),
    "SUPPORTED_MODEL_REQUIRED",
  );
  const { thread } = await adapter.startThread({
    cwd: workspace,
    model: config.model,
    permissionProfile: "read-only",
  });
  phase = "native-attachment-turn";
  turnRequests++;
  const { turn } = await adapter.startTurn(
    thread.id,
    "Identify the pixel color of the attached image and read the attached file. Reply with that color and the exact file contents. Do not modify anything.",
    {
      model: config.model,
      effort: "low",
      permissionProfile: "read-only",
      attachments: files.map((f, i) => ({
        id: f.id,
        kind: i === 0 ? "image" : "text",
        name: i === 0 ? "red.png" : "synthetic.bin",
        path: join(published.directory.canonical, f.id),
      })),
    },
  );
  const deadline = Date.now() + 120000;
  while (
    !completed.has(turn.id) &&
    Date.now() < deadline &&
    !timedOut &&
    !unexpectedRequest
  )
    await new Promise((r) => setTimeout(r, 100));
  assert.equal(completed.get(turn.id)?.status, "completed");
  assert.match(response, /red/i);
  assert.ok(response.includes(marker));
  phase = "cleanup";
  await adapter.closeAndWait();
  assert.equal(
    await inspectRecoveredLocalRuntime(adapter.ownedIdentity()),
    "absent",
  );
  await adapter.cleanupRetiredOwnership();
  await rm(workspace, { recursive: true, force: true });
  await writeFile(
    join(root, "result.json"),
    JSON.stringify(
      {
        passed: true,
        sourceDigest: sourceDigest(),
        runtimeVersion: CODEX_VERSION,
        binarySha256,
        platform: process.platform,
        nonroot: true,
        turnRequests,
        syntheticImageColor: true,
        exactOpaqueFileContent: true,
        limits: [
          "native/account boundary; separate Harbor and sandbox acceptance required",
        ],
        cleanup:
          "Owned workspace removed; private one-time native home and attachment copies retained for main cleanup",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "PASS P024-04 bounded dedicated native image/file delivery; sanitized result.json retained",
  );
} catch {
  // Native errors may embed account/network information. Only our fixed phase is public.
  console.error(
    `${turnRequests ? "FAIL" : "UNVERIFIED"} P024-04 phase=${phase}; explicit HARBOR_P024_LIVE_CONFIG, credential-only private state, complete pinned native distribution, model and nonroot Linux required; no automatic retry`,
  );
  process.exitCode = turnRequests ? 1 : 2;
} finally {
  if (timer) clearTimeout(timer);
  const cleanup = await Promise.allSettled(
    owned.map((adapter) => adapter.closeAndWait()),
  );
  if (cleanup.some((result) => result.status === "rejected")) {
    console.error(
      "FAIL P024-04 owned retirement unconfirmed; dedicated resources retained for recovery",
    );
    process.exitCode = 1;
  }
  for (const key of Object.keys(process.env))
    if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
}
