import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import { newIntent, request, type Intent } from "./api.ts";
import type { WorkspaceView } from "../../../packages/workspaces/src/types.ts";
type TerminalView = {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  profile: string;
  state: string;
  generation: number;
  deadline: string;
  retired: boolean;
  failureCode: string | null;
  exitCode: number | null;
  controllerEpoch: number;
  controllerUntil: string | null;
  inputUncertain: boolean;
  outputSequence: number;
  outputFloor: number;
  outputLost: boolean;
};
type Control = {
  controllerId: string;
  epoch: number;
  generation: number;
  sequence: number;
  until: string;
};
type Execute = (
  intent: Intent,
  complete?: (result: any) => void,
) => Promise<void>;
const encoded = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytes = (data: string) =>
  Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
export function Terminals({
  workspace,
  csrf,
  execute,
  disabled,
}: {
  workspace: WorkspaceView;
  csrf: string;
  execute: Execute;
  disabled: boolean;
}) {
  const [list, setList] = useState<TerminalView[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [profile, setProfile] = useState("read-only");
  const mounted = useRef(true);
  const refreshing = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const data = await request<{ terminals: TerminalView[] }>(
        `/workspaces/${workspace.id}/terminals`,
      );
      if (mounted.current) setList(data.terminals);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "Terminal list unavailable");
    } finally {
      refreshing.current = false;
    }
  }, [workspace.id]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  const terminal = list.find((t) => t.id === selected);
  return (
    <div className="terminal-panel">
      {!terminal && (
        <p>
          Workspace <strong>{workspace.name}</strong>. The shell reserves this
          checkout until its runner and background jobs are confirmed stopped.
          Network access is disabled.
        </p>
      )}
      <details className="terminal-create" open={!terminal}>
        <summary>Terminal setup</summary>
        <div className="terminal-actions">
          <label>
            Terminal permissions
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            >
              <option value="read-only">Read only</option>
              <option value="workspace-write">Workspace write</option>
            </select>
          </label>
          <button
            disabled={disabled || workspace.state !== "ready"}
            onClick={() =>
              void execute(
                newIntent(
                  `/workspaces/${workspace.id}/terminals`,
                  { permissionProfile: profile, cols: 80, rows: 24 },
                  "Create terminal",
                ),
                (r) => {
                  if (mounted.current) {
                    setSelected(r.terminal.id);
                    void refresh();
                  }
                },
              )
            }
          >
            New terminal
          </button>
        </div>
      </details>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <label>
        Terminal
        <select
          aria-label="Selected terminal"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose a terminal</option>
          {list.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id.slice(0, 8)} · {t.state} · {t.profile}
            </option>
          ))}
        </select>
      </label>
      {terminal ? (
        <TerminalScreen
          key={terminal.id + ":" + terminal.generation}
          initial={terminal}
          csrf={csrf}
          execute={execute}
          disabled={disabled}
          changed={refresh}
        />
      ) : (
        <p className="field-help">
          Create a terminal or select a retained terminal to reconnect.
        </p>
      )}
    </div>
  );
}
function TerminalScreen({
  initial,
  csrf,
  execute,
  disabled,
  changed,
}: {
  initial: TerminalView;
  csrf: string;
  execute: Execute;
  disabled: boolean;
  changed: () => Promise<void>;
}) {
  const [terminal, setTerminal] = useState(initial),
    [control, setControl] = useState<Control | null>(null),
    [connected, setConnected] = useState(false),
    [connection, setConnection] = useState(0),
    [error, setError] = useState(""),
    [gap, setGap] = useState(false),
    [paste, setPaste] = useState<string | null>(null),
    [unknown, setUnknown] = useState<any>(null);
  const host = useRef<HTMLDivElement>(null),
    instance = useRef<XTerm | null>(null),
    socket = useRef<WebSocket | null>(null),
    controlRef = useRef<Control | null>(null),
    stateRef = useRef(initial),
    pending = useRef<any>(null),
    waiting = useRef(new Uint8Array()),
    rendering = useRef(false),
    gesture = useRef(false),
    alive = useRef(true),
    resizeSequence = useRef(0);
  useEffect(() => {
    if (!connected) setTerminal(initial);
  }, [initial, connected]);
  stateRef.current = terminal;
  controlRef.current = control;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const identity = () => {
    const c = controlRef.current;
    return c
      ? {
          version: 1,
          generation: terminal.generation,
          epoch: c.epoch,
          controllerId: c.controllerId,
        }
      : null;
  };
  const flushInput = () => {
    const c = controlRef.current,
      ws = socket.current;
    if (
      !c ||
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      pending.current ||
      !waiting.current.length
    )
      return;
    const frame = {
      ...identity(),
      type: "input",
      sequence: ++c.sequence,
      data: encoded(waiting.current),
    };
    waiting.current = new Uint8Array();
    pending.current = frame;
    ws.send(JSON.stringify(frame));
  };
  const sendInput = (text: string) => {
    const c = controlRef.current;
    if (!c || stateRef.current.state !== "running") {
      setError("Take control before entering input.");
      return;
    }
    const next = new TextEncoder().encode(text);
    if (next.length < 1) return;
    if (next.length > 4096 || next.length + waiting.current.length > 4096) {
      setError(
        "Local input is full. Wait for acknowledgement before typing more.",
      );
      return;
    }
    const combined = new Uint8Array(waiting.current.length + next.length);
    combined.set(waiting.current);
    combined.set(next, waiting.current.length);
    waiting.current = combined;
    flushInput();
  };
  useEffect(() => {
    let disposed = false,
      term: XTerm | undefined,
      fit: any,
      ws: WebSocket | undefined,
      heartbeatTimer: ReturnType<typeof setInterval> | undefined,
      observer: ResizeObserver | undefined;
    let renderQueue: { reset?: boolean; data?: Uint8Array }[] = [],
      renderBytes = 0,
      renderBusy = false,
      cursor = 0,
      lossSeen = false;
    const render = () => {
      if (disposed || renderBusy || !term || !renderQueue.length) return;
      const item = renderQueue.shift()!;
      if (item.reset) {
        term.reset();
        render();
        return;
      }
      renderBusy = true;
      rendering.current = true;
      const data = item.data!;
      term.write(data, () => {
        renderBytes -= data.length;
        rendering.current = false;
        renderBusy = false;
        render();
      });
    };
    const markGesture = () => {
      gesture.current = true;
      queueMicrotask(() => {
        gesture.current = false;
      });
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (new TextEncoder().encode(text).length > 4096) {
        setError("Paste is limited to 4,096 bytes.");
        return;
      }
      if (/[\r\n]/.test(text)) setPaste(text);
      else sendInput(text);
    };
    const connect = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/xterm/css/xterm.css"),
      ]);
      if (disposed || !host.current) return;
      term = new Terminal({
        documentOverride: document,
        allowProposedApi: true,
        scrollback: 2000,
        fontSize: 13,
        disableStdin: true,
        theme: { background: "#191919", foreground: "#f5f5f5" },
        windowOptions: {},
        linkHandler: { activate: () => {} },
        logLevel: "off",
      });
      instance.current = term;
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host.current);
      fit.fit();
      for (const id of [0, 1, 2, 8, 52, 1337])
        term.parser.registerOscHandler(id, () => true);
      term.onData((data) => {
        if (controlRef.current && (!rendering.current || gesture.current))
          sendInput(data);
      });
      host.current.addEventListener("paste", onPaste, true);
      for (const event of ["keydown", "beforeinput", "compositionend"])
        host.current.addEventListener(event, markGesture, true);
      const sendResize = () => {
        if (disposed || !term) return;
        fit.fit();
        const id = identity();
        if (id && ws?.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({
              ...id,
              type: "resize",
              sequence: ++resizeSequence.current,
              cols: Math.max(20, Math.min(240, term.cols)),
              rows: Math.max(5, Math.min(80, term.rows)),
            }),
          );
      };
      let resizeTimer: ReturnType<typeof setTimeout> | undefined;
      observer = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(sendResize, 300);
      });
      observer.observe(host.current);
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/terminals/${initial.id}/stream`,
      );
      socket.current = ws;
      ws.onopen = () => {
        if (disposed) return;
        setConnected(true);
        ws!.send(
          JSON.stringify({
            version: 1,
            type: "hello",
            generation: initial.generation,
            cursor,
            csrf,
          }),
        );
      };
      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "state") {
            setTerminal(message.terminal);
            if (message.terminal.outputLost && !lossSeen) {
              lossSeen = true;
              renderQueue.push({ reset: true });
              setGap(true);
              render();
            }
            const c = controlRef.current;
            if (
              c &&
              (message.terminal.controllerEpoch !== c.epoch ||
                message.terminal.state !== "running" ||
                message.terminal.inputUncertain)
            ) {
              controlRef.current = null;
              setControl(null);
              term!.options.disableStdin = true;
            }
          } else if (message.type === "output") {
            if (message.generation !== initial.generation)
              throw Error("Stale output generation");
            if (message.lost) setGap(true);
            if (message.gap) {
              renderQueue.push({ reset: true });
              cursor = message.floor;
              setGap(true);
            }
            for (const chunk of message.chunks) {
              if (chunk.sequence <= cursor) continue;
              if (chunk.sequence !== cursor + 1) {
                renderQueue.push({ reset: true });
                setGap(true);
              }
              const data = bytes(chunk.data);
              if (renderBytes + data.length > 262144)
                throw Error(
                  "Rendering backlog exceeded; reconnect to a bounded tail",
                );
              renderBytes += data.length;
              renderQueue.push({ data });
              cursor = chunk.sequence;
            }
            render();
          } else if (message.type === "ack" && message.action === "input") {
            const sent = pending.current;
            if (
              sent &&
              sent.epoch === message.epoch &&
              sent.sequence === message.sequence
            ) {
              pending.current = null;
              flushInput();
            }
          } else if (message.type === "error") {
            setError(message.message);
            if (
              [
                "CONTROLLER_STALE",
                "CONTROLLER_EXPIRED",
                "INPUT_UNCERTAIN",
              ].includes(message.code)
            ) {
              controlRef.current = null;
              setControl(null);
              term!.options.disableStdin = true;
            }
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Terminal stream invalid");
          ws!.close();
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        controlRef.current = null;
        setControl(null);
        term!.options.disableStdin = true;
        if (pending.current) setUnknown(pending.current);
        waiting.current = new Uint8Array();
        setError(
          "Detached. The shell may still be running. Reconnect explicitly; unacknowledged input is never sent again automatically.",
        );
      };
      heartbeatTimer = setInterval(() => {
        if (ws?.readyState !== WebSocket.OPEN) return;
        const id = identity();
        ws.send(
          JSON.stringify(
            id
              ? { ...id, type: "heartbeat" }
              : { version: 1, type: "watch", generation: initial.generation },
          ),
        );
      }, 6000);
    };
    void connect().catch((e) => {
      if (!disposed)
        setError(
          e instanceof Error ? e.message : "Terminal renderer unavailable",
        );
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      ws?.close();
      socket.current = null;
      controlRef.current = null;
      setControl(null);
      if (pending.current) setUnknown(pending.current);
      waiting.current = new Uint8Array();
      host.current?.removeEventListener("paste", onPaste, true);
      for (const event of ["keydown", "beforeinput", "compositionend"])
        host.current?.removeEventListener(event, markGesture, true);
      term?.dispose();
      instance.current = null;
      renderQueue = [];
    };
  }, [connection, initial.id, initial.generation, csrf]);
  const takeControl = () =>
    void execute(
      newIntent(
        `/terminals/${terminal.id}/control`,
        {
          generation: terminal.generation,
          expectedEpoch: terminal.controllerEpoch,
          acknowledgeUncertainInput: terminal.inputUncertain || !!unknown,
        },
        "Take terminal control",
      ),
      (r) => {
        if (!alive.current) return;
        setControl(r.control);
        controlRef.current = r.control;
        resizeSequence.current = 0;
        pending.current = null;
        waiting.current = new Uint8Array();
        setUnknown(null);
        setError("");
        if (instance.current) {
          instance.current.options.disableStdin = false;
          instance.current.focus();
        }
        void changed();
      },
    );
  return (
    <section className="terminal-session" aria-label="Persistent terminal">
      <div className="terminal-summary">
        <strong>
          {terminal.workspaceName ?? "Workspace"} · {terminal.profile}
        </strong>
        <span>
          {terminal.state === "shell_exited"
            ? "Shell exited; background work may remain"
            : terminal.state}{" "}
          {terminal.exitCode !== null ? `(exit ${terminal.exitCode})` : ""}
        </span>
      </div>
      <details className="terminal-details">
        <summary>Network disabled · lifetime and reservation</summary>
        <p>
          Lifetime ends {new Date(terminal.deadline).toLocaleString()}. The
          shell holds this workspace until its runner and background jobs are
          confirmed stopped.
        </p>
      </details>
      <p role="status">
        {control
          ? "You control this terminal."
          : connected
            ? "Read-only viewer. Take control to send input."
            : "Detached from terminal."}
      </p>
      {gap && (
        <p className="writer-notice" role="status">
          Older output expired or was lost. The display was reset; this tail
          cannot reconstruct a full-screen application.
        </p>
      )}
      {terminal.inputUncertain && (
        <p className="inline-error">
          Some input may have reached the process. Taking control acknowledges
          that uncertainty.
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="terminal-actions">
        <button
          disabled={disabled || !connected || terminal.state !== "running"}
          onClick={takeControl}
        >
          {control ? "Renew control" : "Take control"}
        </button>
        {!connected && (
          <button
            onClick={() => {
              setError("");
              setConnection((n) => n + 1);
            }}
          >
            Reconnect
          </button>
        )}
        <button
          disabled={disabled || terminal.retired}
          onClick={() =>
            void execute(
              newIntent(
                `/terminals/${terminal.id}/terminate`,
                { generation: terminal.generation },
                "Terminate terminal and background jobs",
              ),
              () => {
                if (alive.current) void changed();
              },
            )
          }
        >
          Terminate terminal
        </button>
        {terminal.retired && (
          <button
            disabled={disabled}
            onClick={() =>
              void execute(
                {
                  ...newIntent(
                    `/terminals/${terminal.id}`,
                    {},
                    "Remove retired terminal metadata",
                  ),
                  method: "DELETE",
                },
                () => {
                  if (alive.current) void changed();
                },
              )
            }
          >
            Remove metadata
          </button>
        )}
      </div>
      <details className="terminal-secondary">
        <summary>Connection and clipboard</summary>
        <div className="terminal-actions">
          {" "}
          <button disabled={!connected} onClick={() => socket.current?.close()}>
            Detach
          </button>
          <button
            onClick={() => {
              const selection = instance.current?.getSelection();
              if (selection)
                void navigator.clipboard
                  .writeText(selection)
                  .catch(() => setError("Clipboard copy unavailable."));
            }}
          >
            Copy selection
          </button>
        </div>
      </details>
      {unknown && (
        <div className="writer-notice">
          <p>
            One input acknowledgement was lost. Checking its outcome does not
            send a new command.
          </p>
          <button
            onClick={() => {
              const { type: _, ...body } = unknown;
              void request<any>(`/terminals/${terminal.id}/input/outcome`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": csrf,
                },
                body: JSON.stringify(body),
              })
                .then((r) => {
                  setError(`Retained input outcome: ${r.input.state}.`);
                  if (
                    [
                      "delivered",
                      "denied",
                      "uncertain",
                      "missing",
                      "expired",
                    ].includes(r.input.state)
                  ) {
                    setUnknown(null);
                    pending.current = null;
                  }
                })
                .catch((e) => setError(e.message));
            }}
          >
            Check input outcome
          </button>
        </div>
      )}
      <div
        ref={host}
        className="terminal-canvas"
        aria-label="Terminal input and output"
      />
      {paste !== null && (
        <div
          className="terminal-paste"
          role="dialog"
          aria-label="Confirm multiline paste"
        >
          <p>Send this exact multiline input?</p>
          <pre>{paste}</pre>
          <button
            disabled={!control}
            onClick={() => {
              sendInput(paste);
              setPaste(null);
            }}
          >
            Send paste
          </button>
          <button onClick={() => setPaste(null)}>Cancel paste</button>
        </div>
      )}
    </section>
  );
}
