/**
 * Bundled lease-verification public key ring (public material only).
 *
 * Private lease signers never ship in Desk. Production keys are injected at
 * build time via `__GROKDESK_LEASE_PUBLIC_KEYS__` or runtime env
 * `GROKDESK_LEASE_PUBLIC_JWKS` / `GROKDESK_LEASE_PUBLIC_KEYS`. Offline
 * well-known fetch failures still leave a non-empty ring when baked keys exist.
 */

import type { PublicJwk } from "@grokdesk/license";

declare const __GROKDESK_LEASE_PUBLIC_KEYS__: string | undefined;

/** Max raw JWKS JSON accepted from env/bake (defense against hostile env). */
export const LEASE_PUBLIC_JWKS_MAX_CHARS = 64 * 1024;
/** Soft cap on accepted public keys in a ring. */
export const LEASE_PUBLIC_JWKS_MAX_KEYS = 32;

function isOkpEd25519PublicJwk(value: unknown): value is PublicJwk {
  if (typeof value !== "object" || value === null) return false;
  const j = value as Record<string, unknown>;
  return (
    j.kty === "OKP" &&
    j.crv === "Ed25519" &&
    typeof j.x === "string" &&
    j.x.length > 0 &&
    j.x.length <= 256 &&
    typeof j.kid === "string" &&
    j.kid.length > 0 &&
    j.kid.length <= 128
  );
}

/** Parse a JSON array or JWKS `{ keys: [...] }` into public lease JWKs. */
export function parseLeasePublicJwksList(raw: string): PublicJwk[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  if (raw.length > LEASE_PUBLIC_JWKS_MAX_CHARS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  let list: unknown[];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { keys?: unknown }).keys)
  ) {
    list = (parsed as { keys: unknown[] }).keys;
  } else {
    return [];
  }
  const out: PublicJwk[] = [];
  for (const item of list) {
    if (out.length >= LEASE_PUBLIC_JWKS_MAX_KEYS) break;
    if (!isOkpEd25519PublicJwk(item)) continue;
    out.push({
      kty: "OKP",
      crv: "Ed25519",
      x: item.x,
      kid: item.kid!,
      ...(typeof item.alg === "string" && item.alg.length <= 32
        ? { alg: item.alg }
        : {}),
      ...(typeof item.use === "string" && item.use.length <= 16
        ? { use: item.use }
        : {}),
    });
  }
  return out;
}

/**
 * Built-in lease public keys from env or build-time define.
 * Never includes private material.
 */
export function getBuiltInLeasePublicJwks(): PublicJwk[] {
  const fromEnv =
    process.env.GROKDESK_LEASE_PUBLIC_JWKS?.trim() ||
    process.env.GROKDESK_LEASE_PUBLIC_KEYS?.trim() ||
    "";
  if (fromEnv) return parseLeasePublicJwksList(fromEnv);

  const baked =
    typeof __GROKDESK_LEASE_PUBLIC_KEYS__ === "string"
      ? __GROKDESK_LEASE_PUBLIC_KEYS__.trim()
      : "";
  if (baked) return parseLeasePublicJwksList(baked);
  return [];
}

/**
 * Refresh safe metadata for the baked trust root.
 *
 * The first ring is authoritative. Later/network rings cannot add a kid or
 * replace key material; they may only refresh metadata for an exact pinned key.
 */
export function mergeLeasePublicJwks(
  baked: ReadonlyArray<PublicJwk>,
  ...metadataRings: ReadonlyArray<ReadonlyArray<PublicJwk>>
): PublicJwk[] {
  return baked.map((pinned) => {
    let current = { ...pinned };
    for (const ring of metadataRings) {
      const match = ring.find(
        (candidate) =>
          candidate.kid === pinned.kid &&
          candidate.kty === pinned.kty &&
          candidate.crv === pinned.crv &&
          candidate.x === pinned.x,
      );
      if (match) {
        current = {
          ...current,
          ...(typeof match.alg === "string" ? { alg: match.alg } : {}),
          ...(typeof match.use === "string" ? { use: match.use } : {}),
        };
      }
    }
    return current;
  });
}
