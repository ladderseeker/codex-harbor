import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HarborError } from "../../../packages/policy/src/index.ts";
import { listProjectDirectories } from "../../../packages/workspaces/src/directories.ts";
import type { Config } from "./config.ts";

export function projectBrowsingCapability(
  c: Pick<Config, "HARBOR_LOCAL_MODE" | "HARBOR_FIXTURE_MODE">,
) {
  const available =
    !!(c.HARBOR_LOCAL_MODE || c.HARBOR_FIXTURE_MODE) &&
    !process.env.HARBOR_STORAGE_SOCKET &&
    !process.env.HARBOR_MANAGED_RELEASE;
  return {
    available,
    reason: available
      ? null
      : "Folder browsing is available only in a local instance. Enter a path relative to an approved root.",
  };
}
/** Registered inside the server's owner-authenticated, bearer-denied boundary. */
export function projectDirectoryRoutes(app: FastifyInstance, c: Config) {
  app.get("/api/v1/project-roots/:id/directories", async (req) => {
    if (!projectBrowsingCapability(c).available)
      throw new HarborError(
        403,
        "PROJECT_BROWSING_UNAVAILABLE",
        "Folder browsing is unavailable in this installation",
      );
    const { id } = z
      .object({ id: z.string().min(1).max(200) })
      .parse(req.params);
    const { path } = z
      .object({ path: z.string().max(2048).default("") })
      .strict()
      .parse(req.query);
    return listProjectDirectories(c.roots, id, path);
  });
}
