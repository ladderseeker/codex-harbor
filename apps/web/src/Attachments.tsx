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
    [files, setFiles] = useState<Attachment[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false);
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
    setDraft((d) => {
      const next = { ...d, ...change };
      latest.current = next;
      return next;
    });
    setDirty(true);
  }
  return {
    draft,
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
}: {
  state: RichDraft;
  csrf: string;
  session: string;
  modalities: string[];
  disabled: boolean;
}) {
  const fileBusy = useRef(false);
  const paused = useRef(false);
  const latestState = useRef(state);
  latestState.current = state;
  const input = useRef<HTMLInputElement>(null),
    upload = useRef<XMLHttpRequest | undefined>(undefined),
    mounted = useRef(true);
  const [progress, setProgress] = useState<number | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState<(() => Promise<void>) | undefined>(undefined);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      upload.current?.abort();
    };
  }, []);
  async function choose(file: File) {
    if (disabled || fileBusy.current || progress !== null) return;
    const type =
      file.type === "image/png" || file.name.toLowerCase().endsWith(".png")
        ? "image/png"
        : file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")
          ? "text/plain"
          : "";
    if (!type) {
      setError("Supported files: PNG images and UTF-8 .txt files.");
      return;
    }
    if (!modalities.includes(type === "image/png" ? "image" : "text")) {
      setError(
        `The selected model does not advertise ${type === "image/png" ? "image" : "text"} input.`,
      );
      return;
    }
    if (!file.size || file.size > (type === "image/png" ? 262144 : 65536)) {
      setError(
        "PNG limit: 256 KiB. Text limit: 64 KiB. Empty files are not accepted.",
      );
      return;
    }
    if (state.draft.attachmentIds.length >= 4) {
      setError("Select up to four files per message.");
      return;
    }
    fileBusy.current = true;
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
      fileBusy.current = false;
      setProgress(null);
      setError("The file could not be read. Choose it again.");
      return;
    }
    if (!mounted.current) return;
    let attachment = state.files.find(
      (f) =>
        f.state === "uploading" && f.digest === digest && f.size === file.size,
    );
    const stage = newIntent(
      `/sessions/${session}/attachments`,
      { name: file.name, mediaType: type, size: file.size, sha256: digest },
      "Stage attachment",
    );
    const binaryKey = `${Date.now()}:${crypto.randomUUID()}`;
    let transferring = false;
    async function run() {
      if (transferring || !mounted.current) return;
      transferring = true;
      fileBusy.current = true;
      setProgress(0);
      setError("");
      setRetry(undefined);
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
        await state.refreshFiles();
        if (!mounted.current) return;
        state.edit({
          attachmentIds: [
            ...new Set([...latestState.current.draft.attachmentIds, id]),
          ],
        });
        setRetry(undefined);
      } catch (e) {
        if (mounted.current) {
          setError(e instanceof Error ? e.message : "Upload failed");
          if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500)
            setRetry(() => async () => {
              paused.current = false;
              await run();
            });
          void state.refreshFiles().catch(() => {});
        }
      } finally {
        transferring = false;
        if (mounted.current) setProgress(null);
        fileBusy.current = false;
        upload.current = undefined;
      }
    }
    await run();
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
  return (
    <section
      className={`attachments ${drag ? "dragging" : ""}`}
      aria-label="Attachments"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files[0];
        if (file) void choose(file);
      }}
    >
      <div className="attachment-tools">
        <button
          type="button"
          disabled={disabled || progress !== null}
          onClick={() => input.current?.click()}
        >
          Attach file
        </button>
        <span>
          Drop or paste one file at a time · PNG 256 KiB · UTF-8 text 64 KiB · 4
          files / 512 KiB
        </span>
      </div>
      <input
        ref={input}
        className="sr-only"
        type="file"
        aria-label="Choose attachment"
        accept="image/png,text/plain,.txt"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void choose(f);
        }}
      />
      <PasteCapture choose={choose} />
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
            <button type="button" onClick={() => void retry()}>
              Retry same upload
            </button>
          )}
        </p>
      )}
      {state.files.some(
        (a) =>
          state.draft.attachmentIds.includes(a.id) &&
          !modalities.includes(a.mediaType === "image/png" ? "image" : "text"),
      ) && (
        <p role="alert">
          The selected model cannot receive one or more selected attachments.
          Choose a compatible model or remove those files.
        </p>
      )}
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
                  disabled={disabled || state.draft.attachmentIds.length >= 4}
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
      <p className="field-help" role="status">
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
function PasteCapture({ choose }: { choose: (file: File) => Promise<void> }) {
  const latest = useRef(choose);
  latest.current = choose;
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (!(e.target instanceof HTMLElement) || !e.target.closest(".composer"))
        return;
      const file = e.clipboardData?.files[0];
      if (file) {
        e.preventDefault();
        void latest.current(file);
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
      {a.mediaType === "image/png" && a.state !== "uploading" && (
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
