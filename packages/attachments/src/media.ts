import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { HarborError } from "../../policy/src/index.ts";
export const ATTACHMENT_LIMITS = Object.freeze({
  imageBytes: 262144,
  textBytes: 65536,
  turnBytes: 524288,
  turnCount: 4,
  sessionCount: 32,
  sessionBytes: 4194304,
  instanceBytes: 104857600,
  expiryHours: 24,
});
export const hashBytes = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function invalid(): never {
  throw new HarborError(
    400,
    "INVALID_MEDIA",
    "File content does not match the supported PNG or UTF-8 text profile",
  );
}
function crc(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
export function validateMedia(bytes: Buffer, type: string): Buffer {
  if (!bytes.length) invalid();
  if (type === "text/plain") {
    if (bytes.length > ATTACHMENT_LIMITS.textBytes) invalid();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      invalid();
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) invalid();
    return bytes;
  }
  if (
    type !== "image/png" ||
    bytes.length > ATTACHMENT_LIMITS.imageBytes ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    invalid();
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0,
    seenData = false,
    ended = false;
  const ids: Buffer[] = [];
  const kept: Buffer[] = [bytes.subarray(0, 8)];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) invalid();
    const tag = bytes.subarray(offset + 4, offset + 8);
    if (
      [...tag].some((v) => !((v >= 65 && v <= 90) || (v >= 97 && v <= 122))) ||
      tag[2]! >= 97
    )
      invalid();
    const kind = tag.toString("ascii");
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (
      crc(bytes.subarray(offset + 4, offset + 8 + length)) !==
      bytes.readUInt32BE(offset + 8 + length)
    )
      invalid();
    if (!width && kind !== "IHDR") invalid();
    if (kind === "IHDR") {
      if (width || length !== 13) invalid();
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      channels = payload[9] === 2 ? 3 : payload[9] === 6 ? 4 : 0;
      if (
        !width ||
        !height ||
        width > 2048 ||
        height > 2048 ||
        !channels ||
        payload[8] !== 8 ||
        payload[10] ||
        payload[11] ||
        payload[12]
      )
        invalid();
      kept.push(bytes.subarray(offset, offset + length + 12));
    } else if (kind === "IDAT") {
      if (ended) invalid();
      seenData = true;
      ids.push(payload);
      kept.push(bytes.subarray(offset, offset + length + 12));
    } else if (kind === "IEND") {
      if (length || !seenData || offset + 12 !== bytes.length) invalid();
      ended = true;
      kept.push(bytes.subarray(offset, offset + 12));
    } else {
      if (!/^[a-z][A-Za-z]{3}$/.test(kind) || seenData) invalid();
    }
    offset += length + 12;
  }
  if (!ended) invalid();
  const expected = (width * channels + 1) * height;
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(ids), { maxOutputLength: expected + 1 });
  } catch {
    invalid();
  }
  if (pixels.length !== expected) invalid();
  for (let y = 0; y < height; y++)
    if (pixels[y * (width * channels + 1)]! > 4) invalid();
  return Buffer.concat(kept);
}
export function safeName(name: string) {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/g, "_")
    .trim();
  if (!cleaned || Buffer.byteLength(cleaned) > 240)
    throw new HarborError(
      400,
      "INVALID_FILENAME",
      "File name is empty or too long",
    );
  return cleaned;
}
