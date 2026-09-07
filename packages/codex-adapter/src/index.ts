import { type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ProcessInspection } from "../../../infra/runner/processes.js";
export type OwnedRuntimeProcess = ChildProcessWithoutNullStreams & {
  closeOwned?: () => Promise<void>;
  inspectOwned?: () => Promise<ProcessInspection>;
};
export const CODEX_VERSION = "0.153.4";
export type RpcId = string | number;
export type RuntimeRequest = {
  id: RpcId;
  method: string;
  params: Record<string, unknown>;
};
export type RuntimeCallbacks = {
  onEvent?: (method: string, params: Record<string, unknown>) => void;
  onRequest?: (request: RuntimeRequest) => void;
  onDisconnect?: (reason: string) => void;
};
export type TurnOptions = {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh";
  permissionProfile?: "read-only" | "workspace-write";
};
export class RuntimeUncertainError extends Error {
  override name = "RuntimeUncertainError";
}
export class TurnAlreadyCompletedError extends Error {
  override name = "TurnAlreadyCompletedError";
  readonly code = "TURN_ALREADY_COMPLETED";
  constructor() {
    super("Turn already completed");
  }
}
/** Private stdio transport. No generic request method is exposed to Harbor callers. */
export class CodexAdapter {
  private nextId = 1;
  private buffer = "";
  private closed = false;
  private initialized = false;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private requests = new Map<RpcId, string>();
  private turnStates = new Map<string, "started" | "completed">();
  constructor(
    private process: OwnedRuntimeProcess,
    private callbacks: RuntimeCallbacks = {},
    private timeoutMs = 15_000,
    private withDispatch?: <T>(send: () => T) => Promise<T>,
    private workspaceRoots: string[] = ["/workspace"],
  ) {
    process.stdout.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => this.receive(chunk));
    // Runtime diagnostics may contain credentials or repository content. Never forward raw stderr.
    process.stderr.resume();
    process.on("error", () => this.disconnect("runtime transport failed"));
    process.on("exit", () =>
      this.disconnect("runtime exited; dispatched work may be uncertain"),
    );
    process.stdin.on("error", () =>
      this.disconnect("runtime input disconnected"),
    );
  }
  private disconnect(reason: string) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new RuntimeUncertainError(reason));
    }
    this.pending.clear();
    this.requests.clear();
    this.process.emit("harbor:close");
    this.process.kill("SIGTERM");
    this.callbacks.onDisconnect?.(reason);
  }
  private send(value: unknown) {
    if (this.closed) throw new RuntimeUncertainError("runtime disconnected");
    const wire = JSON.stringify(value) + "\n";
    if (
      Buffer.byteLength(wire) > 1_048_576 ||
      this.process.stdin.writableLength > 1_048_576
    ) {
      this.disconnect("runtime input limit");
      throw new RuntimeUncertainError("runtime input limit");
    }
    this.process.stdin.write(wire);
  }
  private receive(chunk: string) {
    if (this.closed) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 2_097_152)
      return this.disconnect("runtime output limit");
    let end: number;
    while (!this.closed && (end = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== "object") throw Error();
        if (typeof message.method === "string") {
          const params = message.params ?? {};
          if (!params || typeof params !== "object" || Array.isArray(params))
            throw Error();
          if (message.id !== undefined) {
            if (
              (typeof message.id !== "string" &&
                typeof message.id !== "number") ||
              (typeof message.id === "string" && message.id.length > 256)
            )
              throw Error();
            if (this.requests.size >= 64 || this.requests.has(message.id))
              throw Error();
            if (
              ![
                "item/commandExecution/requestApproval",
                "item/fileChange/requestApproval",
                "item/tool/requestUserInput",
              ].includes(message.method)
            ) {
              this.send({
                id: message.id,
                error: {
                  code: -32601,
                  message: "Unsupported Harbor runtime request",
                },
              });
              continue;
            }
            this.requests.set(message.id, message.method);
            this.callbacks.onRequest?.({
              id: message.id,
              method: message.method,
              params,
            });
          } else {
            if (
              ["turn/started", "turn/completed"].includes(message.method) &&
              typeof params.threadId === "string" &&
              typeof params.turn?.id === "string"
            ) {
              const key = JSON.stringify([params.threadId, params.turn.id]);
              if (key.length > 1024) throw Error();
              this.turnStates.set(
                key,
                message.method === "turn/started" ? "started" : "completed",
              );
              if (this.turnStates.size > 128)
                this.turnStates.delete(this.turnStates.keys().next().value!);
            }
            this.callbacks.onEvent?.(message.method, params);
          }
        } else {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error)
            pending.reject(new Error("Codex request rejected"));
          else pending.resolve(message.result);
        }
      } catch {
        this.disconnect("invalid runtime protocol or callback failure");
        return;
      }
    }
  }
  private request(method: string, params: unknown): Promise<any> {
    if (this.closed)
      return Promise.reject(new RuntimeUncertainError("runtime disconnected"));
    if (this.pending.size >= 32)
      return Promise.reject(new Error("runtime request limit"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(
        () =>
          this.disconnect(
            "runtime acknowledgement timed out; delivery uncertain",
          ),
        this.timeoutMs,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async initialize() {
    if (this.initialized) throw Error("Already initialized");
    const result = await this.request("initialize", {
      clientInfo: {
        name: "codex_harbor",
        title: "Codex Harbor",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: false },
    });
    this.send({ method: "initialized" });
    this.initialized = true;
    return result;
  }
  startThread(options: {
    cwd: string;
    model?: string;
    permissionProfile?: "read-only" | "workspace-write";
  }) {
    return this.request("thread/start", {
      cwd: options.cwd,
      model: options.model,
      sandbox: options.permissionProfile ?? "read-only",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      ephemeral: false,
    });
  }
  resumeThread(
    threadId: string,
    options: {
      cwd: string;
      permissionProfile?: "read-only" | "workspace-write";
    },
  ) {
    return this.request("thread/resume", {
      threadId,
      cwd: options.cwd,
      sandbox: options.permissionProfile ?? "read-only",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
    });
  }
  readThread(threadId: string) {
    return this.request("thread/read", { threadId, includeTurns: true });
  }
  listModels() {
    return this.request("model/list", { limit: 100 });
  }
  loginWithApiKey(apiKey: string) {
    if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey))
      throw Error("Invalid runtime credential");
    return this.request("account/login/start", { type: "apiKey", apiKey });
  }
  logoutAccount() {
    return this.request("account/logout", undefined);
  }
  readAccount() {
    return this.request("account/read", { refreshToken: false });
  }
  async startTurn(threadId: string, text: string, options: TurnOptions = {}) {
    const send = () => {
      const response = this.request("turn/start", {
        threadId,
        input: [{ type: "text", text, text_elements: [] }],
        model: options.model,
        effort: options.effort,
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        sandboxPolicy:
          options.permissionProfile === "workspace-write"
            ? {
                type: "workspaceWrite",
                writableRoots: this.workspaceRoots,
                networkAccess: false,
                excludeTmpdirEnvVar: true,
                excludeSlashTmp: true,
              }
            : { type: "readOnly", networkAccess: false },
      });
      void response.catch(() => undefined);
      return { response };
    };
    const result = this.withDispatch ? await this.withDispatch(send) : send();
    return result.response;
  }
  steerTurn(threadId: string, turnId: string, text: string) {
    return this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: "text", text, text_elements: [] }],
    });
  }
  async interruptTurn(threadId: string, turnId: string) {
    // Pinned Codex acknowledges turn/start before the active turn is installed.
    const key = JSON.stringify([threadId, turnId]),
      deadline = Date.now() + this.timeoutMs;
    while (!this.closed && !this.turnStates.has(key) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (this.closed) throw new RuntimeUncertainError("runtime disconnected");
    if (!this.turnStates.has(key)) {
      this.disconnect("turn start notification deadline exceeded");
      throw new RuntimeUncertainError("turn activation is uncertain");
    }
    if (this.turnStates.get(key) === "completed")
      throw new TurnAlreadyCompletedError();
    return this.request("turn/interrupt", { threadId, turnId });
  }
  async respond(
    id: RpcId,
    answer: {
      decision?: "accept" | "decline" | "cancel";
      answers?: Record<string, { answers: string[] }>;
    },
  ) {
    const method = this.requests.get(id);
    if (!method) throw Error("Expired or already answered request");
    this.requests.delete(id);
    let result: unknown;
    if (method === "item/tool/requestUserInput") {
      if (
        !answer.answers ||
        Object.keys(answer.answers).length > 20 ||
        Object.entries(answer.answers).some(
          ([key, value]) =>
            key.length > 256 ||
            !value ||
            !Array.isArray(value.answers) ||
            value.answers.length > 20 ||
            value.answers.some(
              (item) => typeof item !== "string" || item.length > 8192,
            ),
        )
      )
        throw Error("Invalid input answer");
      result = { answers: answer.answers };
    } else {
      if (
        !answer.decision ||
        !["accept", "decline", "cancel"].includes(answer.decision)
      )
        throw Error("Invalid approval decision");
      result = { decision: answer.decision };
    }
    if (this.withDispatch)
      await this.withDispatch(() => this.send({ id, result }));
    else this.send({ id, result });
  }
  inspectProcesses(): Promise<ProcessInspection> {
    return (
      this.process.inspectOwned?.() ??
      Promise.resolve({
        status: this.closed ? "runtime_gone" : "unavailable",
        processes: [],
      })
    );
  }
  close() {
    this.disconnect("runtime closed");
  }
  async closeAndWait() {
    const exited =
      this.process.exitCode !== null || this.process.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve) =>
            this.process.once("exit", () => resolve()),
          );
    this.close();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([exited, this.process.closeOwned?.()]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.process.kill("SIGKILL");
            reject(Error("Owned runtime termination unconfirmed"));
          }, 20_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
