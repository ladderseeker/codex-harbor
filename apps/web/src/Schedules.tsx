import { useEffect, useRef, useState } from "react";
import { ApiError, mutate, newIntent, request, type Intent } from "./api.ts";
import type { ScheduleConfig } from "../../../packages/schedules/src/schema.ts";
interface Schedule {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  state: string;
  reason: string | null;
  config: ScheduleConfig;
  prompt?: string;
  nextDueAt: string | null;
  grant: {
    epoch: number;
    expiresAt: string;
    revoked: boolean;
    source: string;
  } | null;
  retention: unknown;
}
interface Occurrence {
  id: string;
  scheduleId: string;
  state: string;
  reason: string | null;
  kind: string;
  localMinute: string | null;
  intendedAt: string;
  sessionId: string | null;
  workspaceId: string | null;
  turnId: string | null;
  acknowledgedAt: string | null;
  provenance: Record<string, unknown>;
  cancellation: { state: string; attempts: number } | null;
}
interface Props {
  csrf: string;
  projects: { id: string; name: string; archivedAt?: string | null }[];
  sessions: { id: string; projectId: string; title: string }[];
  models: { id: string; name: string; efforts: string[] }[];
  profiles: string[];
  initialProject: string;
  openConversation: (id: string) => void;
}
const date = (v: string | null) => (v ? new Date(v).toLocaleString() : "None");
const label = (v: string) => v.replaceAll("_", " ");
export function Schedules(props: Props) {
  const [project, setProject] = useState(props.initialProject),
    [rows, setRows] = useState<Schedule[]>([]),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Schedule>(),
    [editor, setEditor] = useState<"new" | "edit" | null>(null),
    [history, setHistory] = useState<Occurrence[]>([]),
    [attention, setAttention] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [historyCursor, setHistoryCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState("");
  const pending = useRef<Intent | undefined>(undefined),
    view = useRef(0),
    listRequest = useRef(0),
    detailRequest = useRef(0),
    historyRequest = useRef(0),
    selectedRef = useRef(selected),
    editorRef = useRef(editor);
  selectedRef.current = selected;
  editorRef.current = editor;
  const filter = () =>
    new URLSearchParams({
      ...(project ? { projectId: project } : {}),
      q: query,
      limit: "20",
    }).toString();
  const load = async (more = false) => {
    const requestId = ++listRequest.current;
    const epoch = view.current,
      values = await request<{
        schedules: Schedule[];
        nextCursor: string | null;
      }>(
        `/schedules?${filter()}${more && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      );
    if (epoch !== view.current || requestId !== listRequest.current) return;
    setRows((old) => (more ? [...old, ...values.schedules] : values.schedules));
    setCursor(values.nextCursor);
  };
  const loadDetail = async (id: string) => {
    const requestId = ++detailRequest.current;
    const epoch = view.current,
      value = await request<{ schedule: Schedule }>(`/schedules/${id}`);
    if (
      epoch === view.current &&
      requestId === detailRequest.current &&
      selectedRef.current === id &&
      !editorRef.current
    )
      setDetail(value.schedule);
  };
  const loadHistory = async (more = false) => {
    const requestId = ++historyRequest.current;
    const epoch = view.current,
      id = selectedRef.current;
    if (!attention && !id) {
      setHistory([]);
      return;
    }
    const route = attention ? "/schedule-attention" : `/schedules/${id}/runs`;
    const value = await request<{
      occurrences: Occurrence[];
      nextCursor: string | null;
    }>(
      route +
        "?" +
        new URLSearchParams({
          limit: "20",
          ...(project ? { projectId: project } : {}),
          ...(more && historyCursor ? { cursor: historyCursor } : {}),
        }),
    );
    if (
      epoch !== view.current ||
      requestId !== historyRequest.current ||
      id !== selectedRef.current
    )
      return;
    setHistory((old) =>
      more ? [...old, ...value.occurrences] : value.occurrences,
    );
    setHistoryCursor(value.nextCursor);
  };
  useEffect(() => {
    view.current++;
    setRows([]);
    setCursor(null);
    setHistoryCursor(null);
    void load().catch((e) => setError(e.message));
  }, [project, query]);
  useEffect(() => {
    detailRequest.current++;
    setDetail(undefined);
    setHistory([]);
    setHistoryCursor(null);
    if (selected) void loadDetail(selected).catch((e) => setError(e.message));
    void loadHistory().catch((e) => setError(e.message));
  }, [selected, attention]);
  useEffect(() => {
    let active = true,
      loading = false;
    const timer = setInterval(() => {
      if (!active || loading || editorRef.current || pending.current) return;
      loading = true;
      void Promise.all([load(), loadHistory()])
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          loading = false;
        });
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
      view.current++;
    };
  }, [project, query, selected, attention]);
  const submit = async (intent: Intent) => {
    if (busy) return;
    setBusy(true);
    setError("");
    pending.current = intent;
    try {
      const result = await mutate<any>(intent, props.csrf);
      pending.current = undefined;
      setEditor(null);
      editorRef.current = null;
      setNotice(intent.label + " accepted.");
      const id = result.schedule?.id ?? result.id ?? selectedRef.current;
      if (id) {
        setSelected(id);
        selectedRef.current = id;
        await loadDetail(id);
      }
      await load();
      await loadHistory();
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        pending.current = undefined;
        setError(e.message);
      } else
        setError(
          "The outcome is not confirmed. Retry this same request before creating another intent.",
        );
    } finally {
      setBusy(false);
    }
  };
  const blocked = busy || !!pending.current;
  return (
    <section className="schedules-panel" aria-label="Scheduled project work">
      <p className="schedule-intro">
        Work can start while you are away. Review the timing and grant, then
        return here for results or requests for your attention.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending.current && (
        <button disabled={busy} onClick={() => void submit(pending.current!)}>
          Retry schedule request
        </button>
      )}
      <div className="schedule-toolbar">
        <label>
          Project
          <select
            aria-label="Project filter"
            value={project}
            disabled={!!editor || blocked}
            onChange={(e) => {
              setProject(e.target.value);
              setSelected("");
            }}
          >
            <option value="">All projects</option>
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Find schedule
          <input
            value={query}
            disabled={!!editor || blocked}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={120}
          />
        </label>
        <button
          disabled={
            !!editor || blocked || !props.projects.some((p) => !p.archivedAt)
          }
          onClick={() => {
            setEditor("new");
            setError("");
          }}
        >
          Create schedule
        </button>
      </div>
      <div className="schedule-columns">
        <nav aria-label="Schedules" className="schedule-list">
          {!rows.length && (
            <p>
              No schedules match this project. Create one to plan unattended
              work.
            </p>
          )}
          {rows.map((s) => (
            <button
              key={s.id}
              disabled={!!editor || blocked}
              aria-current={selected === s.id ? "true" : undefined}
              onClick={() => {
                setSelected(s.id);
                setAttention(false);
              }}
            >
              <strong>{s.title}</strong>
              <span className={"state state-" + s.state}>{label(s.state)}</span>
              <small>Next: {date(s.nextDueAt)}</small>
            </button>
          ))}
          {cursor && (
            <button
              disabled={blocked || !!editor}
              onClick={() => void load(true).catch((e) => setError(e.message))}
            >
              More schedules
            </button>
          )}
          <button
            disabled={blocked || !!editor}
            aria-pressed={attention}
            onClick={() => setAttention((v) => !v)}
          >
            Attention inbox
          </button>
        </nav>
        <div className="schedule-detail">
          {editor ? (
            <ScheduleEditor
              key={
                editor === "new" ? "new" : detail?.id + ":" + detail?.revision
              }
              {...props}
              projectId={project || props.projects[0]?.id || ""}
              initial={editor === "edit" ? detail : undefined}
              disabled={blocked}
              save={(body, editing) =>
                void submit({
                  ...newIntent(
                    editing ? `/schedules/${editing.id}` : "/schedules",
                    editing
                      ? { expectedRevision: editing.revision, schedule: body }
                      : body,
                    editing ? "Save schedule" : "Create and activate schedule",
                  ),
                  ...(editing ? { method: "PUT" as const } : {}),
                })
              }
              discard={() => {
                setEditor(null);
                setError("");
              }}
            />
          ) : !attention && detail ? (
            <>
              <div className="schedule-title">
                <h3>{detail.title}</h3>
                <span className={"state state-" + detail.state}>
                  {label(detail.state)}
                </span>
              </div>
              {detail.reason && (
                <p role="status">
                  {label(detail.reason)}. Review the settings and latest
                  occurrence before activating again.
                </p>
              )}
              <dl className="schedule-facts">
                <div>
                  <dt>Timing</dt>
                  <dd>
                    {detail.config.rule.kind === "cron"
                      ? detail.config.rule.expression
                      : detail.config.rule.local}
                  </dd>
                </div>
                <div>
                  <dt>Timezone</dt>
                  <dd>{detail.config.rule.timezone}</dd>
                </div>
                <div>
                  <dt>Next occurrence</dt>
                  <dd>{date(detail.nextDueAt)}</dd>
                </div>
                <div>
                  <dt>Grant expires</dt>
                  <dd>
                    {date(detail.grant?.expiresAt ?? null)}
                    {detail.grant?.revoked ? " (revoked)" : ""}
                  </dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>
                    {detail.config.workspaceMode === "standalone"
                      ? "New workspace and conversation"
                      : "Reuse selected conversation"}
                  </dd>
                </div>
                <div>
                  <dt>Permissions</dt>
                  <dd>
                    {detail.config.permissionProfile === "read-only"
                      ? "Read only"
                      : "Edit project files"}
                  </dd>
                </div>
              </dl>
              <pre className="schedule-prompt">{detail.prompt}</pre>
              <div className="schedule-actions">
                <button disabled={blocked} onClick={() => setEditor("edit")}>
                  Edit schedule
                </button>
                <button
                  disabled={blocked || detail.state === "paused"}
                  onClick={() =>
                    void submit(
                      newIntent(
                        `/schedules/${detail.id}/pause`,
                        { expectedRevision: detail.revision },
                        "Pause future work",
                      ),
                    )
                  }
                >
                  Pause future work
                </button>
                <button
                  disabled={blocked}
                  onClick={() =>
                    void submit(
                      newIntent(
                        `/schedules/${detail.id}/activation`,
                        { expectedRevision: detail.revision, grantDays: 30 },
                        "Activate for 30 days",
                      ),
                    )
                  }
                >
                  Activate for 30 days
                </button>
                <button
                  disabled={blocked}
                  onClick={() =>
                    void submit(
                      newIntent(
                        `/schedules/${detail.id}/runs`,
                        { expectedRevision: detail.revision },
                        "Run once now",
                      ),
                    )
                  }
                >
                  Run once now
                </button>
              </div>
              <p className="field-help">
                Pausing does not interrupt a running turn. Run once now uses a
                separate one-day grant and keeps a paused schedule paused.
              </p>
            </>
          ) : !attention ? (
            <p>Select a schedule to review its settings and results.</p>
          ) : null}
          {!editor && (attention || selected) && (
            <section
              className="schedule-history"
              aria-label={
                attention ? "Schedule attention" : "Occurrence history"
              }
            >
              <h3>{attention ? "Needs attention" : "Occurrence history"}</h3>
              {!history.length && (
                <p>
                  {attention
                    ? "No occurrences currently need attention."
                    : "No occurrences yet."}
                </p>
              )}
              {history.map((o) => (
                <article key={o.id}>
                  <div className="schedule-title">
                    <strong>
                      {o.kind === "manual"
                        ? "Requested run"
                        : o.kind === "range"
                          ? "Missed range"
                          : o.localMinute}
                    </strong>
                    <span className={"state state-" + o.state}>
                      {label(o.state)}
                    </span>
                  </div>
                  <p>
                    {date(o.intendedAt)}
                    {o.reason ? " — " + label(o.reason) : ""}
                  </p>
                  {o.kind === "range" && (
                    <p className="field-help">
                      Some intended times were omitted. The range is retained
                      without an invented count.
                    </p>
                  )}
                  {o.state === "uncertain" && (
                    <p>
                      Original effects remain uncertain. Open the conversation
                      for confirmed fencing and an explicit new input; that
                      continuation does not change this outcome.
                    </p>
                  )}
                  <div className="schedule-actions">
                    {o.sessionId && (
                      <button
                        onClick={() => props.openConversation(o.sessionId!)}
                      >
                        Open conversation
                      </button>
                    )}
                    {[
                      "accepted",
                      "preparing_workspace",
                      "queued_turn",
                      "running",
                      "attention",
                    ].includes(o.state) && (
                      <button
                        disabled={
                          blocked ||
                          (!!o.cancellation &&
                            o.cancellation.state !== "failed") ||
                          (o.cancellation?.attempts ?? 0) >= 3
                        }
                        onClick={() =>
                          void submit(
                            newIntent(
                              `/schedules/${o.scheduleId}/runs/${o.id}/cancel`,
                              {
                                expectedAttempt:
                                  o.cancellation?.state === "failed"
                                    ? o.cancellation.attempts + 1
                                    : 1,
                              },
                              "Cancel occurrence",
                            ),
                          )
                        }
                      >
                        {o.cancellation?.state === "failed"
                          ? "Retry cancellation"
                          : o.cancellation
                            ? "Cancellation requested"
                            : "Cancel occurrence"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {historyCursor && (
                <button
                  disabled={blocked}
                  onClick={() =>
                    void loadHistory(true).catch((e) => setError(e.message))
                  }
                >
                  More occurrences
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
function ScheduleEditor(
  props: Props & {
    projectId: string;
    initial?: Schedule;
    disabled: boolean;
    save: (body: unknown, editing?: Schedule) => void;
    discard: () => void;
  },
) {
  const initial = props.initial;
  const [project, setProject] = useState(initial?.projectId ?? props.projectId),
    [title, setTitle] = useState(initial?.title ?? ""),
    [prompt, setPrompt] = useState(initial?.prompt ?? ""),
    [kind, setKind] = useState(initial?.config.rule.kind ?? "cron"),
    [expression, setExpression] = useState(
      initial?.config.rule.kind === "cron"
        ? initial.config.rule.expression
        : "0 9 * * 1-5",
    ),
    [local, setLocal] = useState(
      initial?.config.rule.kind === "once" ? initial.config.rule.local : "",
    ),
    [timezone, setTimezone] = useState(
      initial?.config.rule.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [mode, setMode] = useState(initial?.config.workspaceMode ?? "standalone"),
    [workspace, setWorkspace] = useState(
      initial?.config.sourceWorkspaceId ?? "",
    ),
    [sourcePolicy, setSourcePolicy] = useState(
      initial?.config.sourcePolicy ?? "committed",
    ),
    [session, setSession] = useState(initial?.config.sessionId ?? ""),
    [model, setModel] = useState(
      initial?.config.model ?? props.models[0]?.id ?? "",
    ),
    [effort, setEffort] = useState(initial?.config.effort ?? "medium"),
    [profile, setProfile] = useState(
      initial?.config.permissionProfile ?? "read-only",
    ),
    [missed, setMissed] = useState(initial?.config.missedPolicy ?? "skip"),
    [days, setDays] = useState(30),
    [baseRevision, setBaseRevision] = useState(
      initial?.config.baseRevision ?? "",
    ),
    [workspaces, setWorkspaces] = useState<
      { id: string; name: string; state: string }[]
    >([]),
    [preview, setPreview] = useState<
      { local: string; instant: string; offset: string; timezone: string }[]
    >([]),
    [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    let current = true;
    void request<{ workspaces: { id: string; name: string; state: string }[] }>(
      `/projects/${project}/workspaces`,
    )
      .then((r) => {
        if (current) setWorkspaces(r.workspaces);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [project]);
  const rule =
    kind === "cron"
      ? { kind: "cron" as const, expression, timezone }
      : { kind: "once" as const, local, timezone };
  useEffect(() => {
    sequence.current++;
    setPreview([]);
  }, [kind, expression, local, timezone, project]);
  const makePreview = async () => {
    const epoch = ++sequence.current;
    setError("");
    try {
      const r = await request<{ preview: typeof preview }>(
        "/schedules/preview",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": props.csrf,
          },
          body: JSON.stringify({ projectId: project, rule }),
        },
      );
      if (epoch === sequence.current) setPreview(r.preview);
    } catch (e) {
      if (epoch === sequence.current) setError((e as Error).message);
    }
  };
  const valid =
    title.trim() &&
    prompt.trim() &&
    new TextEncoder().encode(prompt).length <= 32768 &&
    preview.length > 0 &&
    model &&
    (mode === "standalone" ? workspace : session);
  return (
    <form
      className="schedule-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || props.disabled) return;
        props.save(
          {
            title,
            projectId: project,
            prompt,
            grantDays: days,
            config: {
              rule,
              workspaceMode: mode,
              ...(mode === "standalone"
                ? {
                    sourceWorkspaceId: workspace,
                    sourcePolicy,
                    ...(sourcePolicy === "committed" && baseRevision
                      ? { baseRevision }
                      : {}),
                  }
                : { sessionId: session }),
              model,
              effort,
              permissionProfile: profile,
              missedPolicy: missed,
              overlapPolicy: "skip",
            },
          },
          initial,
        );
      }}
    >
      <h3>{initial ? "Edit schedule" : "Plan unattended work"}</h3>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={props.disabled}>
        <label>
          Schedule title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            required
          />
        </label>
        <label>
          Schedule project
          <select
            aria-label="Schedule project"
            value={project}
            disabled={!!initial}
            onChange={(e) => {
              setProject(e.target.value);
              setWorkspace("");
              setSession("");
            }}
          >
            {props.projects
              .filter((p) => !p.archivedAt)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Scheduled prompt
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            maxLength={32768}
            required
          />
        </label>
        <small>
          {new TextEncoder().encode(prompt).length.toLocaleString()} / 32,768
          bytes
        </small>
        <div className="schedule-form-pair">
          <label>
            Recurrence
            <select
              aria-label="Recurrence"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="cron">Recurring cron</option>
              <option value="once">One time</option>
            </select>
          </label>
          <label>
            Timezone
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
              required
            />
          </label>
        </div>
        {kind === "cron" ? (
          <label>
            Five-field cron
            <input
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              maxLength={200}
              required
            />
            <small>
              Minute, hour, day of month, month, weekday. Numbers, lists, ranges
              and steps.
            </small>
          </label>
        ) : (
          <label>
            Local date and time
            <input
              type="datetime-local"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              required
            />
          </label>
        )}
        <button type="button" onClick={() => void makePreview()}>
          Preview next occurrences
        </button>
        {!!preview.length && (
          <ol className="schedule-preview">
            {preview.slice(0, 8).map((p) => (
              <li key={p.instant}>
                <strong>{p.local.replace("T", " ")}</strong>
                <span>
                  {p.timezone} (UTC{p.offset})
                </span>
                <small>{p.instant}</small>
              </li>
            ))}
          </ol>
        )}
        <p className="field-help">
          Skipped daylight-saving minutes do not run. A repeated minute runs
          only at its first instant.
        </p>
        <label>
          Occurrence workspace
          <select
            aria-label="Occurrence workspace"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="standalone">New workspace and conversation</option>
            <option value="existing">Reuse an existing conversation</option>
          </select>
        </label>
        {mode === "standalone" ? (
          <>
            <label>
              Source workspace
              <select
                aria-label="Source workspace"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                required
              >
                <option value="">Choose source</option>
                {workspaces
                  .filter((w) => w.state === "ready")
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Source content
              <select
                aria-label="Source content"
                value={sourcePolicy}
                onChange={(e) =>
                  setSourcePolicy(e.target.value as typeof sourcePolicy)
                }
              >
                <option value="committed">
                  Committed Git files (exclude local changes)
                </option>
                <option value="snapshot">
                  Explicit snapshot copy of a non-Git folder
                </option>
              </select>
            </label>
            {sourcePolicy === "committed" && (
              <label>
                Fixed commit (optional)
                <input
                  value={baseRevision}
                  onChange={(e) => setBaseRevision(e.target.value)}
                  placeholder="Full commit ID; blank resolves HEAD at each occurrence"
                  maxLength={64}
                />
              </label>
            )}
            <p className="field-help">
              Each occurrence keeps its own workspace. Preparation requires
              permission to create project files, including for a read-only
              turn.
            </p>
          </>
        ) : (
          <label>
            Existing conversation
            <select
              aria-label="Existing conversation"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              required
            >
              <option value="">Choose conversation</option>
              {props.sessions
                .filter((s) => s.projectId === project)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
            </select>
          </label>
        )}
        <div className="schedule-form-pair">
          <label>
            Schedule model
            <select
              aria-label="Schedule model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setEffort(
                  (props.models.find((m) => m.id === e.target.value)
                    ?.efforts[0] ?? "medium") as typeof effort,
                );
              }}
            >
              {props.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Schedule effort
            <select
              aria-label="Schedule effort"
              value={effort}
              onChange={(e) => setEffort(e.target.value as typeof effort)}
            >
              {(props.models.find((m) => m.id === model)?.efforts ?? []).map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
            </select>
          </label>
        </div>
        <label>
          Scheduled permissions
          <select
            aria-label="Scheduled permissions"
            value={profile}
            onChange={(e) => setProfile(e.target.value as typeof profile)}
          >
            {props.profiles.map((p) => (
              <option key={p} value={p}>
                {p === "read-only" ? "Read only" : "Edit project files"}
              </option>
            ))}
          </select>
        </label>
        <label>
          After downtime
          <select
            aria-label="After downtime"
            value={missed}
            onChange={(e) => setMissed(e.target.value as typeof missed)}
          >
            <option value="skip">Skip missed occurrences</option>
            <option value="catch_up">
              Run at most the latest three from 24 hours
            </option>
          </select>
        </label>
        {!initial && (
          <label>
            Unattended grant duration (days)
            <input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
        )}
        <p className="field-help">
          {initial
            ? "Saving pauses future work and revokes old queued grants. Activate the revised settings explicitly."
            : "Creating activates a separate unattended grant. Signing out does not pause it; you can pause future work here."}{" "}
          Busy occurrences are skipped; scheduled work never jumps ahead of a
          busy conversation.
        </p>
      </fieldset>
      <div className="schedule-actions">
        <button disabled={props.disabled || !valid} type="submit">
          {initial ? "Save schedule and pause" : "Create and activate schedule"}
        </button>
        <button
          type="button"
          className="quiet-button"
          disabled={props.disabled}
          onClick={props.discard}
        >
          Discard draft
        </button>
      </div>
    </form>
  );
}
