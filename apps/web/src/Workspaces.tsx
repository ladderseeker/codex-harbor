import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceView } from "../../../packages/workspaces/src/types.ts";
import { newIntent, request, type Intent } from "./api.ts";

export type Inspection = {
  available: boolean;
  git: boolean | null;
  dirty: boolean | null;
  head?: string;
  branch?: string | null;
  reason?: string;
};
type Execute = (
  intent: Intent,
  complete?: (result: unknown) => void,
) => Promise<void>;
export const workspaceNames = {
  local: "Local",
  worktree: "Git Worktree",
  copy: "Copy",
};

export function useWorkspaces(projectId: string) {
  const [result, setResult] = useState<{
    projectId: string;
    workspaces: WorkspaceView[];
  }>({ projectId: "", workspaces: [] });
  const [error, setError] = useState("");
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await request<{ workspaces: WorkspaceView[] }>(
        `/projects/${encodeURIComponent(projectId)}/workspaces`,
      );
      if (currentProject.current !== projectId) return;
      setResult({ projectId, workspaces: data.workspaces });
      setError("");
    } catch (failure) {
      if (currentProject.current !== projectId) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "Workspaces could not be loaded.",
      );
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return {
    workspaces: result.projectId === projectId ? result.workspaces : [],
    error,
    refresh,
  };
}

export function WorkspaceSummary({
  workspace,
  sessionId,
  queued,
}: {
  workspace?: WorkspaceView;
  sessionId: string;
  queued: boolean;
}) {
  const [details, setDetails] = useState<{
    id: string;
    inspection: Inspection;
  }>();
  useEffect(() => {
    let active = true;
    if (workspace?.id && workspace.state === "ready")
      void request<{ inspection: Inspection }>(
        `/workspaces/${encodeURIComponent(workspace.id)}`,
      )
        .then((result) => {
          if (active)
            setDetails({ id: workspace.id, inspection: result.inspection });
        })
        .catch(() => {
          if (active) setDetails(undefined);
        });
    return () => {
      active = false;
    };
  }, [workspace?.id, workspace?.state]);
  const inspection =
    details?.id === workspace?.id ? details?.inspection : undefined;
  return (
    <div className="workspace-summary" aria-label="Conversation workspace">
      {!workspace ? (
        <p role="status">Loading workspace identity…</p>
      ) : (
        <>
          <p>
            <strong>{workspace.name}</strong>
            <span>{workspaceNames[workspace.kind]}</span>
            <span
              className={`workspace-state workspace-state-${workspace.state}`}
            >
              {workspace.state}
            </span>
          </p>
          <p className="workspace-path">{workspace.relativePath}</p>
          {inspection?.git && (
            <p className="field-help">
              {inspection.branch === null
                ? "Detached checkout"
                : inspection.branch
                  ? `Branch: ${inspection.branch}`
                  : "Branch status unavailable"}
              {inspection.dirty
                ? "; uncommitted changes present"
                : "; clean checkout"}
            </p>
          )}
          <dl>
            <div>
              <dt>Workspace ID</dt>
              <dd>{workspace.id}</dd>
            </div>
            {workspace.baseRevision && (
              <div>
                <dt>Base commit</dt>
                <dd>{workspace.baseRevision}</dd>
              </div>
            )}
          </dl>
          {workspace.kind === "worktree" && (
            <p className="field-help">
              Based on committed source. Uncommitted Local changes are excluded.
            </p>
          )}
          {workspace.kind === "copy" && (
            <p className="field-help">
              An independent snapshot of the non-Git source.
            </p>
          )}
          {inspection && !inspection.available && (
            <p className="inline-error" role="status">
              Workspace inspection is unavailable. No alternate path will be
              used.
            </p>
          )}
          {workspace.state !== "ready" && (
            <p className="inline-error" role="status">
              This workspace is {workspace.state}. New work cannot start here.
              The conversation stays bound to this workspace.
            </p>
          )}
          {workspace.writerOwnerId &&
            workspace.writerSessionId !== sessionId && (
              <p className="writer-notice" role="status">
                {queued
                  ? "Queued for this workspace."
                  : "This workspace is in use."}{" "}
                A {workspace.writerKind ?? "conversation"} holds its writer
                reservation. Work starts after its processes are confirmed
                stopped.
              </p>
            )}
          {workspace.writerSessionId === sessionId && (
            <p className="field-help">
              This conversation holds the workspace writer reservation.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function WorkspaceManager({
  projectId,
  projectName,
  archived,
  workspaces,
  disabled,
  execute,
  refresh,
  selected,
  select,
}: {
  projectId: string;
  projectName: string;
  archived: boolean;
  workspaces: WorkspaceView[];
  disabled: boolean;
  execute: Execute;
  refresh: () => Promise<void>;
  selected: string;
  select: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"worktree" | "copy">("worktree");
  const [revision, setRevision] = useState("");
  const [inspection, setInspection] = useState<{
    id: string;
    data: Inspection;
  }>();
  const [inspecting, setInspecting] = useState(false);
  const [inspectionError, setInspectionError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    action: "archive" | "remove" | "project" | "release";
    workspace?: WorkspaceView;
  }>();
  const source = workspaces.find((workspace) => workspace.id === sourceId);
  const sourceInfo = inspection?.id === sourceId ? inspection.data : undefined;

  async function inspect(id: string) {
    setSourceId(id);
    setInspection(undefined);
    setInspectionError("");
    setInspecting(true);
    setAcknowledged(false);
    setRevision("");
    try {
      const result = await request<{
        workspace: WorkspaceView;
        inspection: Inspection;
      }>(`/workspaces/${encodeURIComponent(id)}`);
      setInspection({ id, data: result.inspection });
      setKind(result.inspection.git ? "worktree" : "copy");
      setRevision(result.inspection.head ?? "");
    } catch (failure) {
      setInspectionError(
        failure instanceof Error
          ? failure.message
          : "Source could not be inspected.",
      );
    } finally {
      setInspecting(false);
    }
  }

  const canCreate =
    !disabled &&
    !archived &&
    source?.state === "ready" &&
    sourceInfo?.available &&
    !inspecting &&
    acknowledged &&
    name.trim() &&
    (kind === "copy"
      ? !sourceInfo.git
      : sourceInfo.git && /^[a-f0-9]{40}$/i.test(revision));
  function create() {
    if (!canCreate) return;
    void execute(
      newIntent(
        `/projects/${encodeURIComponent(projectId)}/workspaces`,
        {
          name: name.trim(),
          kind,
          sourceWorkspaceId: sourceId,
          ...(kind === "worktree" ? { revision } : {}),
          dirtyPolicy: kind === "worktree" ? "exclude" : "snapshot",
        },
        "Create workspace",
      ),
      (result) => {
        const workspace = (result as { workspace: WorkspaceView }).workspace;
        select(workspace.id);
        setCreating(false);
        setName("");
        void refresh();
      },
    );
  }

  function confirm() {
    if (!confirmation || disabled) return;
    const { action, workspace } = confirmation;
    const intent =
      action === "release"
        ? newIntent(
            `/workspaces/${encodeURIComponent(workspace!.id)}/release`,
            {
              acknowledgeUnknownEffects: true,
              expectedSessionId: workspace!.writerSessionId,
              expectedGeneration: workspace!.writerGeneration,
            },
            "Release uncertain workspace",
          )
        : action === "project"
          ? newIntent(
              `/projects/${encodeURIComponent(projectId)}/archive`,
              {},
              "Archive project",
            )
          : newIntent(
              `/workspaces/${encodeURIComponent(workspace!.id)}${action === "archive" ? "/archive" : ""}`,
              {},
              action === "archive" ? "Archive workspace" : "Remove workspace",
            );
    if (action === "remove") intent.method = "DELETE";
    void execute(intent, () => {
      setConfirmation(undefined);
      void refresh();
    });
  }

  return (
    <div className="workspace-manager">
      <p className="field-help">
        Separate workspaces can run concurrently. Harbor coordinates managed
        writers in a shared workspace; external scripts and SSH can still change
        files.
      </p>
      {archived && (
        <p className="writer-notice">
          This project is archived. Saved conversations and source folders are
          retained.
        </p>
      )}
      <div className="managed-workspaces">
        {workspaces.map((workspace) => (
          <section
            key={workspace.id}
            className="managed-workspace"
            aria-label={workspace.name}
          >
            <div className="managed-workspace-heading">
              <h3>{workspace.name}</h3>
              <span>
                {workspaceNames[workspace.kind]} · {workspace.state}
              </span>
            </div>
            <p className="workspace-path">{workspace.relativePath}</p>
            {workspace.baseRevision && (
              <p className="workspace-path">Base {workspace.baseRevision}</p>
            )}
            {workspace.failureCode && (
              <p className="inline-error">
                {workspace.failureCode.replaceAll("_", " ")}
              </p>
            )}
            {workspace.release && (
              <p role="status">
                Reservation release: {workspace.release.state}
                {workspace.release.failureCode
                  ? ` — ${workspace.release.failureCode.replaceAll("_", " ")}. Ownership remains reserved; retry after retirement can be confirmed.`
                  : ""}
              </p>
            )}
            {workspace.writerOwnerId && (
              <p className="field-help">
                Writer reservation held by {workspace.writerKind}{" "}
                {workspace.writerOwnerId}.
              </p>
            )}
            <div className="workspace-actions">
              {workspace.writerSessionId && workspace.writerGeneration && (
                <button
                  disabled={disabled}
                  onClick={() =>
                    setConfirmation({ action: "release", workspace })
                  }
                >
                  Release uncertain reservation
                </button>
              )}
              <button
                disabled={disabled || archived || workspace.state !== "ready"}
                onClick={() => select(workspace.id)}
              >
                {selected === workspace.id
                  ? "Selected for new conversations"
                  : "Use for new conversations"}
              </button>
              {workspace.state !== "archived" &&
                workspace.state !== "removed" && (
                  <button
                    disabled={disabled || !!workspace.writerOwnerId}
                    onClick={() =>
                      setConfirmation({ action: "archive", workspace })
                    }
                  >
                    Archive
                  </button>
                )}
              {workspace.kind !== "local" && workspace.state !== "removed" && (
                <button
                  className="quiet-button danger-text"
                  disabled={disabled || !!workspace.writerOwnerId}
                  onClick={() =>
                    setConfirmation({ action: "remove", workspace })
                  }
                >
                  Remove checkout
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      {confirmation && (
        <section
          className="remove-confirmation"
          aria-label="Confirm workspace action"
        >
          <h3>
            {confirmation.action === "project"
              ? `Archive ${projectName}?`
              : confirmation.action === "release"
                ? `Release ${confirmation.workspace?.name}?`
                : `${confirmation.action === "archive" ? "Archive" : "Remove"} ${confirmation.workspace?.name}?`}
          </h3>
          <p>
            {confirmation.action === "release"
              ? "Stop the previous conversation’s processes and release this workspace. Prior effects remain unknown and existing file changes remain. The original uncertain work will not be replayed. Healthy active work must be stopped first."
              : confirmation.action === "remove"
                ? "Delete this derived checkout after Harbor verifies it is clean and inactive. Dirty or active checkouts cannot be removed. Saved conversation history remains."
                : "Archive this record and prevent new work. Source folders and saved conversations are retained."}
          </p>
          <div className="dialog-actions">
            <button
              onClick={() => setConfirmation(undefined)}
              disabled={disabled}
            >
              Cancel
            </button>
            <button
              className="danger-button"
              onClick={confirm}
              disabled={disabled}
            >
              {confirmation.action === "release"
                ? "Acknowledge unknown effects and stop processes"
                : confirmation.action === "remove"
                  ? "Remove checkout"
                  : "Confirm archive"}
            </button>
          </div>
        </section>
      )}
      {!creating && !archived && (
        <button
          className="primary"
          disabled={disabled}
          onClick={() => {
            setCreating(true);
            const local = workspaces.find(
              (workspace) =>
                workspace.kind === "local" && workspace.state === "ready",
            );
            if (local) void inspect(local.id);
          }}
        >
          Create workspace
        </button>
      )}
      {creating && (
        <form
          className="workspace-create"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <h3>Create workspace</h3>
          <label className="field">
            Workspace name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="field">
            Source workspace
            <select
              value={sourceId}
              onChange={(event) => void inspect(event.target.value)}
              disabled={disabled || inspecting}
            >
              <option value="">Choose a source</option>
              {workspaces
                .filter(
                  (workspace) =>
                    workspace.kind === "local" && workspace.state === "ready",
                )
                .map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
            </select>
          </label>
          {inspecting && (
            <p role="status">Inspecting source files and Git state…</p>
          )}
          {inspectionError && (
            <p className="inline-error" role="alert">
              {inspectionError}
            </p>
          )}
          {sourceInfo && (
            <>
              <p className="field-help">
                {sourceInfo.available
                  ? sourceInfo.git
                    ? `Git source${sourceInfo.branch ? ` on ${sourceInfo.branch}` : sourceInfo.branch === null ? " at a detached commit" : ""}. ${sourceInfo.dirty ? "Uncommitted changes are present." : "The source is clean."}`
                    : "Non-Git source folder."
                  : "Source unavailable. No alternate path will be used."}
              </p>
              {sourceInfo.reason && (
                <p className="inline-error">{sourceInfo.reason}</p>
              )}
              <label className="field">
                Workspace type
                <select
                  value={kind}
                  disabled={disabled || !sourceInfo.available}
                  onChange={(event) => {
                    setKind(event.target.value as "worktree" | "copy");
                    setAcknowledged(false);
                  }}
                >
                  <option value="worktree" disabled={!sourceInfo.git}>
                    Git Worktree
                  </option>
                  <option value="copy" disabled={!!sourceInfo.git}>
                    Copy
                  </option>
                </select>
              </label>
              {kind === "worktree" && (
                <label className="field">
                  Base commit
                  <input
                    required
                    value={revision}
                    maxLength={40}
                    pattern="[a-fA-F0-9]{40}"
                    onChange={(event) => setRevision(event.target.value)}
                    disabled={disabled}
                    aria-describedby="base-help"
                  />
                </label>
              )}
              <p id="base-help" className="field-help">
                {kind === "worktree"
                  ? "Use the full commit ID. The Local checkout stays unchanged; uncommitted changes are excluded. Git metadata is shared among this project’s managed worktrees."
                  : "Create an independent bounded snapshot of this non-Git folder. Source files remain in place."}
              </p>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={disabled}
                />
                {kind === "worktree"
                  ? "Use committed files only"
                  : "Create a separate copy of the source files"}
              </label>
            </>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!canCreate}>
              Create workspace
            </button>
          </div>
        </form>
      )}
      {!archived && (
        <div className="project-archive">
          <button
            className="quiet-button danger-text"
            disabled={disabled}
            onClick={() => setConfirmation({ action: "project" })}
          >
            Archive project
          </button>
        </div>
      )}
    </div>
  );
}
