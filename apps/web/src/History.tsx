import { useEffect, useRef, useState } from "react";
import type { Session } from "../../../packages/contracts/src/index.ts";
import { request, newIntent, type Intent } from "./api.ts";
export function History({
  projectId,
  selectedId,
  revision,
  select,
  workspaces = [],
}: {
  projectId: string;
  selectedId: string;
  revision: string;
  select(id: string): void;
  workspaces?: { id: string; name: string }[];
}) {
  const [q, setQ] = useState(""),
    [state, setState] = useState("active"),
    [rows, setRows] = useState<(Session & { snippet: string })[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const epoch = useRef(0);
  async function load(next?: string) {
    const requestEpoch = ++epoch.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ projectId, q, state, limit: "20" });
      if (next) query.set("cursor", next);
      const result = await request<{
        sessions: (Session & { snippet: string })[];
        nextCursor: string | null;
      }>("/history?" + query);
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
  return (
    <section className="history" aria-label="Conversation history">
      <label className="field">
        Search conversations
        <input
          type="search"
          value={q}
          maxLength={120}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <label className="field">
        Show
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="active">Active conversations</option>
          <option value="archived">Archived conversations</option>
          <option value="all">All conversations</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="conversation-list">
        {rows.map((s) => (
          <button
            key={s.id}
            className={`conversation-link ${selectedId === s.id ? "selected" : ""}`}
            aria-current={selectedId === s.id ? "page" : undefined}
            onClick={() => select(s.id)}
          >
            <span className={`rail-dot dot-${s.state}`} aria-hidden="true" />
            <span>
              {s.title}
              <small className="conversation-workspace">
                {workspaces.find((w) => w.id === s.workspaceId)?.name ??
                  "Loading workspace…"}
              </small>
              {q && s.snippet && (
                <small className="history-snippet">{s.snippet}</small>
              )}
            </span>
          </button>
        ))}
      </div>
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
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(session.title),
    [revision, setRevision] = useState(session.metadataRevision ?? 0);
  useEffect(() => {
    setEditing(false);
    setTitle(session.title);
  }, [session.id]);
  return (
    <section className="history-details" aria-label="Conversation details">
      {session.archived && (
        <p>
          Archived — this only changes history visibility. Work and stored
          history are preserved.
        </p>
      )}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void execute(
              newIntent(
                `/sessions/${session.id}/metadata`,
                { expectedRevision: revision, title },
                "Rename conversation",
              ),
              () => setEditing(false),
            );
          }}
        >
          <label className="field">
            Conversation title
            <input
              maxLength={200}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <button disabled={disabled || !title.trim()} type="submit">
            Save title
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel edit
          </button>
        </form>
      ) : (
        <button
          disabled={disabled}
          onClick={() => {
            setTitle(session.title);
            setRevision(session.metadataRevision ?? 0);
            setEditing(true);
          }}
        >
          Rename conversation
        </button>
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
