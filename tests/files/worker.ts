import { createServer } from "node:http";
import { chmod, unlink } from "node:fs/promises";
import { executeFile } from "../../infra/files/service.ts";
if (
  process.env.NODE_ENV !== "test" ||
  process.env.HARBOR_FIXTURE_MODE !== "private-test" ||
  !process.env.HARBOR_FILE_SOCKET
)
  throw Error("Private file-service fixture configuration required");
const socket = process.env.HARBOR_FILE_SOCKET;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) req.destroy();
  });
  req.on("end", () => {
    let command;
    try {
      command = JSON.parse(body);
      if (
        req.url !== "/files" ||
        !["tree", "search", "content", "download", "status", "diff"].includes(
          command.action,
        )
      )
        throw Error();
    } catch {
      res.writeHead(400).end();
      return;
    }
    void executeFile(command, true)
      .then((result) =>
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(result)),
      )
      .catch((error) =>
        res
          .writeHead(409, { "content-type": "application/json" })
          .end(JSON.stringify({ code: error.code ?? "FILE_UNAVAILABLE" })),
      );
  });
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(socket, resolve);
});
await chmod(socket, 0o600);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () =>
    server.close(() => void unlink(socket).catch(() => {})),
  );
