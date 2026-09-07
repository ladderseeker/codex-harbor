import { createConnection } from "node:net";
import { HarborError } from "./index.ts";
export async function credentialCommand(
  socketPath: string | undefined,
  request: unknown,
): Promise<unknown> {
  if (!socketPath)
    throw new HarborError(
      503,
      "CREDENTIAL_STORE_UNAVAILABLE",
      "Supervisor credential service is not configured",
    );
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let body = "",
      settled = false;
    const done = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const unavailable = () =>
      done(
        new HarborError(
          503,
          "CREDENTIAL_UNAVAILABLE",
          "Supervisor credential response unavailable",
          true,
        ),
      );
    const deadline = setTimeout(unavailable, 90000);
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("data", (chunk) => {
      body += chunk.toString();
      if (Buffer.byteLength(body) > 8192) {
        unavailable();
        return;
      }
      if (body.includes("\n")) {
        try {
          const response = JSON.parse(body);
          if (response.error)
            done(
              new HarborError(
                response.error.status,
                response.error.code,
                response.error.message,
              ),
            );
          else done(undefined, response.result);
        } catch {
          unavailable();
        }
      }
    });
    socket.on("error", unavailable);
    socket.on("end", () => {
      if (!settled) unavailable();
    });
    socket.on("close", () => {
      if (!settled) unavailable();
    });
  });
}
