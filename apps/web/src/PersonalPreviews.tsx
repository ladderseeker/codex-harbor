import { useState } from "react";
import { mutate, newIntent } from "./api.ts";
export type PersonalPreviewEndpoint = {
  name: string;
  port: number;
  origin: string;
};
export function PersonalPreviews({
  endpoints,
  workspaceId,
  csrfToken,
}: {
  endpoints: PersonalPreviewEndpoint[];
  workspaceId: string;
  csrfToken: string;
}) {
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  async function open(port: number) {
    setPending(port);
    setError("");
    setOpening(null);
    try {
      const result = await mutate<{ bootstrapPath: string }>(
        newIntent(
          "/personal-preview-openings",
          { workspaceId, port },
          "Open development preview",
        ),
        csrfToken,
      );
      setOpening(result.bootstrapPath);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not open preview",
      );
    } finally {
      setPending(null);
    }
  }
  if (!endpoints.length) return null;
  return (
    <section className="panel" aria-label="Development preview">
      <h3>Development preview</h3>
      <p>
        Ask Codex to start your app on the localhost port below. This opens an
        existing server; ask Codex to stop it when finished.
      </p>
      <p>
        The port is shared by your VPS projects. Check that it is serving the
        project you intend to view.
      </p>
      {endpoints.map((entry) => (
        <button
          key={entry.port}
          disabled={pending !== null}
          onClick={() => void open(entry.port)}
        >
          {pending === entry.port
            ? "Preparing…"
            : `${entry.name} · 127.0.0.1:${entry.port}`}
        </button>
      ))}
      {opening && (
        <p>
          <a href={opening} target="_blank" rel="noopener noreferrer">
            Open private preview ↗
          </a>{" "}
          · Link expires in 30 seconds. Prepare again if expired.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
