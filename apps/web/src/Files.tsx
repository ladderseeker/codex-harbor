import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { request, mutate, newIntent, ApiError, type Intent } from "./api.ts";
const FileEditor = lazy(() =>
  import("./FileEditor.tsx").then((m) => ({ default: m.FileEditor })),
);
export function Files({
  workspace,
  csrf,
  writeAvailable,
  unavailableReason,
  onClose,
}: {
  workspace: { id: string; name: string };
  csrf: string;
  writeAvailable: boolean;
  unavailableReason?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const base = `/workspaces/${workspace.id}`,
    root = workspace.id + ":";
  const [section, setSection] = useState<"files" | "changes">("files"),
    [directory, setDirectory] = useState(root),
    [tree, setTree] = useState<any>(),
    [lease, setLease] = useState<any>(),
    [content, setContent] = useState<any>(),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Intent>(),
    [operation, setOperation] = useState<any>(),
    [inspection, setInspection] = useState<any>(),
    [operations, setOperations] = useState<any[]>([]),
    [searchMode, setSearchMode] = useState<"filename" | "text">("text"),
    [status, setStatus] = useState<any>(),
    [diff, setDiff] = useState<any>(),
    [side, setSide] = useState<"staged" | "unstaged">("unstaged"),
    [selected, setSelected] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<any>(),
    [changed, setChanged] = useState(false),
    [confirmClose, setConfirmClose] = useState(false),
    [ack, setAck] = useState(false);
  const [reviewed, setReviewed] = useState<Record<string, string>>({});
  const draftRevision = useRef(0);
  const contentEpoch = useRef(0),
    diffEpoch = useRef(0);
  useEffect(
    () => () => {
      contentEpoch.current++;
      diffEpoch.current++;
    },
    [workspace.id],
  );
  const refreshFlight = useRef(false),
    refreshAgain = useRef(false),
    currentRefresh = useRef<() => Promise<void>>(async () => {});
  const generation = useRef(0),
    dirty = !!content && text !== content.text;
  const refresh = async () => {
    if (refreshFlight.current) {
      refreshAgain.current = true;
      return;
    }
    refreshFlight.current = true;
    const epoch = ++generation.current;
    try {
      const [t, s] = await Promise.all([
        request<any>(base + "/files/tree?ref=" + encodeURIComponent(directory)),
        request<any>(base + "/git/status").catch(() => null),
      ]);
      if (epoch !== generation.current) return;
      setTree(t);
      setStatus(s);
      setLease(t.workspace);
    } catch (e) {
      if (epoch === generation.current) setError((e as Error).message);
    } finally {
      refreshFlight.current = false;
      if (refreshAgain.current && dialog.current?.isConnected) {
        refreshAgain.current = false;
        void currentRefresh.current();
      }
    }
  };
  currentRefresh.current = refresh;
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [workspace.id, directory]);
  useEffect(() => {
    let dead = false;
    void Promise.all([
      request<any>(base + "/files/operations"),
      request<any>(base + "/git/operations"),
    ])
      .then(([f, g]) => {
        if (dead) return;
        const all = [...f.operations, ...g.operations].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
        setOperations(all);
        const unsettled = all.find(
          (o) =>
            ["queued", "dispatching", "uncertain"].includes(o.state) &&
            !o.acknowledgedAt,
        );
        if (unsettled) setOperation(unsettled);
      })
      .catch((e) => {
        if (!dead) setError((e as Error).message);
      });
    return () => {
      dead = true;
    };
  }, [workspace.id]);
  useEffect(() => {
    const stream = new EventSource(
      `/api/v1${base}/files/events?ref=${encodeURIComponent(directory)}${content?.ref ? "&fileRef=" + encodeURIComponent(content.ref) : ""}`,
    );
    const invalid = () => {
      setChanged(true);
      void refresh();
    };
    stream.addEventListener("invalidate", invalid);
    stream.addEventListener("resync", invalid);
    return () => stream.close();
  }, [workspace.id, directory, content?.ref]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  useEffect(() => {
    if (
      !operation ||
      !["queued", "dispatching", "uncertain"].includes(operation.state) ||
      !!operation.acknowledgedAt
    )
      return;
    let dead = false,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const r = await request<any>(base + "/file-operations/" + operation.id);
        if (dead) return;
        setInspection(r.inspection);
        if (r.operation.state === "succeeded") {
          await refresh();
          if (r.operation.kind === "save" && content?.ref) {
            const c = await request<any>(
              base + "/files/content?ref=" + encodeURIComponent(content.ref),
            );
            if (!dead) {
              setContent(c);
              setText(c.text ?? "");
              setChanged(false);
            }
          }
        }
        if (!dead) {
          setOperation(r.operation);
          setOperations((old) =>
            [r.operation, ...old.filter((o) => o.id !== r.operation.id)].slice(
              0,
              256,
            ),
          );
        }
      } catch (e) {
        if (!dead) setError((e as Error).message);
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void poll(), 700);
    void poll();
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [operation?.id, operation?.state, operation?.acknowledgedAt]);
  async function execute(intent: Intent) {
    setBusy(true);
    setError("");
    setPending(intent);
    try {
      const result = await mutate<any>(intent, csrf);
      setPending(undefined);
      if (result.operation) setOperation(result.operation);
      if (result.released) {
        setAck(false);
        setOperation((o: any) => ({
          ...o,
          acknowledgedAt: new Date().toISOString(),
        }));
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500)
        setPending(undefined);
    } finally {
      setBusy(false);
    }
  }
  async function open(entry: any) {
    if (dirty) {
      setError("Save or discard this draft before opening another file.");
      return;
    }
    const epoch = ++contentEpoch.current,
      draftAtOpen = draftRevision.current;
    setError("");
    if (entry.kind === "directory") {
      setDirectory(entry.ref);
      return;
    }
    try {
      const value = await request<any>(
        base + "/files/content?ref=" + encodeURIComponent(entry.ref),
      );
      if (epoch !== contentEpoch.current) return;
      if (draftRevision.current !== draftAtOpen) {
        setError(
          "Your draft changed while that file was opening. Save or discard it before switching files.",
        );
        return;
      }
      setChanged(false);
      setContent({ ...value, ref: entry.ref, name: entry.name ?? entry.path });
      setText(value.text ?? "");
    } catch (e) {
      if (epoch === contentEpoch.current) setError((e as Error).message);
    }
  }
  async function showDiff(entry: any, nextSide = side) {
    const epoch = ++diffEpoch.current;
    setDiff(undefined);
    setSide(nextSide);
    setSelected([]);
    try {
      const inspected = await request<any>(
        base +
          "/git/diff?ref=" +
          encodeURIComponent(entry.ref) +
          "&side=" +
          nextSide,
      );
      if (epoch !== diffEpoch.current) return;
      setDiff(inspected);
      if (
        nextSide === "staged" &&
        ["text", "binary", "oversized"].includes(inspected.status)
      )
        setReviewed((v) => ({ ...v, [entry.ref]: inspected.revision }));
    } catch (e) {
      if (epoch === diffEpoch.current) setError((e as Error).message);
    }
  }
  async function download() {
    try {
      const response = await fetch(
        `/api/v1${base}/files/download?ref=${encodeURIComponent(content.ref)}&revision=${encodeURIComponent(content.revision)}`,
        { credentials: "same-origin" },
      );
      if (!response.ok)
        throw Error("Download changed or is unavailable; refresh the file.");
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = content.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const active =
      operation && ["queued", "dispatching"].includes(operation.state),
    blocked = busy || !!pending || active || !writeAvailable,
    writeBlocked =
      blocked ||
      (!!lease && lease.state !== "ready") ||
      (operation?.state === "uncertain" && !operation.acknowledgedAt);
  const stagedEntries =
    status?.entries.filter((entry: any) => ![" ", "?"].includes(entry.index)) ??
    [];
  const completeReview =
    !!status?.complete &&
    !status.cursor &&
    stagedEntries.length > 0 &&
    stagedEntries.every(
      (entry: any) => reviewed[entry.ref] === status.revision,
    );
  return (
    <dialog
      ref={dialog}
      className="files-dialog"
      aria-labelledby="files-title"
      onCancel={(event) => {
        event.preventDefault();
        if (dirty) setConfirmClose(true);
        else onClose();
      }}
    >
      <header className="files-header">
        <div>
          <h2 id="files-title">{workspace.name}</h2>
          <p>
            Files and reviewed changes{lease?.kind ? ` · ${lease.kind}` : ""}
          </p>
          {lease?.writerKind && (
            <p role="status">Workspace reserved by {lease.writerKind} work</p>
          )}
          {lease?.state === "archived" && (
            <p role="status">Archived workspace · inspection only</p>
          )}
        </div>
        <button
          className="quiet-button"
          onClick={() => (dirty ? setConfirmClose(true) : onClose())}
        >
          Close files
        </button>
      </header>
      <nav className="file-tabs" aria-label="Workspace views">
        <button
          aria-pressed={section === "files"}
          onClick={() => setSection("files")}
        >
          Files
        </button>
        <button
          aria-pressed={section === "changes"}
          onClick={() => {
            setSection("changes");
            void refresh();
          }}
        >
          Changes
        </button>
        <button className="quiet-button" onClick={() => void refresh()}>
          Refresh
        </button>
      </nav>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {pending && (
        <button disabled={busy} onClick={() => void execute(pending)}>
          Retry same file operation
        </button>
      )}
      {changed && (
        <p className="file-notice">
          Workspace changed. Your draft and review are preserved; refresh the
          file before saving.
        </p>
      )}
      {!writeAvailable && (
        <p className="notice">
          {unavailableReason ??
            "Managed writes are disabled by the permission ceiling."}
        </p>
      )}
      {operations.length > 0 && (
        <details className="file-history">
          <summary>Recent file operations</summary>
          {operations.map((o) => (
            <button
              key={o.id}
              disabled={busy || !!pending}
              onClick={() => {
                setOperation(o);
                setInspection(undefined);
              }}
            >
              {o.kind}: {o.state} · {o.id.slice(0, 8)}
            </button>
          ))}
        </details>
      )}
      {operation && (
        <aside className="file-operation">
          <strong>
            {operation.kind}: {operation.state}
          </strong>
          {operation.result?.commitOid && (
            <code>{operation.result.commitOid}</code>
          )}
          {operation.failureCode && <span>{operation.failureCode}</span>}
          {operation.state === "uncertain" && !operation.acknowledgedAt && (
            <>
              <p>
                Effects are uncertain. This workspace stays reserved until the
                exact helper is retired and you acknowledge the inspected state.
              </p>
              {(!inspection || inspection.state === "failed") && (
                <button
                  disabled={blocked || (inspection?.attempts ?? 0) >= 3}
                  onClick={() =>
                    void execute(
                      newIntent(
                        base + `/file-operations/${operation.id}/inspect`,
                        {
                          expectedEpoch: operation.epoch,
                          ...(inspection
                            ? {
                                inspectionId: inspection.id,
                                expectedAttempt: inspection.attempts,
                              }
                            : {}),
                        },
                        "Inspect file effect",
                      ),
                    )
                  }
                >
                  Inspect and fence file operation
                </button>
              )}
              {inspection && <p>Inspection: {inspection.state}</p>}
              {inspection?.report && (
                <pre>{JSON.stringify(inspection.report, null, 2)}</pre>
              )}
              {inspection?.state === "ready" && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    I reviewed the result and acknowledge unknown effects.
                  </label>
                  <button
                    disabled={!ack || blocked}
                    onClick={() =>
                      void execute(
                        newIntent(
                          base + `/file-operations/${operation.id}/release`,
                          {
                            inspectionId: inspection.id,
                            expectedEpoch: Number(inspection.fence),
                            acknowledgeUnknownEffects: true,
                          },
                          "Release file reservation",
                        ),
                      )
                    }
                  >
                    Acknowledge and release workspace
                  </button>
                </>
              )}
            </>
          )}
        </aside>
      )}
      {section === "files" ? (
        <div className="file-layout">
          <aside className="file-tree">
            <button className="quiet-button" onClick={() => setDirectory(root)}>
              Workspace root
            </button>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  setResults(
                    await request<any>(
                      base +
                        "/files/search?mode=" +
                        searchMode +
                        "&q=" +
                        encodeURIComponent(query),
                    ),
                  );
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              <label>
                Search files
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={120}
                />
              </label>
              <label>
                Search mode
                <select
                  value={searchMode}
                  onChange={(e) =>
                    setSearchMode(e.target.value as "filename" | "text")
                  }
                >
                  <option value="text">File contents</option>
                  <option value="filename">Filename</option>
                </select>
              </label>
              <button disabled={!query}>Search</button>
            </form>
            {results && (
              <>
                <p>
                  {results.matches.length} matches
                  {results.truncated ? "; scan limit reached" : ""}
                </p>
                {results.cursor && (
                  <button
                    onClick={() =>
                      void request<any>(
                        base +
                          "/files/search?q=" +
                          encodeURIComponent(query) +
                          "&mode=" +
                          searchMode +
                          "&cursor=" +
                          encodeURIComponent(results.cursor),
                      )
                        .then(setResults)
                        .catch((e) => setError(e.message))
                    }
                  >
                    Next search page
                  </button>
                )}
                <button
                  className="quiet-button"
                  onClick={() => setResults(undefined)}
                >
                  Clear search
                </button>
              </>
            )}
            {(results?.matches ?? tree?.entries ?? []).map(
              (entry: any, index: number) => (
                <button
                  key={entry.ref + ":" + index}
                  className="file-entry"
                  disabled={
                    entry.kind === "symlink" || entry.kind === "unavailable"
                  }
                  onClick={() => void open(entry)}
                >
                  <span>
                    {entry.kind === "directory" ? "▸ " : ""}
                    {entry.name ?? entry.path}
                  </span>
                  {entry.kind === "symlink" && (
                    <small>Symlink; not followed</small>
                  )}
                  {entry.snippet && (
                    <small>
                      {entry.line}: {entry.snippet}
                    </small>
                  )}
                </button>
              ),
            )}
            {tree?.cursor && !results && (
              <button
                onClick={async () => {
                  try {
                    const next = await request<any>(
                      base +
                        "/files/tree?ref=" +
                        encodeURIComponent(directory) +
                        "&cursor=" +
                        encodeURIComponent(tree.cursor),
                    );
                    setTree({
                      ...next,
                      entries: [...tree.entries, ...next.entries],
                    });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                More entries
              </button>
            )}
          </aside>
          <main className="file-content">
            {content ? (
              <>
                <header>
                  <h3>{content.name}</h3>
                  <span>{dirty ? "Unsaved draft" : content.status}</span>
                  {content.revision && (
                    <button
                      className="quiet-button"
                      onClick={() => void download()}
                    >
                      Download inspected file
                    </button>
                  )}
                </header>
                {content.status === "text" ? (
                  <>
                    <Suspense fallback={<p>Loading editor…</p>}>
                      <FileEditor
                        label="File text editor"
                        value={text}
                        onChange={(value) => {
                          draftRevision.current++;
                          setText(value);
                        }}
                        readOnly={!!blocked}
                      />
                    </Suspense>
                    <footer>
                      <button
                        disabled={!dirty || writeBlocked}
                        onClick={() =>
                          void execute(
                            newIntent(
                              base + "/files/save",
                              {
                                ref: content.ref,
                                expectedRevision: content.revision,
                                text,
                              },
                              "Save file",
                            ),
                          )
                        }
                      >
                        Save file
                      </button>
                      <button
                        disabled={blocked}
                        className="quiet-button"
                        onClick={async () => {
                          const epoch = ++contentEpoch.current;
                          setBusy(true);
                          try {
                            const latest = await request<any>(
                              base +
                                "/files/content?ref=" +
                                encodeURIComponent(content.ref),
                            );
                            if (epoch !== contentEpoch.current) return;
                            if (latest.status !== "text")
                              throw Error(
                                "The file is no longer editable text. Your draft is retained; inspect the external change before continuing.",
                              );
                            setContent(latest);
                            setChanged(false);
                            setError("");
                          } catch (e) {
                            if (epoch === contentEpoch.current)
                              setError((e as Error).message);
                          } finally {
                            if (epoch === contentEpoch.current) setBusy(false);
                          }
                        }}
                      >
                        Refresh revision, keep draft
                      </button>
                      <button
                        className="quiet-button"
                        disabled={blocked}
                        onClick={() => {
                          setText(content.text ?? "");
                          setChanged(false);
                        }}
                      >
                        Discard draft
                      </button>
                    </footer>
                  </>
                ) : (
                  <p>
                    {content.reason ??
                      "Binary content is available only as a download."}
                  </p>
                )}
              </>
            ) : (
              <p className="file-empty">Choose a file to inspect or edit.</p>
            )}
          </main>
        </div>
      ) : (
        <div className="file-layout">
          <aside className="file-tree">
            {!status && <p>No supported Git metadata is available.</p>}
            {status && (
              <>
                <p>
                  {status.head.target}{" "}
                  {status.head.oid?.slice(0, 12) ?? "Unborn HEAD"}
                </p>
                <p>
                  Commit as {status.author.name} &lt;{status.author.email}&gt;
                </p>
                <p>
                  Managed Git skips hooks and filters; it has no network access.
                </p>
                {status.entries.map((entry: any) => (
                  <div key={entry.ref} className="change-entry">
                    <span>{entry.path}</span>
                    {entry.conflict ? (
                      <strong>Conflict; resolve externally</strong>
                    ) : (
                      <>
                        <button
                          className="quiet-button"
                          onClick={() => void showDiff(entry, "unstaged")}
                        >
                          Unstaged {entry.worktree}
                        </button>
                        <button
                          className="quiet-button"
                          onClick={() => void showDiff(entry, "staged")}
                        >
                          Staged {entry.index}
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {!status.complete && (
                  <p>
                    Git status exceeded the bounded review limit. New Git
                    mutations are unavailable until the workspace fits that
                    limit.
                  </p>
                )}
                {status.cursor && (
                  <button
                    onClick={async () => {
                      const epoch = generation.current;
                      try {
                        const next = await request<any>(
                          base +
                            "/git/status?cursor=" +
                            encodeURIComponent(status.cursor),
                        );
                        if (epoch === generation.current)
                          setStatus({
                            ...next,
                            entries: [...status.entries, ...next.entries],
                          });
                      } catch (e) {
                        if (epoch === generation.current)
                          setError((e as Error).message);
                      }
                    }}
                  >
                    More changed paths
                  </button>
                )}
              </>
            )}
          </aside>
          <main className="file-content">
            {diff ? (
              <>
                <header>
                  <h3>
                    {status?.entries.find(
                      (entry: any) => entry.ref === diff.ref,
                    )?.path ?? "Selected file"}
                  </h3>
                  <span>{side} changes</span>
                  <button
                    disabled={writeBlocked}
                    onClick={() =>
                      void execute(
                        newIntent(
                          base +
                            "/git/" +
                            (side === "staged" ? "unstage" : "stage"),
                          {
                            expectedRevision: diff.revision,
                            selections: [{ ref: diff.ref, wholeFile: true }],
                          },
                          "Apply reviewed whole file",
                        ),
                      )
                    }
                  >
                    {side === "staged" ? "Unstage" : "Stage"} whole file
                  </button>
                </header>
                <details className="file-identities">
                  <summary>Reviewed content identities and modes</summary>
                  <p>
                    Before: {diff.oldSha256 ?? "unavailable"} (
                    {diff.oldMode ?? "missing"})
                  </p>
                  <p>
                    After: {diff.newSha256 ?? "unavailable"} (
                    {diff.newMode ?? "missing"})
                  </p>
                </details>
                {diff.status === "text" ? (
                  <>
                    <Suspense fallback={<p>Loading diff…</p>}>
                      <FileEditor
                        label="Reviewed file diff"
                        original={diff.oldText}
                        value={diff.newText}
                        readOnly
                      />
                    </Suspense>
                    {diff.wholeFileOnly && (
                      <p>
                        Rename or file mode changes require a whole-file
                        selection.
                      </p>
                    )}
                    <div className="hunk-selection">
                      {diff.hunks.map((h: any) => (
                        <label key={h.id}>
                          <input
                            type="checkbox"
                            disabled={diff.wholeFileOnly}
                            checked={selected.includes(h.id)}
                            onChange={(e) =>
                              setSelected((v) =>
                                e.target.checked
                                  ? [...v, h.id]
                                  : v.filter((id) => id !== h.id),
                              )
                            }
                          />
                          <pre>{h.text}</pre>
                        </label>
                      ))}
                    </div>
                    <button
                      disabled={
                        writeBlocked || !selected.length || diff.wholeFileOnly
                      }
                      onClick={() =>
                        void execute(
                          newIntent(
                            base +
                              "/git/" +
                              (side === "staged" ? "unstage" : "stage"),
                            {
                              expectedRevision: diff.revision,
                              selections: [
                                { ref: diff.ref, hunkIds: selected },
                              ],
                            },
                            "Apply reviewed hunks",
                          ),
                        )
                      }
                    >
                      {side === "staged" ? "Unstage" : "Stage"} selected hunks
                    </button>
                  </>
                ) : (
                  <p>{diff.status}; review and select the whole file.</p>
                )}
              </>
            ) : (
              <p>Choose staged or unstaged changes to review.</p>
            )}
            {status && (
              <form
                className="commit-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!completeReview || writeBlocked) {
                    setError(
                      "Open every staged diff at the current revision before committing.",
                    );
                    return;
                  }
                  void execute(
                    newIntent(
                      base + "/git/commit",
                      {
                        expectedRevision: status.revision,
                        selectedRefs: status.entries
                          .filter((e: any) => ![" ", "?"].includes(e.index))
                          .map((e: any) => e.ref),
                        message,
                      },
                      "Commit reviewed staged tree",
                    ),
                  );
                }}
              >
                <label>
                  Commit message
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={8192}
                  />
                </label>
                <p>
                  Open each staged diff before committing. The commit includes
                  every explicitly reviewed staged entry. Unstaged changes stay
                  on disk.
                </p>
                <button
                  disabled={
                    writeBlocked ||
                    !completeReview ||
                    !message.trim() ||
                    !!status.cursor ||
                    !status.complete ||
                    !status.entries.some(
                      (e: any) => ![" ", "?"].includes(e.index),
                    )
                  }
                >
                  Commit reviewed staged changes
                </button>
              </form>
            )}
          </main>
        </div>
      )}
      {confirmClose && (
        <div className="file-confirm" role="alertdialog">
          <p>This file has an unsaved draft.</p>
          <button onClick={() => setConfirmClose(false)}>Keep editing</button>
          <button onClick={onClose}>Discard and close</button>
        </div>
      )}
    </dialog>
  );
}
