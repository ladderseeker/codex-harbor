import { request } from "node:http";
import type {
  WorkspaceCommand,
  WorkspaceProvision,
} from "../../packages/workspaces/src/types.ts";
export function workspaceCommand(
  command: WorkspaceCommand,
  totalDeadlineMs = 45000,
): Promise<WorkspaceProvision & { dirty?: boolean; removed?: boolean }> {
  const socketPath = process.env.HARBOR_STORAGE_SOCKET;
  if (!socketPath)
    return Promise.reject(Error("Managed workspace service unavailable"));
  if (
    !Number.isSafeInteger(totalDeadlineMs) ||
    totalDeadlineMs < 50 ||
    totalDeadlineMs > 45000
  )
    return Promise.reject(Error("Invalid storage deadline"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        req.destroy();
        reject(error);
      } else resolve(value);
    };
    const req = request(
      {
        socketPath,
        path: "/workspace",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
          if (Buffer.byteLength(body) > 16384)
            finish(Error("Workspace result limit"));
        });
        res.on("aborted", () =>
          finish(Error("Workspace service response aborted")),
        );
        res.on("error", () =>
          finish(Error("Workspace service response failed")),
        );
        res.on("close", () => {
          if (!res.complete)
            finish(Error("Workspace service response incomplete"));
        });
        res.on("end", () => {
          try {
            const value = JSON.parse(body);
            if (res.statusCode !== 200)
              throw Object.assign(
                Error("Managed workspace operation unavailable"),
                {
                  code:
                    value.code === "WORKSPACE_STORAGE_FAILED"
                      ? "WORKSPACE_STORAGE_FAILED"
                      : "WORKSPACE_STORAGE_UNAVAILABLE",
                },
              );
            finish(undefined, value);
          } catch (error) {
            finish(
              error instanceof Error
                ? error
                : Error("Invalid workspace response"),
            );
          }
        });
      },
    );
    const deadline = setTimeout(
      () => finish(Error("Workspace service total deadline exceeded")),
      totalDeadlineMs,
    );
    req.on("error", () => finish(Error("Workspace service unavailable")));
    req.setTimeout(Math.min(10000, totalDeadlineMs), () =>
      finish(Error("Workspace service inactive")),
    );
    req.end(JSON.stringify(command));
  });
}
