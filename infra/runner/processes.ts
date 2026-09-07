import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export type ProcessInspection = {
  status: "known" | "unavailable" | "runtime_gone";
  generation?: number;
  processes: { pid: number; executable: string }[];
};
export async function inspectRunnerProcesses(config: {
  instanceId?: string;
  sessionId: string;
  generation: number;
}): Promise<ProcessInspection> {
  const unavailable: ProcessInspection = {
    status: "unavailable",
    generation: config.generation,
    processes: [],
  };
  if (
    !/^[a-z0-9_-]{1,64}$/.test(config.sessionId) ||
    !Number.isSafeInteger(config.generation)
  )
    return unavailable;
  const name = `harbor-${config.instanceId ?? "local"}-${config.sessionId}-${config.generation}`;
  try {
    const ids = await exec(
      "docker",
      ["ps", "-aq", "--filter", `name=^/${name}$`],
      { timeout: 5000, maxBuffer: 4096 },
    );
    if (!ids.stdout.trim()) return { ...unavailable, status: "runtime_gone" };
    const inspected = JSON.parse(
      (
        await exec(
          "docker",
          [
            "inspect",
            "--format",
            '{"Labels":{{json .Config.Labels}},"Running":{{json .State.Running}}}',
            name,
          ],
          {
            timeout: 5000,
            maxBuffer: 16384,
          },
        )
      ).stdout,
    );
    if (
      inspected.Labels?.["org.codex-harbor.owner"] !== "runner" ||
      inspected.Labels?.["org.codex-harbor.instance"] !==
        (config.instanceId ?? "local")
    )
      return unavailable;
    if (!inspected.Running) return { ...unavailable, status: "runtime_gone" };
    const script =
      "const f=require('fs'),p=require('path');const out=[];for(const name of f.readdirSync('/proc')){if(!/^[0-9]+$/.test(name)||Number(name)===process.pid)continue;try{const executable=p.basename(f.readlinkSync('/proc/'+name+'/exe')).replace(/[^a-zA-Z0-9_.-]/g,'?').slice(0,64);out.push({pid:Number(name),executable});}catch{}if(out.length>=128)break;}process.stdout.write(JSON.stringify(out));";
    const result = JSON.parse(
      (
        await exec("docker", ["exec", name, "node", "-e", script], {
          timeout: 5000,
          maxBuffer: 16384,
        })
      ).stdout,
    );
    if (!Array.isArray(result) || result.length > 128) return unavailable;
    return {
      status: "known",
      generation: config.generation,
      processes: result,
    };
  } catch {
    return unavailable;
  }
}
