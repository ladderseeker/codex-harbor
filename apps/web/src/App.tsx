import {
  ConversationActivity,
  groupConversationMessages,
} from "./ConversationActivity.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { completedAssistantResponses } from "./message-responses.ts";
import {
  PersonalPreviews,
  type PersonalPreviewEndpoint,
} from "./PersonalPreviews.tsx";
import { MarkdownMessage } from "./MarkdownMessage.tsx";
import { Icon } from "./Icons.tsx";
import { SidebarResize } from "./SidebarResize.tsx";
import { Schedules } from "./Schedules.tsx";
import {
  useRichDraft,
  AttachmentPicker,
  AttachmentPreview,
} from "./Attachments.tsx";
import { Files } from "./Files.tsx";
import { History } from "./History.tsx";
import { Recovery } from "./Recovery.tsx";
import { Terminals } from "./Terminals.tsx";
import { Previews } from "./Previews.tsx";
import { Tokens } from "./Tokens.tsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  Approval,
  HarborEvent,
  PermissionProfile,
  Session as SessionRecord,
  Snapshot,
} from "../../../packages/contracts/src/index.ts";
import {
  WorkspaceManager,
  WorkspaceSummary,
  useWorkspaces,
  workspaceNames,
} from "./Workspaces.tsx";
import { Credentials } from "./Credentials.tsx";
import { ApiError, mutate, newIntent, request, type Intent } from "./api.ts";

type Session = SessionRecord & { archivedAt?: string | null };

interface Project {
  id: string;
  name: string;
  path?: string;
  relativePath?: string;
  archivedAt?: string | null;
}
interface Root {
  id: string;
  name?: string;
  label?: string;
}
interface Capabilities {
  projectBrowsing?: { available: boolean; reason: string | null };
  local?: boolean;
  personalVps?: boolean;
  personalPreviews?: PersonalPreviewEndpoint[];
  files?: { read: boolean; write: boolean; reason: string | null };
  models: {
    id: string;
    name: string;
    efforts: string[];
    inputModalities?: string[];
  }[];
  permissionProfiles: PermissionProfile[];
  runtime?: unknown;
  account?: { authenticated: boolean; authMode: string | null };
  limits?: {
    maxInputBytes?: number;
    maxConversationBytes?: number;
    replayEventLimit?: number;
    retryWindowHours?: number;
  };
  emergencyStopped?: boolean;
}
interface Identity {
  owner: { subject: string };
  csrfToken: string;
}
type Pending = { intent: Intent; complete: (result: unknown) => void };
const busyStates = new Set([
  "accepted",
  "queued",
  "dispatching",
  "running",
  "waiting_approval",
  "waiting_input",
  "cancelling",
]);
const stateNames: Record<string, string> = {
  idle: "Ready",
  accepted: "Accepted",
  queued: "Queued",
  dispatching: "Starting",
  running: "Working",
  waiting_approval: "Needs approval",
  waiting_input: "Needs your answer",
  succeeded: "Finished",
  failed: "Failed",
  interrupted: "Interrupted",
  uncertain: "Outcome uncertain",
  cancelling: "Stopping",
};
const permissionNames: Record<string, string> = {
  "read-only": "Read only",
  "workspace-write": "Edit project files",
};
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request could not be completed.";

function State({ state }: { state: string }) {
  return (
    <span className={`state state-${state}`} role="status">
      <span aria-hidden="true" className="state-dot" />
      {stateNames[state] ?? state.replaceAll("_", " ")}
    </span>
  );
}

export function App() {
  useEffect(() => {
    const closeMenus = (event: Event) => {
      document
        .querySelectorAll<HTMLDetailsElement>("details.action-menu[open]")
        .forEach((menu) => {
          if (!menu.contains(event.target as Node)) menu.open = false;
        });
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("focusin", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("focusin", closeMenus);
    };
  }, []);
  const [identity, setIdentity] = useState<Identity>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [roots, setRoots] = useState<Root[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [selectedId, setSelectedId] = useState(
    () => new URLSearchParams(location.search).get("conversation") ?? "",
  );
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const [projectId, setProjectId] = useState("");
  const workspaceData = useWorkspaces(projectId);
  const [newWorkspaceId, setNewWorkspaceId] = useState("");
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [terminalWorkspace, setTerminalWorkspace] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => {
    setNewWorkspaceId("");
  }, [projectId]);
  useEffect(() => {
    if (!newWorkspaceId)
      setNewWorkspaceId(
        workspaceData.workspaces.find(
          (workspace) =>
            workspace.kind === "local" && workspace.state === "ready",
        )?.id ??
          workspaceData.workspaces.find(
            (workspace) => workspace.state === "ready",
          )?.id ??
          "",
      );
  }, [workspaceData.workspaces, newWorkspaceId]);
  const [projectStorage, setProjectStorage] = useState<{
    status: string;
    usedBytes?: number;
    byteLimit?: number;
  }>({ status: "unavailable" });

  const [snapshot, setSnapshot] = useState<Snapshot>();
  useEffect(() => {
    let active = true;
    if (projectId)
      void request<{ status: string; usedBytes?: number; byteLimit?: number }>(
        `/projects/${encodeURIComponent(projectId)}/storage`,
      )
        .then((value) => {
          if (active) setProjectStorage(value);
        })
        .catch(() => {
          if (active) setProjectStorage({ status: "unavailable" });
        });
    return () => {
      active = false;
    };
  }, [projectId, snapshot?.session.state]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [previewWorkspace, setPreviewWorkspace] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [connection, setConnection] = useState<
    "connecting" | "live" | "offline"
  >("connecting");
  const [pendingIntents, setPendingIntents] = useState<Pending[]>([]);
  const pending = pendingIntents[0];
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const sendingRef = useRef(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyFilter, setHistoryFilter] = useState("active");
  const [projectDetailsOpen, setProjectDetailsOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [replayGap, setReplayGap] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [notice, setNotice] = useState("");
  const richDraft = useRichDraft(selectedId, identity?.csrfToken);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("medium");
  const [permission, setPermission] = useState<PermissionProfile>("read-only");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followsBottom = useRef(true);
  const visibleApproval = useRef<string | undefined>(undefined);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(),
  );
  const [mobile, setMobile] = useState(() => window.innerWidth <= 700);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const resizeComposer = useCallback(() => {
    const input = composerRef.current;
    if (!input) return;
    input.style.height = "24px";
    input.style.height = Math.min(160, input.scrollHeight) + "px";
    input.style.overflowY = input.scrollHeight > 160 ? "auto" : "hidden";
  }, []);
  useEffect(resizeComposer, [
    richDraft.draft.text,
    selectedId,
    sidebarWidth,
    snapshot?.session.id,
    resizeComposer,
  ]);
  const updateSidebarWidth = useCallback(
    (value: number) => setSidebarWidth(value),
    [],
  );
  const closeNavigation = useCallback(() => {
    setSidebarOpen(false);
    if (window.innerWidth <= 700)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>("[aria-label='Open navigation']")
          ?.focus(),
      );
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => {
      const focused = document.activeElement;
      if (
        query.matches &&
        (focused?.closest(".sidebar") || focused?.matches(".sidebar-resize"))
      )
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLButtonElement>("[aria-label='Open navigation']")
            ?.focus(),
        );
      setMobile(query.matches);
      setSidebarOpen(false);
      resizeComposer();
    };
    query.addEventListener("change", update);
    window.addEventListener("resize", resizeComposer);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("resize", resizeComposer);
    };
  }, [resizeComposer]);
  useEffect(() => {
    if (!mobile || !sidebarOpen) return;
    document
      .querySelector<HTMLButtonElement>(
        ".sidebar [aria-label='Close navigation']",
      )
      ?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.activeElement?.closest("dialog"))
        closeNavigation();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [mobile, sidebarOpen, closeNavigation]);
  useEffect(() => {
    if (projectId)
      setExpandedProjects((previous) => new Set([...previous, projectId]));
  }, [projectId]);
  const report = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 401) setExpired(true);
    setError(errorMessage(failure));
  }, []);

  const refreshLists = useCallback(async () => {
    const [projectResult, sessionResult] = await Promise.all([
      request<{ projects: Project[] }>("/projects"),
      request<{ sessions: Session[] }>("/sessions"),
    ]);
    setProjects(projectResult.projects);
    setSessions(sessionResult.sessions);
    return {
      projects: projectResult.projects,
      sessions: sessionResult.sessions,
    };
  }, []);

  useEffect(() => {
    if (!identity) return;
    let refreshing = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      try {
        await refreshLists();
      } catch (failure) {
        report(failure);
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [identity, refreshLists, report]);

  const refreshSnapshot = useCallback(async (id: string) => {
    const result = await request<Snapshot>(
      `/sessions/${encodeURIComponent(id)}/snapshot`,
    );
    if (selectedRef.current === id) {
      setSnapshot((previous) =>
        previous?.session.id === id && previous.cursor > result.cursor
          ? previous
          : result,
      );
      setSessions((previous) =>
        previous.map((session) =>
          session.id === id ? result.session : session,
        ),
      );
    }
    return result;
  }, []);

  const refreshCapabilities = useCallback(async () => {
    const caps = await request<Capabilities>("/capabilities");
    setCapabilities(caps);
    setStopped(Boolean(caps.emergencyStopped));
    setModel((previous) =>
      caps.models.some((item) => item.id === previous)
        ? previous
        : (caps.models[0]?.id ?? ""),
    );
    setPermission((previous) =>
      caps.permissionProfiles.includes(previous)
        ? previous
        : (caps.permissionProfiles[0] ?? "read-only"),
    );
    return caps;
  }, []);

  useEffect(() => {
    const available =
      capabilities?.models.find((item) => item.id === model)?.efforts ?? [];
    if (available.length && !available.includes(effort))
      setEffort(available.includes("medium") ? "medium" : available[0]!);
  }, [capabilities, model, effort]);

  useEffect(() => {
    if (!identity || expired) return;
    let running = false;
    const refresh = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await refreshCapabilities();
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 401)
          report(failure);
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [identity, expired, refreshCapabilities, report]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const me = await request<Identity>("/me");
      setIdentity(me);
      const [list, rootResult, caps] = await Promise.all([
        refreshLists(),
        request<{ roots: Root[] }>("/project-roots"),
        request<Capabilities>("/capabilities"),
      ]);
      setRoots(rootResult.roots);
      setCapabilities(caps);
      setStopped(Boolean(caps.emergencyStopped));
      setModel(caps.models[0]?.id ?? "");
      setEffort(
        caps.models[0]?.efforts.includes("medium")
          ? "medium"
          : (caps.models[0]?.efforts[0] ?? ""),
      );
      setPermission(caps.permissionProfiles[0] ?? "read-only");
      const selected = list.sessions.find(
        (session) => session.id === selectedRef.current,
      );
      if (selected) {
        setProjectId(selected.projectId);
        setModel(selected.model);
        setEffort(selected.effort);
        setPermission(selected.permissionProfile);
      } else {
        setSelectedId("");
        setProjectId(list.projects[0]?.id ?? "");
      }
    } catch (failure) {
      report(failure);
    } finally {
      setLoading(false);
    }
  }, [refreshLists, report]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const pop = () =>
      setSelectedId(
        new URLSearchParams(location.search).get("conversation") ?? "",
      );
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  useEffect(() => {
    if (!selectedId || !identity || expired) return;
    let disposed = false;
    let source: EventSource | undefined;
    let cursor = 0;
    let refreshing = false;
    let refreshAgain = false;
    let reopen = true;
    let initial = true;
    setSnapshot(undefined);
    setConnection("connecting");
    setReplayGap(false);
    followsBottom.current = true;

    function openStream() {
      if (disposed) return;
      source?.close();
      const stream = new EventSource(
        `/api/v1/sessions/${encodeURIComponent(selectedId)}/events?cursor=${cursor}`,
        { withCredentials: true },
      );
      source = stream;
      reopen = false;
      const currentStream = () => !disposed && source === stream;
      stream.onopen = () => {
        if (!currentStream()) return;
        setConnection("live");
        void sync();
      };
      stream.onerror = () => {
        if (!currentStream()) return;
        setConnection("offline");
        void sync();
      };
      const receive = (message: MessageEvent) => {
        if (!currentStream()) return;
        try {
          const event = JSON.parse(message.data) as HarborEvent;
          if (
            event.schemaVersion === 1 &&
            event.conversationId === selectedId &&
            Number.isSafeInteger(event.sequence) &&
            event.sequence <= cursor
          )
            return;
        } catch {
          /* An unreadable event requires the same authoritative snapshot. */
        }
        void sync();
      };
      stream.onmessage = receive;
      stream.addEventListener("harbor", receive as EventListener);
      stream.addEventListener("resync", () => {
        if (!currentStream()) return;
        // Closing suppresses EventSource's retry with its obsolete query cursor.
        stream.close();
        source = undefined;
        reopen = true;
        setReplayGap(true);
        setConnection("connecting");
        void sync();
      });
      stream.addEventListener("snapshot", () => {
        if (currentStream()) void sync();
      });
    }

    async function sync() {
      if (disposed) return;
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      try {
        do {
          refreshAgain = false;
          const result = await refreshSnapshot(selectedId);
          if (disposed) return;
          cursor = Math.max(cursor, result.cursor);
          if (initial) {
            initial = false;
            setProjectId(result.session.projectId);
            setModel(result.session.model);
            setEffort(result.session.effort);
            setPermission(result.session.permissionProfile);
          }
        } while (refreshAgain && !disposed);
        // Resync may arrive while a snapshot is already in flight. Reopen only
        // after the coalesced refresh finishes, always using its latest cursor.
        if (reopen && !disposed) openStream();
      } catch (failure) {
        if (!disposed) {
          setConnection("offline");
          report(failure);
        }
      } finally {
        refreshing = false;
      }
    }
    void sync();
    const timer = window.setInterval(() => {
      if (!disposed) void sync();
    }, 15000);
    const visible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      source?.close();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [selectedId, identity, expired, refreshSnapshot, report]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const approvalId =
      snapshot?.approvals.find(
        (approval) =>
          approval.state === "pending" || approval.state === "answering",
      )?.id ??
      (snapshot?.session.state === "uncertain"
        ? "recovery:" + snapshot.session.id
        : undefined);
    if (approvalId && visibleApproval.current !== approvalId) {
      const card = transcript.querySelector<HTMLElement>(
        ".approval, .recovery",
      );
      if (card)
        transcript.scrollTop +=
          card.getBoundingClientRect().top -
          transcript.getBoundingClientRect().top -
          20;
      followsBottom.current = false;
    } else if (!approvalId && followsBottom.current)
      transcript.scrollTop = transcript.scrollHeight;
    visibleApproval.current = approvalId;
  }, [snapshot]);

  function selectSession(id: string) {
    const url = new URL(location.href);
    if (id) url.searchParams.set("conversation", id);
    else url.searchParams.delete("conversation");
    history.pushState({}, "", url);
    setSelectedId(id);
    closeNavigation();
    setNotice("");
  }

  async function execute(
    intent: Intent,
    complete: (result: unknown) => void = () => {},
  ) {
    if (!identity || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      const result = await mutate(intent, identity.csrfToken);
      setPendingIntents((previous) =>
        previous.filter((item) => item.intent.key !== intent.key),
      );
      complete(result);
    } catch (failure) {
      report(failure);
      if (
        failure instanceof ApiError &&
        (failure.status === 0 || failure.status >= 500)
      )
        setPendingIntents((previous) =>
          previous.some((item) => item.intent.key === intent.key)
            ? previous
            : [...previous, { intent, complete }],
        );
      else {
        setPendingIntents((previous) =>
          previous.filter((item) => item.intent.key !== intent.key),
        );
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
    // A refresh failure cannot change an acknowledged command into an unknown command.
    try {
      await refreshLists();
      if (selectedRef.current) await refreshSnapshot(selectedRef.current);
    } catch (failure) {
      report(failure);
    }
  }

  const current =
    snapshot?.session.id === selectedId ? snapshot.session : undefined;
  const project = projects.find(
    (item) => item.id === (current?.projectId ?? projectId),
  );
  const boundWorkspace = workspaceData.workspaces.find(
    (workspace) => workspace.id === current?.workspaceId,
  );
  const workspaceWritable =
    boundWorkspace?.state === "ready" && !project?.archivedAt;
  const canCreateConversation =
    workspaceData.workspaces.some(
      (workspace) =>
        workspace.id === newWorkspaceId && workspace.state === "ready",
    ) && !project?.archivedAt;
  const activeOperation = snapshot?.operations.findLast(
    (operation) => operation.kind === "turn" && busyStates.has(operation.state),
  );
  const cancellationRequested = snapshot?.operations.some(
    (operation) =>
      operation.kind === "cancel" && busyStates.has(operation.state),
  );
  const active = !!current && busyStates.has(current.state);
  const uncertain = current?.state === "uncertain";
  const responseTexts = completedAssistantResponses(
    snapshot?.messages ?? [],
    snapshot?.operations ?? [],
  );
  const text = richDraft.draft.text;
  const settingsReady =
    capabilities?.account?.authenticated === true &&
    !!capabilities?.models.some(
      (item) => item.id === model && item.efforts.includes(effort),
    ) &&
    !!capabilities?.permissionProfiles.includes(permission);
  const blocked = sending || !!pending || expired || stopped;
  const pendingApprovals =
    snapshot?.approvals.filter(
      (approval) =>
        approval.state === "pending" || approval.state === "answering",
    ) ?? [];

  async function newSession(targetProjectId = projectId) {
    if (!targetProjectId || !settingsReady || blocked || creatingRef.current)
      return;
    const target = projects.find((item) => item.id === targetProjectId);
    if (!target || target.archivedAt) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const available =
        targetProjectId === projectId
          ? workspaceData.workspaces
          : (
              await request<{
                workspaces: { id: string; kind: string; state: string }[];
              }>(`/projects/${encodeURIComponent(targetProjectId)}/workspaces`)
            ).workspaces;
      const workspace =
        targetProjectId === projectId
          ? available.find(
              (item) => item.id === newWorkspaceId && item.state === "ready",
            )
          : (available.find(
              (item) => item.kind === "local" && item.state === "ready",
            ) ?? available.find((item) => item.state === "ready"));
      if (!workspace) {
        setError(
          "This project has no ready workspace. Open project details to manage workspaces.",
        );
        return;
      }
      await execute(
        newIntent(
          "/sessions",
          {
            projectId: targetProjectId,
            workspaceId: workspace.id,
            model,
            effort,
            permissionProfile: permission,
          },
          "Create conversation",
        ),
        (result) => {
          const created = (result as { session: Session }).session;
          setProjectId(targetProjectId);
          selectSession(created.id);
          setTimeout(() => composerRef.current?.focus(), 0);
        },
      );
    } catch (failure) {
      report(failure);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      !current ||
      !text.trim() ||
      blocked ||
      active ||
      uncertain ||
      !settingsReady ||
      !richDraft.ready ||
      richDraft.saving ||
      !!richDraft.error ||
      !workspaceWritable
    )
      return;
    const id = current.id;
    const sentText = text;
    if (
      new TextEncoder().encode(sentText).byteLength >
      (capabilities?.limits?.maxInputBytes ?? 32768)
    ) {
      setError("This message is too large. Shorten it before sending.");
      return;
    }
    const saved = richDraft.dirty ? await richDraft.save() : richDraft.draft;
    if (!saved) return;
    void execute(
      newIntent(
        `/sessions/${encodeURIComponent(id)}/turns`,
        {
          text: sentText,
          model,
          effort,
          permissionProfile: permission,
          attachmentIds: saved.attachmentIds,
          draftRevision: saved.revision,
        },
        "Send message",
      ),
      () => {
        richDraft.accepted();
        followsBottom.current = true;
      },
    );
  }

  if (expired)
    return (
      <main className="entry">
        <div className="brand">Harbor</div>
        <h1>Sign in to reconnect</h1>
        <p>
          Your session has ended. Work already authorized can continue while you
          are signed out.
        </p>
        <a className="button primary" href="/auth/login">
          Sign in
        </a>
      </main>
    );

  return (
    <div
      className="app"
      style={{ "--rail-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      {searchOpen && (
        <Modal
          title="Search and filters"
          className="search-dialog"
          close={() => setSearchOpen(false)}
          returnFocus=".rail-search"
          initialFocus="input[type=search]"
          backdropDismiss
          trapFocus
        >
          <section className="history-filters" aria-label="Search filters">
            <label className="search-input-row">
              <Icon name="search" />
              <span className="sr-only">Search conversations</span>
              <input
                autoFocus
                type="search"
                placeholder="Search conversations"
                value={historyQuery}
                maxLength={120}
                onChange={(event) => setHistoryQuery(event.target.value)}
              />
            </label>
            <div className="search-scope-row">
              <span>
                <Icon name="folder" />
                {project?.name ?? "Selected project"}
              </span>
              <label>
                <span className="sr-only">Show</span>
                <select
                  value={historyFilter}
                  onChange={(event) => setHistoryFilter(event.target.value)}
                >
                  <option value="active">Active conversations</option>
                  <option value="archived">Archived conversations</option>
                  <option value="all">All conversations</option>
                </select>
              </label>
            </div>
            <label className="archive-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Show archived projects
            </label>
          </section>
          {projectId && (
            <div className="search-results">
              <History
                key={projectId}
                searchResults
                projectId={projectId}
                query={historyQuery}
                filter={historyFilter}
                selectedId={selectedId}
                revision={JSON.stringify(
                  sessions.filter((s) => s.projectId === projectId),
                )}
                select={(id) => {
                  setSearchOpen(false);
                  selectSession(id);
                }}
                viewStatus={(id) => {
                  setSearchOpen(false);
                  selectSession(id);
                  setStatusOpen(true);
                }}
                workspaces={workspaceData.workspaces}
                disabled={blocked}
                execute={execute}
              />
            </div>
          )}
        </Modal>
      )}
      <a className="skip-link" href="#conversation">
        Skip to conversation
      </a>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={closeNavigation}
        />
      )}
      <aside
        className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
        aria-label="Projects and conversations"
        id="project-sidebar"
        inert={mobile && !sidebarOpen}
      >
        <div className="brand-row">
          <a className="brand" href="/">
            <Icon name="harbor" />
            Harbor
          </a>
          <button
            className="icon-button rail-search"
            aria-label="Search and filters"
            title="Search and filters"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((value) => !value)}
          >
            <Icon name="search" />
          </button>
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={closeNavigation}
          >
            ×
          </button>
        </div>
        <button
          className="new-conversation"
          aria-label="New conversation"
          onClick={() => void newSession()}
          disabled={
            !projectId ||
            !settingsReady ||
            blocked ||
            creating ||
            !canCreateConversation
          }
        >
          <Icon name="compose" />
          New chat
        </button>
        {capabilities && !(capabilities.local || capabilities.personalVps) && (
          <button
            className="quiet-button"
            onClick={() => setSchedulesOpen(true)}
          >
            Schedules
          </button>
        )}
        <div className="rail-heading">
          <h2>Projects</h2>
          <button
            className="icon-button"
            aria-label="Add project"
            onClick={() => setShowProjectForm(true)}
            disabled={!identity || blocked}
          >
            +
          </button>
        </div>
        <nav className="project-list" aria-label="Projects">
          {projects
            .filter(
              (item) =>
                showArchived || !item.archivedAt || item.id === projectId,
            )
            .map((item) => (
              <div key={item.id} className="project-group">
                <div className="project-row">
                  <button
                    className={`project-button ${projectId === item.id ? "selected" : ""}`}
                    aria-expanded={expandedProjects.has(item.id)}
                    onClick={() => {
                      setExpandedProjects((previous) => {
                        const next = new Set(previous);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                      if (projectId !== item.id) {
                        setProjectId(item.id);
                        const first = sessions.find(
                          (session) => session.projectId === item.id,
                        );
                        selectSession(first?.id ?? "");
                      }
                    }}
                  >
                    <Icon name="folder" />
                    <span>
                      {item.name}
                      {item.archivedAt ? " (archived)" : ""}
                    </span>
                  </button>
                  <button
                    className="icon-button project-more"
                    aria-label={`Project details for ${item.name}`}
                    title="Project details"
                    onClick={() => {
                      setProjectId(item.id);
                      if (current?.projectId !== item.id) selectSession("");
                      setProjectDetailsOpen(true);
                    }}
                  >
                    <Icon name="more" />
                  </button>
                  <button
                    className="icon-button project-new"
                    aria-label={`New conversation in ${item.name}`}
                    title="New chat"
                    disabled={
                      blocked || creating || !settingsReady || !!item.archivedAt
                    }
                    onClick={() => void newSession(item.id)}
                  >
                    <Icon name="compose" />
                  </button>
                </div>
                {expandedProjects.has(item.id) && (
                  <History
                    projectId={item.id}
                    viewStatus={(id) => {
                      setProjectId(item.id);
                      selectSession(id);
                      setStatusOpen(true);
                    }}
                    selectedId={selectedId}
                    revision={JSON.stringify(
                      sessions.filter(
                        (session) => session.projectId === item.id,
                      ),
                    )}
                    select={(id) => {
                      setProjectId(item.id);
                      selectSession(id);
                    }}
                    workspaces={
                      projectId === item.id ? workspaceData.workspaces : []
                    }
                    disabled={blocked}
                    execute={execute}
                  />
                )}
              </div>
            ))}
          {!projects.length && !loading && (
            <p className="rail-empty">Add a project folder to begin.</p>
          )}
        </nav>
        <details
          className="rail-footer action-menu settings-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button"))
              event.currentTarget.open = false;
          }}
        >
          <summary
            className="icon-button"
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" />
          </summary>
          <div className="action-menu-panel">
            <button
              className="account-button"
              hidden={capabilities?.personalVps}
              disabled={!identity}
              title={
                capabilities?.personalVps
                  ? "API tokens are unavailable in this personal profile"
                  : undefined
              }
              onClick={() => setTokensOpen(true)}
            >
              <Icon name="key" />
              API tokens
            </button>
            <button
              className="account-button"
              onClick={() => setAccountOpen(true)}
              disabled={!identity}
            >
              <Icon name="settings" />
              Codex account{" "}
              <span>
                {capabilities?.account?.authenticated ? "Ready" : "Set up"}
              </span>
            </button>
            <p>Work continues when you leave.</p>
            <button
              className="quiet-button danger-text"
              onClick={() => setEmergencyOpen(true)}
              disabled={!identity || stopped}
            >
              <Icon name="stop" />
              Emergency stop
            </button>
            <button
              className="quiet-button"
              onClick={() =>
                void execute(
                  newIntent("/security/logout", {}, "Sign out"),
                  () => {
                    location.assign("/auth/login");
                  },
                )
              }
              disabled={!identity || sending}
            >
              <Icon name="logout" />
              Sign out
            </button>
          </div>
        </details>
      </aside>
      <SidebarResize changed={updateSidebarWidth} />
      <main
        id="conversation"
        className="main"
        tabIndex={-1}
        inert={mobile && sidebarOpen}
      >
        <header className="conversation-header">
          <button
            className="icon-button mobile-only"
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="panel" />
          </button>
          <div className="header-title">
            <p>{project?.name ?? "Your workspace"}</p>
            <h1>{current?.title ?? "Conversations"}</h1>
          </div>
          {current && connection !== "live" && (
            <span className="connection" role="status">
              {connection === "connecting" ? "Connecting…" : "Reconnecting…"}
            </span>
          )}
        </header>
        {(error || pending) && (
          <div className="notice error" role="alert">
            <div>
              <strong>
                {pending
                  ? `${pending.intent.label}: result not confirmed`
                  : "Unable to complete request"}
              </strong>
              <p>
                {error ||
                  "The request may have been accepted. Retry the same request to check its result."}
              </p>
            </div>
            {pending ? (
              <button
                onClick={() => void execute(pending.intent, pending.complete)}
                disabled={sending}
              >
                Retry same request
              </button>
            ) : (
              <button
                onClick={() => {
                  setError("");
                  void (selectedId
                    ? refreshSnapshot(selectedId).catch(report)
                    : load());
                }}
                disabled={sending}
              >
                Reconnect
              </button>
            )}
          </div>
        )}
        {replayGap && (
          <div className="notice" role="status">
            <div>
              <strong>Live update gap</strong>
              <p>
                Some live updates are no longer available. Harbor is refreshing
                from the saved conversation; earlier updates may be missing.
              </p>
            </div>
            <button onClick={() => setReplayGap(false)}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {stopped && (
          <div className="notice error" role="status">
            <div>
              <strong>Emergency stop is active</strong>
              <p>
                New work is paused. Check running work and restore service
                through your administrator configuration.
              </p>
            </div>
          </div>
        )}
        {loading ? (
          <div className="empty-state" role="status">
            <h2>Opening Harbor…</h2>
            <p>Loading your projects and conversations.</p>
          </div>
        ) : !identity ? (
          <div className="empty-state">
            <h2>Harbor could not connect</h2>
            <p>Check your connection and try again.</p>
            <button onClick={() => void load()}>Try again</button>
          </div>
        ) : !selectedId ? (
          <div className="empty-state">
            <svg
              className="empty-symbol"
              aria-hidden="true"
              viewBox="0 0 80 80"
            >
              <path d="M19 52V28a21 21 0 0 1 42 0v24M9 57c8 8 16 8 24 0 8 8 16 8 24 0 5 5 10 7 14 5" />
            </svg>
            <h2>
              {projects.length
                ? `Start work in ${project?.name ?? "a project"}`
                : "Add your first project"}
            </h2>
            <p>
              {projects.length
                ? "Open a conversation from the sidebar, or start a new one. Your work and replies stay here when you return."
                : "Choose a folder within an approved root. Harbor keeps your conversations with the project they belong to."}
            </p>
            {model === "gpt-6-astra" &&
              ["low", "medium", "high", "xhigh", "max"].some(
                (level) =>
                  !capabilities?.models
                    .find((entry) => entry.id === model)
                    ?.efforts.includes(level),
              ) && (
                <p className="field-help">
                  Some GPT-6 Astra reasoning levels are unavailable in this
                  runtime. Only supported levels are offered.
                </p>
              )}
            {!projects.length ? (
              <button
                className="primary"
                disabled={blocked}
                onClick={() => setShowProjectForm(true)}
              >
                Add project
              </button>
            ) : settingsReady ? (
              <button
                className="primary"
                disabled={blocked || creating || !canCreateConversation}
                onClick={() => void newSession()}
              >
                New conversation
              </button>
            ) : (
              <div className="setup-next">
                <h3>
                  {!capabilities?.account?.authenticated
                    ? "Connect your Codex account"
                    : "Checking available models"}
                </h3>
                <p>
                  {!capabilities?.account?.authenticated
                    ? "Set up an API key, then Harbor will check account access and available models in this project."
                    : "Harbor is discovering the models available for this project. This can take a few seconds. If none appear, check your account and server model policy."}
                </p>
                <button onClick={() => setAccountOpen(true)}>
                  Open account setup
                </button>
                <button
                  className="quiet-button"
                  onClick={() => void refreshCapabilities().catch(report)}
                >
                  Check again
                </button>
              </div>
            )}
          </div>
        ) : !current ? (
          <div className="empty-state" role="status">
            <h2>Opening conversation…</h2>
          </div>
        ) : (
          <>
            <div
              className="transcript"
              ref={transcriptRef}
              onScroll={() => {
                const element = transcriptRef.current;
                if (element)
                  followsBottom.current =
                    element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight <
                    100;
              }}
              aria-label="Conversation messages"
            >
              <div className="transcript-inner">
                {project?.archivedAt && (
                  <p className="writer-notice">
                    This project is archived. Source folders and conversation
                    history remain available.
                  </p>
                )}
                {!snapshot?.messages.length && (
                  <div className="conversation-start">
                    <h2>What would you like to work on?</h2>
                    <p>
                      Describe the task, the context, and what a good result
                      looks like.
                    </p>
                  </div>
                )}
                {groupConversationMessages(snapshot?.messages ?? []).map(
                  (entry) => {
                    if (entry.kind === "activity")
                      return (
                        <ConversationActivity
                          key={entry.id}
                          messages={entry.messages}
                        />
                      );
                    const message = entry.message;
                    return (
                      <article
                        key={message.id}
                        className={`message message-${message.role}`}
                        aria-label={`${message.role === "user" ? "You" : message.role === "assistant" ? "Codex" : "Harbor"} message`}
                      >
                        <div
                          className={
                            message.role === "user" ? "user-bubble" : undefined
                          }
                        >
                          <div className="message-heading">
                            <strong>
                              {message.role === "user"
                                ? "You"
                                : message.role === "assistant"
                                  ? "Codex"
                                  : "Harbor"}
                            </strong>
                            <time dateTime={message.createdAt}>
                              {new Date(message.createdAt).toLocaleTimeString(
                                [],
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </time>
                          </div>
                          {message.role === "assistant" ? (
                            <MarkdownMessage text={message.text} />
                          ) : (
                            <div className="message-text">{message.text}</div>
                          )}
                          {richDraft.files
                            .filter(
                              (a) =>
                                a.operationId === message.operationId &&
                                message.role === "user",
                            )
                            .map((a) => (
                              <AttachmentPreview key={a.id} attachment={a} />
                            ))}
                        </div>
                        {message.role === "user" && (
                          <MessageActions text={message.text} />
                        )}
                        {message.role === "assistant" &&
                          responseTexts.has(message.id) && (
                            <MessageActions
                              key={`${current.id}:${message.id}`}
                              text={responseTexts.get(message.id)!}
                              assistant
                            />
                          )}
                        {message.status === "streaming" && (
                          <span className="streaming-label">Writing…</span>
                        )}
                      </article>
                    );
                  },
                )}
                {pendingApprovals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    disabled={blocked}
                    answer={(decision, answers) =>
                      void execute(
                        newIntent(
                          `/approvals/${encodeURIComponent(approval.id)}/answer`,
                          {
                            generation: approval.generation,
                            decision,
                            ...(answers ? { answers } : {}),
                          },
                          decision === "decline"
                            ? "Decline request"
                            : "Answer request",
                        ),
                      )
                    }
                  />
                ))}
                {uncertain &&
                  (capabilities?.local || capabilities?.personalVps) && (
                    <p className="state-explanation">
                      Native runtime delivery is uncertain. Stop this instance
                      and inspect its processes before using a new conversation;
                      automatic recovery is unavailable.
                    </p>
                  )}
                {uncertain &&
                  !(capabilities?.local || capabilities?.personalVps) && (
                    <Recovery
                      key={`recovery:${current.id}`}
                      id={current.id}
                      cursor={snapshot?.cursor ?? 0}
                      disabled={blocked}
                      settings={{
                        model,
                        effort,
                        permissionProfile: permission,
                      }}
                      execute={execute}
                    />
                  )}
                {current.state === "interrupted" && (
                  <div className="state-explanation">
                    <h2>Work was interrupted</h2>
                    <p>
                      Completed changes remain. Review the conversation before
                      continuing.
                    </p>
                    <h3>Processes observed after interruption</h3>
                    <p>
                      Some listed processes may belong to the runtime itself.
                    </p>
                    {snapshot?.processes?.status === "known" ? (
                      snapshot.processes.processes.length ? (
                        <ul aria-label="Processes observed after interruption">
                          {snapshot.processes.processes.map((process) => (
                            <li key={process.pid}>
                              PID {process.pid}: {process.executable}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No other processes were observed in the runner.</p>
                      )
                    ) : snapshot?.processes?.status === "runtime_gone" ? (
                      <p>
                        The runtime has exited. Its earlier process state is no
                        longer available.
                      </p>
                    ) : (
                      <p>
                        Process inspection is unavailable. Background processes
                        may still be running.
                      </p>
                    )}
                  </div>
                )}
                {current.state === "failed" && (
                  <div className="state-explanation">
                    <h2>This turn could not finish</h2>
                    <p>
                      Review the reported error above. You can adjust your
                      request and send a new message.
                    </p>
                  </div>
                )}
                {active && !pendingApprovals.length && (
                  <p className="activity" role="status">
                    <span className="activity-dot" aria-hidden="true" />
                    {current.state === "queued"
                      ? "Waiting to start…"
                      : "Codex is working. You can leave and return later."}
                  </p>
                )}
              </div>
            </div>
            {!settingsReady && (
              <div className="notice" role="status">
                <div>
                  <strong>Account or model setup needs attention</strong>
                  <p>
                    Open account setup to check authentication and available
                    models.
                  </p>
                </div>
                <button onClick={() => setAccountOpen(true)}>
                  Account setup
                </button>
              </div>
            )}
            <section className="composer-region" aria-label="Message composer">
              <form
                className={`composer ${uncertain ? "recovery-settings" : ""}`}
                onSubmit={send}
              >
                {uncertain && (
                  <p className="recovery-settings-label">
                    Settings for the separate new operation
                  </p>
                )}
                <label className="sr-only" htmlFor="message">
                  Message Codex
                </label>
                <textarea
                  id="message"
                  ref={composerRef}
                  value={text}
                  placeholder="Describe your task…"
                  onChange={(event) =>
                    richDraft.edit({ text: event.target.value })
                  }
                  maxLength={capabilities?.limits?.maxInputBytes ?? 32768}
                  disabled={
                    sending ||
                    !!pending ||
                    expired ||
                    uncertain ||
                    !richDraft.ready
                  }
                  rows={1}
                  onKeyDown={(event) => {
                    if (
                      !event.shiftKey &&
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                {identity &&
                  !(capabilities?.local || capabilities?.personalVps) && (
                    <AttachmentPicker
                      key={selectedId}
                      state={richDraft}
                      csrf={identity.csrfToken}
                      session={selectedId}
                      modalities={
                        capabilities?.models.find((m) => m.id === model)
                          ?.inputModalities ?? []
                      }
                      disabled={blocked || !richDraft.ready}
                    />
                  )}
                <div className="composer-bottom">
                  <div className="settings">
                    <label>
                      Model
                      <select
                        aria-label="Model"
                        value={model}
                        disabled={active || blocked}
                        onChange={(event) => {
                          const value = event.target.value;
                          setModel(value);
                          const efforts =
                            capabilities?.models.find(
                              (item) => item.id === value,
                            )?.efforts ?? [];
                          if (!efforts.includes(effort))
                            setEffort(
                              efforts.includes("medium")
                                ? "medium"
                                : (efforts[0] ?? ""),
                            );
                        }}
                      >
                        {capabilities?.models.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Effort
                      <select
                        aria-label="Effort"
                        value={effort}
                        disabled={active || blocked}
                        onChange={(event) => setEffort(event.target.value)}
                      >
                        {capabilities?.models
                          .find((item) => item.id === model)
                          ?.efforts.map((item) => (
                            <option key={item} value={item}>
                              {item === "xhigh"
                                ? "Extra High"
                                : item[0]?.toUpperCase() + item.slice(1)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Permissions
                      <select
                        aria-label="Permissions"
                        value={permission}
                        disabled={active || blocked}
                        onChange={(event) =>
                          setPermission(event.target.value as PermissionProfile)
                        }
                      >
                        {capabilities?.permissionProfiles.map((item) => (
                          <option key={item} value={item}>
                            {permissionNames[item] ?? item}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {activeOperation ? (
                    <button
                      type="button"
                      className="stop-button"
                      disabled={sending || !!pending || cancellationRequested}
                      onClick={() =>
                        void execute(
                          newIntent(
                            `/turns/${encodeURIComponent(activeOperation.id)}/cancel`,
                            {},
                            "Stop turn",
                          ),
                          () =>
                            setNotice(
                              "Stop requested. Waiting for confirmation that work has stopped.",
                            ),
                        )
                      }
                    >
                      <span aria-hidden="true">■</span>{" "}
                      {cancellationRequested ? "Stopping…" : "Stop turn"}
                    </button>
                  ) : (
                    <button
                      className="primary send-button"
                      type="submit"
                      disabled={
                        blocked ||
                        active ||
                        uncertain ||
                        !text.trim() ||
                        !settingsReady ||
                        !richDraft.ready ||
                        richDraft.saving ||
                        !!richDraft.error ||
                        richDraft.files.some(
                          (a) =>
                            richDraft.draft.attachmentIds.includes(a.id) &&
                            !(
                              capabilities?.models.find((m) => m.id === model)
                                ?.inputModalities ?? []
                            ).includes(
                              a.mediaType === "image/png" ? "image" : "text",
                            ),
                        ) ||
                        !workspaceWritable ||
                        Boolean(current?.backgroundStopRequested)
                      }
                    >
                      {sending ? "Sending…" : "Send"}
                      <span aria-hidden="true">↑</span>
                    </button>
                  )}
                </div>
              </form>
              {model === "gpt-6-astra" &&
                ["low", "medium", "high", "xhigh", "max"].some(
                  (level) =>
                    !capabilities?.models
                      .find((entry) => entry.id === model)
                      ?.efforts.includes(level),
                ) && (
                  <p className="field-help">
                    Some GPT-6 Astra reasoning levels are unavailable in this
                    runtime. Only supported levels are offered.
                  </p>
                )}
              <div className="composer-help">
                <span>
                  {active
                    ? "Wait for this turn to finish before sending another message."
                    : permission === "read-only"
                      ? "Codex can read this project. File edits require a different permission."
                      : "Codex can edit files in this project."}
                </span>
                <span className="shortcut">
                  Enter to send · Shift Enter for a new line
                </span>
              </div>
            </section>
          </>
        )}
      </main>
      {projectDetailsOpen && project && (
        <Modal
          title={`Project details: ${project.name}`}
          close={() => setProjectDetailsOpen(false)}
        >
          <p>{project.path ?? project.relativePath ?? project.name}</p>
          {projectId && (
            <div className="rail-workspaces">
              <label>
                New conversation workspace
                <select
                  aria-label="New conversation workspace"
                  value={newWorkspaceId}
                  onChange={(event) => setNewWorkspaceId(event.target.value)}
                  disabled={blocked || !!project?.archivedAt}
                >
                  <option value="">Choose workspace</option>
                  {workspaceData.workspaces
                    .filter((workspace) => workspace.state !== "removed")
                    .map((workspace) => (
                      <option
                        key={workspace.id}
                        value={workspace.id}
                        disabled={workspace.state !== "ready"}
                      >
                        {workspace.name} ({workspaceNames[workspace.kind]})
                        {workspace.state !== "ready"
                          ? ` — ${workspace.state}`
                          : ""}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="quiet-button"
                hidden={capabilities?.local || capabilities?.personalVps}
                title={
                  capabilities?.local || capabilities?.personalVps
                    ? "Workspace management requires the managed installation"
                    : undefined
                }
                onClick={() => {
                  setProjectDetailsOpen(false);
                  setWorkspaceManagerOpen(true);
                }}
              >
                Manage workspaces
              </button>
              <button
                className="quiet-button"
                hidden={!capabilities?.files?.read}
                disabled={!newWorkspaceId}
                title={capabilities?.files?.reason ?? undefined}
                onClick={() => {
                  setProjectDetailsOpen(false);
                  setFilesOpen(true);
                }}
              >
                Files and changes
              </button>
              <button
                className="quiet-button"
                hidden={capabilities?.local || capabilities?.personalVps}
                disabled={!newWorkspaceId}
                onClick={() => {
                  setProjectDetailsOpen(false);
                  setTerminalWorkspace(newWorkspaceId);
                }}
              >
                Open terminals
              </button>
              <button
                className="quiet-button"
                hidden={
                  capabilities?.local ||
                  (capabilities?.personalVps &&
                    !capabilities.personalPreviews?.length)
                }
                disabled={!newWorkspaceId}
                onClick={() => {
                  setProjectDetailsOpen(false);
                  setPreviewWorkspace(newWorkspaceId);
                }}
              >
                Project previews
              </button>
              {workspaceData.error && (
                <p className="inline-error">{workspaceData.error}</p>
              )}
            </div>
          )}
        </Modal>
      )}
      {statusOpen && current && (
        <Modal
          title="Conversation status"
          returnFocus={`[data-rename-focus="${current.id}"]`}
          close={() => setStatusOpen(false)}
          failure={error}
          retry={
            pending
              ? () => void execute(pending.intent, pending.complete)
              : undefined
          }
        >
          <h3>{current.title}</h3>
          {current.backgroundUntil && (
            <p>
              Archiving this conversation also stops its retained background
              processes. The conversation history is preserved.
            </p>
          )}
          <State state={current.state} />
          <p>
            Connection:{" "}
            {connection === "live"
              ? "Connected"
              : connection === "connecting"
                ? "Connecting"
                : "Reconnecting"}
          </p>
          <p>
            {current.backgroundUntil
              ? "This conversation retains runtime resources."
              : boundWorkspace?.writerSessionId === current.id
                ? "This conversation holds the workspace writer reservation."
                : "No retained background runtime is reported. Workspace and process details are shown below."}
          </p>
          <details>
            <summary>Storage and limits</summary>
            <p>
              Conversation:{" "}
              {Math.ceil((snapshot?.storage?.conversationBytes ?? 0) / 1024)}{" "}
              KiB of{" "}
              {Math.ceil(
                (snapshot?.storage?.conversationLimitBytes ?? 2097152) / 1024,
              )}{" "}
              KiB.
            </p>
            <p>
              {projectStorage.status === "known"
                ? `Project: ${Math.ceil(projectStorage.usedBytes! / 1048576)} MiB of ${Math.ceil(projectStorage.byteLimit! / 1048576)} MiB.`
                : "Project quota usage is unavailable."}
            </p>
          </details>

          <WorkspaceSummary
            workspace={boundWorkspace}
            sessionId={current.id}
            queued={current.state === "queued"}
          />
          {current.backgroundUntil && !active && (
            <div className="state-explanation" role="status">
              <h2>Development processes are available</h2>
              <p>
                Your development server can stay available until{" "}
                {new Date(current.backgroundUntil).toLocaleTimeString()}.
                Continue here to keep working. Stop these processes before using
                this project in another conversation.
              </p>
              <button
                className="quiet-button"
                disabled={blocked || current.backgroundStopRequested}
                onClick={() =>
                  void execute(
                    newIntent(
                      `/sessions/${current.id}/background-stop`,
                      { generation: current.generation ?? 0 },
                      "Stop background processes",
                    ),
                    async () => {
                      await refreshSnapshot(current.id);
                    },
                  )
                }
              >
                {current.backgroundStopRequested
                  ? "Stopping background processes…"
                  : "Stop background processes"}
              </button>
            </div>
          )}
          {capabilities?.limits?.maxConversationBytes && (
            <details className="storage-limits">
              <summary>Conversation limits</summary>
              <p>
                Conversation storage limit:{" "}
                {(capabilities.limits.maxConversationBytes / 1048576).toFixed(
                  0,
                )}{" "}
                MiB.{" "}
                {capabilities.limits.replayEventLimit
                  ? `The latest ${capabilities.limits.replayEventLimit.toLocaleString()} live updates are retained for replay.`
                  : ""}{" "}
                {capabilities.limits.retryWindowHours
                  ? `An unchanged request can be retried for ${capabilities.limits.retryWindowHours} hours.`
                  : ""}
              </p>
            </details>
          )}
        </Modal>
      )}
      {filesOpen && identity && newWorkspaceId && (
        <Files
          key={newWorkspaceId}
          workspace={{
            id: newWorkspaceId,
            name:
              workspaceData.workspaces.find((w) => w.id === newWorkspaceId)
                ?.name ?? "Workspace",
          }}
          csrf={identity.csrfToken}
          writeAvailable={!!capabilities?.files?.write}
          unavailableReason={capabilities?.files?.reason ?? undefined}
          onClose={() => setFilesOpen(false)}
        />
      )}
      {workspaceManagerOpen && project && (
        <Modal
          title={`Workspaces in ${project.name}`}
          returnFocus=".project-group:has(.project-button.selected) .project-more"
          failure={error}
          retry={
            pending
              ? () => void execute(pending.intent, pending.complete)
              : undefined
          }
          close={() => setWorkspaceManagerOpen(false)}
        >
          <WorkspaceManager
            key={project.id}
            projectId={project.id}
            projectName={project.name}
            archived={!!project.archivedAt}
            workspaces={workspaceData.workspaces}
            disabled={blocked}
            execute={execute}
            refresh={workspaceData.refresh}
            selected={newWorkspaceId}
            select={setNewWorkspaceId}
          />
        </Modal>
      )}
      {schedulesOpen && identity && (
        <Modal title="Scheduled work" close={() => setSchedulesOpen(false)}>
          <Schedules
            csrf={identity.csrfToken}
            projects={projects}
            sessions={sessions}
            models={capabilities?.models ?? []}
            profiles={capabilities?.permissionProfiles ?? []}
            initialProject={projectId}
            openConversation={(id) => {
              selectSession(id);
              setSchedulesOpen(false);
            }}
          />
        </Modal>
      )}
      {terminalWorkspace &&
        identity &&
        workspaceData.workspaces.find((w) => w.id === terminalWorkspace) && (
          <Modal
            title="Workspace terminals"
            failure={error}
            retry={
              pending
                ? () => void execute(pending.intent, pending.complete)
                : undefined
            }
            close={() => setTerminalWorkspace("")}
          >
            <Terminals
              key={terminalWorkspace}
              workspace={
                workspaceData.workspaces.find(
                  (w) => w.id === terminalWorkspace,
                )!
              }
              csrf={identity.csrfToken}
              execute={execute}
              disabled={blocked}
            />
          </Modal>
        )}
      {previewWorkspace &&
        identity &&
        workspaceData.workspaces.find((w) => w.id === previewWorkspace) && (
          <Modal
            title="Private project previews"
            failure={error}
            retry={
              pending
                ? () => void execute(pending.intent, pending.complete)
                : undefined
            }
            close={() => setPreviewWorkspace("")}
          >
            {capabilities?.personalVps ? (
              <PersonalPreviews
                key={previewWorkspace}
                endpoints={capabilities.personalPreviews ?? []}
                workspaceId={previewWorkspace}
                csrfToken={identity.csrfToken}
              />
            ) : (
              <Previews
                key={previewWorkspace}
                workspace={
                  workspaceData.workspaces.find(
                    (w) => w.id === previewWorkspace,
                  )!
                }
                execute={execute}
                disabled={blocked}
              />
            )}
          </Modal>
        )}
      {tokensOpen && identity && (
        <Modal
          returnFocus=".settings-menu > summary"
          title="API tokens"
          close={() => setTokensOpen(false)}
        >
          <Tokens csrf={identity.csrfToken} projects={projects} />
        </Modal>
      )}
      {accountOpen && identity && (
        <Modal
          returnFocus=".settings-menu > summary"
          title="Codex account"
          close={() => setAccountOpen(false)}
        >
          <Credentials
            csrfToken={identity.csrfToken}
            hasProjects={projects.length > 0}
            authenticated={capabilities?.account?.authenticated === true}
            changed={() => void refreshCapabilities().catch(report)}
            expired={() => setExpired(true)}
          />
        </Modal>
      )}
      {showProjectForm && (
        <ProjectDialog
          roots={roots}
          browsing={capabilities?.projectBrowsing}
          allowRoot={capabilities?.personalVps === true}
          failure={error}
          retry={
            pending
              ? () => void execute(pending.intent, pending.complete)
              : undefined
          }
          disabled={blocked}
          close={() => setShowProjectForm(false)}
          create={(body) =>
            void execute(
              newIntent("/projects", body, "Add project"),
              (result) => {
                const created = (result as { project: Project }).project;
                setProjectId(created.id);
                selectSession("");
                setShowProjectForm(false);
              },
            )
          }
        />
      )}
      {emergencyOpen && (
        <Modal
          title="Stop all work?"
          failure={error}
          retry={
            pending
              ? () => void execute(pending.intent, pending.complete)
              : undefined
          }
          close={() => setEmergencyOpen(false)}
        >
          <p>
            Request interruption of active work and prevent new tasks from
            starting. Changes already made will remain.
          </p>
          <div className="dialog-actions">
            <button onClick={() => setEmergencyOpen(false)}>
              Keep working
            </button>
            <button
              className="danger-button"
              disabled={sending}
              onClick={() =>
                void execute(
                  newIntent("/security/emergency-stop", {}, "Emergency stop"),
                  () => {
                    setStopped(true);
                    setEmergencyOpen(false);
                    setNotice(
                      "Emergency stop requested. Review each conversation for its confirmed state.",
                    );
                  },
                )
              }
            >
              Stop all work
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  close,
  failure,
  retry,
  returnFocus,
  initialFocus,
  backdropDismiss = false,
  trapFocus = false,
  className = "",
}: {
  title: string;
  returnFocus?: string;
  initialFocus?: string;
  backdropDismiss?: boolean;
  trapFocus?: boolean;
  className?: string;
  children: React.ReactNode;
  close: () => void;
  failure?: string;
  retry?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const focused = document.activeElement as HTMLElement | null;
    const opener =
      focused
        ?.closest("details.action-menu")
        ?.querySelector<HTMLElement>("summary") ?? focused;
    dialog?.showModal();
    if (initialFocus) dialog?.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      dialog?.close();
      requestAnimationFrame(() => {
        const target = returnFocus
          ? document.querySelector<HTMLElement>(returnFocus)
          : opener;
        // Switching between dialogs can leave body as the apparent opener.
        // Only finish restoration when a usable control actually receives focus.
        if (document.querySelector("dialog[open]")) return;
        const candidates = [
          target,
          document.querySelector<HTMLElement>(".project-button.selected"),
          document.querySelector<HTMLElement>("[aria-label='Open navigation']"),
        ];
        for (const candidate of candidates) {
          if (
            !candidate?.isConnected ||
            candidate === document.body ||
            candidate === document.documentElement ||
            candidate.closest("[inert]") ||
            !candidate.checkVisibility()
          )
            continue;
          candidate.focus();
          if (document.activeElement === candidate) break;
        }
      });
    };
  }, []);
  return (
    <dialog
      className={`dialog ${className}`}
      onKeyDown={(event) => {
        if (!trapFocus) return;
        if (event.key === "Escape") {
          // Search inputs otherwise consume the first Escape to clear text.
          event.preventDefault();
          event.stopPropagation();
          close();
          return;
        }
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter(
          (element) => element.checkVisibility() && !element.closest("[inert]"),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        if (!backdropDismiss || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      }}
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          ×
        </button>
      </div>
      {failure && (
        <div className="dialog-error" role="alert">
          <p>{failure}</p>
          {retry && <button onClick={retry}>Retry same request</button>}
        </div>
      )}
      {children}
    </dialog>
  );
}

function ProjectDialog({
  roots,
  browsing,
  allowRoot = false,
  disabled,
  close,
  create,
  failure,
  retry,
}: {
  roots: Root[];
  browsing?: { available: boolean; reason: string | null };
  allowRoot?: boolean;
  failure?: string;
  retry?: () => void;
  disabled: boolean;
  close: () => void;
  create: (body: {
    name: string;
    rootId: string;
    path: string;
    create: boolean;
  }) => void;
}) {
  const [rootId, setRootId] = useState(roots[0]?.id ?? "");
  useEffect(() => {
    if (!roots.some((root) => root.id === rootId))
      setRootId(roots[0]?.id ?? "");
  }, [roots, rootId]);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [makeFolder, setMakeFolder] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [listing, setListing] = useState<{
    path: string;
    directories: { name: string; path: string }[];
    truncated: boolean;
  }>();
  const [browseError, setBrowseError] = useState("");
  const [browseLoading, setBrowseLoading] = useState(false);
  const [retryListing, setRetryListing] = useState(0);
  useEffect(() => {
    setBrowsePath("");
    setListing(undefined);
  }, [rootId]);
  useEffect(() => {
    if (!browserOpen || !browsing?.available || !rootId) return;
    let active = true;
    setBrowseLoading(true);
    setBrowseError("");
    setListing(undefined);
    void request<{
      path: string;
      directories: { name: string; path: string }[];
      truncated: boolean;
    }>(
      `/project-roots/${encodeURIComponent(rootId)}/directories?path=${encodeURIComponent(browsePath)}`,
    )
      .then((result) => {
        if (active) setListing(result);
      })
      .catch((error) => {
        if (active) setBrowseError(errorMessage(error));
      })
      .finally(() => {
        if (active) setBrowseLoading(false);
      });
    return () => {
      active = false;
    };
  }, [browserOpen, browsing?.available, rootId, browsePath, retryListing]);
  return (
    <Modal title="Add project" close={close} failure={failure} retry={retry}>
      <p>
        {allowRoot
          ? "Choose an approved folder or one of its subfolders."
          : "Choose a folder inside an approved root."}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) create({ name, rootId, path, create: makeFolder });
        }}
      >
        <label className="field">
          Project name
          <input
            required
            autoFocus
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          Approved root
          <select
            required
            value={rootId}
            onChange={(event) => setRootId(event.target.value)}
          >
            {roots.map((root) => (
              <option key={root.id} value={root.id}>
                {root.name ?? root.label ?? root.id}
              </option>
            ))}
          </select>
        </label>
        {browsing?.available ? (
          <button
            type="button"
            onClick={() => setBrowserOpen((value) => !value)}
            aria-expanded={browserOpen}
          >
            Browse folders
          </button>
        ) : (
          <p className="field-help">
            {browsing?.reason ??
              "Folder browsing is unavailable. Enter a path relative to the approved root."}
          </p>
        )}
        {browserOpen && browsing?.available && (
          <section className="folder-browser" aria-label="Project folders">
            <div className="folder-browser-header">
              <button
                type="button"
                disabled={!browsePath || browseLoading}
                onClick={() =>
                  setBrowsePath(browsePath.split("/").slice(0, -1).join("/"))
                }
              >
                Parent folder
              </button>
              <code>{browsePath || "Approved root"}</code>
            </div>
            {browseLoading && <p role="status">Loading folders…</p>}
            {browseError && (
              <div role="alert">
                <p>{browseError}</p>
                <button
                  type="button"
                  onClick={() => setRetryListing((value) => value + 1)}
                >
                  Retry folders
                </button>
              </div>
            )}
            {listing && (
              <>
                <div className="folder-list">
                  {listing.directories.map((directory) => (
                    <button
                      type="button"
                      key={directory.path}
                      aria-label={`Open folder ${directory.name}`}
                      onClick={() => setBrowsePath(directory.path)}
                    >
                      <Icon name="folder" />
                      {directory.name}
                    </button>
                  ))}
                </div>
                {!listing.directories.length && (
                  <p className="field-help">No subfolders in this folder.</p>
                )}
                {listing.truncated && (
                  <p role="status" className="field-help">
                    Only the first folders are shown. Enter a relative path to
                    select another folder.
                  </p>
                )}
                <button
                  type="button"
                  disabled={(!browsePath && !allowRoot) || disabled}
                  onClick={() => {
                    setPath(browsePath || ".");
                    if (!name.trim())
                      setName(
                        browsePath
                          ? (browsePath.split("/").at(-1) ?? "")
                          : (roots.find((root) => root.id === rootId)?.name ??
                              "Project"),
                      );
                    setMakeFolder(false);
                    setBrowserOpen(false);
                  }}
                >
                  Use this folder
                </button>
                {!browsePath && !allowRoot && (
                  <p className="field-help">
                    Open a project folder within this root to select it.
                  </p>
                )}
              </>
            )}
            <p className="field-help">
              Folders belong to this Harbor instance. No files are uploaded.
            </p>
          </section>
        )}
        <label className="field">
          Folder path
          <input
            required
            maxLength={240}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="my-project"
            aria-describedby="path-help"
          />
        </label>
        <p className="field-help" id="path-help">
          A path relative to the selected root.
        </p>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={makeFolder}
            onChange={(event) => setMakeFolder(event.target.checked)}
          />
          Create a new folder
        </label>
        {!roots.length && (
          <p className="inline-error">
            No project roots are configured. Add an approved root in the server
            configuration first.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={disabled || !rootId || !name.trim() || !path.trim()}
            type="submit"
          >
            {disabled ? "Adding…" : "Add project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Question = {
  id: string;
  header?: string;
  question: string;
  isSecret?: boolean;
  options?: { label: string; description?: string }[];
};
function ApprovalCard({
  approval,
  disabled,
  answer,
}: {
  approval: Approval;
  disabled: boolean;
  answer: (
    decision: "accept" | "decline",
    answers?: Record<string, { answers: string[] }>,
  ) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const scope =
    approval.scope && typeof approval.scope === "object"
      ? (approval.scope as {
          questions?: Question[];
          reason?: string;
          command?: string | string[];
          changes?: unknown;
        })
      : {};
  const isInput = approval.kind === "item/tool/requestUserInput";
  const questions =
    isInput && Array.isArray(scope.questions) ? scope.questions : [];
  const answering = approval.state === "answering";
  return (
    <section
      className="approval"
      aria-label={isInput ? "Input request" : "Approval request"}
    >
      <h2>{isInput ? "Codex needs your answer" : "Codex needs approval"}</h2>
      {scope.reason && <p>{scope.reason}</p>}
      {scope.command && (
        <pre>
          {Array.isArray(scope.command)
            ? scope.command.join(" ")
            : scope.command}
        </pre>
      )}
      {!isInput && !scope.command && (
        <pre>
          {typeof approval.scope === "string"
            ? approval.scope
            : JSON.stringify(approval.scope, null, 2)}
        </pre>
      )}
      {questions.map((question) => (
        <fieldset key={question.id} disabled={disabled || answering}>
          <legend>{question.question}</legend>
          {question.isSecret ? (
            <p>
              Credentials cannot be entered here. Configure the account on the
              server, then decline this request.
            </p>
          ) : (
            <>
              <label
                className="sr-only"
                htmlFor={`answer-${approval.id}-${question.id}`}
              >
                {question.header ?? question.question}
              </label>
              {question.options?.length ? (
                <select
                  id={`answer-${approval.id}-${question.id}`}
                  value={answers[question.id] ?? ""}
                  onChange={(event) =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.id]: event.target.value,
                    }))
                  }
                >
                  <option value="">Choose an answer</option>
                  {question.options.map((option) => (
                    <option key={option.label} value={option.label}>
                      {option.label}
                      {option.description ? ` — ${option.description}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`answer-${approval.id}-${question.id}`}
                  value={answers[question.id] ?? ""}
                  maxLength={4096}
                  onChange={(event) =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.id]: event.target.value,
                    }))
                  }
                />
              )}
            </>
          )}
        </fieldset>
      ))}
      <p className="field-help">
        {answering
          ? "Answer submitted. Waiting for confirmation."
          : "This request stays paused until answered or expired."}
      </p>
      <div className="approval-actions">
        <button
          disabled={disabled || answering}
          onClick={() => answer("decline")}
        >
          Decline
        </button>
        <button
          className="primary"
          disabled={
            disabled ||
            answering ||
            (isInput &&
              questions.some(
                (question) =>
                  question.isSecret || !answers[question.id]?.trim(),
              ))
          }
          onClick={() =>
            answer(
              "accept",
              isInput
                ? Object.fromEntries(
                    questions.map((question) => [
                      question.id,
                      { answers: [answers[question.id]!] },
                    ]),
                  )
                : undefined,
            )
          }
        >
          {isInput ? "Send answer" : "Approve once"}
        </button>
      </div>
    </section>
  );
}
