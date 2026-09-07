import { deflateSync } from "node:zlib";
export function png(extra = false, width = 1, height = 1) {
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const v of b) {
      c ^= v;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind: string, data: Buffer) => {
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    b.write(kind, 4);
    data.copy(b, 8);
    b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4);
    return b;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  let seed = 314159;
  for (let y = 0; y < height; y++)
    for (let x = 1; x <= width * 4; x++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels[y * (width * 4 + 1) + x] = seed >>> 24;
    }
  if (width === 1 && height === 1)
    Buffer.from([0, 255, 0, 0, 255]).copy(pixels);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...(extra
      ? [chunk("tEXt", Buffer.from("unsafe name\0<script>hostile()</script>"))]
      : []),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
/** Deliberately invalid raw chunk type whose high bits alias ASCII in Node's decoder. */
export function highBitPng() {
  const bytes = png();
  bytes[12]! |= 128;
  let c = 0xffffffff;
  for (const value of bytes.subarray(12, 29)) {
    c ^= value;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((c ^ 0xffffffff) >>> 0, 29);
  return bytes;
}
