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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
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
const exec = promisify(execFile);
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
let gitCommit = false,
  dependencyInstall = false,
  buildTest = false,
  localhost = false,
  processRetired = false;
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
  // This harness owns an ephemeral listener, never the installed preview port.
  process.env.HARBOR_PERSONAL_PREVIEWS = "[]";
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
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") return reject(Error());
        server.close(() => resolve(address.port));
      });
    });
    const git = (...args: string[]) =>
      exec("/usr/bin/git", ["-C", c.workspace, ...args], {
        env: { PATH: process.env.PATH },
        timeout: 10000,
      });
    await git("init", "-q");
    await git("config", "user.name", "Harbor Acceptance");
    await git("config", "user.email", "harbor-acceptance@example.invalid");
    const fixtures: Record<string, string> = {
      "package.json": JSON.stringify({
        private: true,
        type: "module",
        packageManager: "pnpm@12.3.4",
        dependencies: { "is-number": "7.0.0" },
        scripts: {
          test: "node check.mjs",
          build: "node check.mjs build",
          dev: "node server.mjs",
        },
      }),
      ".gitignore": "node_modules/\nserver.log\nbuild.json\n",
      "check.mjs":
        'import assert from "node:assert/strict"; import fs from "node:fs"; import number from "is-number"; const expected=fs.readFileSync("input.txt","utf8").toUpperCase()+(fs.existsSync("continuation.txt")?fs.readFileSync("continuation.txt","utf8").toUpperCase():""); assert(number(7)); assert.equal(fs.readFileSync("output.txt","utf8"),expected); if(process.argv[2]==="build") fs.writeFileSync("build.json", JSON.stringify({content:expected})); console.log("PASS");\n',
      "server.mjs": `import http from "node:http"; import fs from "node:fs"; http.createServer((req,res)=>res.end(fs.readFileSync("output.txt"))).listen(${port},"127.0.0.1");\n`,
    };
    for (const [name, content] of Object.entries(fixtures))
      await writeFile(c.workspace + "/" + name, content, { flag: "wx" });
    await git("add", ".");
    await git("commit", "-qm", "acceptance fixture");
    const baseline = (await git("rev-parse", "HEAD")).stdout.trim();
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
      `Complete this disposable project's development task using tools now. Read input.txt and write output.txt with exactly its contents uppercased, preserving newline. Leave the fixture files unchanged. Run pnpm install to install the pinned dependency and create the lockfile, then pnpm install --frozen-lockfile, pnpm test and pnpm build. Git add and commit input.txt, output.txt and pnpm-lock.yaml (Git test identity is already configured). Start pnpm dev as a background process so its server remains available on 127.0.0.1:${port} after this turn; verify HTTP. Do not modify outside the project or remove its files. Reply DONE after completing the work.`,
    );
    firstWrite =
      (await readFixtureFile(c.workspace + "/output.txt")) ===
        nonce.toUpperCase() + "\n" &&
      (await readFixtureFile(c.workspace + "/input.txt")) === nonce + "\n";
    if (!firstWrite) throw Error();
    for (const [name, content] of Object.entries(fixtures))
      if ((await readFile(c.workspace + "/" + name, "utf8")) !== content)
        throw Error();
    gitCommit =
      (await git("rev-parse", "HEAD")).stdout.trim() !== baseline &&
      (await git("show", "HEAD:output.txt")).stdout ===
        nonce.toUpperCase() + "\n";
    dependencyInstall =
      JSON.parse(
        await readFile(
          c.workspace + "/node_modules/is-number/package.json",
          "utf8",
        ),
      ).version === "7.0.0" &&
      (await readFile(c.workspace + "/pnpm-lock.yaml", "utf8")).includes(
        "is-number",
      );
    buildTest =
      JSON.parse(await readFile(c.workspace + "/build.json", "utf8"))
        .content ===
      nonce.toUpperCase() + "\n";
    // Independently run the immutable check; do not trust the model's success text.
    await exec(process.execPath, ["check.mjs"], {
      cwd: c.workspace,
      timeout: 10000,
    });
    const response = await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(5000),
    });
    localhost = (await response.text()) === nonce.toUpperCase() + "\n";
    if (!gitCommit || !dependencyInstall || !buildTest || !localhost)
      throw Error();
    stage = "native-retirement";
    await retire();
    processRetired = await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(2000),
    }).then(
      () => false,
      () => true,
    );
    if (!processRetired) throw Error();
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
      "Use tools to read continuation.txt and append its contents uppercased to output.txt, preserving existing contents and newline. Run pnpm test and pnpm build again. Do not change either input or any fixture files. Do the work now, then reply DONE.",
    );
    resumedWrite =
      (await readFixtureFile(c.workspace + "/output.txt")) ===
        nonce.toUpperCase() + "\n" + next.toUpperCase() + "\n" &&
      (await readFixtureFile(c.workspace + "/continuation.txt")) ===
        next + "\n" &&
      (await readFixtureFile(c.workspace + "/input.txt")) === nonce + "\n";
    if (!resumedWrite) throw Error();
    for (const [name, content] of Object.entries(fixtures))
      if ((await readFile(c.workspace + "/" + name, "utf8")) !== content)
        throw Error();
    await exec(process.execPath, ["check.mjs"], {
      cwd: c.workspace,
      timeout: 10000,
    });
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
      }, 480000);
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
const passed =
  !failure &&
  hasChatGPT &&
  firstWrite &&
  resumedWrite &&
  retired &&
  gitCommit &&
  dependencyInstall &&
  buildTest &&
  localhost &&
  processRetired;
console.log(
  JSON.stringify({
    passed,
    stage,
    hasChatGPT,
    firstWrite,
    resumedWrite,
    toolEvents,
    retired,
    gitCommit,
    dependencyInstall,
    buildTest,
    localhost,
    processRetired,
  }),
);
if (!passed) process.exitCode = 1;
