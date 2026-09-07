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
