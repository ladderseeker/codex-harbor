import { Icon } from "./Icons.tsx";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../../../packages/contracts/src/index.ts";
import { request, newIntent, type Intent } from "./api.ts";
export function History({
  projectId,
  selectedId,
  revision,
  select,
  workspaces = [],
  disabled,
  execute,
  query = "",
  filter = "active",
  viewStatus,
}: {
  query?: string;
  filter?: string;
  viewStatus(id: string): void;
  projectId: string;
  selectedId: string;
  revision: string;
  select(id: string): void;
  workspaces?: { id: string; name: string; writerSessionId?: string | null }[];
  disabled: boolean;
  execute(intent: Intent, complete?: (result: unknown) => void): Promise<void>;
}) {
  const q = query,
    state = filter;
  const [rows, setRows] = useState<(Session & { snippet: string })[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{
    id: string;
    title: string;
    revision: number;
  } | null>(null);
  const epoch = useRef(0);
  function restoreActionFocus(id: string) {
    requestAnimationFrame(() => {
      const target =
        document.querySelector<HTMLElement>(`[data-rename-focus="${id}"]`) ??
        document.querySelector<HTMLElement>(".session-row .session-rename") ??
        document.querySelector<HTMLElement>(".project-button.selected");
      target?.focus();
    });
  }
  async function load(next?: string, refresh = false) {
    const requestEpoch = ++epoch.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ projectId, q, state, limit: "20" });
      if (next) query.set("cursor", next);
      let result = await request<{
        sessions: (Session & { snippet: string })[];
        nextCursor: string | null;
      }>("/history?" + query);
      if (refresh) {
        const targetCount = rows.length;
        while (result.nextCursor && result.sessions.length < targetCount) {
          if (epoch.current !== requestEpoch) return;
          query.set("cursor", result.nextCursor);
          const page = await request<{
            sessions: (Session & { snippet: string })[];
            nextCursor: string | null;
          }>("/history?" + query);
          result = {
            sessions: [...result.sessions, ...page.sessions],
            nextCursor: page.nextCursor,
          };
        }
      }
      if (epoch.current !== requestEpoch) return;
      setRows((old) => (next ? [...old, ...result.sessions] : result.sessions));
      setCursor(result.nextCursor);
      setError("");
    } catch (e) {
      if (epoch.current === requestEpoch)
        setError(e instanceof Error ? e.message : "History unavailable");
    } finally {
      if (epoch.current === requestEpoch) setLoading(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(timer);
      epoch.current++;
    };
  }, [q, state, projectId, revision]);
  const refreshRef = useRef(() => {});
  refreshRef.current = () => {
    if (
      !loading &&
      document.visibilityState === "visible" &&
      state !== "active"
    )
      void load(undefined, true);
  };
  useEffect(() => {
    const timer = window.setInterval(() => refreshRef.current(), 15000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <section className="history" aria-label="Conversation history">
      {error && <p role="alert">{error}</p>}
      <div className="conversation-list">
        {rows.map((s) => (
          <div
            key={s.id}
            className={`session-row ${selectedId === s.id ? "selected" : ""}`}
          >
            <button
              className={`conversation-link ${selectedId === s.id ? "selected" : ""}`}
              aria-current={selectedId === s.id ? "page" : undefined}
              onClick={() => select(s.id)}
            >
              <span
                className={`rail-dot ${s.backgroundUntil || workspaces.some((w) => w.writerSessionId === s.id) ? "resource-held" : ""}`}
                title={
                  s.backgroundUntil ||
                  workspaces.some((w) => w.writerSessionId === s.id)
                    ? "Occupying runtime resources"
                    : "View status for resource details"
                }
                role="img"
                aria-label={
                  s.backgroundUntil ||
                  workspaces.some((w) => w.writerSessionId === s.id)
                    ? "Occupying runtime resources"
                    : "Resource details available in View status"
                }
              />
              <span>
                {s.title}
                {workspaces.find((w) => w.id === s.workspaceId) && (
                  <small className="conversation-workspace">
                    {workspaces.find((w) => w.id === s.workspaceId)?.name}
                  </small>
                )}
                {q && s.snippet && (
                  <small className="history-snippet">{s.snippet}</small>
                )}
              </span>
            </button>
            <details
              className="action-menu session-menu"
              onToggle={(event) => {
                const detail = event.currentTarget;
                if (!detail.open) return;
                const panel =
                  detail.querySelector<HTMLElement>(".action-menu-panel");
                const rect = detail.getBoundingClientRect();
                if (panel) {
                  panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 232))}px`;
                  panel.style.top = `${Math.max(12, Math.min(rect.bottom + 4, window.innerHeight - panel.offsetHeight - 12))}px`;
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary
                className="icon-button session-rename"
                data-rename-focus={s.id}
                aria-label={`More actions for ${s.title}`}
                title="More actions"
              >
                <Icon name="more" />
              </summary>
              <div className="action-menu-panel">
                <button
                  disabled={disabled}
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    setEditing({
                      id: s.id,
                      title: s.title,
                      revision: s.metadataRevision ?? 0,
                    });
                  }}
                >
                  Rename
                </button>
                <button
                  disabled={disabled}
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    void execute(
                      newIntent(
                        `/sessions/${s.id}/metadata`,
                        {
                          expectedRevision: s.metadataRevision ?? 0,
                          archived: !s.archived,
                        },
                        s.archived
                          ? "Restore conversation"
                          : "Archive conversation",
                      ),
                      async () => {
                        await load();
                        restoreActionFocus(s.id);
                      },
                    );
                  }}
                >
                  {s.archived ? "Restore conversation" : "Archive conversation"}
                </button>
                <button
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    viewStatus(s.id);
                  }}
                >
                  View status
                </button>
                {s.backgroundUntil && (
                  <button
                    disabled={
                      disabled ||
                      s.backgroundStopRequested ||
                      [
                        "queued",
                        "dispatching",
                        "running",
                        "waiting_approval",
                        "waiting_input",
                      ].includes(s.state)
                    }
                    onClick={(event) => {
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      void execute(
                        newIntent(
                          `/sessions/${s.id}/background-stop`,
                          { generation: s.generation ?? 0 },
                          "Stop background processes",
                        ),
                        async () => {
                          await load();
                          restoreActionFocus(s.id);
                        },
                      );
                    }}
                  >
                    {s.backgroundStopRequested
                      ? "Stopping background processes…"
                      : "Stop background processes"}
                  </button>
                )}
              </div>
            </details>
          </div>
        ))}
      </div>
      {editing && (
        <form
          className="sidebar-rename"
          onSubmit={(event) => {
            event.preventDefault();
            const target = editing;
            void execute(
              newIntent(
                `/sessions/${encodeURIComponent(target.id)}/metadata`,
                { expectedRevision: target.revision, title: target.title },
                "Rename conversation",
              ),
              () => {
                setEditing(null);
                void load();
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      `[data-rename-focus="${target.id}"]`,
                    )
                    ?.focus(),
                );
              },
            );
          }}
        >
          <label className="field">
            Conversation title
            <input
              autoFocus
              maxLength={200}
              required
              value={editing.title}
              onChange={(event) =>
                setEditing({ ...editing, title: event.target.value })
              }
            />
          </label>
          <div className="rename-actions">
            <button type="submit" disabled={disabled || !editing.title.trim()}>
              Save title
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel edit
            </button>
          </div>
        </form>
      )}
      {!rows.length && !loading && (
        <p className="rail-empty">No matching conversations</p>
      )}
      {cursor && (
        <button disabled={loading} onClick={() => void load(cursor)}>
          Load older conversations
        </button>
      )}
    </section>
  );
}
export function ConversationDetails({
  session,
  disabled,
  execute,
}: {
  session: Session;
  disabled: boolean;
  execute(intent: Intent, complete?: (result: unknown) => void): Promise<void>;
}) {
  return (
    <section className="history-details" aria-label="Conversation details">
      {session.archived && (
        <p>
          Archived — this only changes history visibility. Work and stored
          history are preserved.
        </p>
      )}
      <button
        disabled={disabled}
        onClick={() =>
          void execute(
            newIntent(
              `/sessions/${session.id}/metadata`,
              {
                expectedRevision: session.metadataRevision ?? 0,
                archived: !session.archived,
              },
              session.archived
                ? "Restore conversation"
                : "Archive conversation",
            ),
          )
        }
      >
        {session.archived ? "Restore conversation" : "Archive conversation"}
      </button>
    </section>
  );
}
