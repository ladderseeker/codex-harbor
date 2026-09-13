/** P015 real subscription/tool acceptance. Run only on explicit disposable paths. */
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, relative, isAbsolute } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { createRuntime } from "../../packages/codex-adapter/src/runtime.ts";
import type { CodexAdapter } from "../../packages/codex-adapter/src/index.ts";

const schema = z
  .object({
    binary: z.string().startsWith("/"),
    home: z.string().startsWith("/"),
    workspace: z.string().startsWith("/"),
    modelsFile: z.string().startsWith("/"),
    model: z.string().min(1).optional(),
  })
  .strict();
const inside = (root: string, candidate: string) => {
  const r = relative(root, candidate);
  return r === "" || (r !== ".." && !r.startsWith("../") && !isAbsolute(r));
};
async function readFixtureFile(filename: string) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid?.() ||
      metadata.size > 512
    )
      throw Error();
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}
let adapter: CodexAdapter | undefined;
let stage = "admission",
  timer: NodeJS.Timeout | undefined;
let hasChatGPT = false,
  firstWrite = false,
  resumedWrite = false,
  retired = false;
let toolEvents = 0;
let completeTurn: ((value: Record<string, unknown>) => void) | undefined;
let failTurn: (() => void) | undefined;
const toolTypes = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "functionCallOutput",
]);
const observedTools = new Set<string>();
let failure = false;
try {
  if (process.platform !== "linux" || process.getuid?.() === 0) throw Error();
  const c = schema.parse(
    JSON.parse(await readFile(process.argv[2] ?? "", "utf8")),
  );
  for (const value of [c.binary, c.home, c.workspace])
    if ((await realpath(value)) !== value) throw Error();
  const [home, workspace, binary] = await Promise.all([
    lstat(c.home),
    lstat(c.workspace, { bigint: true }),
    lstat(c.binary),
  ]);
  if (
    !home.isDirectory() ||
    home.uid !== process.getuid?.() ||
    (home.mode & 0o077) !== 0 ||
    !workspace.isDirectory() ||
    String(workspace.uid) !== String(process.getuid?.()) ||
    !binary.isFile()
  )
    throw Error();
  if (
    inside(c.home, c.workspace) ||
    inside(c.workspace, c.home) ||
    inside(c.home, c.binary) ||
    inside(c.workspace, c.binary) ||
    (await readdir(c.workspace)).length !== 0
  )
    throw Error();
  // Require an independent credential-only home, never existing native conversations.
  if ((await readdir(c.home)).some((name) => name !== "auth.json"))
    throw Error();
  await lstat(dirname(c.binary) + "/codex-code-mode-host");
  const allowed = z
    .array(z.string().min(1))
    .min(1)
    .parse(JSON.parse(await readFile(c.modelsFile, "utf8")));
  if (c.model && !allowed.includes(c.model)) throw Error();
  for (const key of [
    "HARBOR_LOCAL_MODE",
    "HARBOR_FIXTURE_MODE",
    "HARBOR_LAUNCHER_SOCKET",
    "OPENAI_API_KEY",
  ])
    delete process.env[key];
  process.env.HARBOR_PERSONAL_VPS_MODE = "personal";
  process.env.HARBOR_PERSONAL_VPS_CODEX_HOME = c.home;
  process.env.HARBOR_PERSONAL_VPS_CODEX_BINARY = c.binary;
  const launch = async () => {
    if (failure) throw Error();
    adapter = await createRuntime({
      sessionId: randomUUID(),
      projectId: randomUUID(),
      generation: 1,
      workspacePath: c.workspace,
      workspaceDevice: String(workspace.dev),
      workspaceInode: String(workspace.ino),
      permissionProfile: "workspace-write",
      onRequest: () => {
        failTurn?.();
        adapter?.close();
      },
      onDisconnect: () => failTurn?.(),
      onEvent: (method, params) => {
        const item = params.item as { type?: string; id?: string } | undefined;
        if (
          ["item/started", "item/completed"].includes(method) &&
          item?.type &&
          toolTypes.has(item.type) &&
          item.id &&
          !observedTools.has(item.id)
        ) {
          observedTools.add(item.id);
          toolEvents++;
        }
        if (method === "turn/completed")
          completeTurn?.(params.turn as Record<string, unknown>);
      },
    });
    if (failure) {
      await adapter.closeAndWait();
      throw Error();
    }
  };
  const retire = async () => {
    await adapter?.closeAndWait();
    if ((await adapter?.inspectProcesses())?.status !== "runtime_gone")
      throw Error();
    adapter = undefined;
  };
  const execute = async () => {
    if (failure) throw Error();
    stage = "initialize";
    await launch();
    stage = "account";
    hasChatGPT = (await adapter!.readAccount()).account?.type === "chatgpt";
    if (!hasChatGPT) throw Error();
    stage = "models";
    const discovered = (await adapter!.listModels()).data as Array<{
      id: string;
      model?: string;
      isDefault?: boolean;
      supportedReasoningEfforts?: Array<{ reasoningEffort: string }>;
    }>;
    const candidates = discovered.filter((m) =>
      allowed.includes(m.model ?? m.id),
    );
    const selected = c.model
      ? candidates.find((m) => (m.model ?? m.id) === c.model)
      : (candidates.find((m) => m.isDefault) ?? candidates[0]);
    if (!selected) throw Error();
    const model = selected.model ?? selected.id;
    const efforts =
      selected.supportedReasoningEfforts?.map((e) => e.reasoningEffort) ?? [];
    const effort = (["low", "medium", "high", "xhigh"] as const).find((e) =>
      efforts.includes(e),
    );
    const turn = async (thread: string, prompt: string) => {
      if (failure) throw Error();
      const before = toolEvents;
      const completion = new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          completeTurn = resolve;
          failTurn = () => reject(Error());
        },
      );
      void completion.catch(() => {});
      try {
        await adapter!.startTurn(thread, prompt, {
          model,
          effort,
          permissionProfile: "workspace-write",
        });
        const result = await completion;
        if (result.status !== "completed" || toolEvents <= before)
          throw Error();
      } finally {
        completeTurn = undefined;
        failTurn = undefined;
      }
    };
    const nonce = randomBytes(24).toString("hex");
    await writeFile(c.workspace + "/input.txt", nonce + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    stage = "first-tool-turn";
    const thread = (
      await adapter!.startThread({
        cwd: c.workspace,
        model,
        permissionProfile: "workspace-write",
      })
    ).thread.id;
    await turn(
      thread,
      "Use the available file or command tools to read input.txt in the current workspace. Create output.txt containing exactly that file's contents converted to uppercase, preserving its newline. Do not change input.txt or access other directories. Do the work now, then reply DONE.",
    );
    firstWrite =
      (await readFixtureFile(c.workspace + "/output.txt")) ===
        nonce.toUpperCase() + "\n" &&
      (await readFixtureFile(c.workspace + "/input.txt")) === nonce + "\n";
    if (!firstWrite) throw Error();
    stage = "native-retirement";
    await retire();
    const next = randomBytes(24).toString("hex");
    await writeFile(c.workspace + "/continuation.txt", next + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    stage = "native-resume";
    await launch();
    await adapter!.resumeThread(thread, {
      cwd: c.workspace,
      permissionProfile: "workspace-write",
    });
    stage = "resumed-tool-turn";
    await turn(
      thread,
      "Use the available file or command tools to read continuation.txt. Append its contents converted to uppercase to output.txt, preserving both existing contents and the new newline. Do not change either input file or access other directories. Do the work now, then reply DONE.",
    );
    resumedWrite =
      (await readFixtureFile(c.workspace + "/output.txt")) ===
        nonce.toUpperCase() + "\n" + next.toUpperCase() + "\n" &&
      (await readFixtureFile(c.workspace + "/continuation.txt")) ===
        next + "\n" &&
      (await readFixtureFile(c.workspace + "/input.txt")) === nonce + "\n";
    if (!resumedWrite) throw Error();
    stage = "final-retirement";
    await retire();
    retired = true;
  };
  await Promise.race([
    execute(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        failure = true;
        failTurn?.();
        adapter?.close();
        reject(Error());
      }, 120000);
    }),
  ]);
} catch {
  failure = true;
} finally {
  clearTimeout(timer);
  try {
    if (adapter) {
      await adapter.closeAndWait();
      retired = (await adapter.inspectProcesses()).status === "runtime_gone";
    }
  } catch {
    failure = true;
    retired = false;
  }
}
const passed = !failure && hasChatGPT && firstWrite && resumedWrite && retired;
console.log(
  JSON.stringify({
    passed,
    stage,
    hasChatGPT,
    firstWrite,
    resumedWrite,
    toolEvents,
    retired,
  }),
);
if (!passed) process.exitCode = 1;
