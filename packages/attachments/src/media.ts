import { createHash } from "node:crypto";
import sharp from "sharp";
import { HarborError } from "../../policy/src/index.ts";
import { ATTACHMENT_LIMITS } from "../../contracts/src/attachments.ts";
export { ATTACHMENT_LIMITS } from "../../contracts/src/attachments.ts";
export const hashBytes = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function invalid(): never {
  throw new HarborError(
    400,
    "INVALID_MEDIA",
    "File content does not match the supported media profile",
  );
}
let decoders = 0;
export async function validateMedia(
  bytes: Buffer,
  type: string,
): Promise<Buffer> {
  if (!bytes.length || bytes.length > ATTACHMENT_LIMITS.fileBytes) invalid();
  if (type === "application/octet-stream") return bytes;
  if (type === "text/plain") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      invalid();
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) invalid();
    return bytes;
  }
  if (type === "image/png") {
    if (
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      invalid();
    let offset = 8,
      ended = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) invalid();
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) invalid();
      const tag = bytes.toString("ascii", offset + 4, offset + 8);
      if (["acTL", "fcTL", "fdAT"].includes(tag)) invalid();
      offset += length + 12;
      if (tag === "IEND") {
        if (length || offset !== bytes.length) invalid();
        ended = true;
      }
    }
    if (!ended) invalid();
  } else if (type === "image/jpeg") {
    if (
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[2] !== 255 ||
      bytes[bytes.length - 2] !== 255 ||
      bytes[bytes.length - 1] !== 217 ||
      bytes.includes(Buffer.from([0x4d, 0x50, 0x46, 0]))
    )
      invalid();
  } else invalid();
  if (decoders >= 2)
    throw new HarborError(
      429,
      "MEDIA_BUSY",
      "Image processing is busy; retry this upload",
      true,
    );
  decoders++;
  try {
    const decoder = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: 16000000,
    }).timeout({ seconds: 5 });
    const metadata = await decoder.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > 8192 ||
      metadata.height > 8192 ||
      (metadata.pages ?? 1) !== 1 ||
      metadata.format !== (type === "image/png" ? "png" : "jpeg")
    )
      invalid();
    const normalized = decoder.autoOrient();
    const output = await (
      type === "image/png" ? normalized.png() : normalized.jpeg()
    ).toBuffer();
    if (output.length > ATTACHMENT_LIMITS.imageBytes) invalid();
    return output;
  } catch {
    invalid();
  } finally {
    decoders--;
  }
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
