export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
    });
  } catch {
    throw new ApiError(
      "Connection lost. The request may have reached Harbor. Reconnect before retrying.",
      0,
    );
  }
  let body: Record<string, any>;
  try {
    body = response.status === 204 ? {} : await response.json();
  } catch {
    throw new ApiError(
      "Harbor returned an unreadable response. The request may have been accepted; retry the same request to check.",
      response.ok ? 0 : response.status,
    );
  }
  if (!response.ok) {
    const error = body.error ?? body;
    throw new ApiError(
      typeof error === "string"
        ? error
        : (error.message ?? "The request could not be completed."),
      response.status,
      error.code,
      error.requestId ?? body.requestId,
    );
  }
  return body as T;
}

export type Intent = {
  path: string;
  body: unknown;
  key: string;
  label: string;
  method?: "POST" | "DELETE" | "PUT" | "PATCH";
};
export const newIntent = (
  path: string,
  body: unknown,
  label: string,
): Intent => ({
  path,
  body,
  label,
  key: `${Date.now()}:${crypto.randomUUID()}`,
});

export function mutate<T>(intent: Intent, csrf: string): Promise<T> {
  return request<T>(intent.path, {
    method: intent.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      "Idempotency-Key": intent.key,
    },
    body: JSON.stringify(intent.body),
  });
}

export const runtimeNames: Record<string, string> = {
  starting: "Starting runtime",
  active: "Runtime active",
  waiting_approval: "Runtime waiting for approval",
  waiting_input: "Runtime waiting for your answer",
  idle: "Runtime idle",
  protected: "Background processes retained",
  retiring: "Stopping runtime",
  unknown: "Runtime state unknown",
};
export function confirmedRuntime(runtime?: { state: string } | null) {
  return (
    !!runtime &&
    [
      "active",
      "waiting_approval",
      "waiting_input",
      "idle",
      "protected",
    ].includes(runtime.state)
  );
}
export function runtimeDescription(runtime: {
  state: string;
  idleUntil: string | null;
}) {
  switch (runtime.state) {
    case "idle":
      return `Runtime idle. It may be reclaimed earlier for capacity${runtime.idleUntil ? `; retention target ends at ${new Date(runtime.idleUntil).toLocaleTimeString()}` : "; maximum retention target is 30 minutes"}.`;
    case "protected":
      return "Background processes retained. No automatic expiry while protected.";
    case "unknown":
      return "Runtime state unknown. Capacity remains reserved; no automatic expiry. Stop this conversation’s retained processes to request confirmed retirement.";
    case "retiring":
      return "Stopping runtime. Capacity remains reserved until processes are confirmed stopped.";
    case "starting":
      return "Starting runtime. Capacity is reserved.";
    default:
      return `${runtimeNames[runtime.state] ?? "Runtime status unavailable"}.`;
  }
}
export function queueDescription(reason?: string | null) {
  const descriptions: Record<string, string> = {
    session_busy: "Waiting for this conversation’s current turn.",
    active_capacity: "Waiting for an active-turn slot.",
    runtime_capacity: "Waiting for runtime capacity.",
    protected_capacity:
      "Waiting for capacity held by active or protected resources.",
    retirement_unknown: "Waiting for runtime retirement to be confirmed.",
    workspace_busy: "Waiting for the workspace reservation.",
    maintenance: "Waiting for maintenance to finish.",
  };
  return reason
    ? (descriptions[reason] ?? "Waiting to start…")
    : "Waiting to start…";
}
