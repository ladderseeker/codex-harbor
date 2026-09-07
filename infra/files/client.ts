import { request } from "node:http";
import type { FileCommand } from "../../packages/files/src/types.ts";
export function readWorkspaceFile(command: FileCommand): Promise<any> {
  const socketPath =
    process.env.HARBOR_FILE_SOCKET ?? process.env.HARBOR_STORAGE_SOCKET;
  if (!socketPath) return Promise.reject(Error("File service unavailable"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        req.destroy();
        reject(error);
      } else resolve(value);
    };
    const req = request(
      {
        socketPath,
        path: "/files",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        let body = Buffer.alloc(0);
        res.on("data", (chunk) => {
          body = Buffer.concat([body, chunk]);
          if (body.length > 23000000) finish(Error("File response limit"));
        });
        res.on("error", () => finish(Error("File service unavailable")));
        res.on("aborted", () => finish(Error("File service unavailable")));
        res.on("close", () => {
          if (!res.complete) finish(Error("File response incomplete"));
        });
        res.on("end", () => {
          try {
            const value = JSON.parse(body.toString());
            if (res.statusCode !== 200)
              throw Object.assign(Error("File inspection unavailable"), {
                code: value.code ?? "FILE_UNAVAILABLE",
              });
            finish(undefined, value);
          } catch (error) {
            finish(error as Error);
          }
        });
      },
    );
    const timer = setTimeout(
      () => finish(Error("File service deadline exceeded")),
      30000,
    );
    req.on("error", () => finish(Error("File service unavailable")));
    req.end(JSON.stringify(command));
  });
}
