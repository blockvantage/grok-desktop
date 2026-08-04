/**
 * Minimal PNG IHDR reader + nearest-neighbor resize.
 * Pure Node (zlib) — no native deps. Used so screenshot bytes match reported width×height.
 */
import { deflateSync, inflateSync } from "node:zlib";

function readU32(buf: Buffer, o: number): number {
  return buf.readUInt32BE(o);
}

function writeU32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

/** PNG CRC-32 (IEEE) */
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Read PNG width/height from IHDR. Throws if not a PNG. */
export function readPngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("not a PNG");
  }
  // IHDR is first chunk after signature
  const length = readU32(png, 8);
  const type = png.subarray(12, 16).toString("ascii");
  if (type !== "IHDR" || length < 13) throw new Error("missing IHDR");
  const width = readU32(png, 16);
  const height = readU32(png, 20);
  return { width, height };
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = writeU32(data.length);
  const crcBuf = Buffer.alloc(4);
  // CRC over type+data
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Create solid RGB PNG (8-bit, no alpha). */
export function createSolidPng(
  width: number,
  height: number,
  rgb: [number, number, number] = [40, 80, 120],
): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  row[0] = 0; // filter none
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * row.length);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Decode RGB/RGBA 8-bit PNG to raw rows (no filter). */
function decodePngRgba(png: Buffer): {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
} {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("not a PNG");
  }
  let o = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 2;
  const idatParts: Buffer[] = [];
  while (o + 8 <= png.length) {
    const len = readU32(png, o);
    const type = png.subarray(o + 4, o + 8).toString("ascii");
    const data = png.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    o += 12 + len;
  }
  if (!width || !height) throw new Error("bad PNG");
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG colorType=${colorType} bitDepth=${bitDepth}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const inflated = inflateSync(Buffer.concat(idatParts));
  // Undo filter (only filter 0 / None fully; handle Sub/Up/Average/Paeth simply)
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let src = 0;
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++]!;
    const row = inflated.subarray(src, src + stride);
    src += stride;
    const dst = out.subarray(y * stride, (y + 1) * stride);
    if (filter === 0) {
      row.copy(dst);
    } else if (filter === 1) {
      // Sub
      for (let i = 0; i < stride; i++) {
        const left = i >= channels ? dst[i - channels]! : 0;
        dst[i] = (row[i]! + left) & 255;
      }
    } else if (filter === 2) {
      // Up
      for (let i = 0; i < stride; i++) {
        dst[i] = (row[i]! + prev[i]!) & 255;
      }
    } else if (filter === 3) {
      // Average
      for (let i = 0; i < stride; i++) {
        const left = i >= channels ? dst[i - channels]! : 0;
        dst[i] = (row[i]! + Math.floor((left + prev[i]!) / 2)) & 255;
      }
    } else if (filter === 4) {
      // Paeth
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? dst[i - channels]! : 0;
        const b = prev[i]!;
        const c = i >= channels ? prev[i - channels]! : 0;
        dst[i] = (row[i]! + paeth(a, b, c)) & 255;
      }
    } else {
      throw new Error(`unsupported PNG filter ${filter}`);
    }
    dst.copy(prev);
  }
  return { width, height, channels, data: out };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Nearest-neighbor resize of PNG to exact targetW×targetH.
 * Returns new PNG buffer; IHDR matches target dimensions.
 */
export function resizePngNearest(
  png: Buffer,
  targetW: number,
  targetH: number,
): Buffer {
  const { width, height, channels, data } = decodePngRgba(png);
  if (width === targetW && height === targetH) return png;

  const out = Buffer.alloc(targetH * targetW * channels);
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(height - 1, Math.floor((y / targetH) * height));
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(width - 1, Math.floor((x / targetW) * width));
      const si = (sy * width + sx) * channels;
      const di = (y * targetW + x) * channels;
      for (let c = 0; c < channels; c++) {
        out[di + c] = data[si + c]!;
      }
    }
  }

  // Encode as RGB (drop alpha if present for smaller encode)
  const rgbChannels = 3;
  const rowSize = 1 + targetW * rgbChannels;
  const raw = Buffer.alloc(rowSize * targetH);
  for (let y = 0; y < targetH; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < targetW; x++) {
      const si = (y * targetW + x) * channels;
      const di = y * rowSize + 1 + x * 3;
      raw[di] = out[si]!;
      raw[di + 1] = out[si + 1]!;
      raw[di + 2] = out[si + 2]!;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(targetW, 0);
  ihdr.writeUInt32BE(targetH, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Ensure screenshot bytes are PNG of exactly targetW×targetH.
 * Non-PNG input: re-wrap is not supported — throws.
 */
export function ensurePngSize(
  bytes: Buffer,
  mime: string,
  targetW: number,
  targetH: number,
): { bytes: Buffer; mime: "image/png" } {
  if (mime !== "image/png" && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    // Try treating as PNG anyway if signature matches; otherwise cannot resize
    throw new Error(`cannot resize mime=${mime} to ${targetW}x${targetH}`);
  }
  const { width, height } = readPngSize(bytes);
  if (width === targetW && height === targetH) {
    return { bytes, mime: "image/png" };
  }
  return { bytes: resizePngNearest(bytes, targetW, targetH), mime: "image/png" };
}
