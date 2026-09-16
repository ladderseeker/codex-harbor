import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icons.tsx";

/** Clipboard writes always use source text, never rendered DOM text. */
export function CopyButton({
  text,
  label = "Copy message",
}: {
  text: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "pending" | "copied" | "failed">(
    "idle",
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const statusId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  async function copy() {
    clearTimeout(timer.current);
    setState("pending");
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (!mounted.current) return;
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      if (mounted.current) setState("failed");
    }
  }
  return (
    <span className="copy-control">
      <button
        type="button"
        className="icon-button"
        onClick={() => void copy()}
        disabled={state === "pending"}
        aria-label={state === "copied" ? "Copied" : label}
        title={state === "copied" ? "Copied" : label}
        aria-describedby={state === "failed" ? statusId : undefined}
      >
        <Icon name={state === "copied" ? "check" : "copy"} />
      </button>
      <span
        id={statusId}
        role="status"
        className={state === "failed" ? "copy-feedback" : "sr-only"}
      >
        {state === "failed"
          ? "Copy failed. Select the text and copy it manually."
          : state === "copied"
            ? "Copied"
            : ""}
      </span>
    </span>
  );
}

/** Votes deliberately live only in this mounted component; no storage or requests. */
export function MessageActions({
  text,
  assistant = false,
}: {
  text: string;
  assistant?: boolean;
}) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  return (
    <div
      className="message-actions"
      role="group"
      aria-label={assistant ? "Response actions" : "Message actions"}
    >
      <CopyButton
        text={text}
        label={assistant ? "Copy response" : "Copy message"}
      />
      {assistant && (
        <>
          <button
            type="button"
            className="icon-button"
            aria-label="Like response"
            title="Like response"
            aria-pressed={vote === "up"}
            onClick={() => setVote(vote === "up" ? null : "up")}
          >
            <Icon name="thumb-up" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Dislike response"
            title="Dislike response"
            aria-pressed={vote === "down"}
            onClick={() => setVote(vote === "down" ? null : "down")}
          >
            <Icon name="thumb-down" />
          </button>
        </>
      )}
    </div>
  );
}
