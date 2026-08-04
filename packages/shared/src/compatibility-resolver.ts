/**
 * Resolve one exact Desk/Grok compatibility pair from a signed manifest.
 *
 * Rules:
 * - Exact pairs only (never independently latest desk + latest grok).
 * - Channel opt-in: stable clients never receive beta pairs.
 * - SemVer (including prereleases) for all version ordering.
 * - Cohort: SHA-256(`${deviceCohortId}:${salt}`) → basis points bucket.
 * - Security deadline and revocations override rollout percentage.
 * - Downgrades (lower SemVer precedence) require an authorized edge.
 */
import semver from "semver";
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  AuthorizedDowngradeEdge,
  CompatibilityManifestPayload,
  CompatibilityPair,
  ReleaseArtifact,
  ReleaseChannel,
  Revocation,
} from "./compatibility-manifest.js";
import { findArtifact } from "./compatibility-manifest.js";
import {
  isCanonicalRuntimeTarget,
  isPublishedTarget,
  type CanonicalRuntimeTarget,
  type RuntimeTarget,
} from "./runtime-target.js";

export type ResolvePairInput = {
  target: RuntimeTarget | string;
  /** Opted-in update channel. Stable never silently becomes beta. */
  channel: ReleaseChannel;
  installedDeskVersion: string;
  installedGrokVersion: string;
  /** Opaque device cohort identifier (not a user PII field). */
  deviceCohortId: string;
  /** Wall-clock ms for deadline evaluation. */
  now?: number;
};

export type ResolvedPairReason =
  | "upgrade"
  | "current"
  | "security"
  | "downgrade"
  | "channel_switch";

export type ResolvedPair = {
  pairId: string;
  channel: ReleaseChannel;
  target: CanonicalRuntimeTarget;
  deskVersion: string;
  grokVersion: string;
  deskArtifactId: string;
  grokArtifactId: string;
  capabilities: string[];
  deskArtifact: ReleaseArtifact;
  grokArtifact: ReleaseArtifact;
  reason: ResolvedPairReason;
  securityForced: boolean;
};

export function compareSemver(a: string, b: string): number {
  const ca = semver.coerce(a, { includePrerelease: true });
  const cb = semver.coerce(b, { includePrerelease: true });
  // Prefer full valid parses; fall back to coerced when needed.
  const va = semver.valid(a) ?? ca?.version;
  const vb = semver.valid(b) ?? cb?.version;
  if (!va || !vb) {
    // Last resort: invalid versions never rank above valid ones.
    if (va && !vb) return 1;
    if (!va && vb) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return semver.compare(va, vb, true /* loose for safety */);
}

/**
 * Cohort membership: first 4 bytes of SHA-256(`${deviceCohortId}:${salt}`)
 * as uint32 mod 10000 compared to basisPoints.
 */
export function isInRolloutCohort(
  deviceCohortId: string,
  salt: string,
  basisPoints: number,
): boolean {
  if (basisPoints <= 0) return false;
  if (basisPoints >= 10000) return true;
  const material = new TextEncoder().encode(`${deviceCohortId}:${salt}`);
  const digest = sha256(material);
  const bucket =
    ((digest[0]! << 24) |
      (digest[1]! << 16) |
      (digest[2]! << 8) |
      digest[3]!) >>>
    0;
  return bucket % 10000 < basisPoints;
}

function isRevoked(
  revocations: readonly Revocation[],
  pair: CompatibilityPair,
  desk: ReleaseArtifact,
  grok: ReleaseArtifact,
): boolean {
  for (const r of revocations) {
    if (r.kind === "pair" && r.id === pair.pairId) return true;
    if (r.kind === "artifact" && (r.id === desk.artifactId || r.id === grok.artifactId)) {
      return true;
    }
    if (
      r.kind === "version" &&
      (r.id === pair.deskVersion ||
        r.id === pair.grokVersion ||
        r.id === desk.version ||
        r.id === grok.version)
    ) {
      return true;
    }
  }
  return false;
}

function hasDowngradeEdge(
  edges: readonly AuthorizedDowngradeEdge[],
  input: ResolvePairInput,
  pair: CompatibilityPair,
): boolean {
  return edges.some(
    (e) =>
      e.target === pair.target &&
      e.channel === pair.channel &&
      e.fromDeskVersion === input.installedDeskVersion &&
      e.toDeskVersion === pair.deskVersion &&
      (e.fromGrokVersion == null ||
        e.fromGrokVersion === input.installedGrokVersion) &&
      (e.toGrokVersion == null || e.toGrokVersion === pair.grokVersion),
  );
}

function comparePairs(a: CompatibilityPair, b: CompatibilityPair): number {
  const desk = compareSemver(a.deskVersion, b.deskVersion);
  if (desk !== 0) return desk;
  return compareSemver(a.grokVersion, b.grokVersion);
}

function isDowngrade(
  input: ResolvePairInput,
  pair: CompatibilityPair,
): boolean {
  const deskCmp = compareSemver(pair.deskVersion, input.installedDeskVersion);
  const grokCmp = compareSemver(pair.grokVersion, input.installedGrokVersion);
  // Any SemVer decrease requires an authorized downgrade edge.
  return deskCmp < 0 || grokCmp < 0;
}

function isCurrent(input: ResolvePairInput, pair: CompatibilityPair): boolean {
  return (
    compareSemver(pair.deskVersion, input.installedDeskVersion) === 0 &&
    compareSemver(pair.grokVersion, input.installedGrokVersion) === 0
  );
}

function allowedChannels(channel: ReleaseChannel): ReleaseChannel[] {
  // Beta opt-in may also see stable; stable never sees beta.
  if (channel === "beta") return ["beta", "stable"];
  return ["stable"];
}

/**
 * Select the single best exact compatibility pair for the running target.
 * Returns null when no allowed pair exists (missing target, channel, rollout,
 * revocations, or unauthorized downgrade).
 */
export function resolvePair(
  manifest: CompatibilityManifestPayload,
  input: ResolvePairInput,
): ResolvedPair | null {
  if (!isCanonicalRuntimeTarget(input.target)) return null;
  const target = input.target;
  if (!isPublishedTarget(target, manifest.publishedTargets)) return null;

  const now = input.now ?? Date.now();
  const deadlineMs =
    manifest.securityDeadline != null && manifest.securityDeadline !== ""
      ? Date.parse(manifest.securityDeadline)
      : NaN;
  const pastDeadline = Number.isFinite(deadlineMs) && now >= deadlineMs;

  const channels = allowedChannels(input.channel);
  const candidates: Array<{
    pair: CompatibilityPair;
    desk: ReleaseArtifact;
    grok: ReleaseArtifact;
    channel: ReleaseChannel;
  }> = [];

  for (const ch of channels) {
    const catalog =
      ch === "stable" ? manifest.channels.stable : manifest.channels.beta;
    if (!catalog) continue;
    for (const p of catalog.pairs) {
      if (p.target !== target) continue;
      if (p.channel !== ch) continue;
      // Prefer the pair's channel catalog so cross-channel id collisions
      // resolve to the matching channel's artifact first.
      const desk = findArtifact(manifest, p.deskArtifactId, ch);
      const grok = findArtifact(manifest, p.grokArtifactId, ch);
      if (!desk || !grok) continue;
      // Exact pair roles: desk slot must be desk, grok slot must be grok.
      if (desk.kind !== "desk" || grok.kind !== "grok") continue;
      // Artifact channel must agree with the pair / selected catalog channel.
      if (desk.channel !== ch || grok.channel !== ch) continue;
      if (desk.target !== target || grok.target !== target) continue;
      if (desk.version !== p.deskVersion || grok.version !== p.grokVersion) {
        continue;
      }
      if (isRevoked(manifest.revocations, p, desk, grok)) continue;
      candidates.push({ pair: p, desk, grok, channel: ch });
    }
  }

  if (candidates.length === 0) return null;

  // Prefer the opted-in channel, then highest SemVer pair, recommended flag as tie-break.
  candidates.sort((a, b) => {
    if (a.channel !== b.channel) {
      // Prefer matching requested channel first
      if (a.channel === input.channel) return -1;
      if (b.channel === input.channel) return 1;
    }
    const cmp = comparePairs(b.pair, a.pair);
    if (cmp !== 0) return cmp;
    const ar = a.pair.recommended ? 1 : 0;
    const br = b.pair.recommended ? 1 : 0;
    return br - ar;
  });

  // Evaluate candidates in sorted order for first acceptable move.
  for (const c of candidates) {
    const current = isCurrent(input, c.pair);
    const downgrade = isDowngrade(input, c.pair);

    if (downgrade && !current) {
      if (!hasDowngradeEdge(manifest.authorizedDowngradeEdges, input, c.pair)) {
        continue;
      }
    }

    // Rollout gate for non-current pairs. Security deadline / forced security overrides %.
    if (!current) {
      const inCohort = isInRolloutCohort(
        input.deviceCohortId,
        manifest.rollout.salt,
        manifest.rollout.basisPoints,
      );
      if (!inCohort && !pastDeadline) {
        continue;
      }
    }

    let reason: ResolvedPairReason;
    let securityForced = false;
    if (current) {
      reason = "current";
    } else if (downgrade) {
      reason = "downgrade";
    } else if (
      c.channel !== input.channel &&
      input.channel === "beta" &&
      c.channel === "stable"
    ) {
      reason = "channel_switch";
    } else {
      reason = "upgrade";
    }
    if (pastDeadline && !current) {
      securityForced = true;
      if (reason === "upgrade") reason = "security";
    }

    return {
      pairId: c.pair.pairId,
      channel: c.channel,
      target,
      deskVersion: c.pair.deskVersion,
      grokVersion: c.pair.grokVersion,
      deskArtifactId: c.pair.deskArtifactId,
      grokArtifactId: c.pair.grokArtifactId,
      capabilities: c.pair.capabilities ?? [],
      deskArtifact: c.desk,
      grokArtifact: c.grok,
      reason,
      securityForced,
    };
  }

  return null;
}
