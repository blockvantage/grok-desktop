import { createHash } from "node:crypto";
import { base64urlDecode, base64urlEncode, toHex, utf8Bytes } from "./base64url.js";
import { canonicalizeJson } from "./canonical.js";
import {
  ed25519Verify,
  importPublicJwk,
  type PublicJwk,
} from "./key-ring.js";

/**
 * Device activation / lease-refresh proof verification (public key only).
 *
 * Activation signing input:
 *   GROKDESK-ACTIVATE-V1\n<base64url(RFC8785 payload)>
 *
 * Lease refresh signing input:
 *   GROKDESK-LEASE-REFRESH-V1\n<base64url(RFC8785 payload)>
 */

export const ACTIVATE_PREFIX = "GROKDESK-ACTIVATE-V1";
export const LEASE_REFRESH_PREFIX = "GROKDESK-LEASE-REFRESH-V1";

export type DevicePublicJwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
};

export type ActivationProofPayload = {
  challengeId: string;
  nonce: string;
  deviceId: string;
  devicePublicJwk: DevicePublicJwk;
  deviceName: string;
  platform: string;
  arch: string;
  osVersion: string;
  deskVersion: string;
};

export type LeaseRefreshProofPayload = {
  challengeId: string;
  nonce: string;
  deviceId: string;
  activationId: string;
  devicePublicJwk: DevicePublicJwk;
  priorLeaseJti: string;
};

export type DeviceProofErrorCode =
  | "device_signature_invalid"
  | "challenge_expired"
  | "challenge_replayed"
  | "clock_skew"
  | "invalid_key_format";

export type DeviceProofVerifyResult =
  | { ok: true; payload: ActivationProofPayload | LeaseRefreshProofPayload }
  | { ok: false; code: DeviceProofErrorCode; message: string };

export function rfc7638JwkThumbprint(jwk: DevicePublicJwk | PublicJwk): string {
  // RFC 7638 required members for OKP, lexicographic order: crv, kty, x
  const required = {
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
  };
  const canonical = canonicalizeJson(required);
  return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

export function buildProofSigningMaterial(
  prefix: typeof ACTIVATE_PREFIX | typeof LEASE_REFRESH_PREFIX,
  payload: object,
): {
  payloadCanonical: string;
  payloadBase64Url: string;
  signingString: string;
  signingBytes: Buffer;
  signingBytesHex: string;
  payloadCanonicalHex: string;
} {
  const payloadCanonical = canonicalizeJson(payload);
  const payloadBase64Url = base64urlEncode(payloadCanonical);
  const signingString = `${prefix}\n${payloadBase64Url}`;
  const signingBytes = utf8Bytes(signingString);
  return {
    payloadCanonical,
    payloadBase64Url,
    signingString,
    signingBytes,
    signingBytesHex: toHex(signingBytes),
    payloadCanonicalHex: toHex(utf8Bytes(payloadCanonical)),
  };
}

export function verifyActivationProof(input: {
  payload: ActivationProofPayload;
  signatureBase64Url: string;
  /** Expected device public key (from payload or registration). */
  devicePublicJwk?: DevicePublicJwk;
  challengeExpiresAtMs?: number;
  challengeConsumed?: boolean;
  nowMs?: number;
  maxClockSkewMs?: number;
  clientTimeMs?: number;
}): DeviceProofVerifyResult {
  if (input.challengeConsumed) {
    return {
      ok: false,
      code: "challenge_replayed",
      message: "Challenge has already been used",
    };
  }

  const now = input.nowMs ?? Date.now();
  if (
    input.challengeExpiresAtMs !== undefined &&
    now > input.challengeExpiresAtMs
  ) {
    return {
      ok: false,
      code: "challenge_expired",
      message: "Challenge has expired",
    };
  }

  if (
    input.clientTimeMs !== undefined &&
    input.maxClockSkewMs !== undefined &&
    Math.abs(input.clientTimeMs - now) > input.maxClockSkewMs
  ) {
    return {
      ok: false,
      code: "clock_skew",
      message: "Client clock is too far from server time",
    };
  }

  const jwk = input.devicePublicJwk ?? input.payload.devicePublicJwk;
  const material = buildProofSigningMaterial(ACTIVATE_PREFIX, input.payload);

  if (!verifySignature(jwk, material.signingBytes, input.signatureBase64Url)) {
    return {
      ok: false,
      code: "device_signature_invalid",
      message: "Device signature is invalid",
    };
  }

  return { ok: true, payload: input.payload };
}

export function verifyLeaseRefreshProof(input: {
  payload: LeaseRefreshProofPayload;
  signatureBase64Url: string;
  registeredDevicePublicJwk: DevicePublicJwk;
  challengeExpiresAtMs?: number;
  challengeConsumed?: boolean;
  nowMs?: number;
}): DeviceProofVerifyResult {
  if (input.challengeConsumed) {
    return {
      ok: false,
      code: "challenge_replayed",
      message: "Challenge has already been used",
    };
  }

  const now = input.nowMs ?? Date.now();
  if (
    input.challengeExpiresAtMs !== undefined &&
    now > input.challengeExpiresAtMs
  ) {
    return {
      ok: false,
      code: "challenge_expired",
      message: "Challenge has expired",
    };
  }

  // Payload device key must match registered activation key.
  if (
    input.payload.devicePublicJwk.x !== input.registeredDevicePublicJwk.x ||
    input.payload.devicePublicJwk.crv !== input.registeredDevicePublicJwk.crv ||
    input.payload.devicePublicJwk.kty !== input.registeredDevicePublicJwk.kty
  ) {
    return {
      ok: false,
      code: "device_signature_invalid",
      message: "Device key does not match registration",
    };
  }

  const material = buildProofSigningMaterial(
    LEASE_REFRESH_PREFIX,
    input.payload,
  );

  if (
    !verifySignature(
      input.registeredDevicePublicJwk,
      material.signingBytes,
      input.signatureBase64Url,
    )
  ) {
    return {
      ok: false,
      code: "device_signature_invalid",
      message: "Device signature is invalid",
    };
  }

  return { ok: true, payload: input.payload };
}

function verifySignature(
  jwk: DevicePublicJwk | PublicJwk,
  data: Buffer,
  signatureBase64Url: string,
): boolean {
  try {
    const publicKey = importPublicJwk({
      kty: "OKP",
      crv: "Ed25519",
      x: jwk.x,
    });
    const sig = base64urlDecode(signatureBase64Url);
    if (sig.byteLength !== 64) return false;
    return ed25519Verify(publicKey, data, sig);
  } catch {
    return false;
  }
}
