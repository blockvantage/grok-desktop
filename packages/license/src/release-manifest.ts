import type { KeyObject } from "node:crypto";
import type { CanonicalTarget } from "@grokdesk/shared";
import { base64urlDecode, base64urlEncode, toHex, utf8Bytes } from "./base64url.js";
import { canonicalizeJson } from "./canonical.js";
import {
  ed25519Verify,
  resolvePublicKey,
  type PublicJwk,
} from "./key-ring.js";

/**
 * Release manifest envelope verification (public keys only).
 *
 *   payloadBase64Url = base64url(RFC8785 payload)
 *   signing input    = GROKDESK-RELEASE-MANIFEST-V1\n<payloadBase64Url>
 */

export const RELEASE_MANIFEST_PREFIX = "GROKDESK-RELEASE-MANIFEST-V1";
export const RELEASE_MANIFEST_SCHEMA = 1 as const;

export type ReleaseManifestSignature = {
  algorithm: "Ed25519";
  keyId: string;
  signatureBase64Url: string;
};

export type SignedReleaseManifestEnvelope = {
  schemaVersion: 1;
  payloadBase64Url: string;
  signatures: ReleaseManifestSignature[];
};

export type ReleaseArtifactRef = {
  version: string;
  artifactId: string;
  sizeBytes: number;
  sha256: string;
  provenance: string;
};

export type ChannelReleases = {
  desk: Partial<Record<CanonicalTarget, ReleaseArtifactRef>>;
  grok: Partial<Record<CanonicalTarget, ReleaseArtifactRef>>;
};

export type CompatibilityPair = {
  deskVersion: string;
  grokVersion: string;
  targets: CanonicalTarget[];
};

export type ReleaseManifestPayload = {
  schema: typeof RELEASE_MANIFEST_SCHEMA;
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  channels: {
    stable: ChannelReleases;
    beta: ChannelReleases;
  };
  compatibilityPairs: CompatibilityPair[];
  revocations: string[];
  rollout: {
    basisPoints: number;
    salt: string;
  };
  securityDeadline: string | null;
  releaseNotesUrl: string;
  supportUrl: string;
};

export type ReleaseManifestVerifyOptions = {
  keys: ReadonlyMap<string, KeyObject | PublicJwk>;
  nowMs?: number;
  /** Highest sequence previously accepted (anti-rollback). */
  highestSequenceSeen?: number;
};

export type ReleaseManifestVerifyResult =
  | {
      ok: true;
      payload: ReleaseManifestPayload;
      envelope: SignedReleaseManifestEnvelope;
      acceptedKeyId: string;
    }
  | {
      ok: false;
      code:
        | "invalid_key_signature"
        | "invalid_key_format"
        | "unknown_key"
        | "lease_expired"
        | "sequence_rollback";
      message: string;
    };

export function buildManifestSigningMaterial(payload: ReleaseManifestPayload): {
  payloadCanonical: string;
  payloadBase64Url: string;
  signingString: string;
  signingBytes: Buffer;
  signingBytesHex: string;
  payloadCanonicalHex: string;
} {
  const payloadCanonical = canonicalizeJson(payload);
  const payloadBase64Url = base64urlEncode(payloadCanonical);
  const signingString = `${RELEASE_MANIFEST_PREFIX}\n${payloadBase64Url}`;
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

export function verifyReleaseManifest(
  envelope: SignedReleaseManifestEnvelope,
  options: ReleaseManifestVerifyOptions,
): ReleaseManifestVerifyResult {
  if (!envelope || envelope.schemaVersion !== 1) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Manifest envelope schema invalid",
    };
  }
  if (
    typeof envelope.payloadBase64Url !== "string" ||
    envelope.payloadBase64Url.length === 0 ||
    !Array.isArray(envelope.signatures) ||
    envelope.signatures.length === 0
  ) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Manifest envelope incomplete",
    };
  }

  let payloadCanonical: string;
  try {
    payloadCanonical = base64urlDecode(envelope.payloadBase64Url).toString("utf8");
  } catch {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Manifest payload encoding invalid",
    };
  }

  let payloadUnknown: unknown;
  try {
    payloadUnknown = JSON.parse(payloadCanonical);
  } catch {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Manifest payload is not JSON",
    };
  }

  if (!isReleaseManifestPayload(payloadUnknown)) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Manifest payload shape invalid",
    };
  }

  const reCanonical = canonicalizeJson(payloadUnknown);
  if (reCanonical !== payloadCanonical) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Manifest payload is not RFC 8785 canonical",
    };
  }

  const signingString = `${RELEASE_MANIFEST_PREFIX}\n${envelope.payloadBase64Url}`;
  const signingBytes = utf8Bytes(signingString);

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
      publicKey = resolvePublicKey(keyMaterial);
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
      code: "invalid_key_signature",
      message: "Release manifest signature is invalid",
    };
  }

  const now = options.nowMs ?? Date.now();
  const expiresAtMs = Date.parse(payloadUnknown.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
    return {
      ok: false,
      code: "lease_expired",
      message: "Release manifest has expired",
    };
  }

  if (
    options.highestSequenceSeen !== undefined &&
    payloadUnknown.sequence < options.highestSequenceSeen
  ) {
    return {
      ok: false,
      code: "sequence_rollback",
      message: "Release manifest sequence rollback",
    };
  }

  return {
    ok: true,
    payload: payloadUnknown,
    envelope,
    acceptedKeyId,
  };
}

function isReleaseManifestPayload(
  value: unknown,
): value is ReleaseManifestPayload {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    o.schema === 1 &&
    typeof o.sequence === "number" &&
    Number.isInteger(o.sequence) &&
    o.sequence >= 1 &&
    typeof o.issuedAt === "string" &&
    typeof o.expiresAt === "string" &&
    typeof o.channels === "object" &&
    o.channels !== null &&
    Array.isArray(o.compatibilityPairs) &&
    Array.isArray(o.revocations) &&
    typeof o.rollout === "object" &&
    o.rollout !== null &&
    typeof o.releaseNotesUrl === "string" &&
    typeof o.supportUrl === "string"
  );
}
