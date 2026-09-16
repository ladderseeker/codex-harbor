import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CodexAdapter,
  type RuntimeCallbacks,
  type OwnedRuntimeProcess,
} from "./index.js";
import { launchRunner } from "../../../infra/runner/launcher.js";
import { launchLocalRuntime } from "./local-runtime.js";
export type RuntimeConfig = RuntimeCallbacks & {
  purpose?: "conversation" | "terminal" | "preview";
  attachmentProject?: import("../../../infra/storage/admission.ts").NativeStorage;
  attachmentDirectory?: import("../../../infra/storage/admission.ts").NativeStorage;
  onTransport?: (adapter: CodexAdapter) => void;
  withDispatch?: <T>(send: () => T) => Promise<T>;
  workspaceId?: string;
  gitCommon?: { canonical: string; device: string; inode: string };
  sessionId: string;
  projectId: string;
  workspacePath: string;
  generation: number;
  fixture?: boolean;
  instanceId?: string;
  permissionProfile?: "read-only" | "workspace-write";
  workspaceDevice?: string;
  workspaceInode?: string;
};
export async function createRuntime(
  config: RuntimeConfig,
): Promise<CodexAdapter> {
  const local =
    !config.fixture &&
    (globalThis.process.env.HARBOR_LOCAL_MODE === "personal" ||
      globalThis.process.env.HARBOR_PERSONAL_VPS_MODE === "personal");
  const process = config.fixture
    ? fixtureProcess(config)
    : local
      ? await launchLocalRuntime(config)
      : await launchRunner(config);
  const adapter = new CodexAdapter(
    process,
    config,
    15_000,
    config.withDispatch,
    local
      ? [config.workspacePath]
      : config.gitCommon && config.workspaceId
        ? [
            "/workspace",
            `/harbor/workspaces/${config.workspaceId}`,
            "/git-common",
          ]
        : ["/workspace"],
    config.purpose,
    !config.fixture && ["terminal", "preview"].includes(config.purpose ?? ""),
    local,
  );
  try {
    config.onTransport?.(adapter);
    await adapter.initialize();
    return adapter;
  } catch (error) {
    adapter.close();
    throw error;
  }
}
function fixtureProcess(config: RuntimeConfig) {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.HARBOR_FIXTURE_MODE !== "private-test"
  )
    throw Error("Private fixture mode is disabled");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(config.sessionId))
    throw Error("Invalid fixture identity");
  const terminal = config.purpose === "terminal";
  const preview = config.purpose === "preview";
  const child = spawn(
    terminal || preview ? "python3" : process.execPath,
    [
      fileURLToPath(
        new URL(
          preview
            ? "../../../tests/fixtures/codex/preview.py"
            : terminal
              ? "../../../tests/fixtures/codex/terminal.py"
              : "../../../tests/fixtures/codex/server.mjs",
          import.meta.url,
        ),
      ),
    ],
    {
      stdio:
        terminal || preview
          ? ["pipe", "pipe", "pipe"]
          : ["pipe", "pipe", "pipe", "ipc"],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        HARBOR_FIXTURE_MODE: "private-test",
        HARBOR_FIXTURE_WORKSPACE: config.workspacePath,
        HARBOR_FIXTURE_INIT_DELAY_MS: process.env.HARBOR_FIXTURE_INIT_DELAY_MS,
        HARBOR_FIXTURE_EXTENDED_MODELS:
          process.env.HARBOR_FIXTURE_EXTENDED_MODELS,
        HARBOR_FIXTURE_TRACE_FILE: process.env.HARBOR_FIXTURE_TRACE_FILE,
        HARBOR_FIXTURE_STATE_FILE: process.env.HARBOR_FIXTURE_STATE_DIR
          ? join(
              process.env.HARBOR_FIXTURE_STATE_DIR,
              config.sessionId + ".json",
            )
          : undefined,
      },
    },
  ) as OwnedRuntimeProcess;
  let background = false,
    retirementUnknown = false;
  child.closeOwned = async () => {
    if (retirementUnknown)
      throw Error("Fixture external retirement unavailable");
  };
  child.on("message", (message) => {
    if ((message as { background?: boolean }).background) background = true;
    if ((message as { retirementUnknown?: boolean }).retirementUnknown)
      retirementUnknown = true;
  });
  child.inspectOwned = async () => ({
    status: retirementUnknown
      ? "unavailable"
      : child.exitCode !== null || child.signalCode !== null
        ? "runtime_gone"
        : "known",
    generation: config.generation,
    processes: background ? [{ pid: 42, executable: "sleep" }] : [],
  });
  return child;
}
