import test from "node:test";
import assert from "node:assert/strict";
import {
  validateMedia,
  safeName,
} from "../../packages/attachments/src/media.ts";
import { png, highBitPng } from "../fixtures/png.ts";
test("attachment PNG parser validates pixels and strips ancillary content", () => {
  assert.deepEqual(validateMedia(png(true), "image/png"), png());
  assert.throws(() => validateMedia(highBitPng(), "image/png"));
  const corrupt = png();
  corrupt[30] ^= 1;
  assert.throws(() => validateMedia(corrupt, "image/png"));
  assert.throws(() =>
    validateMedia(Buffer.concat([png(), Buffer.from("<script>")]), "image/png"),
  );
  assert.throws(() =>
    validateMedia(Buffer.from('<svg onload="x"/>'), "image/png"),
  );
});
test("attachment text is bounded UTF-8 and never interpreted as markup", () => {
  const hostile = Buffer.from("<script>alert(1)</script>");
  assert.equal(validateMedia(hostile, "text/plain"), hostile);
  assert.throws(() => validateMedia(Buffer.from([0xc0, 0xaf]), "text/plain"));
  assert.throws(() => validateMedia(Buffer.from([0]), "text/plain"));
  assert.throws(() => validateMedia(Buffer.alloc(65537, 65), "text/plain"));
  assert.equal(safeName("../../a\u202e.txt"), ".._.._a_.txt");
});
