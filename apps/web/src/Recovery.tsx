import { useEffect, useState } from "react";
import { request, newIntent, type Intent } from "./api.ts";
interface Result {
  generation: number;
  cursor: number;
  unresolvedOperations: { id: string; state: string }[];
  recovery: null | {
    id: string;
    state: string;
    generation: number | null;
    attempt: number;
    attemptsRemaining: number;
    report: {
      status: string;
      reason?: string;
      repairedItems?: number;
      conflicts?: number;
      truncated?: boolean;
    };
  };
}
export function Recovery({
  id,
  cursor,
  disabled,
  settings,
  execute,
}: {
  id: string;
  cursor: number;
  disabled: boolean;
  settings: { model: string; effort: string; permissionProfile: string };
  execute(intent: Intent, complete?: (result: unknown) => void): Promise<void>;
}) {
  const [result, setResult] = useState<Result>(),
    [error, setError] = useState(""),
    [text, setText] = useState(""),
    [ack, setAck] = useState(false);
  useEffect(() => {
    let current = true;
    const read = () =>
      request<Result>(`/sessions/${id}/recovery`).then(
        (r) => {
          if (current) {
            setResult(r);
            setError("");
          }
        },
        (e) => {
          if (current) setError(e.message);
        },
      );
    void read();
    const timer = setInterval(() => void read(), 1500);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [id, cursor]);
  const r = result?.recovery;
  return (
    <section
      className="state-explanation recovery"
      aria-label="Recover uncertain conversation"
    >
      <h2>The outcome is uncertain</h2>
      <p>
        Some work may have happened. The original request stays recorded as
        uncertain and will never be sent again automatically.
      </p>
      {error && <p role="alert">{error}</p>}
      {!result ? (
        <p>Loading recovery status…</p>
      ) : (
        <>
          <p>
            {result.unresolvedOperations.length} unresolved operation(s).
            Confirmed history cursor {result.cursor}.
          </p>
          {(!r ||
            (r.state === "consumed" &&
              result.unresolvedOperations.length > 0)) && (
            <button
              disabled={disabled}
              onClick={() =>
                void execute(
                  newIntent(
                    `/sessions/${id}/recovery`,
                    { expectedGeneration: result.generation },
                    "Fence and inspect conversation",
                  ),
                )
              }
            >
              Fence old runtime and inspect history
            </button>
          )}
          {r && (
            <>
              <p role="status">
                Recovery: {r.state}. Attempt {r.attempt} of 3.
              </p>
              {r.report.reason && <p>{r.report.reason}</p>}
              {r.report.status === "available" && (
                <p>
                  Native history inspected. {r.report.repairedItems ?? 0}{" "}
                  item(s) repaired; {r.report.conflicts ?? 0} conflicting
                  item(s) preserved without replacement.
                  {r.report.truncated &&
                    " The native projection was truncated."}
                </p>
              )}
              {["queued", "fencing"].includes(r.state) && (
                <p>
                  Confirming that the old runtime and its processes have
                  retired. New work remains blocked.
                </p>
              )}
              {r.state === "failed" &&
                (r.attemptsRemaining > 0 ? (
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void execute(
                        newIntent(
                          `/sessions/${id}/recovery`,
                          {
                            recoveryId: r.id,
                            expectedGeneration: result.generation,
                            expectedAttempt: r.attempt,
                          },
                          "Retry runtime fencing",
                        ),
                      )
                    }
                  >
                    Retry fencing deliberately
                  </button>
                ) : (
                  <p>
                    Recovery attempts are exhausted. Work remains blocked; use
                    the documented administrator recovery procedure.
                  </p>
                ))}
              {r.state === "ready" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!ack || !text.trim()) return;
                    void execute(
                      newIntent(
                        `/sessions/${id}/recovery/continue`,
                        {
                          recoveryId: r.id,
                          expectedGeneration: r.generation,
                          acknowledgeUnknownEffects: true,
                          text,
                          ...settings,
                        },
                        "Start acknowledged new operation",
                      ),
                      () => {
                        setText("");
                        setAck(false);
                      },
                    );
                  }}
                >
                  <p>
                    The old runtime is fenced. Review files and retained history
                    before authorizing new work. This does not establish what
                    the old operation changed.
                  </p>
                  <label className="recovery-ack">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    I understand that unknown effects may remain and authorize a
                    separate new operation.
                  </label>
                  <label className="field">
                    New instructions after recovery
                    <textarea
                      value={text}
                      maxLength={32768}
                      onChange={(e) => setText(e.target.value)}
                      rows={4}
                    />
                  </label>
                  <button
                    disabled={disabled || !ack || !text.trim()}
                    type="submit"
                  >
                    Start new operation after recovery
                  </button>
                  <p>
                    Normal new-work capacity limits still apply. You can leave
                    this conversation stopped.
                  </p>
                </form>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
