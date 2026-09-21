import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  validateMedia,
  safeName,
  ATTACHMENT_LIMITS,
} from "../../packages/attachments/src/media.ts";
import { png, highBitPng } from "../fixtures/png.ts";
test("PNG/JPEG decoding normalizes pixels and strips metadata", async () => {
  const normalized = await validateMedia(png(true), "image/png");
  assert.deepEqual(
    await sharp(normalized).raw().toBuffer(),
    Buffer.from([255, 0, 0, 255]),
  );
  assert.equal((await sharp(normalized).metadata()).exif, undefined);
  assert.ok(!normalized.includes(Buffer.from("hostile")));
  const jpeg = await sharp({
    create: { width: 8, height: 4, channels: 3, background: "red" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const out = await validateMedia(jpeg, "image/jpeg");
  const metadata = await sharp(out).metadata();
  assert.equal(metadata.width, 4);
  assert.equal(metadata.height, 8);
  assert.equal(metadata.exif, undefined);
  const corrupt = png();
  corrupt[30] ^= 1;
  for (const b of [
    corrupt,
    highBitPng(),
    Buffer.concat([png(), Buffer.from("<script>")]),
    Buffer.from('<svg onload="x"/>'),
    png().subarray(0, 30),
  ])
    await assert.rejects(validateMedia(b, "image/png"));
  await assert.rejects(validateMedia(jpeg.subarray(0, -2), "image/jpeg"));
  await assert.rejects(
    validateMedia(
      await sharp({
        create: { width: 8193, height: 1, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
      "image/png",
    ),
  );
  await assert.rejects(
    validateMedia(
      await sharp({
        create: { width: 4001, height: 4000, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
      "image/png",
    ),
  );
});
test("strict text and opaque file boundaries preserve exact bytes", async () => {
  const hostile = Buffer.from("<script>alert(1)</script>");
  assert.equal(await validateMedia(hostile, "text/plain"), hostile);
  for (const bytes of [
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0]),
    Buffer.alloc(ATTACHMENT_LIMITS.textBytes + 1, 65),
  ])
    await assert.rejects(validateMedia(bytes, "text/plain"));
  const boundary = Buffer.alloc(ATTACHMENT_LIMITS.fileBytes, 255);
  assert.equal(
    await validateMedia(boundary, "application/octet-stream"),
    boundary,
  );
  await assert.rejects(
    validateMedia(
      Buffer.alloc(boundary.length + 1),
      "application/octet-stream",
    ),
  );
  assert.equal(safeName("../../a\u202e.txt"), ".._.._a_.txt");
});
