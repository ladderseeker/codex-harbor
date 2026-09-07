import { request } from "node:http";
export type ManagedProject = {
  canonical: string;
  device: string;
  inode: string;
};
async function call<T = ManagedProject>(
  action: string,
  rootId: string,
  relativePath: string,
): Promise<T> {
  const socketPath = process.env.HARBOR_STORAGE_SOCKET;
  if (!socketPath)
    throw Error("Managed Linux storage provisioning unavailable");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: "/",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 8192) req.destroy(Error("Storage response limit"));
        });
        res.on("end", () => {
          try {
            if (res.statusCode !== 200)
              throw Error("Managed project quota or runner access unavailable");
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(15_000, () =>
      req.destroy(Error("Storage provisioning timeout")),
    );
    req.on("error", reject);
    req.end(JSON.stringify({ action, rootId, relativePath }));
  });
}
export const createManagedProject = (rootId: string, relativePath: string) =>
  call("allocate", rootId, relativePath);
export const validateManagedProject = (rootId: string, relativePath: string) =>
  call("validate", rootId, relativePath);

export const clearManagedCredentials = (rootId: string, relativePath: string) =>
  call<{ removedCount: number }>("clearCredentials", rootId, relativePath);

export type ManagedStorageUsage = {
  status: "known";
  usedBytes: number;
  byteLimit: number;
  usedInodes: number;
  inodeLimit: number;
};
export const inspectManagedStorage = (rootId: string, relativePath: string) =>
  call<ManagedStorageUsage>("inspect", rootId, relativePath);
