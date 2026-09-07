import type { Pool, PoolClient } from "pg";
import { HarborError } from "../../../packages/policy/src/index.ts";
import {
  requireAuthority,
  type Authority,
  type AuthorityConfig,
  type Scope,
} from "../../../packages/policy/src/authority.ts";
export type TokenRoutePolicy = {
  scope: Scope | ((db: Pool | PoolClient, req: any) => Promise<Scope>);
  resource: (
    db: Pool | PoolClient,
    req: any,
  ) => Promise<{ projectId: string; permissionProfile?: string }>;
};
const extensions = new Map<string, TokenRoutePolicy>();
/** Later delivered facade modules must register an explicit resource resolver. */
export function registerProgrammaticRoute(
  method: string,
  path: string,
  policy: TokenRoutePolicy,
) {
  const key = method.toUpperCase() + " " + path;
  if (extensions.has(key)) throw Error("Duplicate programmatic route policy");
  extensions.set(key, policy);
}
/** Explicit facade allowlist: new endpoints remain browser-only until registered. */
export async function authorizeTokenRoute(
  db: Pool | PoolClient,
  c: AuthorityConfig,
  authority: Authority,
  req: any,
) {
  if (authority.kind !== "token") return;
  const route = req.routeOptions.url,
    method = req.method;
  const extension = extensions.get(method + " " + route);
  if (extension) {
    const resource = await extension.resource(db, req);
    await requireAuthority(db, authority.hash, c, {
      scope:
        typeof extension.scope === "function"
          ? await extension.scope(db, req)
          : extension.scope,
      ...resource,
    });
    return;
  }
  let scope: Scope = "read",
    projectId: string | undefined,
    profile: string | undefined;
  if (
    method === "GET" &&
    [
      "/api/v1/openapi.json",
      "/api/v1/capabilities",
      "/api/v1/projects",
      "/api/v1/sessions",
    ].includes(route)
  ) {
  } else if (method === "POST" && route === "/api/v1/sessions") {
    scope = "execute";
    projectId = req.body?.projectId;
    profile = req.body?.permissionProfile;
  } else {
    let sql: string;
    if (
      ["/api/v1/sessions/:id/snapshot", "/api/v1/sessions/:id/events"].includes(
        route,
      ) &&
      method === "GET"
    )
      sql = "SELECT project_id,permission_profile FROM sessions WHERE id=$1";
    else if (route === "/api/v1/sessions/:id/turns" && method === "POST") {
      scope = "execute";
      profile = req.body?.permissionProfile;
      sql = "SELECT project_id,permission_profile FROM sessions WHERE id=$1";
    } else if (route === "/api/v1/operations/:id" && method === "GET")
      sql =
        "SELECT s.project_id,s.permission_profile FROM sessions s JOIN operations o ON o.session_id=s.id WHERE o.id=$1";
    else if (route === "/api/v1/turns/:id/cancel" && method === "POST") {
      scope = "cancel";
      sql =
        "SELECT s.project_id,s.permission_profile FROM sessions s JOIN operations o ON o.session_id=s.id WHERE o.id=$1";
    } else if (route === "/api/v1/approvals/:id/answer" && method === "POST") {
      scope = "approve";
      sql =
        "SELECT s.project_id,s.permission_profile FROM sessions s JOIN approvals a ON a.session_id=s.id WHERE a.id=$1";
    } else
      throw new HarborError(
        403,
        "TOKEN_ROUTE_DENIED",
        "This route requires owner browser authority",
      );
    const resource = (await db.query(sql, [req.params.id])).rows[0];
    if (!resource)
      throw new HarborError(404, "NOT_FOUND", "Resource not found");
    projectId = resource.project_id;
    if (scope === "approve") profile = resource.permission_profile;
  }
  if (scope !== "read" && !projectId)
    throw new HarborError(400, "INVALID_RESOURCE", "Project is required");
  await requireAuthority(db, authority.hash, c, {
    scope,
    projectId,
    permissionProfile: profile,
  });
}
