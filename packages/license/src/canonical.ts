import canonicalizeImport from "canonicalize";
import { base64urlEncode, utf8Bytes } from "./base64url.js";

/**
 * RFC 8785 (JSON Canonicalization Scheme) helpers.
 * Shared by product keys, device proofs, leases, and release manifests.
 */

// NodeNext + CJS interop: some resolvers surface `{ default: fn }`.
const canonicalize: (input: unknown) => string | undefined =
  typeof canonicalizeImport === "function"
    ? canonicalizeImport
    : (
        canonicalizeImport as unknown as {
          default: (input: unknown) => string | undefined;
        }
      ).default;

export function canonicalizeJson(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new Error("canonicalize_undefined");
  }
  return result;
}

export function canonicalBytes(value: unknown): Buffer {
  return utf8Bytes(canonicalizeJson(value));
}

export function canonicalBase64Url(value: unknown): string {
  return base64urlEncode(canonicalBytes(value));
}
