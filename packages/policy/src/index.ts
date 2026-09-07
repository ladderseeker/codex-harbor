import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  RETRY_WINDOW_MS,
  type PermissionProfile,
} from "../../contracts/src/index.ts";
export class HarborError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function checkKey(key: unknown, now = Date.now()) {
  if (typeof key !== "string" || !/^\d{13}:[0-9a-f-]{36}$/i.test(key))
    throw new HarborError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Use <unixMs>:<uuid> as Idempotency-Key",
    );
  const age = now - Number(key.split(":")[0]);
  if (age < -300000 || age > RETRY_WINDOW_MS)
    throw new HarborError(
      409,
      "EXPIRED_INTENT",
      "Retry window expired; explicitly submit a new intent",
    );
}
export function authorizePermission(
  requested: PermissionProfile,
  ceiling: PermissionProfile,
) {
  if (requested === "workspace-write" && ceiling === "read-only")
    throw new HarborError(
      403,
      "PERMISSION_CEILING",
      "Permission exceeds administrator ceiling",
    );
}
export function requireOrigin(origin: unknown, expected: string) {
  if (origin !== expected)
    throw new HarborError(
      403,
      "ORIGIN_DENIED",
      "Exact application Origin required",
    );
}
