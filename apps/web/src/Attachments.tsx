import { ATTACHMENT_LIMITS } from "../../../packages/contracts/src/attachments.ts";
import { Icon } from "./Icons.tsx";
import { useEffect, useRef, useState } from "react";
import { ApiError, mutate, newIntent, request, type Intent } from "./api.ts";
export type Attachment = {
  id: string;
  sessionId: string;
  name: string;
  state: string;
  mediaType: string;
  size: number;
  digest: string;
  operationId: string | null;
  expiresAt: string;
};
type Draft = { text: string; attachmentIds: string[]; revision: number };
const blank: Draft = { text: "", attachmentIds: [], revision: 0 };
export function useRichDraft(session: string, csrf: string | undefined) {
  const [draft, setDraft] = useState<Draft>(blank),
    [files, updateFiles] = useState<Attachment[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false);
  const filesRef = useRef(files);
  function setFiles(next: Attachment[]) {
    filesRef.current = next;
    updateFiles(next);
  }
  const current = useRef(session);
  const epoch = useRef(0);
  if (current.current !== session) {
    current.current = session;
    epoch.current++;
  }
  const viewGeneration = epoch.current;
  const latest = useRef(draft);
  latest.current = draft;
  const pending = useRef<Intent | undefined>(undefined);
  const working = useRef(false);
  async function refreshFiles() {
    const id = session,
      generation = epoch.current;
    const r = await request<{ attachments: Attachment[] }>(
      `/sessions/${id}/attachments`,
    );
    if (current.current === id && epoch.current === generation)
      setFiles(r.attachments);
    return r.attachments;
  }
  async function reload() {
    const id = session;
    if (!id || current.current !== id || epoch.current !== viewGeneration)
      return;
    epoch.current++;
    const reloadGeneration = epoch.current;
    working.current = false;
    setSaving(false);
    setReady(false);
    const [d, f] = await Promise.all([
      request<{ draft: Draft }>(`/sessions/${id}/draft`),
      request<{ attachments: Attachment[] }>(`/sessions/${id}/attachments`),
    ]);
    if (current.current !== id || epoch.current !== reloadGeneration) return;
    setDraft(d.draft);
    latest.current = d.draft;
    setFiles(f.attachments);
    pending.current = undefined;
    setDirty(false);
    setError("");
    setReady(true);
  }
  useEffect(() => {
    setReady(false);
    setDraft(blank);
    setFiles([]);
    pending.current = undefined;
    setDirty(false);
    setError("");
    working.current = false;
    setSaving(false);
    if (session && csrf) {
      const result = reload();
      const generation = epoch.current;
      void result.catch((e) => {
        if (epoch.current === generation) setError(e.message);
      });
    }
  }, [session, csrf]);
  async function save(): Promise<Draft | undefined> {
    if (!ready || !csrf || working.current) return;
    const id = session,
      generation = epoch.current;
    const state = latest.current;
    const intent =
      pending.current ??
      newIntent(
        `/sessions/${id}/draft`,
        {
          text: state.text,
          attachmentIds: state.attachmentIds,
          expectedRevision: state.revision,
        },
        "Save draft",
      );
    pending.current = intent;
    working.current = true;
    setSaving(true);
    try {
      const r = await mutate<{ draft: Draft }>(intent, csrf);
      if (current.current !== id || epoch.current !== generation) return;
      pending.current = undefined;
      const sent = intent.body as { text: string; attachmentIds: string[] };
      const unchanged =
        latest.current.text === sent.text &&
        JSON.stringify(latest.current.attachmentIds) ===
          JSON.stringify(sent.attachmentIds);
      const next = { ...latest.current, revision: r.draft.revision };
      latest.current = next;
      setDraft(next);
      setDirty(!unchanged);
      setError("");
      return unchanged ? next : undefined;
    } catch (e) {
      if (current.current === id && epoch.current === generation)
        setError(e instanceof Error ? e.message : "Draft save failed");
      return;
    } finally {
      if (current.current === id && epoch.current === generation) {
        working.current = false;
        setSaving(false);
      }
    }
  }
  useEffect(() => {
    if (!ready || !dirty || error || saving) return;
    const timer = setTimeout(() => void save(), 600);
    return () => clearTimeout(timer);
  }, [draft, ready, dirty, error, saving]);
  function edit(change: Partial<Draft>) {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setDraft(next);
    setDirty(true);
  }
  return {
    draft,
    getDraft: () => latest.current,
    getFiles: () => filesRef.current,
    files,
    ready,
    error,
    saving,
    dirty,
    edit,
    save,
    reload,
    refreshFiles,
    setError,
    accepted() {
      const result = reload(),
        generation = epoch.current;
      void result.catch((e) => {
        if (epoch.current === generation) setError(e.message);
      });
    },
  };
}
export type RichDraft = ReturnType<typeof useRichDraft>;
export function AttachmentPicker({
  state,
  csrf,
  session,
  modalities,
  disabled,
  onBusyChange,
}: {
  state: RichDraft;
  csrf: string;
  session: string;
  modalities: string[];
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const queue = useRef<File[]>([]);
  const held = useRef<File | undefined>(undefined);
  const draining = useRef(false);
  const [queued, setQueued] = useState(0);
  const [selectionError, setSelectionError] = useState("");
  const paused = useRef(false);
  const latestState = useRef(state);
  latestState.current = state;
  const input = useRef<HTMLInputElement>(null),
    upload = useRef<XMLHttpRequest | undefined>(undefined),
    mounted = useRef(true);
  const [progress, setProgress] = useState<number | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState<(() => Promise<void>) | undefined>(undefined);
  const retryRef = useRef(false);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    onBusyChange(progress !== null || queued > 0 || !!retry);
  }, [progress, queued, retry, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      upload.current?.abort();
      onBusyChange(false);
    };
  }, []);
  async function choose(file: File) {
    if (!mounted.current) return false;
    retryRef.current = false;
    const type =
      file.type === "image/png" || /\.png$/i.test(file.name)
        ? "image/png"
        : file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)
          ? "image/jpeg"
          : "application/octet-stream";
    if (!modalities.includes(type.startsWith("image/") ? "image" : "text")) {
      setError(
        `The selected model does not advertise ${type.startsWith("image/") ? "image" : "text"} input for ${file.name}.`,
      );
      return false;
    }
    paused.current = false;
    setError("");
    setProgress(0);
    let buffer: ArrayBuffer;
    let digest: string;
    try {
      buffer = await file.arrayBuffer();
      digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
    } catch {
      setProgress(null);
      setError("The file could not be read. Choose it again.");
      return false;
    }
    if (!mounted.current) return false;
    let attachment = latestState.current
      .getFiles()
      .find(
        (f) =>
          f.state === "uploading" &&
          f.digest === digest &&
          f.size === file.size,
      );
    const stage = newIntent(
      `/sessions/${session}/attachments`,
      { name: file.name, mediaType: type, size: file.size, sha256: digest },
      "Stage attachment",
    );
    const binaryKey = `${Date.now()}:${crypto.randomUUID()}`;
    let transferring = false;
    async function run() {
      if (transferring || !mounted.current) return false;
      transferring = true;
      setProgress(0);
      setError("");
      setRetry(undefined);
      retryRef.current = false;
      try {
        if (paused.current) throw Error("Upload paused. Retry the same file.");
        if (!attachment)
          attachment = (await mutate<{ attachment: Attachment }>(stage, csrf))
            .attachment;
        if (!mounted.current) return;
        if (paused.current) throw Error("Upload paused. Retry the same file.");
        const id = attachment.id;
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          upload.current = xhr;
          xhr.open("PUT", `/api/v1/attachments/${id}/content`);
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.setRequestHeader("X-CSRF-Token", csrf);
          xhr.setRequestHeader("Idempotency-Key", binaryKey);
          xhr.timeout = 30000;
          xhr.upload.onprogress = (e) => {
            if (mounted.current && e.lengthComputable)
              setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else {
              let message = "Upload rejected";
              try {
                message = JSON.parse(xhr.responseText).error.message;
              } catch {}
              reject(new ApiError(message, xhr.status));
            }
          };
          xhr.onerror = () =>
            reject(new Error("Upload connection lost. Retry the same file."));
          xhr.ontimeout = () =>
            reject(new Error("Upload timed out. Retry the same file."));
          xhr.onabort = () =>
            reject(
              new Error("Upload paused. Retry it or remove the staged file."),
            );
          xhr.send(buffer);
        });
        if (!mounted.current) return;
        const authoritativeFiles = await latestState.current.refreshFiles();
        if (!mounted.current) return;
        const selectedIds = latestState.current.getDraft().attachmentIds;
        const total = authoritativeFiles
          .filter((a) => selectedIds.includes(a.id) || a.id === id)
          .reduce((sum, a) => sum + a.size, 0);
        if (
          total > ATTACHMENT_LIMITS.turnBytes ||
          (!selectedIds.includes(id) &&
            selectedIds.length >= ATTACHMENT_LIMITS.turnCount)
        ) {
          throw new ApiError(
            "Uploaded file is ready, but normalized files exceed this message's four-file / 20 MiB limit. Remove a selection before adding it.",
            413,
          );
        }
        state.edit({
          attachmentIds: [
            ...new Set([...latestState.current.getDraft().attachmentIds, id]),
          ],
        });
        setRetry(undefined);
        held.current = undefined;
        return true;
      } catch (e) {
        if (mounted.current) {
          setError(e instanceof Error ? e.message : "Upload failed");
          if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) {
            held.current = file;
            retryRef.current = true;
            setRetry(() => async () => {
              paused.current = false;
              if (await run()) void drain();
              else if (!retryRef.current) {
                held.current = undefined;
                void drain();
              }
            });
          }
          void state.refreshFiles().catch(() => {});
        }
        return false;
      } finally {
        transferring = false;
        if (mounted.current) setProgress(null);
        upload.current = undefined;
      }
    }
    return await run();
  }
  async function drain() {
    if (draining.current || held.current || !mounted.current) return;
    draining.current = true;
    try {
      while (queue.current.length && mounted.current && !held.current) {
        const file = queue.current.shift()!;
        setQueued(queue.current.length);
        held.current = file;
        // The current file remains reserved while hashing/transferring.
        const accepted = await choose(file);
        if (!mounted.current) return;
        if (!accepted) {
          // Retryable transfers retain their exact intent and block the queue.
          if (retryRef.current) break;
          held.current = undefined;
          setSelectionError(
            (previous) =>
              `${previous ? previous + " " : ""}${file.name} was not added. Choose it again to retry.`,
          );
        }
      }
    } finally {
      draining.current = false;
    }
  }
  function chooseBatch(files: File[]) {
    if (disabled) {
      setSelectionError(
        "Attachments are unavailable while this conversation is busy.",
      );
      return;
    }
    const current = latestState.current;
    const selected = current
      .getFiles()
      .filter((a) => current.getDraft().attachmentIds.includes(a.id));
    let count =
      current.getDraft().attachmentIds.length +
      queue.current.length +
      (held.current ? 1 : 0);
    let bytes =
      selected.reduce((sum, a) => sum + a.size, 0) +
      queue.current.reduce((sum, f) => sum + f.size, 0) +
      (held.current?.size ?? 0);
    const rejected: string[] = [];
    for (const file of files) {
      if (
        !file.size ||
        file.size > ATTACHMENT_LIMITS.fileBytes ||
        count >= ATTACHMENT_LIMITS.turnCount ||
        bytes + file.size > ATTACHMENT_LIMITS.turnBytes
      ) {
        rejected.push(file.name);
      } else {
        queue.current.push(file);
        count++;
        bytes += file.size;
      }
    }
    setSelectionError(
      rejected.length
        ? `Not added: ${rejected.slice(0, 4).join(", ") + (rejected.length > 4 ? ` and ${rejected.length - 4} more files` : "")}. Limits: 10 MiB per file, four files / 20 MiB per message; empty files are not accepted.`
        : "",
    );
    setQueued(queue.current.length);
    void drain();
  }
  async function remove(a: Attachment) {
    const intent = newIntent(`/attachments/${a.id}`, {}, "Remove attachment");
    try {
      await request(intent.path, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          "Idempotency-Key": intent.key,
        },
        body: "{}",
      });
      await state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Removal failed");
    }
  }
  const latestChoose = useRef(chooseBatch);
  latestChoose.current = chooseBatch;
  useEffect(() => {
    // The attachment section uses display:contents; the composer owns the
    // complete drop surface, including its textarea and empty padding.
    const composer = input.current?.closest("form.composer");
    if (!composer) return;
    const isFileDrag = (event: DragEvent) =>
      !!event.dataTransfer &&
      (event.dataTransfer.types.includes("Files") ||
        event.dataTransfer.files.length > 0);
    const over = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (!isFileDrag(dragEvent)) return;
      dragEvent.preventDefault();
      setDrag(true);
    };
    const leave = (event: Event) => {
      const related = (event as DragEvent).relatedTarget;
      if (!(related instanceof Node) || !composer.contains(related))
        setDrag(false);
    };
    const drop = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (!isFileDrag(dragEvent)) return;
      dragEvent.preventDefault();
      setDrag(false);
      const files = Array.from(dragEvent.dataTransfer?.files ?? []);
      if (files.length) latestChoose.current(files);
    };
    const end = () => setDrag(false);
    composer.addEventListener("dragover", over, true);
    composer.addEventListener("dragleave", leave, true);
    composer.addEventListener("drop", drop, true);
    window.addEventListener("dragend", end);
    window.addEventListener("blur", end);
    return () => {
      composer.removeEventListener("dragover", over, true);
      composer.removeEventListener("dragleave", leave, true);
      composer.removeEventListener("drop", drop, true);
      window.removeEventListener("dragend", end);
      window.removeEventListener("blur", end);
    };
  }, []);
  return (
    <section
      className={`attachments ${drag ? "dragging" : ""}`}
      aria-label="Attachments"
    >
      <div className="attachment-tools">
        <button
          type="button"
          className="icon-button attachment-trigger"
          aria-label="Attach file"
          title="Attach file"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Icon name="plus" />
        </button>
        <details className="attachment-limits">
          <summary aria-label="Attachment limits" title="Attachment limits">
            <Icon name="more" />
          </summary>
          Select, drop or paste files · PNG/JPEG images and general files · 10
          MiB each · 4 files / 20 MiB per message
        </details>
      </div>
      <input
        ref={input}
        className="sr-only"
        type="file"
        aria-label="Choose attachment"
        multiple
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          chooseBatch(files);
        }}
      />
      <PasteCapture choose={chooseBatch} disabled={disabled} />
      {queued > 0 && (
        <p role="status">
          {queued} file{queued === 1 ? "" : "s"} queued
        </p>
      )}
      {selectionError && <p role="alert">{selectionError}</p>}
      {progress !== null && (
        <div role="status">
          Uploading <progress max={100} value={progress} />
          <button
            type="button"
            onClick={() => {
              paused.current = true;
              upload.current?.abort();
            }}
          >
            Pause upload
          </button>
        </div>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          {retry && (
            <>
              <button type="button" onClick={() => void retry()}>
                Retry upload
              </button>
              <button
                type="button"
                onClick={() => {
                  held.current = undefined;
                  retryRef.current = false;
                  setRetry(undefined);
                  setError("");
                  void drain();
                }}
              >
                Cancel
              </button>
            </>
          )}
        </p>
      )}
      {state.files.some(
        (a) =>
          state.draft.attachmentIds.includes(a.id) &&
          !modalities.includes(
            a.mediaType.startsWith("image/") ? "image" : "text",
          ),
      ) && (
        <p role="alert">
          The selected model cannot receive one or more selected attachments.
          Choose a compatible model or remove those files.
        </p>
      )}
      <div className="attachment-list" aria-label="Selected and staged files">
        {state.files
          .filter((a) => ["staged", "uploading"].includes(a.state))
          .map((a) => (
            <div className="attachment-row" key={a.id}>
              <AttachmentPreview attachment={a} />
              <span>
                {a.state === "uploading"
                  ? "Upload incomplete: choose the same file to resume"
                  : state.draft.attachmentIds.includes(a.id)
                    ? "Selected for this message"
                    : "Ready to attach"}
              </span>
              {a.state === "staged" &&
                !state.draft.attachmentIds.includes(a.id) && (
                  <button
                    type="button"
                    disabled={
                      disabled ||
                      progress !== null ||
                      queued > 0 ||
                      !!retry ||
                      state.draft.attachmentIds.length >=
                        ATTACHMENT_LIMITS.turnCount ||
                      state.files
                        .filter((f) => state.draft.attachmentIds.includes(f.id))
                        .reduce((sum, f) => sum + f.size, 0) +
                        a.size >
                        ATTACHMENT_LIMITS.turnBytes
                    }
                    onClick={() =>
                      state.edit({
                        attachmentIds: [...state.draft.attachmentIds, a.id],
                      })
                    }
                  >
                    Select
                  </button>
                )}
              <button
                type="button"
                disabled={
                  disabled || state.dirty || state.saving || progress !== null
                }
                onClick={() => void remove(a)}
                aria-label={`Remove ${a.name}`}
              >
                Remove
              </button>
            </div>
          ))}
      </div>
      <p className="field-help draft-status" role="status">
        {state.error
          ? state.error
          : !state.ready
            ? "Loading saved draft…"
            : state.saving
              ? "Saving draft…"
              : state.dirty
                ? "Draft has unsaved changes"
                : "Draft saved for 24 hours."}
      </p>
      {state.error && (
        <>
          <button type="button" onClick={() => void state.save()}>
            Retry draft save
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm("Replace local edits with the saved draft?"))
                void state.reload();
            }}
          >
            Reload saved draft
          </button>
        </>
      )}
    </section>
  );
}
function PasteCapture({
  choose,
  disabled,
}: {
  choose: (files: File[]) => void;
  disabled: boolean;
}) {
  const latest = useRef({ choose, disabled });
  latest.current = { choose, disabled };
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (!(e.target instanceof HTMLElement) || !e.target.closest(".composer"))
        return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length && !latest.current.disabled) {
        e.preventDefault();
        latest.current.choose(files);
      }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, []);
  return null;
}
export function AttachmentPreview({
  attachment: a,
}: {
  attachment: Attachment;
}) {
  return (
    <span className="attachment-preview">
      {(a.mediaType === "image/png" || a.mediaType === "image/jpeg") &&
        a.state !== "uploading" && (
          <img
            loading="lazy"
            src={`/api/v1/attachments/${a.id}/preview`}
            alt={`Attachment: ${a.name}`}
            width={48}
            height={48}
          />
        )}
      <span>
        {a.name} <small>{Math.ceil(a.size / 1024)} KiB</small>
        {a.state !== "uploading" && (
          <a href={`/api/v1/attachments/${a.id}/content`} download>
            Download
          </a>
        )}
      </span>
    </span>
  );
}
