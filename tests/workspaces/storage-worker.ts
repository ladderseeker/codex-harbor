import { executeWorkspace } from "../../infra/storage/workspace-service.ts";
let body = "";
for await (const chunk of process.stdin) {
  body += chunk;
  if (body.length > 8192) throw Error("Input limit");
}
await executeWorkspace(JSON.parse(body), true);
