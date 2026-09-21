import { Icon } from "./Icons.tsx";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../../../packages/contracts/src/index.ts";
import {
  request,
  newIntent,
  confirmedRuntime,
  runtimeNames,
  type Intent,
} from "./api.ts";
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
  searchResults = false,
}: {
  searchResults?: boolean;
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
  const baseIdentity = `${projectId}:${state}:${q}:${searchResults}`;
  const identity = baseIdentity;
  const [rowsIdentity, setRowsIdentity] = useState(baseIdentity);
  const [pageIdentity, setPageIdentity] = useState("");
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
  const rowCount = useRef(0);
  const failedLoad = useRef<{ next?: string; refresh: boolean }>({
    refresh: false,
  });
  const focusScope = useRef<HTMLElement>(null);
  const pendingActionFocus = useRef<string | null>(null);
  function restoreActionFocus(id: string) {
    requestAnimationFrame(() => {
      const target =
        focusScope.current?.querySelector<HTMLElement>(
          `[data-rename-focus="${id}"]`,
        ) ??
        focusScope.current?.querySelector<HTMLElement>(
          ".session-row .session-rename",
        ) ??
        focusScope.current
          ?.closest("dialog")
          ?.querySelector<HTMLElement>("input[type=search]") ??
        document.querySelector<HTMLElement>(".project-button.selected");
      target?.focus();
    });
  }
  async function load(next?: string, refresh = false) {
    const requestEpoch = ++epoch.current;
    setLoading(true);
    failedLoad.current = { next, refresh };
    try {
      const query = new URLSearchParams({ projectId, q, state, limit: "5" });
      if (!searchResults) {
        query.set("order", "queried");
      }
      if (next) query.set("cursor", next);
      let result = await request<{
        sessions: (Session & { snippet: string })[];
        nextCursor: string | null;
      }>("/history?" + query);
      if (refresh) {
        const targetCount = rowCount.current;
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
      setRows((old) => {
        const unique = [
          ...new Map(
            (next ? [...old, ...result.sessions] : result.sessions).map(
              (row) => [row.id, row],
            ),
          ).values(),
        ];
        rowCount.current = unique.length;
        return unique;
      });
      setRowsIdentity(baseIdentity);
      setPageIdentity(identity);
      setCursor(result.nextCursor);
      setError("");
    } catch (e) {
      if (epoch.current === requestEpoch)
        setError(e instanceof Error ? e.message : "History unavailable");
    } finally {
      if (epoch.current === requestEpoch) setLoading(false);
    }
  }
  const lastIdentity = useRef(identity);
  const lastBaseIdentity = useRef(baseIdentity);
  useEffect(() => {
    const changed = lastBaseIdentity.current !== baseIdentity;
    const selectionChanged = lastIdentity.current !== identity;
    lastIdentity.current = identity;
    lastBaseIdentity.current = baseIdentity;
    if (selectionChanged) {
      setCursor(null);
      setError("");
      failedLoad.current = { refresh: !changed };
    }
    if (changed) {
      setRows([]);
      rowCount.current = 0;
      setCursor(null);
      setError("");
    }
    setLoading(true);
    const timer = setTimeout(() => void load(undefined, !changed), 200);
    return () => {
      clearTimeout(timer);
      epoch.current++;
    };
  }, [identity, revision]);
  // The acknowledged mutation also refreshes /sessions. That revision can
  // supersede this component's read, so restore only after current rows commit.
  useEffect(() => {
    if (loading || !pendingActionFocus.current) return;
    const id = pendingActionFocus.current;
    pendingActionFocus.current = null;
    restoreActionFocus(id);
  }, [loading, rows]);
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
  const visibleRows = rowsIdentity === baseIdentity ? rows : [];
  const displayRows = visibleRows;
  const currentPage = pageIdentity === identity;
  return (
    <section
      ref={focusScope}
      className="history"
      aria-label="Conversation history"
      aria-busy={loading}
    >
      {error && lastIdentity.current === identity && (
        <div className="history-error" role="alert">
          <p>{error}</p>
          <button
            disabled={loading}
            onClick={() =>
              void load(failedLoad.current.next, failedLoad.current.refresh)
            }
          >
            Retry history
          </button>
        </div>
      )}
      {searchResults && loading && (
        <p className="rail-empty" role="status">
          Loading conversations…
        </p>
      )}
      <div className="conversation-list">
        {displayRows.map((s) => (
          <div
            key={s.id}
            className={`session-row ${selectedId === s.id ? "selected" : ""}`}
          >
            <button
              className={`conversation-link ${selectedId === s.id ? "selected" : ""}`}
              aria-current={selectedId === s.id ? "page" : undefined}
              onClick={() => select(s.id)}
            >
              {searchResults ? (
                <Icon name="compose" />
              ) : (
                <span
                  className={`rail-dot ${(s.runtime ? confirmedRuntime(s.runtime) : s.backgroundUntil || workspaces.some((w) => w.writerSessionId === s.id)) ? "resource-held" : ""}`}
                  title={
                    s.runtime
                      ? runtimeNames[s.runtime.state]
                      : s.backgroundUntil ||
                          workspaces.some((w) => w.writerSessionId === s.id)
                        ? "Occupying runtime resources"
                        : "View status for resource details"
                  }
                  role="img"
                  aria-label={
                    s.runtime
                      ? runtimeNames[s.runtime.state]
                      : s.backgroundUntil ||
                          workspaces.some((w) => w.writerSessionId === s.id)
                        ? "Occupying runtime resources"
                        : "Resource details available in View status"
                  }
                />
              )}
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
                if (event.key === "Escape" && event.currentTarget.open) {
                  event.preventDefault();
                  event.stopPropagation();
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
                  <Icon name="compose" />
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
                        pendingActionFocus.current = s.id;
                        await load(undefined, true);
                      },
                    );
                  }}
                >
                  <Icon name="archive" />
                  {s.archived ? "Unarchive" : "Archive"}
                </button>
                <button
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    viewStatus(s.id);
                  }}
                >
                  <Icon name="info" />
                  Status
                </button>
                {(s.runtime || s.backgroundUntil) && (
                  <button
                    disabled={
                      disabled ||
                      s.backgroundStopRequested ||
                      s.runtime?.state === "retiring" ||
                      [
                        "accepted",
                        "cancelling",
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
                          {
                            generation:
                              s.runtime?.generation ?? s.generation ?? 0,
                          },
                          "Stop processes",
                        ),
                        async () => {
                          pendingActionFocus.current = s.id;
                          await load(undefined, true);
                        },
                      );
                    }}
                  >
                    <Icon name="stop" />
                    {s.backgroundStopRequested
                      ? "Stopping background processes…"
                      : "Stop processes"}
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
              async () => {
                setEditing(null);
                pendingActionFocus.current = target.id;
                await load(undefined, true);
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
              Cancel
            </button>
          </div>
        </form>
      )}
      {!displayRows.length && !loading && (
        <p className="rail-empty">No matching conversations</p>
      )}
      {cursor && currentPage && (
        <button
          className="history-more"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          Show more
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
        {session.archived ? "Unarchive" : "Archive"}
      </button>
    </section>
  );
}
