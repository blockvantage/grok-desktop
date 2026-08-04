/**
 * Signed Desk/Grok compatibility release manifest (v1).
 *
 * Wire envelope: `{ schemaVersion: 1, payloadBase64Url, signatures[] }`.
 * `payloadBase64Url` holds exact RFC 8785 UTF-8 manifest bytes (as produced by
 * the release publisher). Each signature covers:
 *   GROKDESK-RELEASE-MANIFEST-V1\n<payloadBase64Url>
 */
import { z } from "zod";
import {
  CANONICAL_RUNTIME_TARGETS,
  type CanonicalRuntimeTarget,
} from "./runtime-target.js";

export const RELEASE_MANIFEST_SIGNATURE_DOMAIN =
  "GROKDESK-RELEASE-MANIFEST-V1" as const;

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1 as const;

export const ReleaseChannelSchema = z.enum(["stable", "beta"]);
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

export const CanonicalRuntimeTargetSchema = z.enum(CANONICAL_RUNTIME_TARGETS);
export type { CanonicalRuntimeTarget };

const Sha256Schema = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/, "sha256 must be 64 hex chars");

/** Defense-in-depth string caps (HTTP body already size-limited at 1 MiB). */
const VER_MAX = 64;
const ID_MAX = 256;
const SHORT_MAX = 512;
const NOTES_MAX = 8_000;
const ISO_MAX = 64;
const ENDPOINT_MAX = 2_048;
const KEY_ID_MAX = 128;
const SIG_MAX = 256;
const SALT_MAX = 128;
/** ~1 MiB base64url budget for the signed payload body. */
const PAYLOAD_B64_MAX = 1_400_000;

export const ProvenanceSchema = z.object({
  source: z.string().min(1).max(SHORT_MAX),
  retrievedAt: z.string().min(1).max(ISO_MAX),
  officialUrl: z.string().url().max(ENDPOINT_MAX).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const SigningPolicySchema = z.object({
  requirePlatformSignature: z.boolean(),
  macTeamId: z.string().min(1).max(64).optional(),
  macDesignatedRequirement: z.string().min(1).max(NOTES_MAX).optional(),
  windowsSubject: z.string().min(1).max(SHORT_MAX).optional(),
  windowsThumbprint: z.string().min(1).max(128).optional(),
});
export type SigningPolicy = z.infer<typeof SigningPolicySchema>;

export const ReleaseArtifactSchema = z.object({
  artifactId: z.string().min(1).max(ID_MAX),
  kind: z.enum(["desk", "grok"]),
  version: z.string().min(1).max(VER_MAX),
  target: CanonicalRuntimeTargetSchema,
  channel: ReleaseChannelSchema,
  grantEndpoint: z.string().min(1).max(ENDPOINT_MAX),
  sizeBytes: z.number().int().nonnegative(),
  sha256: Sha256Schema,
  provenance: ProvenanceSchema,
  signingPolicy: SigningPolicySchema,
  capabilities: z.array(z.string().min(1).max(128)).max(64).optional(),
  notes: z.string().max(NOTES_MAX).optional(),
});
export type ReleaseArtifact = z.infer<typeof ReleaseArtifactSchema>;

export const CompatibilityPairSchema = z.object({
  pairId: z.string().min(1).max(ID_MAX),
  channel: ReleaseChannelSchema,
  target: CanonicalRuntimeTargetSchema,
  deskVersion: z.string().min(1).max(VER_MAX),
  grokVersion: z.string().min(1).max(VER_MAX),
  deskArtifactId: z.string().min(1).max(ID_MAX),
  grokArtifactId: z.string().min(1).max(ID_MAX),
  capabilities: z.array(z.string().min(1).max(128)).max(64).default([]),
  recommended: z.boolean().optional(),
});
export type CompatibilityPair = z.infer<typeof CompatibilityPairSchema>;

export const ChannelCatalogSchema = z.object({
  desk: z.array(ReleaseArtifactSchema).max(256),
  grok: z.array(ReleaseArtifactSchema).max(256),
  pairs: z.array(CompatibilityPairSchema).max(512),
});
export type ChannelCatalog = z.infer<typeof ChannelCatalogSchema>;

export const RolloutPolicySchema = z.object({
  /** 0–10000 inclusive; 10000 = 100% of cohort. */
  basisPoints: z.number().int().min(0).max(10000),
  salt: z.string().min(1).max(SALT_MAX),
});
export type RolloutPolicy = z.infer<typeof RolloutPolicySchema>;

export const RevocationSchema = z.object({
  kind: z.enum(["version", "artifact", "pair"]),
  id: z.string().min(1).max(ID_MAX),
  reason: z.string().max(NOTES_MAX).optional(),
  revokedAt: z.string().min(1).max(ISO_MAX),
});
export type Revocation = z.infer<typeof RevocationSchema>;

export const AuthorizedDowngradeEdgeSchema = z.object({
  fromDeskVersion: z.string().min(1).max(VER_MAX),
  toDeskVersion: z.string().min(1).max(VER_MAX),
  fromGrokVersion: z.string().min(1).max(VER_MAX).optional(),
  toGrokVersion: z.string().min(1).max(VER_MAX).optional(),
  target: CanonicalRuntimeTargetSchema,
  channel: ReleaseChannelSchema,
  reason: z.string().max(NOTES_MAX).optional(),
});
export type AuthorizedDowngradeEdge = z.infer<
  typeof AuthorizedDowngradeEdgeSchema
>;

export const CompatibilityManifestPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  sequence: z.number().int().nonnegative(),
  issuedAt: z.string().min(1).max(ISO_MAX),
  expiresAt: z.string().min(1).max(ISO_MAX),
  publishedTargets: z.array(CanonicalRuntimeTargetSchema).min(1).max(32),
  channels: z.object({
    stable: ChannelCatalogSchema,
    beta: ChannelCatalogSchema.optional(),
  }),
  rollout: RolloutPolicySchema,
  securityDeadline: z.string().min(1).max(ISO_MAX).nullable().optional(),
  revocations: z.array(RevocationSchema).max(1_000).default([]),
  authorizedDowngradeEdges: z
    .array(AuthorizedDowngradeEdgeSchema)
    .max(256)
    .default([]),
  releaseNotesUrl: z.string().url().max(ENDPOINT_MAX).optional(),
  supportUrl: z.string().url().max(ENDPOINT_MAX).optional(),
  minDeskVersion: z.string().min(1).max(VER_MAX).optional(),
  maxDeskVersion: z.string().min(1).max(VER_MAX).optional(),
  recommendedDeskVersion: z.string().min(1).max(VER_MAX).optional(),
  minGrokVersion: z.string().min(1).max(VER_MAX).optional(),
  recommendedGrokVersion: z.string().min(1).max(VER_MAX).optional(),
});
export type CompatibilityManifestPayload = z.infer<
  typeof CompatibilityManifestPayloadSchema
>;

export const ManifestSignatureSchema = z.object({
  algorithm: z.literal("Ed25519"),
  keyId: z.string().min(1).max(KEY_ID_MAX),
  signatureBase64Url: z.string().min(1).max(SIG_MAX),
});
export type ManifestSignature = z.infer<typeof ManifestSignatureSchema>;

export const SignedCompatibilityEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  payloadBase64Url: z.string().min(1).max(PAYLOAD_B64_MAX),
  signatures: z.array(ManifestSignatureSchema).min(1).max(8),
});
export type SignedCompatibilityEnvelope = z.infer<
  typeof SignedCompatibilityEnvelopeSchema
>;

/** Base64url (no padding) helpers — browser and Node safe. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(bin)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const raw =
    typeof atob !== "undefined"
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, "base64").toString("binary");
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Minimal RFC 8785-style deterministic JSON (sorted object keys, no whitespace).
 * The release publisher is the authority for signed bytes; this helper is for
 * tests and local fixture construction.
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortValue(obj[key]);
  }
  return sorted;
}

export function encodeManifestPayload(
  payload: CompatibilityManifestPayload,
): string {
  const parsed = CompatibilityManifestPayloadSchema.parse(payload);
  const bytes = new TextEncoder().encode(canonicalizeJson(parsed));
  return bytesToBase64Url(bytes);
}

export function decodeManifestPayload(
  payloadBase64Url: string,
): CompatibilityManifestPayload {
  const json = new TextDecoder().decode(base64UrlToBytes(payloadBase64Url));
  return parseCompatibilityManifestPayload(JSON.parse(json));
}

export function parseCompatibilityManifestPayload(
  input: unknown,
): CompatibilityManifestPayload {
  return CompatibilityManifestPayloadSchema.parse(input);
}

export function parseSignedCompatibilityEnvelope(
  input: unknown,
): SignedCompatibilityEnvelope {
  return SignedCompatibilityEnvelopeSchema.parse(input);
}

export function buildSignatureMessage(payloadBase64Url: string): string {
  return `${RELEASE_MANIFEST_SIGNATURE_DOMAIN}\n${payloadBase64Url}`;
}

export function signatureMessageBytes(payloadBase64Url: string): Uint8Array {
  return new TextEncoder().encode(buildSignatureMessage(payloadBase64Url));
}

/** Lookup an artifact by id within a single channel catalog. */
export function findArtifactInCatalog(
  catalog: ChannelCatalog,
  artifactId: string,
): ReleaseArtifact | undefined {
  for (const a of catalog.desk) if (a.artifactId === artifactId) return a;
  for (const a of catalog.grok) if (a.artifactId === artifactId) return a;
  return undefined;
}

/**
 * Lookup an artifact by id across stable/beta catalogs.
 * When `preferredChannel` is set, that catalog is searched first so
 * cross-channel id collisions resolve to the pair's channel.
 */
export function findArtifact(
  payload: CompatibilityManifestPayload,
  artifactId: string,
  preferredChannel?: ReleaseChannel,
): ReleaseArtifact | undefined {
  const ordered: ChannelCatalog[] = [];
  if (preferredChannel === "beta") {
    if (payload.channels.beta) ordered.push(payload.channels.beta);
    ordered.push(payload.channels.stable);
  } else if (preferredChannel === "stable") {
    ordered.push(payload.channels.stable);
    if (payload.channels.beta) ordered.push(payload.channels.beta);
  } else {
    ordered.push(payload.channels.stable);
    if (payload.channels.beta) ordered.push(payload.channels.beta);
  }
  for (const cat of ordered) {
    const hit = findArtifactInCatalog(cat, artifactId);
    if (hit) return hit;
  }
  return undefined;
}
