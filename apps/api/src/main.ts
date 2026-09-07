import { buildServer } from "./server.ts";
import { config } from "./config.ts";
const c = config();
const app = await buildServer(c);
await app.listen({ host: c.HARBOR_HOST, port: c.HARBOR_PORT });
for (const s of ["SIGINT", "SIGTERM"] as const)
  process.on(s, () => void app.close());
