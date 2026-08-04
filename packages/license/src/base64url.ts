/** Unpadded base64url encode. */
export function base64urlEncode(bytes: Buffer | Uint8Array | string): string {
  const buf =
    typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  return buf.toString("base64url");
}

/** Unpadded base64url decode. */
export function base64urlDecode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("invalid_base64url");
  }
  return Buffer.from(value, "base64url");
}

export function utf8Bytes(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

export function toHex(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function fromHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("invalid_hex");
  }
  return Buffer.from(hex, "hex");
}
