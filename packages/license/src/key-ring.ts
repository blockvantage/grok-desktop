import {
  createPublicKey,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import { base64urlDecode } from "./base64url.js";

/**
 * Public-key material only. This package never loads private keys
 * for issuance or local activation signing.
 */

export type PublicJwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid?: string;
  alg?: string;
  use?: string;
};

export type KeyRing = ReadonlyMap<string, KeyObject | PublicJwk>;

export function importPublicJwk(jwk: PublicJwk): KeyObject {
  const j = jwk;
  // Node accepts JWK via createPublicKey; cast through Record for older @types/node.
  const normalized: Record<string, string> = {
    kty: j.kty,
    crv: j.crv,
    x: j.x,
  };
  if (j.kid) normalized.kid = j.kid;
  if (j.alg) normalized.alg = j.alg;
  if (j.use) normalized.use = j.use;
  return createPublicKey({ key: normalized, format: "jwk" });
}

export function resolvePublicKey(keyMaterial: KeyObject | PublicJwk): KeyObject {
  if (
    keyMaterial &&
    typeof keyMaterial === "object" &&
    "type" in keyMaterial &&
    (keyMaterial as KeyObject).type
  ) {
    return keyMaterial as KeyObject;
  }
  return importPublicJwk(keyMaterial as PublicJwk);
}

export function ed25519Verify(
  publicKey: KeyObject,
  data: Buffer | Uint8Array,
  signature: Buffer | Uint8Array,
): boolean {
  try {
    return nodeVerify(
      null,
      Buffer.from(data),
      publicKey,
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

export function ed25519VerifyBase64Url(
  publicKey: KeyObject,
  data: Buffer | Uint8Array,
  signatureBase64Url: string,
): boolean {
  try {
    const sig = base64urlDecode(signatureBase64Url);
    if (sig.byteLength !== 64) return false;
    return ed25519Verify(publicKey, data, sig);
  } catch {
    return false;
  }
}

/** Build a kid → public JWK map from vector/document key entries. */
export function buildKeyRing(
  entries: Iterable<{ kid: string; publicJwk: PublicJwk }>,
): Map<string, PublicJwk> {
  const map = new Map<string, PublicJwk>();
  for (const entry of entries) {
    map.set(entry.kid, entry.publicJwk);
  }
  return map;
}
