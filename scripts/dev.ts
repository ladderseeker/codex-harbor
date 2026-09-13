import { spawn, execFileSync } from "node:child_process";
const fixture = process.argv.includes("--fixture");
if (fixture && process.argv.includes("--local"))
  throw Error("Choose --fixture or --local");
if (process.argv.includes("--local")) {
  await import("./local-dev.ts");
} else if (fixture) {
  execFileSync("pnpm", ["build"], { stdio: "inherit" });
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "tests/e2e/run.ts", "--serve"],
    { stdio: "inherit", env: process.env },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  if (!process.env.DATABASE_URL || !process.env.HARBOR_ORIGIN) {
    console.error(
      "Configured development requires DATABASE_URL, HARBOR_ORIGIN and owner/OIDC/project configuration. For an isolated disposable local instance run pnpm dev --fixture.",
    );
    process.exitCode = 1;
  } else {
    const children = [
      "apps/api/src/main.ts",
      "apps/supervisor/src/main.ts",
    ].map((file) =>
      spawn(process.execPath, ["--import", "tsx", file], {
        stdio: "inherit",
        env: process.env,
      }),
    );
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => children.forEach((p) => p.kill(signal)));
    for (const child of children)
      child.on("exit", (code) => {
        children.forEach((p) => {
          if (p !== child) p.kill("SIGTERM");
        });
        process.exitCode = code ?? 1;
      });
  }
}
