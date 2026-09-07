import { useCallback, useEffect, useRef, useState } from "react";
import { newIntent, request, type Intent } from "./api.ts";
import type { WorkspaceView } from "../../../packages/workspaces/src/types.ts";
type Preview = {
  id: string;
  name: string;
  script: string;
  port: number;
  permissionProfile: "read-only" | "workspace-write";
  revision: number;
  generation: number;
  state: string;
  retired: boolean;
  deadline: string | null;
  failureCode: string | null;
  lastStopId: string | null;
  outputLost: boolean;
};
type Execute = (
  intent: Intent,
  complete?: (result: any) => void,
) => Promise<void>;
export function Previews({
  workspace,
  execute,
  disabled,
}: {
  workspace: WorkspaceView;
  execute: Execute;
  disabled: boolean;
}) {
  const [list, setList] = useState<Preview[]>([]),
    [selected, setSelected] = useState(""),
    [available, setAvailable] = useState(true),
    [error, setError] = useState(""),
    [name, setName] = useState("Project preview"),
    [script, setScript] = useState("dev"),
    [port, setPort] = useState("3000"),
    [profile, setProfile] = useState<"read-only" | "workspace-write">(
      "read-only",
    ),
    [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<{ id: string; revision: number } | null>(
      null,
    ),
    [bootstrap, setBootstrap] = useState<{
      path: string;
      until: number;
    } | null>(null),
    [ack, setAck] = useState(false),
    [log, setLog] = useState(""),
    [gap, setGap] = useState(false);
  const alive = useRef(true),
    refreshing = useRef(false),
    cursor = useRef(0),
    logEpoch = useRef(0);
  const viewEpoch = useRef(0);
  const choose = (id: string) => {
    viewEpoch.current++;
    setEditing(null);
    setBootstrap(null);
    setAck(false);
    setSelected(id);
  };
  const perform = (intent: Intent, complete?: (result: any) => void) => {
    const epoch = viewEpoch.current;
    return execute(intent, (result) => {
      if (alive.current && viewEpoch.current === epoch) complete?.(result);
    });
  };
  const current = list.find((p) => p.id === selected);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const data = await request<{ previews: Preview[]; available: boolean }>(
        `/workspaces/${workspace.id}/previews`,
      );
      if (alive.current) {
        setList(data.previews);
        setAvailable(data.available);
        setError("");
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Preview list unavailable");
    } finally {
      refreshing.current = false;
    }
  }, [workspace.id]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    const epoch = ++logEpoch.current;
    cursor.current = 0;
    setLog("");
    setGap(false);
    setBootstrap(null);
    setAck(false);
    if (!selected) return;
    let busy = false;
    const decoder = new TextDecoder();
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const data = await request<{
          cursor: number;
          gap: boolean;
          preview: Preview;
          chunks: { dataBase64: string }[];
        }>(`/previews/${selected}/logs?cursor=${cursor.current}`);
        if (!alive.current || logEpoch.current !== epoch) return;
        let text = "";
        for (const chunk of data.chunks)
          text += decoder.decode(
            Uint8Array.from(atob(chunk.dataBase64), (c) => c.charCodeAt(0)),
            { stream: true },
          );
        cursor.current = data.cursor;
        setGap((old) => old || data.gap || data.preview.outputLost);
        if (text) setLog((old) => (old + text).slice(-1048576));
      } catch (e) {
        if (alive.current && logEpoch.current === epoch)
          setError(e instanceof Error ? e.message : "Preview logs unavailable");
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1000);
    return () => {
      clearInterval(timer);
      logEpoch.current++;
    };
  }, [selected]);
  const finish = (result: any) => {
    if (!alive.current) return;
    if (result.preview) choose(result.preview.id);
    void refresh();
  };
  const busy = disabled || creating;
  const create = async () => {
    setCreating(true);
    try {
      await perform(
        editing
          ? {
              ...newIntent(
                "/previews/" + editing.id,
                {
                  name,
                  script,
                  port: Number(port),
                  permissionProfile: profile,
                  expectedRevision: editing.revision,
                },
                "Edit preview launch settings",
              ),
              method: "PATCH",
            }
          : newIntent(
              "/previews",
              {
                workspaceId: workspace.id,
                name,
                script,
                port: Number(port),
                permissionProfile: profile,
              },
              "Create preview",
            ),
        finish,
      );
    } finally {
      if (alive.current) setCreating(false);
    }
  };
  return (
    <section className="previews-panel" aria-label="Private project previews">
      <div className="preview-context">
        <strong>{workspace.name}</strong>
        <span>Private · no external network · 24-hour maximum</span>
      </div>
      {!available && (
        <p role="status">
          Private preview DNS, TLS and relay are not configured. Your
          administrator can enable this profile.
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="preview-layout">
        <nav className="preview-list" aria-label="Saved previews">
          {list.map((p) => (
            <button
              key={p.id}
              className={
                p.id === selected ? "preview-choice selected" : "preview-choice"
              }
              aria-pressed={p.id === selected}
              onClick={() => choose(p.id)}
            >
              <strong>{p.name}</strong>
              <span>
                {p.state.replaceAll("_", " ")} · {p.permissionProfile}
              </span>
            </button>
          ))}
          <button className="quiet-button" onClick={() => choose("")}>
            New preview
          </button>
        </nav>
        <div className="preview-detail">
          {!current || editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <h3>{editing ? "Edit launch settings" : "Create a preview"}</h3>
              <p className="muted">
                Run an existing package script in this workspace. Install its
                dependencies before starting.
              </p>
              <label>
                Preview name
                <input
                  value={name}
                  maxLength={160}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <div className="preview-form-row">
                <label>
                  Package script
                  <input
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    pattern="[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}"
                    maxLength={64}
                    required
                  />
                </label>
                <label>
                  Application port
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    required
                  />
                </label>
              </div>
              <label>
                Preview permissions
                <select
                  value={profile}
                  onChange={(e) => setProfile(e.target.value as typeof profile)}
                >
                  <option value="read-only">Read only</option>
                  <option value="workspace-write">Workspace write</option>
                </select>
              </label>
              <p className="muted">
                Read-only previews may see concurrent source edits. Workspace
                write reserves this workspace until the preview and its
                background processes are retired.
              </p>
              <button
                disabled={busy || !available || workspace.state !== "ready"}
              >
                {editing ? "Save launch settings" : "Save preview"}
              </button>
            </form>
          ) : (
            <>
              <div className="preview-heading">
                <div>
                  <h3>{current.name}</h3>
                  <p className="muted">
                    npm run {current.script} · port {current.port} ·{" "}
                    {current.permissionProfile}
                  </p>
                </div>
                <span className="status-badge" role="status">
                  {current.state.replaceAll("_", " ")}
                </span>
              </div>
              {current.failureCode && (
                <p role="status" className="inline-error">
                  {current.failureCode.replaceAll("_", " ").toLowerCase()}.{" "}
                  {current.retired
                    ? "The process has been retired. You can deliberately start again."
                    : "The workspace reservation remains until retirement is confirmed."}
                </p>
              )}
              {current.deadline && !current.retired && (
                <p className="muted">
                  Stops by {new Date(current.deadline).toLocaleString()}.
                </p>
              )}
              <div className="preview-actions">
                {current.retired && current.state !== "queued" && (
                  <button
                    className="quiet-button"
                    disabled={busy}
                    onClick={() => {
                      viewEpoch.current++;
                      setBootstrap(null);
                      setName(current.name);
                      setScript(current.script);
                      setPort(String(current.port));
                      setProfile(current.permissionProfile);
                      setEditing({
                        id: current.id,
                        revision: current.revision,
                      });
                    }}
                  >
                    Edit launch settings
                  </button>
                )}
                {current.retired && current.state !== "queued" && (
                  <button
                    disabled={busy || !available}
                    onClick={() =>
                      void perform(
                        newIntent(
                          `/previews/${current.id}/start`,
                          { expectedRevision: current.revision },
                          "Start preview",
                        ),
                        finish,
                      )
                    }
                  >
                    Start preview
                  </button>
                )}
                {current.state === "ready" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        newIntent(
                          `/previews/${current.id}/open`,
                          { expectedGeneration: current.generation },
                          "Prepare private preview access",
                        ),
                        (result) => {
                          if (alive.current) {
                            setBootstrap({
                              path: result.bootstrapPath,
                              until: Date.now() + 30000,
                            });
                            void refresh();
                          }
                        },
                      )
                    }
                  >
                    Prepare private access
                  </button>
                )}
                {bootstrap &&
                  bootstrap.until > Date.now() &&
                  current.state === "ready" && (
                    <a
                      className="preview-open"
                      href={bootstrap.path}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open preview in new tab ↗
                    </a>
                  )}
                {(!current.retired || current.state === "queued") && (
                  <button
                    className="danger-button"
                    disabled={
                      busy ||
                      current.state === "stopping" ||
                      (current.state === "uncertain" && !ack)
                    }
                    onClick={() =>
                      void perform(
                        newIntent(
                          `/previews/${current.id}/stop`,
                          {
                            expectedGeneration: current.generation,
                            ...(current.state === "uncertain"
                              ? { acknowledgeUnconfirmed: current.lastStopId }
                              : {}),
                          },
                          "Stop preview and retire its processes",
                        ),
                        finish,
                      )
                    }
                  >
                    Stop preview
                  </button>
                )}
                {current.retired && current.state !== "queued" && (
                  <button
                    className="quiet-button"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        {
                          ...newIntent(
                            `/previews/${current.id}`,
                            {},
                            "Remove retired preview",
                          ),
                          method: "DELETE",
                        },
                        () => {
                          if (alive.current) {
                            choose("");
                            void refresh();
                          }
                        },
                      )
                    }
                  >
                    Remove record
                  </button>
                )}
              </div>
              {current.state === "uncertain" && (
                <label className="preview-ack">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  I acknowledge that retirement was not confirmed and want to
                  retry the same runtime.
                </label>
              )}
              {bootstrap && (
                <p className="muted">
                  The opening expires after 30 seconds. The new tab receives
                  preview-only access; your Harbor session remains private.
                </p>
              )}
              <div className="preview-log-heading">
                <h4>Process log</h4>
                <span className="muted">Latest 1 MiB · 24 hours</span>
              </div>
              {gap && (
                <p role="status" className="inline-error">
                  Some earlier output is unavailable. This view does not
                  reconstruct missing output.
                </p>
              )}
              <pre
                className="preview-log"
                aria-label="Preview process log"
                tabIndex={0}
              >
                {log || "No process output yet."}
              </pre>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
