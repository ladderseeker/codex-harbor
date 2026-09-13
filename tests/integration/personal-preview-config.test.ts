import { test } from "node:test";
import assert from "node:assert/strict";
import { personalPreviewConfig } from "../../apps/api/src/personal-preview-config.ts";
test("personal preview configuration excludes control listeners and shared owner origin", () => {
  const parse = (entry: unknown[]) =>
    personalPreviewConfig(
      JSON.stringify(entry),
      "https://harbor.example",
      [3348, 3350, 5548],
    );
  const valid = { name: "App", port: 3100, origin: "https://preview.example" };
  assert.equal(parse([valid])[0].port, 3100);
  for (const port of [3348, 3350, 5548, 80, 65536])
    assert.throws(() => parse([{ ...valid, port }]));
  for (const origin of [
    "https://harbor.example",
    "https://harbor.example:8443",
    "http://preview.example",
    "https://preview.example/path",
    "https://u:p@preview.example",
  ])
    assert.throws(() => parse([{ ...valid, origin }]));
  assert.throws(() => parse([valid, valid]));
  assert.throws(() =>
    parse([{ ...valid, destination: "http://169.254.169.254" }]),
  );
});
