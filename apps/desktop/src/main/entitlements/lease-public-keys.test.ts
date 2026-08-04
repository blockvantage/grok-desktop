import { afterEach, describe, expect, it } from "vitest";
import {
  getBuiltInLeasePublicJwks,
  LEASE_PUBLIC_JWKS_MAX_CHARS,
  LEASE_PUBLIC_JWKS_MAX_KEYS,
  mergeLeasePublicJwks,
  parseLeasePublicJwksList,
} from "./lease-public-keys.js";

const SAMPLE = {
  kty: "OKP" as const,
  crv: "Ed25519" as const,
  x: "yQd1GM-kOHZ-1oxxgXjPGpI0PTxf_IVPImWLZcuiYvA",
  kid: "lease-test-1",
  alg: "EdDSA",
};

describe("lease-public-keys", () => {
  const prevJwks = process.env.GROKDESK_LEASE_PUBLIC_JWKS;
  const prevKeys = process.env.GROKDESK_LEASE_PUBLIC_KEYS;

  afterEach(() => {
    if (prevJwks === undefined) delete process.env.GROKDESK_LEASE_PUBLIC_JWKS;
    else process.env.GROKDESK_LEASE_PUBLIC_JWKS = prevJwks;
    if (prevKeys === undefined) delete process.env.GROKDESK_LEASE_PUBLIC_KEYS;
    else process.env.GROKDESK_LEASE_PUBLIC_KEYS = prevKeys;
  });

  it("parses bare array and JWKS envelope; rejects private material shapes", () => {
    expect(parseLeasePublicJwksList(JSON.stringify([SAMPLE]))).toEqual([
      SAMPLE,
    ]);
    expect(
      parseLeasePublicJwksList(JSON.stringify({ keys: [SAMPLE] })),
    ).toEqual([SAMPLE]);
    expect(parseLeasePublicJwksList("not-json")).toEqual([]);
    expect(
      parseLeasePublicJwksList(
        JSON.stringify([{ kty: "OKP", crv: "Ed25519", d: "secret", kid: "x" }]),
      ),
    ).toEqual([]);
  });

  it("rejects oversized raw JWKS and caps key count", () => {
    expect(
      parseLeasePublicJwksList("x".repeat(LEASE_PUBLIC_JWKS_MAX_CHARS + 1)),
    ).toEqual([]);
    const many = Array.from({ length: LEASE_PUBLIC_JWKS_MAX_KEYS + 5 }, (_, i) => ({
      ...SAMPLE,
      kid: `lease-${i}`,
    }));
    expect(parseLeasePublicJwksList(JSON.stringify(many))).toHaveLength(
      LEASE_PUBLIC_JWKS_MAX_KEYS,
    );
    expect(
      parseLeasePublicJwksList(
        JSON.stringify([{ ...SAMPLE, kid: "k".repeat(200) }]),
      ),
    ).toEqual([]);
  });

  it("loads built-in keys from env (public only)", () => {
    process.env.GROKDESK_LEASE_PUBLIC_JWKS = JSON.stringify([SAMPLE]);
    const keys = getBuiltInLeasePublicJwks();
    expect(keys).toHaveLength(1);
    expect(keys[0]?.kid).toBe("lease-test-1");
    expect(JSON.stringify(keys)).not.toMatch(/private|pkcs8|"d":/i);
  });

  it("rejects attacker-supplied fetched key material and fetched-only kids", () => {
    const pinned = { ...SAMPLE, x: "PINNED" };
    const substituted = { ...SAMPLE, x: "ATTACKER" };
    const injected = { ...SAMPLE, kid: "attacker-only", x: "ATTACKER2" };

    expect(mergeLeasePublicJwks([pinned], [substituted, injected])).toEqual([
      pinned,
    ]);
  });

  it("keeps baked rotation overlap authoritative while refreshing safe metadata", () => {
    const oldPinned = { ...SAMPLE, kid: "lease-old", alg: undefined };
    const newPinned = { ...SAMPLE, kid: "lease-new", x: "NEW", use: undefined };
    const fetchedNew = {
      ...newPinned,
      alg: "EdDSA",
      use: "sig",
    };

    expect(mergeLeasePublicJwks([oldPinned, newPinned], [fetchedNew])).toEqual([
      oldPinned,
      { ...newPinned, alg: "EdDSA", use: "sig" },
    ]);
  });

  it("accepts GROKDESK_LEASE_PUBLIC_KEYS alias used by electron.vite bake", () => {
    delete process.env.GROKDESK_LEASE_PUBLIC_JWKS;
    process.env.GROKDESK_LEASE_PUBLIC_KEYS = JSON.stringify([SAMPLE]);
    const keys = getBuiltInLeasePublicJwks();
    expect(keys).toHaveLength(1);
    expect(keys[0]?.kid).toBe("lease-test-1");
  });
});
