import type { ProcessInspection } from "../../../infra/runner/processes.ts";
export type IdleClassification = "idle" | "protected" | "unknown" | "gone";
/** Only the launcher may exclude its two exact live identities. No descendant allowlist. */
export function classifyIdle(
  inspection: ProcessInspection,
  generation: number,
): IdleClassification {
  if (inspection.generation !== generation) return "unknown";
  if (inspection.status === "runtime_gone") return "gone";
  if (inspection.status !== "known") return "unknown";
  return inspection.processes.length ? "protected" : "idle";
}
export function capacityReason(states: string[]) {
  if (states.some((state) => state === "unknown" || state === "retiring"))
    return "retirement_unknown" as const;
  if (states.some((state) => state === "protected"))
    return "protected_capacity" as const;
  return "runtime_capacity" as const;
}
