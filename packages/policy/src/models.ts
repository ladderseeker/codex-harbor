import type { PoolClient } from "pg";
import { HarborError } from "./index.ts";
export async function effectiveSettings(
  db: PoolClient,
  model: string,
  effort: string,
  models: string[],
) {
  const discovered =
    (
      await db.query(
        "SELECT data FROM runtime_capabilities WHERE updated_at>now()-interval '1 hour'",
      )
    ).rows[0]?.data?.data ?? [];
  const selected = discovered.find(
    (candidate: any) => (candidate.model ?? candidate.id) === model,
  );
  if (!models.includes(model) || !selected)
    throw new HarborError(
      403,
      "MODEL_DENIED",
      "Model is not in current discovered capabilities and administrator policy",
    );
  if (
    !(selected.supportedReasoningEfforts ?? []).some(
      (entry: any) => entry.reasoningEffort === effort,
    )
  )
    throw new HarborError(
      403,
      "EFFORT_DENIED",
      "Reasoning effort is unavailable for this model",
    );
}
