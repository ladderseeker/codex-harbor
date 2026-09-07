/** Shared local topology for development and deterministic verification. */
export const localComposeFiles = (): string[] =>
  process.platform === "linux"
    ? ["-f", "infra/compose.yaml", "-f", "infra/compose.linux.yaml"]
    : ["-f", "infra/compose.yaml"];
