import type { KeyObject } from "node:crypto";
import { base64urlDecode, base64urlEncode, toHex, utf8Bytes } from "./base64url.js";
import { canonicalizeJson } from "./canonical.js";
import {
  ed25519Verify,
  resolvePublicKey,
  type PublicJwk,
} from "./key-ring.js";

/**
 * GD3 product key format (verify only — no private key load/issuance):
 *   GD3.<base64url(RFC8785 claims)>.<base64url(Ed25519 signature)>
 *
 * Signature input is ASCII bytes of: GD3.<claimsBase64Url>
 */

export const PRODUCT_ID = "grok-desk" as const;
export const PRODUCT_KEY_SCHEMA = 1 as const;
export const PRODUCT_KEY_SEAT_LIMIT = 3 as const;
export const PRODUCT_KEY_UPDATE_POLICY = "lifetime_stable" as const;

export type ProductKeyClaims = {
  schema: typeof PRODUCT_KEY_SCHEMA;
  entitlementId: string;
  productId: typeof PRODUCT_ID;
  keyVersion: number;
  issuedAt: string;
  seatLimit: typeof PRODUCT_KEY_SEAT_LIMIT;
  updatePolicy: typeof PRODUCT_KEY_UPDATE_POLICY;
  kid: string;
};

export type ProductKeyVerifyOptions = {
  /** kid -> public key (or JWK). */
  keys: ReadonlyMap<string, KeyObject | PublicJwk>;
  /**
   * When set, a valid signature whose keyVersion is lower than current
   * reports key_rotated rather than accept.
   */
  currentKeyVersionByEntitlement?: ReadonlyMap<string, number>;
};

export type ProductKeyErrorCode =
  | "invalid_key_format"
  | "invalid_key_signature"
  | "key_rotated"
  | "unknown_key";

export type ProductKeyVerifyResult =
  | { ok: true; claims: ProductKeyClaims; gd3: string }
  | { ok: false; code: ProductKeyErrorCode; message: string };

const GD3_PREFIX = "GD3.";
const MAX_GD3_LENGTH = 8 * 1024;
/** Max paste/import buffer for extractGd3. */
const MAX_EXTRACT_INPUT = 8 * 1024;

const GD3_TOKEN_RE = /GD3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/**
 * Extract exactly one GD3 token from free-form paste text.
 * Rejects empty/oversized input and multiple tokens.
 */
export function extractGd3(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("invalid_key_format");
  }
  if (input.length > MAX_EXTRACT_INPUT) {
    throw new Error("invalid_key_format");
  }
  const matches = input.match(GD3_TOKEN_RE);
  if (!matches || matches.length === 0) {
    throw new Error("invalid_key_format");
  }
  if (matches.length > 1) {
    throw new Error("multiple_keys");
  }
  return matches[0]!;
}

export function canonicalizeProductKeyClaims(claims: ProductKeyClaims): string {
  return canonicalizeJson(claims);
}

/** ASCII signing input: GD3.<base64url(RFC8785 claims)> */
export function productKeySigningInput(claims: ProductKeyClaims): {
  claimsCanonical: string;
  claimsBase64Url: string;
  signingString: string;
  signingBytes: Buffer;
  signingBytesHex: string;
  claimsCanonicalHex: string;
} {
  const claimsCanonical = canonicalizeProductKeyClaims(claims);
  const claimsBase64Url = base64urlEncode(claimsCanonical);
  const signingString = `${GD3_PREFIX}${claimsBase64Url}`;
  const signingBytes = utf8Bytes(signingString);
  return {
    claimsCanonical,
    claimsBase64Url,
    signingString,
    signingBytes,
    signingBytesHex: toHex(signingBytes),
    claimsCanonicalHex: toHex(utf8Bytes(claimsCanonical)),
  };
}

export function parseProductKey(
  gd3: string,
):
  | {
      ok: true;
      claimsBase64Url: string;
      signatureBase64Url: string;
      signingString: string;
      signingBytes: Buffer;
      claimsCanonical: string;
      claims: ProductKeyClaims;
    }
  | { ok: false; code: "invalid_key_format"; message: string } {
  if (typeof gd3 !== "string" || gd3.length === 0 || gd3.length > MAX_GD3_LENGTH) {
    return { ok: false, code: "invalid_key_format", message: "Product key length invalid" };
  }
  if (!gd3.startsWith(GD3_PREFIX)) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Product key must start with GD3.",
    };
  }

  // Reject legacy schemes explicitly.
  if (gd3.startsWith("GD1.") || gd3.startsWith("GD2.")) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Legacy product key scheme is not supported",
    };
  }

  const rest = gd3.slice(GD3_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot === rest.length - 1) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Product key structure invalid",
    };
  }
  if (rest.indexOf(".", dot + 1) !== -1) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Product key has extra segments",
    };
  }

  const claimsBase64Url = rest.slice(0, dot);
  const signatureBase64Url = rest.slice(dot + 1);

  let claimsCanonical: string;
  let signature: Buffer;
  try {
    claimsCanonical = base64urlDecode(claimsBase64Url).toString("utf8");
    signature = base64urlDecode(signatureBase64Url);
  } catch {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Product key encoding invalid",
    };
  }

  if (signature.byteLength !== 64) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Product key signature length invalid",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(claimsCanonical);
  } catch {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Product key claims are not JSON",
    };
  }

  if (!isProductKeyClaims(parsed)) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Product key claims invalid",
    };
  }

  // Re-canonicalize and require byte equality with RFC 8785 form.
  const reCanonical = canonicalizeProductKeyClaims(parsed);
  if (reCanonical !== claimsCanonical) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Product key claims are not RFC 8785 canonical",
    };
  }

  const signingString = `${GD3_PREFIX}${claimsBase64Url}`;
  return {
    ok: true,
    claimsBase64Url,
    signatureBase64Url,
    signingString,
    signingBytes: utf8Bytes(signingString),
    claimsCanonical,
    claims: parsed,
  };
}

export function verifyProductKey(
  gd3: string,
  options: ProductKeyVerifyOptions,
): ProductKeyVerifyResult {
  // Fast-reject legacy schemes before structure parse.
  if (
    typeof gd3 === "string" &&
    (gd3.startsWith("GD1.") || gd3.startsWith("GD2."))
  ) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Legacy product key scheme is not supported",
    };
  }

  const parsed = parseProductKey(gd3);
  if (!parsed.ok) {
    return parsed;
  }

  const keyMaterial = options.keys.get(parsed.claims.kid);
  if (!keyMaterial) {
    return { ok: false, code: "unknown_key", message: "Unknown product signing key" };
  }

  let publicKey: KeyObject;
  try {
    publicKey = resolvePublicKey(keyMaterial);
  } catch {
    return { ok: false, code: "unknown_key", message: "Product signing key invalid" };
  }

  let signature: Buffer;
  try {
    signature = base64urlDecode(parsed.signatureBase64Url);
  } catch {
    return { ok: false, code: "invalid_key_format", message: "Signature encoding invalid" };
  }

  if (!ed25519Verify(publicKey, parsed.signingBytes, signature)) {
    return {
      ok: false,
      code: "invalid_key_signature",
      message: "Product key signature is invalid",
    };
  }

  const current = options.currentKeyVersionByEntitlement?.get(
    parsed.claims.entitlementId,
  );
  if (current !== undefined && parsed.claims.keyVersion < current) {
    return {
      ok: false,
      code: "key_rotated",
      message: "Product key has been rotated",
    };
  }

  return { ok: true, claims: parsed.claims, gd3 };
}

function isProductKeyClaims(value: unknown): value is ProductKeyClaims {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    o.schema === 1 &&
    typeof o.entitlementId === "string" &&
    o.entitlementId.length > 0 &&
    o.productId === PRODUCT_ID &&
    typeof o.keyVersion === "number" &&
    Number.isInteger(o.keyVersion) &&
    o.keyVersion >= 1 &&
    typeof o.issuedAt === "string" &&
    o.seatLimit === PRODUCT_KEY_SEAT_LIMIT &&
    o.updatePolicy === PRODUCT_KEY_UPDATE_POLICY &&
    typeof o.kid === "string" &&
    o.kid.length > 0 &&
    Object.keys(o).length === 8
  );
}
