import { xfsFixture } from "../isolation/xfs-fixture.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sourceDigest } from "../../scripts/source-digest.ts";
const source = sourceDigest();
const fixture = await xfsFixture();
try {
  const result = await promisify(execFile)(
    "python3",
    ["tests/deployment/publication.py", fixture.control + "/manifest.json"],
    { timeout: 120000, env: fixture.env },
  );
  console.log(JSON.stringify({ source, result: JSON.parse(result.stdout) }));
} finally {
  await fixture.cleanup();
}
