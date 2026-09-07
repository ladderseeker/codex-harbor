import { request } from "node:http";
export type ManagedProject = {
  canonical: string;
  device: string;
  inode: string;
};
export async function managedStorageCall<T = ManagedProject>(
  action: string,
  rootId: string,
  relativePath: string,
  totalDeadlineMs = 15000,
): Promise<T> {
  const socketPath = process.env.HARBOR_STORAGE_SOCKET;
  if (!socketPath)
    throw Error("Managed Linux storage provisioning unavailable");
  if (
    !Number.isSafeInteger(totalDeadlineMs) ||
    totalDeadlineMs < 50 ||
    totalDeadlineMs > 15000
  )
    throw Error("Invalid storage deadline");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        req.destroy();
        reject(error);
      } else resolve(value!);
    };
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
          if (Buffer.byteLength(body) > 8192)
            finish(Error("Storage response limit"));
        });
        res.on("aborted", () => finish(Error("Storage response aborted")));
        res.on("error", () => finish(Error("Storage response failed")));
        res.on("close", () => {
          if (!res.complete) finish(Error("Storage response incomplete"));
        });
        res.on("end", () => {
          try {
            if (res.statusCode !== 200)
              throw Error("Managed project quota or runner access unavailable");
            finish(undefined, JSON.parse(body));
          } catch (error) {
            finish(
              error instanceof Error
                ? error
                : Error("Invalid storage response"),
            );
          }
        });
      },
    );
    const deadline = setTimeout(
      () => finish(Error("Storage total deadline exceeded")),
      totalDeadlineMs,
    );
    req.setTimeout(Math.min(10000, totalDeadlineMs), () =>
      finish(Error("Storage provisioning inactive")),
    );
    req.on("error", () => finish(Error("Storage service unavailable")));
    req.end(JSON.stringify({ action, rootId, relativePath }));
  });
}
export const createManagedProject = (rootId: string, relativePath: string) =>
  managedStorageCall("allocate", rootId, relativePath);
export const validateManagedProject = (rootId: string, relativePath: string) =>
  managedStorageCall("validate", rootId, relativePath);

export const clearManagedCredentials = (rootId: string, relativePath: string) =>
  managedStorageCall<{ removedCount: number }>(
    "clearCredentials",
    rootId,
    relativePath,
  );

export type ManagedStorageUsage = {
  status: "known";
  usedBytes: number;
  byteLimit: number;
  usedInodes: number;
  inodeLimit: number;
};
export const inspectManagedStorage = (rootId: string, relativePath: string) =>
  managedStorageCall<ManagedStorageUsage>("inspect", rootId, relativePath);
