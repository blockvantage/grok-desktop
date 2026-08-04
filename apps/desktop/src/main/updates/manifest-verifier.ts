/**
 * Verify signed compatibility release manifests (Ed25519).
 *
 * Signing domain: GROKDESK-RELEASE-MANIFEST-V1\n<payloadBase64Url>
 * Public keys come from the separate GROKDESK_RELEASE_PUBLIC_KEYS build-time
 * ring (not product/lease keys).
 */
import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import {
  RELEASE_MANIFEST_SIGNATURE_DOMAIN,
  buildSignatureMessage,
  decodeManifestPayload,
  parseSignedCompatibilityEnvelope,
  type CompatibilityManifestPayload,
  type SignedCompatibilityEnvelope,
} from "@grokdesk/shared";
import {
  base64urlDecode,
  ed25519Verify,
  importPublicJwk,
  resolvePublicKey,
  type PublicJwk,
  type KeyRing,
} from "@grokdesk/license";

/** Build-time release public key ring (JSON array of JWKs with kid). */
declare const __GROKDESK_RELEASE_PUBLIC_KEYS__: string | undefined;

export type ReleaseKeyMaterial = KeyObject | PublicJwk | string;

export type ReleaseKeyRing = ReadonlyMap<string, ReleaseKeyMaterial>;

export type ManifestVerifyErrorCode =
  | "invalid_envelope"
  | "invalid_payload"
  | "unknown_key"
  | "invalid_signature"
  | "manifest_expired"
  | "sequence_rollback"
  | "sequence_hash_mismatch"
  | "absent_target"
  | "revoked_pair";

export type ManifestVerifyOptions = {
  keys: ReleaseKeyRing;
  nowMs?: number;
  /** Highest sequence previously accepted (anti-rollback). */
  highestSequenceSeen?: number;
  /**
   * SHA-256 (hex) of the payload bytes last accepted at `highestSequenceSeen`.
   * Required to reject same-sequence/different-hash envelopes.
   */
  highestSequencePayloadSha256?: string;
  /** When set, require this target in `publishedTargets`. */
  requiredTarget?: string;
  /** When set, reject if this pair id appears in revocations. */
  requiredPairId?: string;
};

export type ManifestVerifySuccess = {
  ok: true;
  payload: CompatibilityManifestPayload;
  envelope: SignedCompatibilityEnvelope;
  acceptedKeyId: string;
  payloadSha256: string;
  sequence: number;
};

export type ManifestVerifyFailure = {
  ok: false;
  code: ManifestVerifyErrorCode;
  message: string;
};

export type ManifestVerifyResult = ManifestVerifySuccess | ManifestVerifyFailure;

/** SHA-256 hex of the raw payloadBase64Url-decoded UTF-8 payload bytes. */
export function hashManifestPayload(payloadBase64Url: string): string {
  const raw = base64urlDecode(payloadBase64Url);
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Parse GROKDESK_RELEASE_PUBLIC_KEYS JSON into a kid → public material map.
 *
 * Accepted shapes:
 * - `[{ kid, kty:"OKP", crv:"Ed25519", x }, ...]`
 * - `{ keys: [ ...same... ] }`
 */
export function parseReleasePublicKeys(raw: string): Map<string, PublicJwk> {
  const trimmed = raw.trim();
  if (!trimmed) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("GROKDESK_RELEASE_PUBLIC_KEYS is not valid JSON");
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { keys?: unknown }).keys)
      ? (parsed as { keys: unknown[] }).keys
      : null;

  if (!list) {
    throw new Error(
      "GROKDESK_RELEASE_PUBLIC_KEYS must be a JSON array of JWKs or { keys: [...] }",
    );
  }

  const map = new Map<string, PublicJwk>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const kid = typeof o.kid === "string" ? o.kid : undefined;
    if (!kid) continue;
    if (o.kty !== "OKP" || o.crv !== "Ed25519" || typeof o.x !== "string") {
      continue;
    }
    const jwk: PublicJwk = {
      kty: "OKP",
      crv: "Ed25519",
      x: o.x,
      kid,
      ...(typeof o.alg === "string" ? { alg: o.alg } : {}),
      ...(typeof o.use === "string" ? { use: o.use } : {}),
    };
    // Validate import early so bad JWKs fail closed at load time.
    importPublicJwk(jwk);
    map.set(kid, jwk);
  }
  return map;
}

/**
 * Built-in release key ring from the build-time define. Packaged builds never
 * accept a process-environment trust-root override. Tests/dev may opt in only
 * through an explicit unpackaged injection.
 */
export function getBuiltInReleasePublicKeys(options: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  isPackaged?: boolean;
  allowDevEnvOverride?: boolean;
} = {}): Map<string, PublicJwk> {
  const baked =
    typeof __GROKDESK_RELEASE_PUBLIC_KEYS__ === "string"
      ? __GROKDESK_RELEASE_PUBLIC_KEYS__.trim()
      : "";
  if (baked) return parseReleasePublicKeys(baked);

  if (options.isPackaged === false && options.allowDevEnvOverride === true) {
    const fromEnv = options.env?.GROKDESK_RELEASE_PUBLIC_KEYS?.trim();
    if (fromEnv) return parseReleasePublicKeys(fromEnv);
  }
  return new Map();
}

function resolveKeyMaterial(material: ReleaseKeyMaterial): KeyObject {
  if (typeof material === "string") {
    return createPublicKey(material);
  }
  return resolvePublicKey(material);
}

function isPairRevoked(
  payload: CompatibilityManifestPayload,
  pairId: string,
): boolean {
  return payload.revocations.some((r) => r.kind === "pair" && r.id === pairId);
}

/**
 * Verify a signed compatibility envelope against the release key ring.
 * Does not install artifacts; only authenticates and validates anti-rollback.
 */
export function verifySignedCompatibilityManifest(
  input: unknown,
  options: ManifestVerifyOptions,
): ManifestVerifyResult {
  let envelope: SignedCompatibilityEnvelope;
  try {
    envelope = parseSignedCompatibilityEnvelope(input);
  } catch {
    return {
      ok: false,
      code: "invalid_envelope",
      message: "Manifest envelope schema invalid",
    };
  }

  let payload: CompatibilityManifestPayload;
  try {
    payload = decodeManifestPayload(envelope.payloadBase64Url);
  } catch {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Manifest payload is not a valid compatibility manifest",
    };
  }

  const signingString = buildSignatureMessage(envelope.payloadBase64Url);
  // Guard domain constant remains the canonical prefix used by publishers.
  if (!signingString.startsWith(`${RELEASE_MANIFEST_SIGNATURE_DOMAIN}\n`)) {
    return {
      ok: false,
      code: "invalid_signature",
      message: "Manifest signing domain mismatch",
    };
  }
  const signingBytes = Buffer.from(signingString, "utf8");

  let acceptedKeyId: string | undefined;
  let sawKnownKey = false;

  for (const sig of envelope.signatures) {
    if (
      !sig ||
      sig.algorithm !== "Ed25519" ||
      typeof sig.keyId !== "string" ||
      typeof sig.signatureBase64Url !== "string"
    ) {
      continue;
    }
    const keyMaterial = options.keys.get(sig.keyId);
    if (!keyMaterial) continue;
    sawKnownKey = true;

    let publicKey: KeyObject;
    try {
      publicKey = resolveKeyMaterial(keyMaterial);
    } catch {
      continue;
    }

    try {
      const raw = base64urlDecode(sig.signatureBase64Url);
      if (raw.byteLength !== 64) continue;
      if (ed25519Verify(publicKey, signingBytes, raw)) {
        acceptedKeyId = sig.keyId;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!acceptedKeyId) {
    if (!sawKnownKey) {
      return {
        ok: false,
        code: "unknown_key",
        message: "No known release signing key on envelope",
      };
    }
    return {
      ok: false,
      code: "invalid_signature",
      message: "Release manifest signature is invalid",
    };
  }

  const now = options.nowMs ?? Date.now();
  const expiresAtMs = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
    return {
      ok: false,
      code: "manifest_expired",
      message: "Release manifest has expired",
    };
  }

  const payloadSha256 = hashManifestPayload(envelope.payloadBase64Url);

  if (
    options.highestSequenceSeen !== undefined &&
    payload.sequence < options.highestSequenceSeen
  ) {
    return {
      ok: false,
      code: "sequence_rollback",
      message: "Release manifest sequence rollback",
    };
  }

  if (
    options.highestSequenceSeen !== undefined &&
    payload.sequence === options.highestSequenceSeen &&
    options.highestSequencePayloadSha256 &&
    options.highestSequencePayloadSha256 !== payloadSha256
  ) {
    return {
      ok: false,
      code: "sequence_hash_mismatch",
      message: "Release manifest sequence reused with different payload hash",
    };
  }

  if (
    options.requiredTarget &&
    !(payload.publishedTargets as readonly string[]).includes(
      options.requiredTarget,
    )
  ) {
    return {
      ok: false,
      code: "absent_target",
      message: `Runtime target ${options.requiredTarget} is not published in this manifest`,
    };
  }

  if (options.requiredPairId && isPairRevoked(payload, options.requiredPairId)) {
    return {
      ok: false,
      code: "revoked_pair",
      message: `Compatibility pair ${options.requiredPairId} is revoked`,
    };
  }

  return {
    ok: true,
    payload,
    envelope,
    acceptedKeyId,
    payloadSha256,
    sequence: payload.sequence,
  };
}

/** Expose key-ring type for callers that build rings from license helpers. */
export type { KeyRing, PublicJwk };
