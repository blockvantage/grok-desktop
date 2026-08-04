/**
 * @grokdesk/license
 *
 * Pure GD3 / lease and signed-manifest verification primitives.
 */

// --- Pure verification (C1) ---
export {
  base64urlEncode,
  base64urlDecode,
  utf8Bytes,
  toHex,
  fromHex,
} from "./base64url.js";

export {
  canonicalizeJson,
  canonicalBytes,
  canonicalBase64Url,
} from "./canonical.js";

export {
  type PublicJwk,
  type KeyRing,
  importPublicJwk,
  resolvePublicKey,
  ed25519Verify,
  ed25519VerifyBase64Url,
  buildKeyRing,
} from "./key-ring.js";

export {
  STABLE_ERROR_CODES,
  stableErrorCodes,
  STABLE_ERROR_MESSAGES,
  STABLE_ERROR_STATUS,
  isStableErrorCode,
  type StableErrorCode,
  type StableEntitlementError,
  type CryptoLocalErrorCode,
  type LicenseVerifyErrorCode,
} from "./errors.js";

export {
  PRODUCT_ID,
  PRODUCT_KEY_SCHEMA,
  PRODUCT_KEY_SEAT_LIMIT,
  PRODUCT_KEY_UPDATE_POLICY,
  extractGd3,
  productKeySigningInput,
  canonicalizeProductKeyClaims,
  parseProductKey,
  verifyProductKey,
  type ProductKeyClaims,
  type ProductKeyVerifyOptions,
  type ProductKeyVerifyResult,
  type ProductKeyErrorCode,
} from "./product-key.js";

export {
  ACTIVATE_PREFIX,
  LEASE_REFRESH_PREFIX,
  rfc7638JwkThumbprint,
  buildProofSigningMaterial,
  verifyActivationProof,
  verifyLeaseRefreshProof,
  type DevicePublicJwk,
  type ActivationProofPayload,
  type LeaseRefreshProofPayload,
  type DeviceProofVerifyResult,
  type DeviceProofErrorCode,
} from "./device-proof.js";

export {
  LEASE_TYP,
  LEASE_ALG,
  LEASE_PRODUCT_ID,
  LEASE_SEAT_LIMIT,
  LEASE_UPDATE_POLICY,
  LEASE_TTL_SECONDS,
  LEASE_REFRESH_AFTER_SECONDS,
  verifyDeviceLease,
  verifyLease,
  type DeviceLeaseClaims,
  type DeviceLeaseVerifyOptions,
  type DeviceLeaseVerifyResult,
} from "./lease.js";

export {
  deriveEntitlementState,
  type LeaseDecision,
  type AuthoritativeDenial,
  type DeriveEntitlementStateInput,
} from "./status.js";

export {
  RELEASE_MANIFEST_PREFIX,
  RELEASE_MANIFEST_SCHEMA,
  buildManifestSigningMaterial,
  verifyReleaseManifest,
  type ReleaseManifestSignature,
  type SignedReleaseManifestEnvelope,
  type ReleaseManifestPayload,
  type ChannelReleases,
  type ReleaseArtifactRef,
  type CompatibilityPair,
  type ReleaseManifestVerifyOptions,
  type ReleaseManifestVerifyResult,
} from "./release-manifest.js";
