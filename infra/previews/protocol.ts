import type { HeaderPairs } from "../../packages/previews/src/http-policy.ts";
export const FRAME_BYTES = 96 * 1024;
export const DATA_BYTES = 48 * 1024;
export type RelayInput =
  | {
      type: "request";
      id: string;
      method: string;
      path: string;
      headers: HeaderPairs;
    }
  | { type: "body"; id: string; data: string }
  | { type: "end"; id: string }
  | { type: "close"; id: string }
  | { type: "websocket"; id: string; path: string; headers: HeaderPairs }
  | { type: "message"; id: string; data: string; binary: boolean };
export type RelayOutput =
  | { type: "ready" }
  | {
      type: "head";
      id: string;
      status: number;
      headers: HeaderPairs;
      streaming: boolean;
    }
  | { type: "data"; id: string; data: string }
  | { type: "end"; id: string }
  | { type: "error"; id: string; code: string }
  | { type: "websocket"; id: string }
  | { type: "message"; id: string; data: string; binary: boolean };
export function bytes(value: unknown, maximum = DATA_BYTES) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(maximum / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw Error("Invalid relay bytes");
  const result = Buffer.from(value, "base64");
  if (result.length > maximum) throw Error("Relay message limit");
  return result;
}
/** Rolling per-connection budget; hostile tiny-frame floods also have finite metadata. */
export class StreamBudget {
  private rows: { at: number; bytes: number }[] = [];
  private used = 0;
  take(count: number) {
    const now = Date.now();
    while (this.rows.length && this.rows[0].at <= now - 60000)
      this.used -= this.rows.shift()!.bytes;
    if (this.rows.length >= 4096 || this.used + count > 2 * 1024 * 1024)
      throw Error("Preview stream rate limit");
    this.rows.push({ at: now, bytes: count });
    this.used += count;
  }
}
